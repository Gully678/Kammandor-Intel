import { NextRequest, NextResponse } from 'next/server';
import { requireBearerToken, verifySupabaseUserToken } from '@/lib/ontology/authRpc';
import { createOfacSdnConnector } from '@/lib/pipeline/connectors/ofac-sdn';
import { ofacNameMatches, sdnRecordId, sdnRecordNames } from '@/lib/ontology/resolveExternal';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * KINTEL Mission B — OFAC SDN name-screening (HITL, informational only)
 * POST /api/ontology/screen/ofac
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE BOUNDARY — READ BEFORE MODIFYING                     ║
 * ║                                                                  ║
 * ║  Sanctions/AML screening is Human-In-The-Loop by construction.    ║
 * ║  An OFAC name match here may ONLY produce an informational        ║
 * ║  public.intelligence_alerts row (status='open'). It NEVER writes  ║
 * ║  to intel.entity/link/entity_provenance/crosswalk, NEVER touches  ║
 * ║  intel.proposed_edit, and NEVER auto-actions anything — a name    ║
 * ║  match is a signal for an analyst to review, not a verdict.       ║
 * ║                                                                  ║
 * ║  severity is the DETERMINISTIC constant 'CRITICAL' — it is never  ║
 * ║  computed, scored, or emitted by an LLM. The match rule itself is ║
 * ║  DETERMINISTIC and exact: normaliseCanonicalName(entity name) ===  ║
 * ║  normaliseCanonicalName(SDN name or alias). No fuzzy matching.     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Body: { tenant: string (org uuid) }
 * Flow: read the tenant's intel.entity rows (type company or person) ->
 *       fetch the OFAC SDN batch via the governed connector (degrades
 *       gracefully to a no-op on any failure — never throws) -> exact
 *       normalised-name match against each SDN record's name + aliases ->
 *       for each matched entity, insert ONE informational CRITICAL alert,
 *       skipping if an open alert with the same headline already exists.
 *
 * Response: { screened, matches, alertsCreated, tenant }
 */

const CRITICAL_SEVERITY = 'CRITICAL' as const; // DETERMINISTIC constant — never LLM-computed.
const UUID_RE            = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ScreenOfacBody {
  tenant?: unknown;
}

// ---------------------------------------------------------------------------
// Auth gate — copied verbatim (dual-gate) from
// src/app/api/ontology/ingest/route.ts's authenticateIngestRequest, kept as
// an independent local copy so this route's own governance boundary
// (informational alerts only, never an ontology write) stays independently
// auditable and the ingest route is never touched by this work.
// ---------------------------------------------------------------------------

interface AuthOk  { ok: true }
interface AuthErr { ok: false; error: string }

async function authenticateScreenRequest(req: NextRequest): Promise<AuthOk | AuthErr> {
  const automateSecret = process.env.AUTOMATE_SECRET;
  const providedSecret  = req.headers.get('x-automate-secret');
  if (automateSecret && providedSecret && providedSecret === automateSecret) {
    return { ok: true };
  }

  const bearer = requireBearerToken(req);
  if (bearer.ok) {
    const verified = await verifySupabaseUserToken(bearer.token);
    if (verified.ok) return { ok: true };
    return { ok: false, error: verified.error };
  }

  return {
    ok:    false,
    error: providedSecret ? 'Invalid automate secret.' : bearer.error,
  };
}

// ---------------------------------------------------------------------------
// Service-role DB access (raw PostgREST fetch — mirrors
// src/app/api/ontology/ingest/route.ts and src/app/api/signals/scan/route.ts;
// there is no supabase-js client in this server-side TS layer).
// ---------------------------------------------------------------------------

interface DbConfig {
  supabaseUrl:    string;
  serviceRoleKey: string;
}

function serviceConfig(): DbConfig | null {
  const supabaseUrl    = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey };
}

function serviceHeaders(db: DbConfig): Record<string, string> {
  return {
    apikey:        db.serviceRoleKey,
    Authorization: `Bearer ${db.serviceRoleKey}`,
  };
}

function intelHeaders(db: DbConfig): Record<string, string> {
  return { ...serviceHeaders(db), 'Accept-Profile': 'intel' };
}

interface ScreenEntity {
  id:              string;
  canonical_name:  string | null;
}

