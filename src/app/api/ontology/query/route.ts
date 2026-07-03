import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';
import {
  ENTITY_SELECT,
  LINK_SELECT,
  getDbConfig,
  intelSelect,
  isEntityType,
  isUuid,
  toObjectSummary,
  type DbConfig,
} from '../objects/shared';
import type {
  GraphEdge,
  GraphQueryResponse,
  GraphTraverseStep,
  ObjectSummary,
  ObjectType,
} from '@/lib/sdk/intel/types';

export const dynamic = 'force-dynamic';

/**
 * KINTEL v2.3 — Headless read surface: the graph-shaped read
 * (PRD §10.2 graph surface). POST /api/ontology/query
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE — READ-ONLY GRAPH SURFACE (PRD §10.2)                ║
 * ║  This is the GraphQL-equivalent traversal over the governed      ║
 * ║  ontology WITHOUT a new dependency: a strictly validated query   ║
 * ║  body executed as SEQUENTIAL TENANT-SCOPED SELECTS against       ║
 * ║  intel.entity / intel.link via PostgREST — NEVER raw SQL from    ║
 * ║  the client, never a client-supplied org id, never select=*.     ║
 * ║  Zero writes. Max traversal depth 3; max 100 nodes.              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Body:
 *   {
 *     start:    { type?: ObjectType, ids?: uuid[] }   (at least one)
 *     traverse: [{ linkType?, direction: 'out'|'in'|'both', targetType? }]
 *               (max depth 3)
 *     limit:    max nodes (default 50, max 100)
 *   }
 * Response: { nodes: ObjectSummary[], edges: GraphEdge[] }
 * 400 on any bad shape or depth > 3.
 */

const MAX_DEPTH = 3;
const DEFAULT_NODE_LIMIT = 50;
const MAX_NODE_LIMIT = 100;
const MAX_START_IDS = 50;
const MAX_LINKS_PER_HOP = 500;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await handleQuery(req);
  } catch {
    return NextResponse.json(
      { error: 'Unexpected error while running the graph query.' },
      { status: 500 },
    );
  }
}

async function handleQuery(req: NextRequest): Promise<NextResponse> {
  const secret = await getSecret('INTEL_HANDOFF_SECRET');
  const tenant = resolveTenantFromRequest(req, secret);
  if (!tenant) {
    return NextResponse.json(
      { error: 'No valid tenant could be resolved for this request.' },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const validation = validateQuery(raw);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const query = validation.query;

  const db = getDbConfig();
  if (!db) {
    return NextResponse.json(
      { error: 'The object store is not configured.' },
      { status: 502 },
    );
  }

  const result = await runTraversal(db, tenant, query);
  if (result === null) {
    return NextResponse.json(
      { error: 'The object store could not be reached. Please retry.' },
      { status: 502 },
    );
  }

  return NextResponse.json(result);
}

// ---------------------------------------------------------------------------
// Strict validation — 400 on anything malformed. Never trust the body.
// ---------------------------------------------------------------------------

interface ValidatedQuery {
  startType?: ObjectType;
  startIds?: string[];
  traverse: GraphTraverseStep[];
  limit: number;
}

type QueryValidation =
  | { ok: true; query: ValidatedQuery }
  | { ok: false; error: string };

const LINK_TYPE_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function validateQuery(raw: unknown): QueryValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'The query body must be a JSON object.' };
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.start !== 'object' || body.start === null) {
    return { ok: false, error: '"start" is required and must be an object.' };
  }
  const start = body.start as Record<string, unknown>;

  const query: ValidatedQuery = { traverse: [], limit: DEFAULT_NODE_LIMIT };

  if (start.type !== undefined) {
    if (!isEntityType(start.type)) {
      return { ok: false, error: `Unknown start type "${String(start.type)}".` };
    }
    query.startType = start.type;
  }

  if (start.ids !== undefined) {
    if (!Array.isArray(start.ids) || start.ids.length === 0 || start.ids.length > MAX_START_IDS) {
      return {
        ok: false,
        error: `"start.ids" must be a non-empty array of at most ${MAX_START_IDS} ids.`,
      };
    }
    for (const id of start.ids) {
      if (!isUuid(id)) {
        return { ok: false, error: 'Every entry in "start.ids" must be a valid object id.' };
      }
    }
    query.startIds = start.ids as string[];
  }

  if (!query.startType && !query.startIds) {
    return { ok: false, error: '"start" must set "type" and/or "ids".' };
  }

  if (body.traverse !== undefined) {
    if (!Array.isArray(body.traverse)) {
      return { ok: false, error: '"traverse" must be an array of steps.' };
    }
    if (body.traverse.length > MAX_DEPTH) {
      return {
        ok: false,
        error: `Traversal depth ${body.traverse.length} exceeds the maximum of ${MAX_DEPTH}.`,
      };
    }
    for (let i = 0; i < body.traverse.length; i += 1) {
      const step = body.traverse[i];
      if (typeof step !== 'object' || step === null) {
        return { ok: false, error: `Traverse step ${i} must be an object.` };
      }
      const s = step as Record<string, unknown>;
      if (s.direction !== 'out' && s.direction !== 'in' && s.direction !== 'both') {
        return {
          ok: false,
          error: `Traverse step ${i}: "direction" must be 'out', 'in' or 'both'.`,
        };
      }
      const out: ValidatedQuery['traverse'][number] = { direction: s.direction };
      if (s.linkType !== undefined) {
        if (typeof s.linkType !== 'string' || !LINK_TYPE_RE.test(s.linkType)) {
          return { ok: false, error: `Traverse step ${i}: invalid "linkType".` };
        }
        out.linkType = s.linkType;
      }
      if (s.targetType !== undefined) {
        if (!isEntityType(s.targetType)) {
          return {
            ok: false,
            error: `Traverse step ${i}: unknown "targetType" "${String(s.targetType)}".`,
          };
        }
        out.targetType = s.targetType;
      }
      query.traverse.push(out);
    }
  }

  if (body.limit !== undefined) {
    if (typeof body.limit !== 'number' || !Number.isFinite(body.limit)) {
      return { ok: false, error: '"limit" must be a number.' };
    }
    query.limit = Math.min(Math.max(Math.trunc(body.limit), 1), MAX_NODE_LIMIT);
  }

  return { ok: true, query };
}

