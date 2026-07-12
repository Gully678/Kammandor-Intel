/**
 * KINTEL — Bright Data Social / People Adapter (URL-driven).
 *
 * Matches the tenant's ACTUAL Bright Data scrapers, which are all
 * "Scraper API" datasets that COLLECT BY URL (or discover by profile/company/
 * subreddit URL). There are no keyword-discovery scrapers, so this adapter is
 * URL-first: give it a profile/company/post/subreddit URL and it routes to the
 * matching dataset_id (per-platform env var) and triggers `[{ url }]`.
 *
 * Verified against docs.brightdata.com Web Scraper API:
 *   POST https://api.brightdata.com/datasets/v3/scrape?dataset_id={id}&format=json   (sync, ≤ a few URLs)
 *   POST https://api.brightdata.com/datasets/v3/trigger?dataset_id={id}&format=json  (async → snapshot)
 *   Body: [{ "url": "https://…" }]   Auth: Bearer BRIGHTDATA_API_KEY
 *
 * Dataset IDs come from the Bright Data control panel (the "collect by URL"
 * scraper for each platform). Set the env var for each platform you use — see
 * the registry below. A subject with no resolvable URL, or a platform whose
 * dataset_id env var is unset, is skipped gracefully (never a wrong call).
 *
 * GDPR: personal data — lawful basis + DPA with Bright Data required before prod.
 */

import type { SocialAdapter, SocialProfileQueryParams, SocialProfilesResponse, SocialProfile } from '../index';
import { syncScrape } from '../../brightdata/client';
import { getSecretOrThrow } from '../../secrets';

/** host substring → env var holding the Bright Data "collect by URL" dataset_id. */
const PLATFORM_DATASET_ENV: Array<{ match: RegExp; env: string; platform: string }> = [
  { match: /linkedin\.com\/company/i, env: 'BRIGHTDATA_DS_LI_COMPANIES', platform: 'linkedin-company' },
  { match: /linkedin\.com\/(in|pub)\//i, env: 'BRIGHTDATA_DS_LI_PEOPLE',   platform: 'linkedin-person' },
  { match: /(twitter|x)\.com/i,          env: 'BRIGHTDATA_DS_X_PROFILES',  platform: 'x' },
  { match: /instagram\.com/i,            env: 'BRIGHTDATA_DS_IG_PROFILES', platform: 'instagram' },
  { match: /tiktok\.com/i,               env: 'BRIGHTDATA_DS_TIKTOK_PROFILES', platform: 'tiktok' },
  { match: /youtube\.com|youtu\.be/i,    env: 'BRIGHTDATA_DS_YT_CHANNELS', platform: 'youtube' },
  { match: /facebook\.com/i,             env: 'BRIGHTDATA_DS_FB_PAGES',    platform: 'facebook' },
  { match: /reddit\.com/i,               env: 'BRIGHTDATA_DS_REDDIT',      platform: 'reddit' },
];

function resolveDataset(url: string): { datasetId: string; platform: string } | null {
  for (const e of PLATFORM_DATASET_ENV) {
    if (e.match.test(url)) {
      const id = process.env[e.env];
      if (id && id.trim() !== '') return { datasetId: id.trim(), platform: e.platform };
      return null; // matched platform but no dataset configured → skip gracefully
    }
  }
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Generic normaliser across LinkedIn/X/IG/TikTok/YouTube/FB/Reddit "collect by URL" records. */
function normalise(raw: Record<string, unknown>, requestedType: 'company' | 'person', url: string): SocialProfile {
  const name =
    str(raw.name) ?? str(raw.full_name) ?? str(raw.account_name) ?? str(raw.title) ??
    str(raw.username) ?? str(raw.profile_name) ?? 'Unknown';
  const outUrl = str(raw.url) ?? str(raw.profile_url) ?? str(raw.input_url) ?? url;
  const followers = num(raw.followers) ?? num(raw.followers_count) ?? num(raw.connections) ?? num(raw.subscribers);
  const employees = num(raw.employees) ?? num(raw.employees_count);
  const headline =
    str(raw.headline) ?? str(raw.bio) ?? str(raw.description) ?? str(raw.tagline) ??
    (str(raw.about) ? String(raw.about).slice(0, 160) : undefined);
  const location = str(raw.location) ?? str(raw.city) ?? str(raw.headquarters);
  return {
    name, type: requestedType, url: outUrl, headline, location,
    followers, employees: requestedType === 'company' ? employees : undefined, raw,
  };
}

export class BrightDataSocialAdapter implements SocialAdapter {
  readonly name = 'brightdata';

  async getProfiles({ type, query, url, limit = 10 }: SocialProfileQueryParams): Promise<SocialProfilesResponse> {
    await getSecretOrThrow('BRIGHTDATA_API_KEY');

    // URL-driven ONLY (matches the tenant's collect-by-URL scrapers). A name/query
    // with no URL cannot be resolved by these scrapers — return empty, not a wrong call.
    const target = url ?? (query && /^https?:\/\//i.test(query) ? query : undefined);
    if (!target) {
      return { profiles: [], provider: 'brightdata' };
    }
    const resolved = resolveDataset(target);
    if (!resolved) {
      // platform not recognised, or its dataset_id env var is not configured
      return { profiles: [], provider: 'brightdata' };
    }

    const requestedType: 'company' | 'person' =
      type === 'company' || resolved.platform === 'linkedin-company' ? 'company' : 'person';

    // Sync scrape by URL (real-time); Bright Data handles the collection.
    const raw = await syncScrape(resolved.datasetId, [{ url: target }]);
    const profiles = raw.slice(0, limit).map((r) => normalise(r, requestedType, target));
    return { profiles, provider: 'brightdata' };
  }
}
