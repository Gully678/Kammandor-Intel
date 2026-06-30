/**
 * KINTEL — Bright Data Social / People Adapter
 *
 * Uses Bright Data Datasets API v3 (licensed scraper service).
 * Verified endpoint paths from https://docs.brightdata.com/datasets/scrapers/linkedin/:
 *
 *   Async (batch, >20 URLs):
 *     POST https://api.brightdata.com/datasets/v3/trigger?dataset_id={id}&format=json
 *          Body: [{ url: "https://www.linkedin.com/..." }]  (or keyword-based inputs)
 *          Response: { snapshot_id: "s_..." }
 *     GET  https://api.brightdata.com/datasets/v3/progress/{snapshot_id}
 *          Response: { status: "collecting"|"digesting"|"ready"|"failed" }
 *     GET  https://api.brightdata.com/datasets/v3/snapshot/{snapshot_id}?format=json
 *          Response: JSON array of structured profile records
 *
 *   Synchronous (≤20 URLs, real-time):
 *     POST https://api.brightdata.com/datasets/v3/scrape?dataset_id={id}&format=json
 *          Body: [{ url: "https://www.linkedin.com/..." }]
 *          Response: JSON array of structured profile records (same shape)
 *
 * Auth: Bearer BRIGHTDATA_API_TOKEN
 *
 * Dataset IDs (founder must configure in Bright Data control panel + set env vars):
 *   BRIGHTDATA_DS_LI_PEOPLE   — LinkedIn People / Profiles dataset
 *   BRIGHTDATA_DS_LI_COMPANIES — LinkedIn Companies dataset
 *   BRIGHTDATA_DS_LI_JOBS     — LinkedIn Jobs dataset (optional)
 *   BRIGHTDATA_DS_INSTAGRAM   — Instagram Profiles dataset (optional)
 *   BRIGHTDATA_DS_X           — X/Twitter Profiles dataset (optional)
 *   BRIGHTDATA_DS_TIKTOK      — TikTok Profiles dataset (optional)
 *
 * Example LinkedIn People dataset_id (verify in your BD account):
 *   gd_l1viktl72bvl7bjuj0  (LinkedIn People — scrape by URL)
 *
 * This is a licensed-provider API client only. No scraping or anti-bot logic is
 * present here — Bright Data handles proxy rotation, CAPTCHA handling, and HTML
 * parsing as part of their licensed data product.
 *
 * GDPR / personal data — legal sign-off required before production deployment.
 * LinkedIn profile data, Instagram follower counts, X/Twitter bios, and similar
 * social media data constitute personal data under GDPR Art. 4(1).
 * A valid lawful basis (Art. 6) and a Data Processing Agreement (Art. 28) with
 * Bright Data Ltd are required before processing personal data in production.
 * Do not store or process personal data without compliance sign-off.
 * See Kammandor operator documentation for the required DPA checklist.
 */

import type { SocialAdapter, SocialProfileQueryParams, SocialProfilesResponse, SocialProfile } from '../index';
import { syncScrape, triggerAndFetch } from '../../brightdata/client';

// ── Dataset ID resolution ────────────────────────────────────────────────────

function getDatasetId(type: 'company' | 'person' | 'job' | 'post'): string {
  const envMap: Record<string, string | undefined> = {
    person:  process.env.BRIGHTDATA_DS_LI_PEOPLE,
    company: process.env.BRIGHTDATA_DS_LI_COMPANIES,
    job:     process.env.BRIGHTDATA_DS_LI_JOBS,
    post:    process.env.BRIGHTDATA_DS_LI_POSTS,
  };
  const id = envMap[type];
  if (!id) {
    throw new Error(
      `provider key required: set BRIGHTDATA_DS_LI_${type.toUpperCase()}S env var ` +
      `with the Bright Data dataset_id for LinkedIn ${type} data`
    );
  }
  return id;
}

function requireToken(): void {
  if (!process.env.BRIGHTDATA_API_TOKEN) {
    throw new Error(
      'provider key required: set BRIGHTDATA_API_TOKEN for brightdata social provider'
    );
  }
}

// ── Normalise LinkedIn person profile ────────────────────────────────────────
// Verified response fields from https://docs.brightdata.com/datasets/scrapers/linkedin/introduction
// Example person record: { name, city, country_code, current_company.name, followers, about, headline }
function normalisePerson(raw: Record<string, unknown>): SocialProfile {
  const currentCompany = raw.current_company as Record<string, unknown> | undefined;
  const followers = typeof raw.followers === 'number'
    ? raw.followers
    : (typeof raw.connections === 'number' ? raw.connections : undefined);

  return {
    name:     String(raw.name ?? raw.full_name ?? 'Unknown'),
    type:     'person',
    url:      String(raw.url ?? raw.profile_url ?? raw.linkedin_url ?? ''),
    headline: raw.headline ? String(raw.headline) : (raw.about ? String(raw.about).slice(0, 160) : undefined),
    location: raw.city ? `${raw.city}${raw.country_code ? ', ' + raw.country_code : ''}` : undefined,
    followers,
    raw,
  };
}

// ── Normalise LinkedIn company profile ───────────────────────────────────────
// Company record: { name, url, followers, employees, specialties, about, tagline }
function normaliseCompany(raw: Record<string, unknown>): SocialProfile {
  const employees = typeof raw.employees === 'number'
    ? raw.employees
    : (typeof raw.employee_count === 'number' ? raw.employee_count : undefined);
  const followers = typeof raw.followers === 'number' ? raw.followers : undefined;

  return {
    name:      String(raw.name ?? 'Unknown'),
    type:      'company',
    url:       String(raw.url ?? raw.company_url ?? raw.linkedin_url ?? ''),
    headline:  raw.tagline ? String(raw.tagline) : (raw.specialties ? String(raw.specialties).slice(0, 160) : undefined),
    location:  raw.headquarters ? String(raw.headquarters) : undefined,
    followers,
    employees,
    raw,
  };
}

function normalise(raw: Record<string, unknown>, type: 'person' | 'company'): SocialProfile {
  return type === 'company' ? normaliseCompany(raw) : normalisePerson(raw);
}

export class BrightDataSocialAdapter implements SocialAdapter {
  readonly name = 'brightdata';

  async getProfiles({
    type,
    query,
    url,
    limit = 10,
  }: SocialProfileQueryParams): Promise<SocialProfilesResponse> {
    requireToken();

    const profileType = (type === 'company' || type === 'person') ? type : 'person';
    const datasetId = getDatasetId(type);

    // Build inputs array: prefer direct URL, fall back to keyword/query
    // LinkedIn scraper input shape: { url: "https://www.linkedin.com/..." }
    // For keyword-based discovery, shape is { keyword: "..." } — async only
    let inputs: Record<string, unknown>[];
    if (url) {
      inputs = [{ url }];
    } else if (query) {
      inputs = [{ keyword: query }];
    } else {
      throw new Error('social adapter: either url or query must be provided');
    }

    // Use sync path for single-URL lookups (real-time, ≤20 inputs)
    // Use async trigger/poll/fetch for keyword discovery (may return many results)
    let raw: Record<string, unknown>[];
    if (url) {
      // Direct URL: use synchronous scrape for low latency
      raw = await syncScrape(datasetId, inputs);
    } else {
      // Keyword/discovery: use async trigger→poll→fetch
      raw = await triggerAndFetch(datasetId, inputs);
    }

    const profiles: SocialProfile[] = raw
      .slice(0, limit)
      .map(item => normalise(item, profileType));

    return { profiles, provider: 'brightdata' };
  }
}
