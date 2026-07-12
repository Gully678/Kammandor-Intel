import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Mission C — the kinetic ACTION layer (Palantir "systems of action"
 * write-back column), v1 EXECUTOR.
 * POST /api/ontology/actions/execute
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE — READ BEFORE MODIFYING                                    ║
 * ║                                                                        ║
 * ║  This route is the FIRST thing in the codebase that dequeues an        ║
 * ║  intel.action row and performs its real-world side effect. It is       ║
 * ║  narrow and safe by construction:                                      ║
 * ║                                                                        ║
 * ║   • v1 EXECUTES ONLY action_type_key = 'notify'. Every other catalogue ║
 * ║     entry (create_kammandor_task, draft_pulse_asset, attach_to_deal,   ║
 * ║     fire_webhook — migrations/intel/0032_action_registry.sql) is       ║
 * ║     deliberately NOT selected by this route's query and is left        ║
 * ║     completely untouched, regardless of its status. Wiring those up    ║
 * ║     is later slices, one action type at a time.                        ║
 * ║   • It picks up rows ONLY in status 'queued' (the act-tier,            ║
 * ║     deterministic router — src/lib/ontology/actions.ts routeAction()/  ║
 * ║     initialStatusFor()) or 'approved' (a human called                  ║
 * ║     intel.approve_action() — migrations/intel/0032). It NEVER touches  ║
 * ║     'awaiting_approval' rows — those still require a human (or the     ║
 * ║     governed RPC) to move them first. This route itself NEVER approves║
 * ║     anything; it only executes rows that are already authorised.       ║
 * ║   • Auth is server-to-server ONLY: x-automate-secret ===               ║
 * ║     process.env.AUTOMATE_SECRET (constant-time compare). There is NO   ║
 * ║     bearer/handoff-token path — executing a side effect that touches   ║
 * ║     the tenant's dashboard feed is not a browser operation, unlike the ║
 * ║     read/queue route (src/app/api/ontology/actions/route.ts), which    ║
 * ║     also accepts a signed handoff token for human/UI callers.          ║
 * ║   • This route NEVER writes intel.entity / intel.link / any ontology   ║
 * ║     table — its only writes are (a) public.intelligence_alerts (the    ║
 * ║     side effect for 'notify') and (b) intel.action itself (status/     ║
 * ║     error/executed_at bookkeeping on the SAME row it just processed).  ║
 * ║   • Alert severity is DETERMINISTIC, drawn from a FIXED allow-list —   ║
 * ║     never computed or LLM-emitted. IMPORTANT: this allow-list is       ║
 * ║     ('CRITICAL' | 'NOTABLE' | 'BACKGROUND'), NOT ('INFO' | 'WARNING' | ║
 * ║     'HIGH' | 'CRITICAL'). That is the vocabulary ACTUALLY used         ║
 * ║     everywhere else in this codebase for public.intelligence_alerts    ║
 * ║     .severity — see src/lib/signals/types.ts's SignalSeverity,         ║
 * ║     migrations/intel/0024_sanctions_entity_alert.sql's 'CRITICAL'      ║
 * ║     literal, and src/app/api/signals/harvest-delta/route.ts's          ║
 * ║     buildAlert(). Using the other vocabulary would violate the         ║
 * ║     table's CHECK constraint and every insert would fail. The default  ║
 * ║     (payload.severity absent, not a string, or outside the allow-list) ║
 * ║     is 'BACKGROUND' — the least-severe constant, i.e. the deterministic║
 * ║     equivalent of an "INFO" default for this table's real vocabulary.  ║
 * ║   • Zero silent failure: EVERY row this route picks up lands back in   ║
 * ║     intel.action with an explicit outcome — 'executed' (+ executed_at) ║
 * ║     or 'failed' (+ error, trimmed to 500 chars). Rows are processed    ║
 * ║     SEQUENTIALLY and one row's failure never throws across to the      ║
 * ║     next — every per-row failure is caught and recorded.               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Auth: header x-automate-secret === process.env.AUTOMATE_SECRET.
 * Body: { tenant?: uuid, limit?: number (default 10, max 25) }.
 * Response: { picked, executed, failed, skippedOtherTypes, tenant? }.
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const MAX_ERROR_LEN = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Allowed severities for public.intelligence_alerts.severity — mirrors the
 * table's CHECK constraint EXACTLY as documented/used elsewhere in this
 * codebase (src/lib/signals/types.ts's SignalSeverity; NOT the generic
 * ('INFO'|'WARNING'|'HIGH'|'CRITICAL') set — that vocabulary does not exist
 * for this table). See the governance banner above for the full rationale.
 */
