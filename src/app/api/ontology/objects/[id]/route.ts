import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';
import { LINK_TYPE_CATALOGUE } from '@/lib/ontology/types';
import {
  ENTITY_SELECT,
  LINK_SELECT,
  getDbConfig,
  intelSelect,
  isUuid,
  toObjectSummary,
  type DbConfig,
} from '../shared';
import type {
  ObjectDetailResponse,
  ObjectLink,
  ProvenanceRecord,
  VersionRecord,
} from '@/lib/sdk/intel/types';

export const dynamic = 'force-dynamic';

/**
 * KINTEL v2.3 — Headless read surface: the full governed object view
 * (PRD §10.1). GET /api/ontology/objects/[id]
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE — READ-ONLY SURFACE                                  ║
 * ║  Zero writes. Tenant identity comes ONLY from the signed         ║
 * ║  handoff contract. The entity is confirmed IN-TENANT FIRST;      ║
 * ║  only then are its links / provenance / versions read (the       ║
 * ║  provenance table has no tenant_id column — its scoping is the   ║
 * ║  proven entity ownership). A fact without its source is not a    ║
 * ║  governed answer: provenance (incl. licence class/terms) always  ║
 * ║  travels with the object. entity_provenance.raw is intentionally ║
 * ║  NEVER returned — raw upstream payloads may carry licensed data. ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Response: { object, links (both directions, catalogue-labelled),
 *             provenance, versions (intel.change_log, latest 20) }
 * 404 if the id is malformed or the object is not in the tenant.
 */

const VERSION_CAP = 20;

/** EXPLICIT allowlist — never `raw` (licensed upstream payloads), never id. */
const PROVENANCE_SELECT =
  'source_key,source_url,fetched_at,confidence,licence_class,licence_terms,property_path';

const CHANGE_LOG_SELECT = 'op,actor,changed_at,before,after';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const secret = await getSecret('INTEL_HANDOFF_SECRET');
  const tenant = resolveTenantFromRequest(req, secret);
  if (!tenant) {
    return NextResponse.json(
      { error: 'No valid tenant could be resolved for this request.' },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    // A malformed id can never name an object in this tenant — 404 without
    // a DB round-trip (and without leaking whether anything exists).
    return notFound();
  }

  const db = getDbConfig();
  if (!db) {
    return NextResponse.json(
      { error: 'The object store is not configured.' },
      { status: 502 },
    );
  }

  // ------------------------------------------------ 1. entity, in tenant
  const entityParams = new URLSearchParams();
  entityParams.set('select', ENTITY_SELECT);
  entityParams.set('tenant_id', `eq.${tenant}`);
  entityParams.set('id', `eq.${id}`);
  entityParams.set('limit', '1');

  const entityRows = await intelSelect(db, 'entity', entityParams);
  if (entityRows === null) return storeUnreachable();
  const object = entityRows.length > 0 ? toObjectSummary(entityRows[0]) : null;
  if (!object) return notFound();

  // ------------------- 2. links (both directions) + provenance + versions
  const [linksOut, linksIn, provenanceRows, versionRows] = await Promise.all([
    fetchLinks(db, tenant, id, 'out'),
    fetchLinks(db, tenant, id, 'in'),
    fetchProvenance(db, id),
    fetchVersions(db, tenant, id),
  ]);
  if (linksOut === null || linksIn === null || provenanceRows === null || versionRows === null) {
    return storeUnreachable();
  }

  const body: ObjectDetailResponse = {
    object,
    links: [...linksOut, ...linksIn],
    provenance: provenanceRows,
    versions: versionRows,
  };
  return NextResponse.json(body);
}

function notFound(): NextResponse {
  return NextResponse.json(
    { error: 'No such object exists in your workspace.' },
    { status: 404 },
  );
}

function storeUnreachable(): NextResponse {
  return NextResponse.json(
    { error: 'The object store could not be reached. Please retry.' },
    { status: 502 },
  );
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

async function fetchLinks(
  db: DbConfig,
  tenant: string,
  id: string,
  direction: 'out' | 'in',
): Promise<ObjectLink[] | null> {
  const params = new URLSearchParams();
  params.set('select', LINK_SELECT);
  params.set('tenant_id', `eq.${tenant}`);
  params.set(direction === 'out' ? 'source_entity_id' : 'target_entity_id', `eq.${id}`);
  params.set('order', 'created_at.desc');

  const rows = await intelSelect(db, 'link', params);
  if (rows === null) return null;

  const links: ObjectLink[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const linkId = str(r.id);
    const source = str(r.source_entity_id);
    const target = str(r.target_entity_id);
    const type = str(r.type);
    const createdAt = str(r.created_at);
    if (!linkId || !source || !target || !type || !createdAt) continue;

    const label = LINK_TYPE_CATALOGUE[type]?.label;
    links.push({
      id: linkId,
      source,
      target,
      type,
      direction,
      ...(label ? { label } : {}),
      properties:
        typeof r.properties === 'object' && r.properties !== null && !Array.isArray(r.properties)
          ? (r.properties as Record<string, unknown>)
          : {},
      created_at: createdAt,
    });
  }
  return links;
}

async function fetchProvenance(db: DbConfig, entityId: string): Promise<ProvenanceRecord[] | null> {
  const params = new URLSearchParams();
  params.set('select', PROVENANCE_SELECT);
  params.set('entity_id', `eq.${entityId}`);
  params.set('order', 'fetched_at.desc');

  const rows = await intelSelect(db, 'entity_provenance', params);
  if (rows === null) return null;

  const records: ProvenanceRecord[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const sourceKey = str(r.source_key);
    const fetchedAt = str(r.fetched_at);
    if (!sourceKey || !fetchedAt) continue;
    records.push({
      source_key: sourceKey,
      source_url: str(r.source_url),
      fetched_at: fetchedAt,
      confidence: num(r.confidence),
      licence_class: str(r.licence_class) as ProvenanceRecord['licence_class'],
      licence_terms: str(r.licence_terms),
      property_path: str(r.property_path),
    });
  }
  return records;
}

async function fetchVersions(
  db: DbConfig,
  tenant: string,
  entityId: string,
): Promise<VersionRecord[] | null> {
  const params = new URLSearchParams();
  params.set('select', CHANGE_LOG_SELECT);
  params.set('tenant_id', `eq.${tenant}`);
  params.set('table_name', 'eq.entity');
  params.set('row_id', `eq.${entityId}`);
  params.set('order', 'changed_at.desc');
  params.set('limit', String(VERSION_CAP));

  const rows = await intelSelect(db, 'change_log', params);
  if (rows === null) return null;

  const versions: VersionRecord[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const op = r.op;
    const changedAt = str(r.changed_at);
    if ((op !== 'INSERT' && op !== 'UPDATE') || !changedAt) continue;
    versions.push({
      op,
      actor: str(r.actor),
      changed_at: changedAt,
      before: r.before ?? null,
      after: r.after ?? null,
    });
  }
  return versions;
}
