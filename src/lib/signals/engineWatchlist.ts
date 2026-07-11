/**
 * KINTEL — engine-owned watchlist loader (intel.tenant_watchlist).
 *
 * Complements the main-app public.km_monitoring_config watchlist. Any consuming
 * system — including INVRT/PULSE on a DIFFERENT Supabase — pushes watch terms
 * over HTTP (POST /api/intel/watchlist) into intel.tenant_watchlist; the signal
 * matcher (scan + automate) reads the UNION of km_monitoring_config + this.
 *
 * A tenant may hold MANY watchlists (scope 'org' | 'deal' | 'campaign', keyed by
 * ref); this loader unions all ACTIVE rows for a tenant into one SignalWatchlist.
 * Reads via service-role PostgREST with Accept-Profile: intel. Never throws.
 */

import type { SignalWatchlist } from './types';

export interface WatchlistDb {
  supabaseUrl: string;
  serviceRoleKey: string;
}

const TERM_SELECT = 'tenant_id,keywords,entities,tickers,geos';

function intelHeaders(db: WatchlistDb): Record<string, string> {
  return {
    apikey: db.serviceRoleKey,
    Authorization: `Bearer ${db.serviceRoleKey}`,
    Accept: 'application/json',
    'Accept-Profile': 'intel',
  };
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Union of every ACTIVE intel.tenant_watchlist row for a tenant. */
export async function fetchEngineWatchlist(
  db: WatchlistDb,
  tenant: string,
): Promise<SignalWatchlist> {
  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/tenant_watchlist`);
    url.searchParams.set('tenant_id', `eq.${tenant}`);
    url.searchParams.set('active', 'eq.true');
    url.searchParams.set('select', TERM_SELECT);

    const res = await fetch(url.toString(), { headers: intelHeaders(db), cache: 'no-store' });
    if (!res.ok) return {};
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return {};

    const kw = new Set<string>();
    const en = new Set<string>();
    const tk = new Set<string>();
    const ge = new Set<string>();
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const r = row as Record<string, unknown>;
      for (const x of strArr(r.keywords)) kw.add(x);
      for (const x of strArr(r.entities)) en.add(x);
      for (const x of strArr(r.tickers)) tk.add(x);
      for (const x of strArr(r.geos)) ge.add(x);
    }
    const out: SignalWatchlist = {};
    if (kw.size) out.keywords = [...kw];
    if (en.size) out.entities = [...en];
    if (tk.size) out.tickers = [...tk];
    if (ge.size) out.geos = [...ge];
    return out;
  } catch {
    return {};
  }
}

/**
 * Distinct tenant ids that have at least one ACTIVE engine watchlist — so the
 * automate cycle also scans cross-Supabase tenants that have NO
 * km_monitoring_config row of their own.
 */
export async function listEngineWatchlistTenants(db: WatchlistDb): Promise<string[]> {
  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/tenant_watchlist`);
    url.searchParams.set('active', 'eq.true');
    url.searchParams.set('select', 'tenant_id');

    const res = await fetch(url.toString(), { headers: intelHeaders(db), cache: 'no-store' });
    if (!res.ok) return [];
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return [];

    const set = new Set<string>();
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const t = (row as Record<string, unknown>).tenant_id;
      if (typeof t === 'string' && t !== '') set.add(t);
    }
    return [...set];
  } catch {
    return [];
  }
}

/** Union two watchlists (exact-dedupe per category). */
export function mergeWatchlists(a: SignalWatchlist, b: SignalWatchlist): SignalWatchlist {
  const cats: (keyof SignalWatchlist)[] = ['keywords', 'entities', 'tickers', 'geos'];
  const out: SignalWatchlist = {};
  for (const c of cats) {
    const merged = [...new Set([...(a[c] ?? []), ...(b[c] ?? [])])];
    if (merged.length) out[c] = merged;
  }
  return out;
}
