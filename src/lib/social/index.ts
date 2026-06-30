/**
 * KINTEL — Social & People Connector: Adapter Interface
 *
 * Provides structured profile data for companies and individuals from social/professional
 * networks (LinkedIn, Instagram, X/Twitter, TikTok, etc.) via licensed provider APIs.
 *
 * Compliance contract:
 *  - Returns RAW provider data only — no scoring or sentiment here.
 *  - Scoring, enrichment, and analysis live in Kammandor (contract boundary).
 *  - Each adapter encodes its provider's caching / rate-limit constraints.
 *
 * GDPR / personal data — legal sign-off required before production deployment.
 * Profile data (names, locations, employment history, follower counts, URLs) constitutes
 * personal data under GDPR. A valid lawful basis (Art. 6) and Data Processing Agreement
 * with the licensed provider are required. See Kammandor operator documentation.
 */

export type SocialProfileType = 'company' | 'person' | 'job' | 'post';

export interface SocialProfileQueryParams {
  /** 'company' or 'person' — governs which dataset is queried */
  type: SocialProfileType;
  /** Free-text name / keyword search (used when url is not provided) */
  query?: string;
  /** Direct profile URL (LinkedIn, etc.) — preferred over query when available */
  url?: string;
  /** Soft cap on results returned from the adapter */
  limit?: number;
}

export interface SocialProfile {
  name: string;
  type: SocialProfileType;
  url: string;
  headline?: string;
  location?: string;
  followers?: number;
  employees?: number;        // companies only
  /** Raw provider JSON — Kammandor scores from this */
  raw: Record<string, unknown>;
}

export interface SocialProfilesResponse {
  profiles: SocialProfile[];
  provider: string;
}

/** Contract every social adapter must satisfy */
export interface SocialAdapter {
  readonly name: string;
  getProfiles(params: SocialProfileQueryParams): Promise<SocialProfilesResponse>;
}

// ── Provider registry ────────────────────────────────────────────────────────

import { BrightDataSocialAdapter } from './providers/brightdata';

/**
 * Resolve the active social adapter.
 * SOCIAL_PROVIDER env selects provider; defaults to 'brightdata'.
 *
 * 'brightdata' — requires BRIGHTDATA_API_TOKEN + BRIGHTDATA_DS_LI_* dataset IDs
 */
export function resolveSocialAdapter(): SocialAdapter {
  const p = (process.env.SOCIAL_PROVIDER ?? 'brightdata').toLowerCase();
  switch (p) {
    case 'brightdata':
    default:
      return new BrightDataSocialAdapter();
  }
}
