/**
 * KINTEL — SERP Connector: Adapter Interface
 * Provider-pluggable: selected via process.env.SERP_PROVIDER (default 'dataforseo').
 *
 * SERP is the search-engine listening layer: for a watchlist keyword / company /
 * product subject it returns the current NEWS and ORGANIC results. Those feed the
 * grounding/delta brain (net-new since baseline) exactly like the social harvest.
 *
 * Compliance contract:
 *  - Returns RAW SERP items only (title/url/domain/snippet/source/timestamp/rank).
 *  - NO sentiment or severity computed here — deterministic severity is applied by
 *    the delta brain; sentiment scoring (if any) lives downstream (contract).
 */

export type SerpKind = 'news' | 'organic';

export interface SerpItem {
  kind: SerpKind;
  title: string;
  url: string | null;
  domain?: string;
  snippet?: string;
  source?: string;
  /** ISO-8601 (or provider-native) timestamp of the result, when available. */
  timestamp?: string;
  /** Absolute rank in the SERP, when available. */
  rank?: number;
}

export interface SerpResponse {
  items: SerpItem[];
  provider: string;
}

export interface SerpQueryParams {
  /** Brand / company / product / keyword to search. */
  keyword: string;
  /** Which SERP surface to pull. */
  type: SerpKind;
  /** Max results (billed per 10 by DataForSEO). Default 20. */
  limit?: number;
  /** DataForSEO location_code (default 2826 = United Kingdom). */
  locationCode?: number;
  /** DataForSEO language_code (default 'en'). */
  languageCode?: string;
}

/** Contract every SERP adapter must satisfy. */
export interface SerpAdapter {
  readonly name: string;
  getSerp(params: SerpQueryParams): Promise<SerpResponse>;
}

// ── Provider registry ────────────────────────────────────────────────────────
import { DataForSeoSerpAdapter } from './providers/dataforseo';

/**
 * Resolve the active SERP adapter.
 * SERP_PROVIDER env selects provider; defaults to 'dataforseo'.
 *   'dataforseo' — requires DATAFORSEO_LOGIN + DATAFORSEO_API_KEY
 */
export function resolveSerpAdapter(): SerpAdapter {
  const p = (process.env.SERP_PROVIDER ?? 'dataforseo').toLowerCase();
  switch (p) {
    case 'dataforseo':
    default:
      return new DataForSeoSerpAdapter();
  }
}
