import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import {
  runAutomateCycle,
  type AutomateCycleDeps,
  type AutomateTenant,
  type PipelineOutcome,
  type StoredAlertKey,
} from '@/lib/automate/cycle';
import type { AgentRunRecord } from '@/lib/agents/types';
import { makeGdeltConnector, GDELT_EXPECTATIONS } from '@/lib/pipeline/connectors/gdelt';
import { runConnector } from '@/lib/pipeline/run';
import type { RawBatch } from '@/lib/pipeline/types';
import { MAPPERS, type MapperResult } from '@/lib/ontology/mappers';
import { proposeCreateEntity, proposeCreateLink } from '@/lib/ontology/propose';
import type { Entity, Link, ProposedEdit } from '@/lib/ontology/types';
import type { IntelligenceAlertRow, SignalWatchlist } from '@/lib/signals/types';
import { fetchEngineWatchlist, listEngineWatchlistTenants, mergeWatchlists } from '@/lib/signals/engineWatchlist';

export const dynamic = 'force-dynamic';

/**
 * KINTEL v2 — Automate route (PRD v2.0 §9.5: scheduled governed reasoning)
 * POST /api/automate   and   GET /api/automate
 *
 * Runs ONE full automate cycle:
 *   GDELT fetch (once, shared) → expectations → pending proposals into the
 *   governed queue → per-tenant watcher agent scan (traced, 'scheduled') →
 *   deduped alerts into public.intelligence_alerts. Returns the
 *   CycleSummary as JSON — every held batch and every failure is in it.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE BOUNDARY — READ BEFORE MODIFYING                    ║
 * ║                                                                  ║
 * ║  This route's ONLY writes are:                                   ║
 * ║   1. intel.proposed_edit  — status='pending' proposals from the  ║
 * ║      connector pipeline (same insert as /api/ontology/ingest);   ║
 * ║   2. public.intelligence_alerts — status='open' watcher alerts   ║
 * ║      (same insert as /api/signals/scan);                         ║
 * ║   3. intel.agent_run — the per-invocation lineage trace          ║
 * ║      (migration intel_0019, §13.1 show raw).                     ║
 * ║  It MUST NEVER write intel.entity / intel.link /                 ║
 * ║  intel.entity_provenance (sole-writer RPC law) and MUST NEVER    ║
 * ║  write daily_briefings. No LLM runs on this path at all.         ║
 * ║                                                                  ║
 * ║  Watchlist reads use an EXPLICIT column allowlist — NEVER        ║
 * ║  select * from km_monitoring_config (property_api_credentials    ║
 * ║  is a secrets column; a regression test guards this).            ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * ── AUTH: shared secret, constant-time ──────────────────────────────────
 * The caller must present AUTOMATE_SECRET via the `x-automate-secret`
 * header OR the `?secret=` query parameter (compared in constant time):
 *  - AUTOMATE_SECRET unset  → 503 'automate not configured' — an EXPLICIT
 *    not-configured state; the route is never silently open;
 *  - secret absent/mismatch → 401 before anything else runs.
 *
 * ── WHY GET IS ACCEPTED (and why ?secret= exists) ───────────────────────
 * Vercel cron (vercel.json crons → GET /api/automate every 30 minutes)
 * sends plain GET requests and CANNOT set custom headers on the Hobby
 * plan. GET therefore carries EXACTLY the same guard semantics as POST,
 * with `?secret=` as the header-less transport for the same secret. Both
 * methods run the same cycle; neither is ever unauthenticated.
 */

/** How far back to look for existing alerts when de-duplicating. */
const DEDUPE_WINDOW_DAYS = 7;

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleAutomate(req);
}

