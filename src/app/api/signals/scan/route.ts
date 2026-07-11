import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';
import { requireBearerToken } from '@/lib/ontology/authRpc';
import { matchSignals } from '@/lib/signals/match';
import { fetchEngineWatchlist, mergeWatchlists } from '@/lib/signals/engineWatchlist';
import { dedupeKey, dedupeKeyFromStoredAlert, toAlertRows } from '@/lib/signals/alerts';
import type {
  IntelligenceAlertRow,
  SignalEvent,
  SignalWatchlist,
} from '@/lib/signals/types';

export const dynamic = 'force-dynamic';

/**
 * KINTEL v2 — Signal/Impact engine scan route (PRD v2.0 §9.5–9.6)
 * POST /api/signals/scan
 *
 * events -> tenant watchlist match (deterministic) -> dedupe -> alert rows
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE BOUNDARY — READ BEFORE MODIFYING                    ║
 * ║                                                                  ║
 * ║  This route's ONLY write is an INSERT into                       ║
 * ║  public.intelligence_alerts (status='open') — the contracted     ║
 * ║  signal flow into the main Kammandor app, whose cron composes    ║
 * ║  daily briefings from those alerts. It MUST NEVER write          ║
 * ║  intel.entity / intel.link / intel.entity_provenance (sole-      ║
 * ║  writer RPC law) and MUST NEVER write daily_briefings.           ║
 * ║                                                                  ║
 * ║  Classification is DETERMINISTIC (src/lib/signals/match.ts).     ║
 * ║  No LLM emits a severity or a figure on this path. Any future    ║
 * ║  AI summarisation must go through src/lib/ai/analyze.ts's        ║
 * ║  governed pipeline and be optional/disabled by default.          ║
 * ║                                                                  ║
 * ║  Watchlist reads use an EXPLICIT column allowlist — NEVER        ║
 * ║  select * from km_monitoring_config (property_api_credentials    ║
 * ║  is a secrets column; a regression test guards this).            ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Auth: bearer token required (same guard as /api/ontology/ingest); tenant
 * identity comes ONLY from the signed handoff contract
 * (resolveTenantFromRequest — same as /api/intel/monitoring-config).
 *
 * Body:     { events: SignalEvent[] }  (≤ 500 events; each needs
 *           title + sourceKey + occurredAt)
 * Response: { scanned, matched, inserted, skippedDuplicates }
 */

/** Hard cap on events per scan request. */
const MAX_EVENTS_PER_SCAN = 500;

/** How far back to look for existing alerts when de-duplicating. */
const DEDUPE_WINDOW_DAYS = 7;

interface ScanBody {
  events?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await handleScan(req);
  } catch {
    // Absolute backstop — the route must never throw unhandled and must
    // never fail silently: unexpected errors surface as an explicit 500.
    return NextResponse.json(
      { error: 'Unexpected error while scanning signals. Nothing was recorded.' },
      { status: 500 },
    );
  }
}