// ---------------------------------------------------------------------------
// Traversal — sequential tenant-scoped selects, breadth-first per step.
// Returns null only on a transport/store failure (surfaced as 502).
// ---------------------------------------------------------------------------

async function runTraversal(
  db: DbConfig,
  tenant: string,
  query: ValidatedQuery,
): Promise<GraphQueryResponse | null> {
  const nodes = new Map<string, ObjectSummary>();
  const edges = new Map<string, GraphEdge>();

  // ---- start set
  const startParams = new URLSearchParams();
  startParams.set('select', ENTITY_SELECT);
  startParams.set('tenant_id', `eq.${tenant}`);
  if (query.startType) startParams.set('type', `eq.${query.startType}`);
  if (query.startIds) startParams.set('id', `in.(${query.startIds.join(',')})`);
  startParams.set('order', 'created_at.desc');
  startParams.set('limit', String(query.limit));

  const startRows = await intelSelect(db, 'entity', startParams);
  if (startRows === null) return null;
  for (const row of startRows) {
    const summary = toObjectSummary(row);
    if (summary && nodes.size < query.limit) nodes.set(summary.id, summary);
  }

  let frontier = [...nodes.keys()];

  // ---- hops (max 3, enforced at validation)
  for (const step of query.traverse) {
    if (frontier.length === 0 || nodes.size >= query.limit) break;

    const links = await fetchHopLinks(db, tenant, frontier, step);
    if (links === null) return null;

    // Far-end ids not yet materialised as nodes.
    const farIds = new Set<string>();
    for (const link of links) {
      if (frontier.includes(link.source) && !nodes.has(link.target)) farIds.add(link.target);
      if (frontier.includes(link.target) && !nodes.has(link.source)) farIds.add(link.source);
    }

    let fetched: ObjectSummary[] = [];
    if (farIds.size > 0) {
      const capacity = query.limit - nodes.size;
      const entityParams = new URLSearchParams();
      entityParams.set('select', ENTITY_SELECT);
      entityParams.set('tenant_id', `eq.${tenant}`);
      entityParams.set('id', `in.(${[...farIds].join(',')})`);
      if (step.targetType) entityParams.set('type', `eq.${step.targetType}`);
      entityParams.set('limit', String(Math.max(capacity, 1)));

      const rows = await intelSelect(db, 'entity', entityParams);
      if (rows === null) return null;
      fetched = rows
        .map(toObjectSummary)
        .filter((o): o is ObjectSummary => o !== null)
        .slice(0, capacity);
      for (const node of fetched) nodes.set(node.id, node);
    }

    // Keep only edges whose BOTH endpoints made it into the node set —
    // nodes and edges always stay consistent for the consumer.
    for (const link of links) {
      if (nodes.has(link.source) && nodes.has(link.target)) {
        edges.set(link.id, link);
      }
    }

    frontier = fetched.map((n) => n.id);
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** One hop's tenant-scoped link select for the given frontier + step. */
async function fetchHopLinks(
  db: DbConfig,
  tenant: string,
  frontier: string[],
  step: GraphTraverseStep,
): Promise<GraphEdge[] | null> {
  const idList = frontier.join(',');
  const params = new URLSearchParams();
  params.set('select', LINK_SELECT);
  params.set('tenant_id', `eq.${tenant}`);
  if (step.linkType) params.set('type', `eq.${step.linkType}`);
  if (step.direction === 'out') {
    params.set('source_entity_id', `in.(${idList})`);
  } else if (step.direction === 'in') {
    params.set('target_entity_id', `in.(${idList})`);
  } else {
    params.set('or', `(source_entity_id.in.(${idList}),target_entity_id.in.(${idList}))`);
  }
  params.set('limit', String(MAX_LINKS_PER_HOP));

  const rows = await intelSelect(db, 'link', params);
  if (rows === null) return null;

  const links: GraphEdge[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : null;
    const source = typeof r.source_entity_id === 'string' ? r.source_entity_id : null;
    const target = typeof r.target_entity_id === 'string' ? r.target_entity_id : null;
    const type = typeof r.type === 'string' ? r.type : null;
    if (!id || !source || !target || !type) continue;
    links.push({
      id,
      source,
      target,
      type,
      properties:
        typeof r.properties === 'object' && r.properties !== null && !Array.isArray(r.properties)
          ? (r.properties as Record<string, unknown>)
          : {},
    });
  }
  return links;
}