/** Vercel cron entry point — identical guard + cycle to POST (see banner). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleAutomate(req);
}

async function handleAutomate(req: NextRequest): Promise<NextResponse> {
  try {
    return await runCycleRequest(req);
  } catch {
    // Absolute backstop — never an unhandled throw, never a leaked detail.
    return NextResponse.json(
      { error: 'Unexpected error while running the automate cycle.' },
      { status: 500 },
    );
  }
}

async function runCycleRequest(req: NextRequest): Promise<NextResponse> {
  // ------------------------------------------------------------------ auth
  const expected = process.env.AUTOMATE_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'automate not configured (AUTOMATE_SECRET is not set)' },
      { status: 503 },
    );
  }
  const provided =
    req.headers.get('x-automate-secret') ??
    new URL(req.url).searchParams.get('secret') ??
    '';
  if (provided === '' || !secretsMatch(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  // ------------------------------------------------------------------ db
  const db = getDbConfig();
  if (!db) {
    return NextResponse.json(
      { error: 'The data store is not configured. Nothing was run.' },
      { status: 503 },
    );
  }

  // -------------------------------------------------- tenants (allowlist)
  const tenantsResult = await fetchAllTenantWatchlists(db);
  if (!tenantsResult.ok) {
    // A cycle without watchlists would silently scan nothing — fail loudly.
    return NextResponse.json(
      { error: 'The tenant watchlists could not be loaded. Nothing was run.' },
      { status: 502 },
    );
  }

  // Fold in engine-owned watchlists (intel.tenant_watchlist): union per
  // tenant AND include cross-Supabase tenants that have NO km_monitoring_config
  // row of their own, so the automate cycle scans for them too.
  const engineTenantIds = await listEngineWatchlistTenants(db);
  const byId = new Map<string, SignalWatchlist>();
  for (const t of tenantsResult.tenants) byId.set(t.id, t.watchlist);
  for (const id of engineTenantIds) if (!byId.has(id)) byId.set(id, {});
  const mergedTenants: AutomateTenant[] = [];
  for (const [id, kmW] of byId) {
    mergedTenants.push({ id, watchlist: mergeWatchlists(kmW, await fetchEngineWatchlist(db, id)) });
  }

  // ------------------------------------------------------------- the cycle
  const connector = makeGdeltConnector();
  const deps: AutomateCycleDeps = {
    tenants: mergedTenants,
    fetchEvents: () => connector.fetch(),
    runPipeline: (batch) => runSharedPipeline(db, mergedTenants, batch),
    persistTrace: (record) => insertAgentRun(db, record),
    insertAlerts: (rows) => insertAlertRows(db, rows),
    listRecentAlerts: (tenantId) => fetchRecentAlerts(db, tenantId),
  };

  const summary = await runAutomateCycle(deps);
  return NextResponse.json(summary);
}

// ---------------------------------------------------------------------------
// Constant-time secret comparison
// ---------------------------------------------------------------------------

/**
 * Constant-time equality via SHA-256 digests: timingSafeEqual requires
 * equal-length buffers, and hashing first removes any length side-channel.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Pipeline binding — runConnector + the governed intel.proposed_edit insert
// ---------------------------------------------------------------------------

/**
 * Run the connector pipeline over the SHARED batch for every tenant and
 * insert the resulting pending proposals into the governed review queue.
 * The expectations gate is tenant-independent (same batch, same
 * expectations), so a 'held' verdict holds the batch for ALL tenants.
 */
async function runSharedPipeline(
  db: DbConfig,
  tenants: AutomateTenant[],
  batch: RawBatch,
): Promise<PipelineOutcome> {
  const mapper = MAPPERS['gdelt'];
  if (!mapper) {
    throw new Error("The 'gdelt' mapper is not registered — pipeline cannot run.");
  }

  const proposals: ProposedEdit[] = [];
  for (const tenant of tenants) {
    const result = await runConnector(
      {
        sourceKey: 'gdelt',
        mapperKey: 'gdelt',
        expectations: GDELT_EXPECTATIONS,
        fetch: async () => batch, // the shared batch — never re-fetched (§8.4)
      },
      { tenantId: tenant.id, mapper, propose: governedPropose },
    );
    if (result.status === 'held') {
      return { status: 'held' }; // gate verdict is batch-wide; recorded loudly upstream
    }
    proposals.push(...result.proposals);
  }

  if (proposals.length > 0) {
    await insertProposedEdits(db, proposals); // throws loudly on failure
  }
  return { status: 'proposed', proposedCount: proposals.length };
}

/**
 * Governed propose fn: mapped records become pending create proposals via
 * the EXISTING propose builders — the only legal pipeline output
 * (runConnector's backstop enforces this).
 */
function governedPropose(
  sourceKey: string,
  tenantId: string,
  mapped: MapperResult,
): ProposedEdit[] {
  const edits: ProposedEdit[] = [];
  for (const entity of mapped.entities as Entity[]) {
    const { id: _id, created_at: _c, updated_at: _u, ...fields } = entity;
    edits.push(
      proposeCreateEntity(
        tenantId,
        fields,
        'automate-cycle',
        `Automated ${sourceKey} ingest (scheduled cycle)`,
      ),
    );
  }
  for (const link of mapped.links as Link[]) {
    const { id: _id, created_at: _c, ...fields } = link;
    edits.push(
      proposeCreateLink(
        tenantId,
        fields,
        'automate-cycle',
        `Automated ${sourceKey} ingest (scheduled cycle)`,
      ),
    );
  }
  return edits;
}