/** The tenant's intel.entity rows of type company or person (id + canonical_name only). */
async function fetchTenantEntities(db: DbConfig, tenant: string): Promise<ScreenEntity[]> {
  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/entity`);
    url.searchParams.set('tenant_id', `eq.${tenant}`);
    url.searchParams.set('type', 'in.(company,person)');
    url.searchParams.set('select', 'id,canonical_name,type');

    const res = await fetch(url.toString(), { headers: intelHeaders(db), cache: 'no-store' });
    if (!res.ok) return [];

    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return [];

    return rows
      .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
      .map((r) => ({
        id:             typeof r.id === 'string' ? r.id : '',
        canonical_name: typeof r.canonical_name === 'string' ? r.canonical_name : null,
      }))
      .filter((e) => e.id !== '');
  } catch {
    return [];
  }
}

interface SdnFetchOk  { ok: true;  records: unknown[] }
interface SdnFetchErr { ok: false }

/**
 * Fetch the OFAC SDN batch via the governed connector. Degrades gracefully
 * to ok:false on ANY failure (network, parse, or the connector's own hard
 * expectation throw) — this route must never throw because an upstream
 * sanctions-list source is unavailable.
 */
async function fetchSdnBatch(): Promise<SdnFetchOk | SdnFetchErr> {
  try {
    const connector = createOfacSdnConnector((url: string) => fetch(url, { cache: 'no-store' }));
    const batch = await connector.fetch();
    return { ok: true, records: batch.records };
  } catch {
    return { ok: false };
  }
}

/** Headlines of currently-open alerts for this tenant (for pre-insert dedupe). */
async function fetchOpenAlertHeadlines(db: DbConfig, tenant: string): Promise<Set<string>> {
  const headlines = new Set<string>();
  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/intelligence_alerts`);
    url.searchParams.set('organization_id', `eq.${tenant}`);
    url.searchParams.set('status', 'eq.open');
    url.searchParams.set('select', 'headline');

    const res = await fetch(url.toString(), { headers: serviceHeaders(db), cache: 'no-store' });
    if (!res.ok) return headlines;

    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return headlines;

    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const headline = (row as Record<string, unknown>).headline;
      if (typeof headline === 'string' && headline.length > 0) headlines.add(headline);
    }
    return headlines;
  } catch {
    return headlines;
  }
}

interface AlertRow {
  organization_id: string;
  severity:        typeof CRITICAL_SEVERITY;
  headline:        string;
  detail:          string;
  status:          'open';
}

/** The route's ONLY write: INSERT one row into public.intelligence_alerts (default schema). */
async function insertAlert(db: DbConfig, row: AlertRow): Promise<{ ok: true } | { ok: false }> {
  try {
    const res = await fetch(`${db.supabaseUrl}/rest/v1/intelligence_alerts`, {
      method: 'POST',
      headers: {
        ...serviceHeaders(db),
        'Content-Type': 'application/json',
        Prefer:         'return=minimal',
      },
      body: JSON.stringify(row),
      cache: 'no-store',
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateScreenRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  let body: ScreenOfacBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const tenant = typeof body.tenant === 'string' ? body.tenant.trim() : '';
  if (!tenant || !UUID_RE.test(tenant)) {
    return NextResponse.json({ error: '"tenant" must be an organisation uuid.' }, { status: 400 });
  }

  const db = serviceConfig();
  if (!db) {
    return NextResponse.json({
      screened: 0,
      matches:  0,
      alertsCreated: 0,
      tenant,
      note: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured',
    });
  }

  const entities = await fetchTenantEntities(db, tenant);
  if (entities.length === 0) {
    return NextResponse.json({ screened: 0, matches: 0, alertsCreated: 0, tenant });
  }

  const sdnResult = await fetchSdnBatch();
  if (!sdnResult.ok) {
    return NextResponse.json({
      screened: entities.length,
      matches:  0,
      alertsCreated: 0,
      tenant,
      note: 'ofac source unavailable',
    });
  }

  // Precompute each SDN record's candidate names once (name + aliases).
  const sdnCandidates = sdnResult.records.map((record) => ({
    record,
    names: sdnRecordNames(record),
  }));

  const openHeadlines = await fetchOpenAlertHeadlines(db, tenant);
  const createdThisRun = new Set<string>();

  let matches = 0;
  let alertsCreated = 0;

  for (const entity of entities) {
    const canonicalName = entity.canonical_name;
    if (!canonicalName) continue;

    const hit = sdnCandidates.find(({ names }) => ofacNameMatches(canonicalName, names));
    if (!hit) continue;

    matches += 1;

    const headline = `Possible OFAC SDN name match: ${canonicalName}`;
    if (openHeadlines.has(headline) || createdThisRun.has(headline)) {
      // DEDUPE: an open alert for this exact headline already exists.
      continue;
    }

    const sdnUid = sdnRecordId(hit.record) || '(no id on source record)';
    const sdnName = sdnRecordNames(hit.record)[0] ?? '(unnamed)';
    const detail =
      `Possible name match against the OFAC SDN list: entity "${canonicalName}" ` +
      `matches SDN record ${sdnUid} ("${sdnName}"). Matched by the deterministic rule: ` +
      `normaliseCanonicalName(entity name) === normaliseCanonicalName(SDN name or alias) — ` +
      `an EXACT match only, never fuzzy scoring. ` +
      `Informational signal — analyst review required; never an auto-action.`;

    const insertResult = await insertAlert(db, {
      organization_id: tenant,
      severity:        CRITICAL_SEVERITY,
      headline,
      detail,
      status:          'open',
    });

    if (insertResult.ok) {
      alertsCreated += 1;
      createdThisRun.add(headline);
    }
  }

  return NextResponse.json({
    screened: entities.length,
    matches,
    alertsCreated,
    tenant,
  });
}