const ALLOWED_SEVERITIES = ['CRITICAL', 'NOTABLE', 'BACKGROUND'] as const;
type AlertSeverity = (typeof ALLOWED_SEVERITIES)[number];
const DEFAULT_SEVERITY: AlertSeverity = 'BACKGROUND';

function resolveSeverity(raw: unknown): AlertSeverity {
  return typeof raw === 'string' && (ALLOWED_SEVERITIES as readonly string[]).includes(raw)
    ? (raw as AlertSeverity)
    : DEFAULT_SEVERITY;
}

function trimError(msg: string): string {
  return msg.length > MAX_ERROR_LEN ? msg.slice(0, MAX_ERROR_LEN) : msg;
}

function clampLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

interface DbConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
}

function getDbConfig(): DbConfig | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return supabaseUrl && serviceRoleKey ? { supabaseUrl, serviceRoleKey } : null;
}

/**
 * Headers for the `intel` schema via PostgREST + service role key — copied
 * verbatim (same conventions) from src/app/api/ontology/actions/route.ts's
 * intelHeaders(). Used for ALL reads/writes of intel.action.
 */
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

/**
 * Headers for the DEFAULT PostgREST profile (public schema — NO
 * Accept-Profile/Content-Profile header at all). public.intelligence_alerts
 * lives in the main app's `public` schema (docs/runbooks/OPS_DR_RUNBOOK.md
 * §"Shared with the main Kammandor app"), NOT `intel` — this is the ONE
 * write in this route that must NOT carry the intel profile header.
 */
function defaultProfileHeaders(db: DbConfig, write = false, prefer?: string): Record<string, string> {
  const h: Record<string, string> = {
    apikey: db.serviceRoleKey,
    Authorization: `Bearer ${db.serviceRoleKey}`,
    Accept: 'application/json',
  };
  if (write) h['Content-Type'] = 'application/json';
  if (prefer) h.Prefer = prefer;
  return h;
}

const ACTION_SELECT = 'id,tenant_id,action_type_key,status,payload';

interface ActionRow {
  id: string;
  tenant_id: string;
  payload: Record<string, unknown>;
}

function toActionRow(row: unknown): ActionRow | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : null;
  const tenantId = typeof r.tenant_id === 'string' ? r.tenant_id : null;
  if (!id || !tenantId) return null;
  const payload =
    typeof r.payload === 'object' && r.payload !== null && !Array.isArray(r.payload)
      ? (r.payload as Record<string, unknown>)
      : {};
  return { id, tenant_id: tenantId, payload };
}

