/**
 * KINTEL — Reviews Connector: Adapter Interface
 * Provider-pluggable: selected via process.env.REVIEWS_PROVIDER
 * Default (keyless dev): 'appstore-rss'
 * Default (production with key): configure REVIEWS_PROVIDER + relevant key env var.
 *
 * Compliance contract:
 *  - Returns RAW reviews + the provider's own aggregate score only.
 *  - Do NOT compute sentiment scores here — sentiment scoring lives in Kammandor (contract).
 *  - Each adapter encodes its platform-specific caching/ToS constraints.
 */

export interface ReviewRecord {
  author: string;
  rating: number;      // 1–5 numeric scale
  text: string;
  date: string;        // ISO-8601
  platform: string;    // e.g. 'appstore', 'trustpilot', 'google', 'yelp', 'g2'
  url: string;         // link to original review
}

export interface AggregateScore {
  /** Provider's own average score (NOT computed by Kammandor) */
  score: number;
  count: number;
  platform: string;
}

export interface ReviewsResponse {
  reviews: ReviewRecord[];
  aggregate: AggregateScore;
}

export interface ReviewsQueryParams {
  entity: string;       // brand name, app id, business id etc.
  platform?: string;    // optional platform hint
  limit?: number;       // max reviews to return (default 25)
}

/** Contract every reviews adapter must satisfy */
export interface ReviewsAdapter {
  readonly name: string;
  getReviews(params: ReviewsQueryParams): Promise<ReviewsResponse>;
}

// ── Provider registry ────────────────────────────────────────────────────────

import { AppStoreRssAdapter }       from './providers/appstore-rss';
import { TrustpilotAdapter }        from './providers/trustpilot';
import { G2Adapter }                from './providers/g2';
import { GooglePlacesAdapter }      from './providers/google-places';
import { YelpAdapter }              from './providers/yelp';
import { DataForSeoAdapter }        from './providers/aggregators/dataforseo';
import { BrightDataReviewsAdapter } from './providers/aggregators/brightdata';
import { OutscraperAdapter }        from './providers/aggregators/outscraper';
import { SerpApiAdapter }           from './providers/aggregators/serpapi';
import { ApifyAdapter }             from './providers/aggregators/apify';

/**
 * Resolve the active reviews adapter.
 * REVIEWS_PROVIDER env selects provider; defaults to 'appstore-rss' (keyless dev).
 *
 * 'appstore-rss'       — KEYLESS, Apple App Store RSS (AMBER: legal-review required)
 * 'trustpilot'         — requires TRUSTPILOT_API_KEY
 * 'g2'                 — requires G2_API_TOKEN
 * 'google-places'      — requires GOOGLE_PLACES_KEY (NO-STORE: Google ToS)
 * 'yelp'               — requires YELP_API_KEY (≤24 h cache)
 * 'dataforseo'         — requires DATAFORSEO_LOGIN + DATAFORSEO_API_KEY
 * 'brightdata'         — requires BRIGHTDATA_API_KEY + BRIGHTDATA_DS_* dataset IDs
 * 'outscraper'         — requires OUTSCRAPER_KEY
 * 'serpapi'            — requires SERPAPI_KEY
 * 'apify'              — requires APIFY_TOKEN
 */
export function resolveReviewsAdapter(): ReviewsAdapter {
  const p = (process.env.REVIEWS_PROVIDER ?? 'appstore-rss').toLowerCase();
  switch (p) {
    case 'trustpilot':    return new TrustpilotAdapter();
    case 'g2':            return new G2Adapter();
    case 'google-places': return new GooglePlacesAdapter();
    case 'yelp':          return new YelpAdapter();
    case 'dataforseo':    return new DataForSeoAdapter();
    case 'brightdata':    return new BrightDataReviewsAdapter();
    case 'outscraper':    return new OutscraperAdapter();
    case 'serpapi':       return new SerpApiAdapter();
    case 'apify':         return new ApifyAdapter();
    case 'appstore-rss':
    default:              return new AppStoreRssAdapter();
  }
}
