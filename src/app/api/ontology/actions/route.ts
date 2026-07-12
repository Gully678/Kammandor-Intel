import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';
import { routeAction, initialStatusFor } from '@/lib/ontology/actions';
import type {
  Action,
  ActionTypeKey,
  ListActionsResponse,
  RequestActionResponse,
  RiskTier,
} from '@/lib/sdk/intel/types';

export const dynamic = 'force-dynamic';

/**
 * Mission C — the kinetic ACTION layer (Palantir "systems of action"
 * write-back column), v1 draft.
 * GET  /api/ontology/actions  — list the tenant's action queue
 * POST /api/ontology/actions  — request a new action
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE — THIS ROUTE MAY ONLY INSERT 'queued' OR                ║
 * ║  'awaiting_approval' ROWS. It NEVER inserts 'approved' directly —    ║
 * ║  intel.approve_action() (migrations/intel/0032_action_registry.sql)  ║
 * ║  is the SOLE approval path (governed, SECURITY DEFINER, authz        ║
 * ║  enforced in-body against the caller's JWT). The initial status is    ║
 * ║  computed deterministically by src/lib/ontology/actions.ts's          ║
 * ║  routeAction()/initialStatusFor() from the action_type's risk_tier    ║
 * ║  (fetched from intel.action_type — NEVER trusted from the request     ║
 * ║  body) and a confidence score (defaulted to 1 for human-originated    ║
 * ║  requests — a human asking IS full confidence in the request itself;  ║
 * ║  automated callers should supply their own calibrated confidence).    ║
 * ║  No LLM ever emits an unreviewed action here — routing is a pure,     ║
 * ║  deterministic function, never a model call.                          ║
 * ║  Tenant identity: signed handoff token (preferred, human/UI callers), ║
 * ║  OR (server-to-server) x-automate-secret + an explicit tenant,        ║
 * ║  mirroring src/app/api/signals/harvest-delta/route.ts's dual auth     ║
 * ║  path. This file writes its OWN inline auth (below) rather than       ║
 * ║  modifying the shared handoff helper, which another agent owns this   ║
 * ║  session. No execution happens here — this is queue + registry only  ║
 * ║  (see 0032's header comment for executor scope, a later slice).       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * GET query params: status? (exact match), limit? (default 50, max 200).
 * POST body: { actionTypeKey, subjectEntityId?, payload?, rationale?,
 *              confidence? (default 1), requestedBy? }.
 * Response (POST): { ok: true, action } — the inserted intel.action row.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_RATIONALE_LEN = 4000;
const MAX_REQUESTED_BY_LEN = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

const ACTION_SELECT =
  'id,tenant_id,action_type_key,subject_entity_id,payload,status,requested_by,rationale,approved_by,approved_at,executed_at,error,created_at,updated_at';

interface DbConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
}

function getDbConfig(): DbConfig | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return supabaseUrl && serviceRoleKey ? { supabaseUrl, serviceRoleKey } : null;
}

/** Headers for the `intel` schema via PostgREST + service role key (matches src/app/api/ontology/objects/shared.ts and src/app/api/signals/harvest-delta/route.ts). */
function intelHeaders(db: DbConfig, write = false, prefer?: string): Record<string, string> {
  const h: Record<string, string> = {
    apikey: db.serviceRoleKey,
    Authorization: `Bearer ${db.serviceRoleKey}`,
    Accept: 'application/json',
  };
  if (write) {
    h['Content-Type'] = 'application/json';
    h['Content-Profile'] = 'intel';
  } else {
    h['Accept-Profile'] = 'intel';
  }
  if (prefer) h.Prefer = prefer;
  return h;
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Resolve the effective tenant for this request — the route's OWN inline
 * auth (does not modify the shared handoff helper):
 *   1. x-automate-secret header + an explicit tenant (server-to-server —
 *      body.tenant for POST, ?tenant= for GET) — copied from
 *      src/app/api/signals/harvest-delta/route.ts's dual-path pattern.
 *   2. Signed handoff token (?t= / x-intel-handoff), verified via
 *      resolveTenantFromRequest — the trusted path for human/UI callers.
 * Returns null (never throws) when no tenant can be resolved.
 */
async function resolveTenant(req: NextRequest, bodyTenant?: unknown): Promise<string | null> {
  const automate = process.env.AUTOMATE_SECRET;
  const provided = req.headers.get('x-automate-secret') ?? '';
  const explicitTenant =
    typeof bodyTenant === 'string' && bodyTenant ? bodyTenant : req.nextUrl.searchParams.get('tenant');
  if (automate && provided && timingSafeEq(provided, automate) && explicitTenant) {
    return explicitTenant;
  }
  const secret = await getSecret('INTEL_HANDOFF_SECRET');
  return resolveTenantFromRequest(req, secret);
}

function clampLimit(raw: string | null): number {
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

/** Map a raw intel.action row onto the governed Action shape using an EXPLICIT allowlist. */
function toAction(row: unknown): Action | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;

  const id = typeof r.id === 'string' ? r.id : null;
  const tenantId = typeof r.tenant_id === 'string' ? r.tenant_id : null;
  const actionTypeKey = typeof r.action_type_key === 'string' ? r.action_type_key : null;
  const status = typeof r.status === 'string' ? r.status : null;
  const requestedBy = typeof r.requested_by === 'string' ? r.requested_by : null;
  const createdAt = typeof r.created_at === 'string' ? r.created_at : null;
  const updatedAt = typeof r.updated_at === 'string' ? r.updated_at : null;
  if (!id || !tenantId || !actionTypeKey || !status || !requestedBy || !createdAt || !updatedAt) {
    return null;
  }

  return {
    id,
    tenant_id: tenantId,
    action_type_key: actionTypeKey as Action['action_type_key'],
    subject_entity_id: typeof r.subject_entity_id === 'string' ? r.subject_entity_id : null,
    payload:
      typeof r.payload === 'object' && r.payload !== null && !Array.isArray(r.payload)
        ? (r.payload as Record<string, unknown>)
        : {},
    status: status as Action['status'],
    requested_by: requestedBy,
    rationale: typeof r.rationale === 'string' ? r.rationale : null,
    approved_by: typeof r.approved_by === 'string' ? r.approved_by : null,
    approved_at: typeof r.approved_at === 'string' ? r.approved_at : null,
    executed_at: typeof r.executed_at === 'string' ? r.executed_at : null,
    error: typeof r.error === 'string' ? r.error : null,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenant = await resolveTenant(req);
  if (!tenant) {
    return NextResponse.json({ error: 'No valid tenant could be resolved for this request.' }, { status: 401 });
  }

  const db = getDbConfig();
  if (!db) {
    return NextResponse.json({ error: 'The action store is not configured.' }, { status: 502 });
  }

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const limit = clampLimit(sp.get('limit'));

  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/action`);
    url.searchParams.set('select', ACTION_SELECT);
    url.searchParams.set('tenant_id', `eq.${tenant}`);
    if (status) url.searchParams.set('status', `eq.${status}`);
    url.searchParams.set('order', 'created_at.desc');
    url.searchParams.set('limit', String(limit));

    const res = await fetch(url.toString(), { headers: intelHeaders(db), cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ error: 'The action queue could not be loaded.' }, { status: 502 });
    }
    const rows: unknown = await res.json();
    const actions = Array.isArray(rows) ? rows.map(toAction).filter((a): a is Action => a !== null) : [];
    const body: ListActionsResponse = { actions };
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: 'The action queue could not be loaded.' }, { status: 502 });
  }
}

interface PostBody {
  tenant?: unknown;
  actionTypeKey?: unknown;
  subjectEntityId?: unknown;
  payload?: unknown;
  rationale?: unknown;
  confidence?: unknown;
  requestedBy?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const tenant = await resolveTenant(req, body.tenant);
  if (!tenant) {
    return NextResponse.json({ error: 'No valid tenant could be resolved for this request.' }, { status: 401 });
  }

  const actionTypeKey = typeof body.actionTypeKey === 'string' ? body.actionTypeKey.trim() : '';
  if (!actionTypeKey) {
    return NextResponse.json({ error: '"actionTypeKey" is required.' }, { status: 400 });
  }

  if (body.subjectEntityId !== undefined && body.subjectEntityId !== null && !isUuid(body.subjectEntityId)) {
    return NextResponse.json({ error: '"subjectEntityId" must be a valid uuid.' }, { status: 400 });
  }
  const subjectEntityId = isUuid(body.subjectEntityId) ? body.subjectEntityId : null;

  const payload =
    typeof body.payload === 'object' && body.payload !== null && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : {};

  const rationale =
    typeof body.rationale === 'string' && body.rationale ? body.rationale.trim().slice(0, MAX_RATIONALE_LEN) : null;

  // Confidence: defaults to 1 for human-originated requests (a human asking
  // for an action IS full confidence in the request itself). Automated
  // callers should supply their own calibrated confidence. routeAction()
  // fails closed (routes to 'ask_human') on anything outside [0, 1] or NaN.
  const confidence = typeof body.confidence === 'number' ? body.confidence : 1;

  const requestedBy =
    typeof body.requestedBy === 'string' && body.requestedBy
      ? body.requestedBy.trim().slice(0, MAX_REQUESTED_BY_LEN)
      : 'api';

  const db = getDbConfig();
  if (!db) {
    return NextResponse.json({ error: 'The action store is not configured.' }, { status: 502 });
  }

  try {
    // Fetch the action_type's risk_tier from the platform catalogue — NEVER
    // trust a client-supplied risk_tier or status.
    const typeUrl = new URL(`${db.supabaseUrl}/rest/v1/action_type`);
    typeUrl.searchParams.set('key', `eq.${actionTypeKey}`);
    typeUrl.searchParams.set('select', 'key,risk_tier');
    const typeRes = await fetch(typeUrl.toString(), { headers: intelHeaders(db), cache: 'no-store' });
    if (!typeRes.ok) {
      return NextResponse.json({ error: 'The action type catalogue could not be reached.' }, { status: 502 });
    }
    const typeRows: unknown = await typeRes.json();
    const typeRow = Array.isArray(typeRows) && typeRows.length > 0 ? (typeRows[0] as Record<string, unknown>) : null;
    const rawRiskTier = typeRow && typeof typeRow.risk_tier === 'string' ? typeRow.risk_tier : null;
    // Positive equality narrowing (not a negated guard) so TypeScript narrows
    // rawRiskTier down to the RiskTier literal union rather than leaving it as
    // a plain string — routeAction() below requires the strict union type.
    const riskTier: RiskTier | null =
      rawRiskTier === 'act' || rawRiskTier === 'draft' || rawRiskTier === 'ask_human' ? rawRiskTier : null;
    if (!riskTier) {
      return NextResponse.json({ error: `Unknown action type "${actionTypeKey}".` }, { status: 400 });
    }

    const route = routeAction(riskTier, confidence);
    const status = initialStatusFor(route); // NEVER 'approved' — see governance banner above.

    const row = {
      tenant_id: tenant,
      action_type_key: actionTypeKey as ActionTypeKey,
      subject_entity_id: subjectEntityId,
      payload,
      status,
      requested_by: requestedBy,
      rationale,
    };

    const insUrl = new URL(`${db.supabaseUrl}/rest/v1/action`);
    const insRes = await fetch(insUrl.toString(), {
      method: 'POST',
      headers: intelHeaders(db, true, 'return=representation'),
      body: JSON.stringify(row),
      cache: 'no-store',
    });
    if (!insRes.ok) {
      return NextResponse.json({ error: 'The action could not be queued.' }, { status: 502 });
    }
    const insRows: unknown = await insRes.json();
    const saved = Array.isArray(insRows) ? insRows[0] : insRows;
    const action = toAction(saved);
    if (!action) {
      return NextResponse.json({ error: 'The action could not be queued.' }, { status: 502 });
    }
    const responseBody: RequestActionResponse = { ok: true, action };
    return NextResponse.json(responseBody);
  } catch {
    return NextResponse.json({ error: 'The action could not be queued.' }, { status: 502 });
  }
}