/** PATCH a single intel.action row. Never throws — returns false on any failure (network or non-2xx). */
async function patchAction(db: DbConfig, id: string, fields: Record<string, unknown>): Promise<boolean> {
  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/action`);
    url.searchParams.set('id', `eq.${id}`);
    const res = await fetch(url.toString(), {
      method: 'PATCH',
      headers: intelHeaders(db, true, 'return=minimal'),
      body: JSON.stringify(fields),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface AlertInsert {
  organization_id: string;
  headline: string;
  detail: string;
  severity: AlertSeverity;
  source_url: null;
  status: 'open';
}

/** Insert one public.intelligence_alerts row (default/public PostgREST profile). Never throws. */
async function insertAlert(db: DbConfig, row: AlertInsert): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/intelligence_alerts`);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: defaultProfileHeaders(db, true, 'return=minimal'),
      body: JSON.stringify(row),
      cache: 'no-store',
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        // ignore — best-effort diagnostic only
      }
      return { ok: false, error: `intelligence_alerts insert failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'intelligence_alerts insert threw an unexpected error' };
  }
}

interface PostBody {
  tenant?: unknown;
  limit?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ---- Auth: server-to-server ONLY. No bearer/handoff-token path. --------
  const automateSecret = process.env.AUTOMATE_SECRET;
  const provided = req.headers.get('x-automate-secret') ?? '';
  if (!automateSecret || !provided || !timingSafeEq(provided, automateSecret)) {
    return NextResponse.json({ error: 'Server-to-server authentication required (x-automate-secret).' }, { status: 401 });
  }

  // ---- Body parsing (tolerant of an empty/absent body). ------------------
  let parsed: unknown = {};
  try {
    const text = await req.text();
    parsed = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const body: PostBody = typeof parsed === 'object' && parsed !== null ? (parsed as PostBody) : {};

  if (body.tenant !== undefined && body.tenant !== null && !isUuid(body.tenant)) {
    return NextResponse.json({ error: '"tenant" must be a valid uuid.' }, { status: 400 });
  }
  const tenant = isUuid(body.tenant) ? body.tenant : null;
  const limit = clampLimit(body.limit);

  const db = getDbConfig();
  if (!db) {
    return NextResponse.json({ error: 'The action store is not configured.' }, { status: 502 });
  }

  // ---- 1. Read the governed queue: 'notify' rows already queued/approved. ----
  let rows: unknown;
  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/action`);
    url.searchParams.set('select', ACTION_SELECT);
    url.searchParams.set('status', 'in.(queued,approved)');
    url.searchParams.set('action_type_key', 'eq.notify');
    if (tenant) url.searchParams.set('tenant_id', `eq.${tenant}`);
    url.searchParams.set('order', 'created_at.asc');
    url.searchParams.set('limit', String(limit));

    const res = await fetch(url.toString(), { headers: intelHeaders(db), cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ error: 'The action queue could not be loaded.' }, { status: 502 });
    }
    rows = await res.json();
  } catch {
    return NextResponse.json({ error: 'The action queue could not be loaded.' }, { status: 502 });
  }

  const actionRows = Array.isArray(rows) ? rows.map(toActionRow).filter((r): r is ActionRow => r !== null) : [];
  const picked = actionRows.length;
  let executed = 0;
  let failed = 0;

  // ---- 2. Process rows SEQUENTIALLY. One row's failure never throws -----
  // ---- across to the next — every outcome lands back on the row. --------
  for (const row of actionRows) {
    try {
      const rawHeadline = row.payload.headline;
      if (typeof rawHeadline !== 'string' || !rawHeadline.trim()) {
        await patchAction(db, row.id, {
          status: 'failed',
          error: 'notify payload missing headline',
          updated_at: new Date().toISOString(),
        });
        failed++;
        continue;
      }
      const headline = rawHeadline.trim();

      const severity = resolveSeverity(row.payload.severity);
      const rawDetail = typeof row.payload.detail === 'string' ? row.payload.detail : '';
      const detail = `${rawDetail ? `${rawDetail} ` : ''}— executed from the governed action queue (intel.action).`;

      const insertResult = await insertAlert(db, {
        organization_id: row.tenant_id,
        headline,
        detail,
        severity,
        source_url: null,
        status: 'open',
      });

      if (!insertResult.ok) {
        await patchAction(db, row.id, {
          status: 'failed',
          error: trimError(insertResult.error ?? 'alert insert failed'),
          updated_at: new Date().toISOString(),
        });
        failed++;
        continue;
      }

      const patched = await patchAction(db, row.id, {
        status: 'executed',
        executed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (!patched) {
        // The alert now exists but we could not confirm the action row was
        // updated. Zero silent failure: force the row to 'failed' with an
        // explicit error rather than leaving it stuck in queued/approved,
        // which would otherwise cause a duplicate alert on the next tick.
        await patchAction(db, row.id, {
          status: 'failed',
          error: trimError('alert created but the action row could not be confirmed as executed'),
          updated_at: new Date().toISOString(),
        });
        failed++;
        continue;
      }

      executed++;
    } catch (err) {
      failed++;
      await patchAction(db, row.id, {
        status: 'failed',
        error: trimError(err instanceof Error ? err.message : 'unexpected executor error'),
        updated_at: new Date().toISOString(),
      });
    }
  }

  return NextResponse.json({
    picked,
    executed,
    failed,
    skippedOtherTypes:
      "v1 executes ONLY action_type_key='notify'; all other action types " +
      '(create_kammandor_task, draft_pulse_asset, attach_to_deal, fire_webhook) ' +
      'are deliberately not selected by this route and remain untouched.',
    ...(tenant ? { tenant } : {}),
  });
}