async function handleScan(req: NextRequest): Promise<NextResponse> {
  // -------------------------------------------------------------- auth
  const auth = requireBearerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  // -------------------------------------------------------- body + validation
  let body: ScanBody;
  try {
    body = (await req.json()) as ScanBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const validation = validateEvents(body.events);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const events = validation.events;

  // -------------------------------------------------------------- tenant
  const secret = await getSecret('INTEL_HANDOFF_SECRET');
  const tenant = resolveTenantFromRequest(req, secret);
  if (!tenant) {
    return NextResponse.json(
      { error: 'No valid tenant could be resolved for this request.' },
      { status: 401 },
    );
  }

  // ---------------------------------------------------- watchlist (allowlist)
  const watchlistResult = await fetchTenantWatchlist(tenant);
  if (!watchlistResult.ok) {
    // A scan without a reachable watchlist would silently drop signals —
    // fail loudly instead (the caller can retry).
    return NextResponse.json(
      { error: 'The tenant watchlist could not be loaded. Nothing was recorded.' },
      { status: 502 },
    );
  }

  // ------------------------------------------------- deterministic matching
  // Union the main-app km_monitoring_config watchlist with the engine-owned
  // intel.tenant_watchlist (cross-Supabase / per-deal / per-campaign terms).
  const _wlDb = getDbConfig();
  const _engineWatchlist = _wlDb ? await fetchEngineWatchlist(_wlDb, tenant) : {};
  const effectiveWatchlist = mergeWatchlists(watchlistResult.watchlist, _engineWatchlist);
  const matched = matchSignals(events, effectiveWatchlist);
  if (matched.length === 0) {
    return NextResponse.json({
      scanned: events.length,
      matched: 0,
      inserted: 0,
      skippedDuplicates: 0,
    });
  }

  // ------------------------------------------------------------- dedupe
  const existingResult = await fetchRecentAlertKeys(tenant);
  if (!existingResult.ok) {
    return NextResponse.json(
      { error: 'Existing alerts could not be checked for duplicates. Nothing was recorded.' },
      { status: 502 },
    );
  }

  const seen = new Set(existingResult.keys);
  const fresh: typeof matched = [];
  let skippedDuplicates = 0;
  for (const signal of matched) {
    const key = dedupeKey(tenant, signal.event);
    if (seen.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(key); // also dedupes repeats within this batch
    fresh.push(signal);
  }

  // ---------------------------------------------------------- insert
  // The ONLY DB write in this route — public.intelligence_alerts only.
  const rows = toAlertRows(tenant, fresh);
  if (rows.length > 0) {
    const insertResult = await insertAlerts(rows);
    if (!insertResult.ok) {
      return NextResponse.json(
        { error: insertResult.error, scanned: events.length, matched: matched.length, inserted: 0 },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    scanned: events.length,
    matched: matched.length,
    inserted: rows.length,
    skippedDuplicates,
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type ValidationResult =
  | { ok: true; events: SignalEvent[] }
  | { ok: false; error: string };

function validateEvents(raw: unknown): ValidationResult {
  if (!Array.isArray(raw)) {
    return { ok: false, error: '"events" must be an array of signal events.' };
  }
  if (raw.length > MAX_EVENTS_PER_SCAN) {
    return {
      ok: false,
      error: `Too many events: ${raw.length}. At most ${MAX_EVENTS_PER_SCAN} events may be scanned per request.`,
    };
  }

  const events: SignalEvent[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (typeof item !== 'object' || item === null) {
      return { ok: false, error: `Event at position ${i} is not an object.` };
    }
    const r = item as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const sourceKey = typeof r.sourceKey === 'string' ? r.sourceKey.trim() : '';
    const occurredAt = typeof r.occurredAt === 'string' ? r.occurredAt.trim() : '';
    if (!title || !sourceKey || !occurredAt) {
      return {
        ok: false,
        error: `Event at position ${i} is missing a required field (title, sourceKey and occurredAt are all required).`,
      };
    }

    const event: SignalEvent = { title, sourceKey, occurredAt };
    if (typeof r.id === 'string') event.id = r.id;
    if (typeof r.description === 'string') event.description = r.description;
    if (typeof r.url === 'string' && r.url) event.url = r.url;
    if (typeof r.magnitude === 'number' && Number.isFinite(r.magnitude)) {
      event.magnitude = r.magnitude;
    }
    const strArr = (v: unknown): string[] | undefined =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string')
        : undefined;
    const entities = strArr(r.entities);
    if (entities) event.entities = entities;
    const geos = strArr(r.geos);
    if (geos) event.geos = geos;
    const tickers = strArr(r.tickers);
    if (tickers) event.tickers = tickers;

    events.push(event);
  }

  return { ok: true, events };
}

// ---------------------------------------------------------------------------
// DB access — raw PostgREST with the service-role key, matching the
// existing pattern in src/app/api/intel/monitoring-config/route.ts and
// src/app/api/ontology/ingest/route.ts (no supabase-js in this layer).
// ---------------------------------------------------------------------------

interface DbConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
}

function getDbConfig(): DbConfig | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey };
}

function serviceHeaders(db: DbConfig): Record<string, string> {
  return {
    apikey: db.serviceRoleKey,
    Authorization: `Bearer ${db.serviceRoleKey}`,
    Accept: 'application/json',
  };
}

type WatchlistResult =
  | { ok: true; watchlist: SignalWatchlist }
  | { ok: false };

/**
 * Read the tenant's watchlist columns from public.km_monitoring_config.
 * EXPLICIT allowlist only — NEVER '*', and NEVER property_api_credentials
 * (jsonb secrets). Only the four matchable term columns are selected here
 * (a strict subset of the monitoring-config route's own allowlist).
 */
async function fetchTenantWatchlist(tenant: string): Promise<WatchlistResult> {
  const db = getDbConfig();
  if (!db) return { ok: false };

  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/km_monitoring_config`);
    url.searchParams.set('organization_id', `eq.${tenant}`);
    url.searchParams.set('select', 'organization_id,keywords,entities,tickers,geos');
    url.searchParams.set('limit', '1');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: serviceHeaders(db),
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false };

    const rows: unknown = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      // No row for this tenant is a VALID state: an empty watchlist simply
      // matches nothing. Only transport/config failures return ok:false.
      return { ok: true, watchlist: {} };
    }

    return { ok: true, watchlist: normaliseWatchlistRow(rows[0]) };
  } catch {
    return { ok: false };
  }
}

/** Allowlist mapping — mirrors monitoring-config's normaliseRow discipline. */
function normaliseWatchlistRow(row: unknown): SignalWatchlist {
  if (typeof row !== 'object' || row === null) return {};
  const r = row as Record<string, unknown>;
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;

  const out: SignalWatchlist = {};
  const keywords = strArr(r.keywords);
  if (keywords) out.keywords = keywords;
  const entities = strArr(r.entities);
  if (entities) out.entities = entities;
  const tickers = strArr(r.tickers);
  if (tickers) out.tickers = tickers;
  const geos = strArr(r.geos);
  if (geos) out.geos = geos;
  return out;
}

type RecentKeysResult = { ok: true; keys: string[] } | { ok: false };

/**
 * Load dedupe keys for this tenant's alerts from the last
 * DEDUPE_WINDOW_DAYS days (any status — a recently acknowledged or resolved
 * alert on the same story must not be re-raised as a fresh duplicate).
 */
async function fetchRecentAlertKeys(tenant: string): Promise<RecentKeysResult> {
  const db = getDbConfig();
  if (!db) return { ok: false };

  try {
    const since = new Date(
      Date.now() - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const url = new URL(`${db.supabaseUrl}/rest/v1/intelligence_alerts`);
    url.searchParams.set('organization_id', `eq.${tenant}`);
    url.searchParams.set('created_at', `gte.${since}`);
    url.searchParams.set('select', 'source_url,headline');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: serviceHeaders(db),
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false };

    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return { ok: false };

    const keys = rows
      .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
      .map((r) =>
        dedupeKeyFromStoredAlert(tenant, {
          source_url: typeof r.source_url === 'string' ? r.source_url : null,
          headline: typeof r.headline === 'string' ? r.headline : null,
        }),
      );

    return { ok: true, keys };
  } catch {
    return { ok: false };
  }
}

type InsertResult = { ok: true } | { ok: false; error: string };

/** The route's ONLY write: INSERT rows into public.intelligence_alerts. */
async function insertAlerts(rows: IntelligenceAlertRow[]): Promise<InsertResult> {
  const db = getDbConfig();
  if (!db) {
    return { ok: false, error: 'The alert store is not configured. Nothing was recorded.' };
  }

  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/intelligence_alerts`);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        ...serviceHeaders(db),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
      cache: 'no-store',
    });
    if (!res.ok) {
      return {
        ok: false,
        error: 'The alerts could not be saved. Nothing was recorded — please retry.',
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'The alerts could not be saved. Nothing was recorded — please retry.',
    };
  }
}
