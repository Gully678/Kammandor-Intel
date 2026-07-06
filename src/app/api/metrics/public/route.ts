import { NextRequest, NextResponse } from 'next/server';

/**
 * KINTEL — Free-tier live-metrics hook.
 * GET /api/metrics/public
 *
 * Public, keyless, cached (~60s) teaser of platform breadth + liveness for
 * anonymous visitors. GOVERNANCE: everything here is an AGGREGATE COUNT of
 * public/live telemetry or of the source registry — labelled live telemetry,
 * never a governed fact, never per-tenant/private data. No LLM involvement.
 * Registry counts come from intel.sources when the DB is reachable and fall
 * back to the intel_0020 registry constants when it is not (never invented).
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// intel_0020_source_registry_expansion — applied + verified against the live
// DB (51 = 33 map-layer + 18 governed). Fallback only; DB wins when reachable.
const REGISTRY_FALLBACK = { sources_monitored: 51, map_layers: 33, governed_sources: 18 };

const TTL_MS = 60_000;

interface PublicMetrics {
  label: string;
  generated_at: string;
  cache_ttl_seconds: number;
  registry: { sources_monitored: number; map_layers: number; governed_sources: number; basis: string };
  live: Record<string, number>;
  monitored_entities: number;
  monitored_entities_basis: string;
  cta: string;
}

const globalStore = globalThis as unknown as {
  __kintelPublicMetrics?: { at: number; data: PublicMetrics };
};

async function fetchJson(url: string, timeoutMs = 15_000, headers?: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers, cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

function pick(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Registry counts from intel.sources via PostgREST; null when unreachable. */
async function registryCounts(): Promise<{ sources_monitored: number; map_layers: number; governed_sources: number } | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const rows = await fetchJson(
    `${url}/rest/v1/sources?select=render_mode`,
    8_000,
    { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'intel' },
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const mapLayers = rows.filter((r) => pick(r, 'render_mode') === 'map-layer').length;
  return { sources_monitored: rows.length, map_layers: mapLayers, governed_sources: rows.length - mapLayers };
}

async function buildMetrics(origin: string): Promise<PublicMetrics> {
  const own = (p: string) => fetchJson(`${origin}${p}`, 20_000);

  const [registry, flights, quakes, maritime, conflicts, cyber, news, sdnIndex] = await Promise.all([
    registryCounts(),
    own('/api/flights'),
    own('/api/earthquakes'),
    own('/api/maritime'),
    own('/api/conflicts'),
    own('/api/cyber-threats'),
    own('/api/news'),
    fetchJson('https://data.opensanctions.org/datasets/latest/us_ofac_sdn/index.json', 10_000),
  ]);

  const live: Record<string, number> = {};
  const add = (k: string, v: unknown) => {
    const n = num(v);
    if (n !== null) live[k] = n;
  };

  add('flights_tracked', pick(flights, 'total'));
  add('earthquakes_24h', pick(quakes, 'total'));
  add('vessels_tracked', pick(maritime, 'total_ships'));
  add('active_conflict_events', pick(conflicts, 'totalLiveEvents'));
  add('active_warzones', pick(conflicts, 'activeWarzones'));
  add('cyber_known_exploited', pick(cyber, 'stats', 'cisa_total'));
  add('news_items_24h', pick(news, 'total'));
  add('sanctions_entities', pick(sdnIndex, 'thing_count') ?? pick(sdnIndex, 'target_count'));

  const monitored = Object.values(live).reduce((a, b) => a + b, 0);

  return {
    label: 'LIVE TELEMETRY — aggregate counts of public/live data; not governed facts; no tenant data',
    generated_at: new Date().toISOString(),
    cache_ttl_seconds: TTL_MS / 1000,
    registry: registry
      ? { ...registry, basis: 'intel.sources (live DB)' }
      : { ...REGISTRY_FALLBACK, basis: 'intel_0020 registry constants (DB unreachable)' },
    live,
    monitored_entities: monitored,
    monitored_entities_basis: 'sum of the live aggregate counts above at generation time',
    cta: 'This is the live free layer. Unlock customised entity tracking + real-time alerts for your deals/brands.',
  };
}

export async function GET(req: NextRequest) {
  const now = Date.now();
  const cached = globalStore.__kintelPublicMetrics;
  const headers = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' };

  if (cached && now - cached.at < TTL_MS) {
    return NextResponse.json(cached.data, { headers });
  }

  const origin = new URL(req.url).origin;
  const data = await buildMetrics(origin);
  globalStore.__kintelPublicMetrics = { at: now, data };
  return NextResponse.json(data, { headers });
}