// ---------------------------------------------------------------------------
// DB access — raw PostgREST with the service-role key, matching the existing
// patterns in src/app/api/signals/scan/route.ts (public schema) and
// src/app/api/ontology/ingest/route.ts (intel schema via Content-Profile).
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

type TenantsResult = { ok: true; tenants: AutomateTenant[] } | { ok: false };

/**
 * Load EVERY tenant's watchlist from public.km_monitoring_config.
 * EXPLICIT allowlist only — NEVER '*', and NEVER property_api_credentials
 * (jsonb secrets). Exactly the four matchable term columns + the tenant id.
 */
async function fetchAllTenantWatchlists(db: DbConfig): Promise<TenantsResult> {
  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/km_monitoring_config`);
    url.searchParams.set('select', 'organization_id,keywords,entities,tickers,geos');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: serviceHeaders(db),
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false };

    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return { ok: false };

    const tenants: AutomateTenant[] = [];
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const r = row as Record<string, unknown>;
      if (typeof r.organization_id !== 'string' || r.organization_id === '') continue;
      tenants.push({ id: r.organization_id, watchlist: normaliseWatchlistRow(r) });
    }
    return { ok: true, tenants };
  } catch {
    return { ok: false };
  }
}

/** Allowlist mapping — mirrors /api/signals/scan's normaliseWatchlistRow. */
function normaliseWatchlistRow(r: Record<string, unknown>): SignalWatchlist {
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

/**
 * Insert pending proposals into intel.proposed_edit — the same PostgREST
 * target and Content-Profile as /api/ontology/ingest. Throws on failure so
 * the cycle records a loud pipeline-stage failure.
 */
async function insertProposedEdits(db: DbConfig, edits: ProposedEdit[]): Promise<void> {
  // Governance: intel.proposed_edit is the ONLY intel-graph target on this
  // path — never entity/link/provenance (those are human-approval writes).
  const res = await fetch(`${db.supabaseUrl}/rest/v1/proposed_edit`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(db),
      'Content-Type': 'application/json',
      'Content-Profile': 'intel', // PostgREST: target the `intel` schema
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(edits),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`proposed_edit insert failed: HTTP ${res.status}`);
  }
}

/**
 * Persist one intel.agent_run lineage row (migration intel_0019 — exact
 * writable columns carried by AgentRunRecord). Throws on failure: a lost
 * trace fails the tenant run loudly rather than passing silently (§13.1).
 */
async function insertAgentRun(db: DbConfig, record: AgentRunRecord): Promise<void> {
  const res = await fetch(`${db.supabaseUrl}/rest/v1/agent_run`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(db),
      'Content-Type': 'application/json',
      'Content-Profile': 'intel', // PostgREST: target the `intel` schema
      Prefer: 'return=minimal',
    },
    body: JSON.stringify([record]),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`agent_run trace insert failed: HTTP ${res.status}`);
  }
}

/** Insert watcher alerts into public.intelligence_alerts (the ONLY alert sink). */
async function insertAlertRows(db: DbConfig, rows: IntelligenceAlertRow[]): Promise<void> {
  const res = await fetch(`${db.supabaseUrl}/rest/v1/intelligence_alerts`, {
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
    throw new Error(`intelligence_alerts insert failed: HTTP ${res.status}`);
  }
}

/**
 * Recent alerts for one tenant (last DEDUPE_WINDOW_DAYS days, any status)
 * for de-duplication — same window and columns as /api/signals/scan.
 * Throws on failure: guessing "no duplicates" would re-raise old alerts.
 */
async function fetchRecentAlerts(db: DbConfig, tenantId: string): Promise<StoredAlertKey[]> {
  const since = new Date(
    Date.now() - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const url = new URL(`${db.supabaseUrl}/rest/v1/intelligence_alerts`);
  url.searchParams.set('organization_id', `eq.${tenantId}`);
  url.searchParams.set('created_at', `gte.${since}`);
  url.searchParams.set('select', 'source_url,headline');

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: serviceHeaders(db),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`recent alerts lookup failed: HTTP ${res.status}`);
  }

  const rows: unknown = await res.json();
  if (!Array.isArray(rows)) {
    throw new Error('recent alerts lookup returned an unexpected shape');
  }
  return rows
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      source_url: typeof r.source_url === 'string' ? r.source_url : null,
      headline: typeof r.headline === 'string' ? r.headline : null,
    }));
}
