import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';

export const dynamic = 'force-dynamic';

/**
 * KINTEL Phase 4 — Tenant-scoped monitoring config
 * GET /api/intel/monitoring-config
 *
 * Resolves the caller's tenant via resolveTenantFromRequest() (signed
 * handoff token by default — see src/lib/handoff/token.ts's SHARED
 * CONTRACT; a plain `?tenant=` param only if INTEL_ALLOW_UNSIGNED_TENANT
 * is explicitly 'true') and returns that tenant's row from
 * public.km_monitoring_config, so the Intel view can scope its
 * watchlist/panels to the tenant instead of a hardcoded default.
 *
 * READ-ONLY. This route never writes to km_monitoring_config or any other
 * table. It does not "own" that table — the MAIN Kammandor app does; this
 * route only reads the row relevant to the resolved tenant, via the same
 * raw-PostgREST-with-service-role pattern already used in
 * src/app/api/ontology/ingest/route.ts (there is no @supabase/supabase-js
 * client in this repo's server-side TS layer — see that route's comment).
 *
 * Response shape is defensive about exact column names on
 * km_monitoring_config, since this route was written without direct access
 * to that table's live schema (see the brief for src/lib/handoff/slice5).
 * If the row exists but a given watchlist field is absent/null, that key
 * is simply omitted from the response rather than the route failing.
 * If no row exists for the tenant (or the table can't be reached), the
 * route returns `{}` rather than an error — an empty watchlist is a valid,
 * safe default (never a hardcoded tenant-specific one).
 */

export interface MonitoringConfigResponse {
  organizationId?: string;
  keywords?:       string[];
  entities?:       string[];
  tickers?:        string[];
  handles?:        string[];
  geographies?:    string[];   // DB column is `geos`
  feeds?:          unknown;     // jsonb feed config (non-sensitive)
  intel?:          unknown;     // jsonb intel context / map focus
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = await getSecret('INTEL_HANDOFF_SECRET');
  const tenant = resolveTenantFromRequest(req, secret);

  if (!tenant) {
    return NextResponse.json(
      { error: 'No valid tenant could be resolved for this request.' },
      { status: 401 },
    );
  }

  const result = await fetchMonitoringConfig(tenant);
  if (!result.ok) {
    // Degrade gracefully: an unreachable/misconfigured table should not
    // break the Intel view — fall back to an empty (safe) watchlist shape.
    return NextResponse.json({});
  }

  return NextResponse.json(result.config);
}

interface FetchConfigResult {
  ok:     boolean;
  config: MonitoringConfigResponse;
}

/**
 * Read the tenant's row from public.km_monitoring_config via PostgREST,
 * using the service-role key (same pattern as ingest/route.ts's
 * insertProposedEdits). No Content-Profile header is sent, since
 * km_monitoring_config lives in the default `public` schema (unlike
 * intel.proposed_edit, which requires `Content-Profile: intel`).
 */
async function fetchMonitoringConfig(tenant: string): Promise<FetchConfigResult> {
  const supabaseUrl    = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false, config: {} };
  }

  try {
    const url = new URL(`${supabaseUrl}/rest/v1/km_monitoring_config`);
    url.searchParams.set('organization_id', `eq.${tenant}`);
    // Explicit allowlist — NEVER select property_api_credentials (jsonb secrets) or internal cols.
    url.searchParams.set('select', 'organization_id,keywords,tickers,handles,entities,geos,feeds,intel');
    url.searchParams.set('limit', '1');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        apikey:        serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept:        'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return { ok: false, config: {} };
    }

    const rows: unknown = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: true, config: {} };
    }

    return { ok: true, config: normaliseRow(rows[0]) };
  } catch {
    // Network error, DNS failure, unexpected shape, etc. — never throw.
    return { ok: false, config: {} };
  }
}

/**
 * Map a raw km_monitoring_config row onto the response shape using an
 * EXPLICIT allowlist. No blanket pass-through: sensitive columns
 * (property_api_credentials) and internal columns (id, reseller_id,
 * timestamps) are never returned.
 */
function normaliseRow(row: unknown): MonitoringConfigResponse {
  if (typeof row !== 'object' || row === null) return {};
  const r = row as Record<string, unknown>;
  const out: MonitoringConfigResponse = {};
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;

  if (typeof r.organization_id === 'string') out.organizationId = r.organization_id;

  const keywords = strArr(r.keywords); if (keywords) out.keywords = keywords;
  const entities = strArr(r.entities); if (entities) out.entities = entities;
  const tickers  = strArr(r.tickers);  if (tickers)  out.tickers  = tickers;
  const handles  = strArr(r.handles);  if (handles)  out.handles  = handles;
  const geos     = strArr(r.geos);     if (geos)     out.geographies = geos;

  if (r.feeds !== null && r.feeds !== undefined) out.feeds = r.feeds;
  if (r.intel !== null && r.intel !== undefined) out.intel = r.intel;

  return out;
}
