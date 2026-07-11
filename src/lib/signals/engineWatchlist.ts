/**
 * KINTEL — engine-owned watchlist loader (intel.tenant_watchlist + watchlist_item).
 *
 * Complements the main-app public.km_monitoring_config watchlist. Any consuming
 * system — Kammandor-main (same Supabase) or INVRT/PULSE (different Supabase) —
 * sets what the hub watches over HTTP (POST /api/intel/watchlist[/items]) or via
 * RLS'd DB; the signal matcher (scan + automate) reads the UNION of all of it.
 *
 * Two engine stores, unioned here:
 *   • intel.tenant_watchlist — header + array terms (keywords/entities/tickers/geos)
 *   • intel.watchlist_item   — TYPED subjects (person/company/product/creator/
 *     commentator/keyword/hashtag/handle/ticker/geo/topic), flattened into the
 *     matcher's four categories below.
 * Reads via service-role PostgREST (Accept-Profile: intel). Never throws.
 */

import type { SignalWatchlist } from './types';

export interface WatchlistDb {
  supabaseUrl: string;
  serviceRoleKey: string;
}

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

/** Which matcher category a typed watchlist_item.kind flattens into (handles excluded — not matched). */
const KIND_TO_CATEGORY: Record<string, keyof SignalWatchlist | undefined> = {
  keyword: 'keywords', hashtag: 'keywords', topic: 'keywords', product: 'keywords',
  person: 'entities', company: 'entities', creator: 'entities', commentator: 'entities',
  ticker: 'tickers',
  geo: 'geos',
  handle: undefined,
};

async function getJson(db: WatchlistDb, url: URL): Promise<unknown[]> {
  const res = await fetch(url.toString(), { headers: intelHeaders(db), cache: 'no-store' });
  if (!res.ok) return [];
  const rows: unknown = await res.json();
  return Array.isArray(rows) ? rows : [];
}

/** Union of every ACTIVE tenant_watchlist row + typed watchlist_item for a tenant. */
export async function fetchEngineWatchlist(
  db: WatchlistDb,
  tenant: string,
): Promise<SignalWatchlist> {
  const sets: Record<keyof SignalWatchlist, Set<string>> = {
    keywords: new Set(), entities: new Set(), tickers: new Set(), geos: new Set(),
  };
  try {
    // 1) header/array watchlists
    const twUrl = new URL(`${db.supabaseUrl}/rest/v1/tenant_watchlist`);
    twUrl.searchParams.set('tenant_id', `eq.${tenant}`);
    twUrl.searchParams.set('active', 'eq.true');
    twUrl.searchParams.set('select', 'keywords,entities,tickers,geos');
    for (const row of await getJson(db, twUrl)) {
      if (typeof row !== 'object' || row === null) continue;
      const r = row as Record<string, unknown>;
      for (const x of strArr(r.keywords)) sets.keywords.add(x);
      for (const x of strArr(r.entities)) sets.entities.add(x);
      for (const x of strArr(r.tickers)) sets.tickers.add(x);
      for (const x of strArr(r.geos)) sets.geos.add(x);
    }
    // 2) typed items → flattened into categories
    const wiUrl = new URL(`${db.supabaseUrl}/rest/v1/watchlist_item`);
    wiUrl.searchParams.set('tenant_id', `eq.${tenant}`);
    wiUrl.searchParams.set('active', 'eq.true');
    wiUrl.searchParams.set('select', 'kind,value');
    for (const row of await getJson(db, wiUrl)) {
      if (typeof row !== 'object' || row === null) continue;
      const r = row as Record<string, unknown>;
      const kind = typeof r.kind === 'string' ? r.kind : '';
      const value = typeof r.value === 'string' ? r.value.trim() : '';
      const cat = KIND_TO_CATEGORY[kind];
      if (cat && value) sets[cat].add(value);
    }
  } catch {
    /* never throw — an unreachable store simply contributes nothing */
  }
  const out: SignalWatchlist = {};
  if (sets.keywords.size) out.keywords = [...sets.keywords];
  if (sets.entities.size) out.entities = [...sets.entities];
  if (sets.tickers.size) out.tickers = [...sets.tickers];
  if (sets.geos.size) out.geos = [...sets.geos];
  return out;
}

/**
 * Distinct tenant ids with at least one ACTIVE engine watchlist row (either
 * store) — so the automate cycle also scans cross-Supabase tenants that have
 * NO km_monitoring_config row of their own.
 */
export async function listEngineWatchlistTenants(db: WatchlistDb): Promise<string[]> {
  const set = new Set<string>();
  try {
    for (const table of ['tenant_watchlist', 'watchlist_item']) {
      const url = new URL(`${db.supabaseUrl}/rest/v1/${table}`);
      url.searchParams.set('active', 'eq.true');
      url.searchParams.set('select', 'tenant_id');
      for (const row of await getJson(db, url)) {
        if (typeof row !== 'object' || row === null) continue;
        const t = (row as Record<string, unknown>).tenant_id;
        if (typeof t === 'string' && t !== '') set.add(t);
      }
    }
  } catch {
    /* ignore */
  }
  return [...set];
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
