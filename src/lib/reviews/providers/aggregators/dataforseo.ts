/**
 * KINTEL — DataForSEO Reviews Aggregator Adapter (v3 aligned)
 *
 * Verified endpoint paths (from https://docs.dataforseo.com/v3/business_data/):
 *   POST https://api.dataforseo.com/v3/business_data/google/reviews/task_post
 *   POST https://api.dataforseo.com/v3/business_data/trustpilot/reviews/task_post
 *   GET  https://api.dataforseo.com/v3/business_data/google/reviews/task_get/{id}
 *   GET  https://api.dataforseo.com/v3/business_data/trustpilot/reviews/task_get/{id}
 *
 * Auth: Basic auth — base64(DATAFORSEO_LOGIN:DATAFORSEO_API_KEY)
 * Task POST payload: [{ keyword, location_code, language_code, depth, sort_by }]
 * Task POST response: tasks[].id (task UUID) — result is null at this stage.
 * Task GET response: tasks[].result[].items[] with per-review objects.
 *
 * Item fields (Google): profile_name, review_text, timestamp, rating.value, review_url
 * Item fields (Trustpilot): profile_name, review_text, timestamp, rating.value, review_url
 *
 * Tier: byok / aggregator
 * Cache: 1 h.
 *
 * AGGREGATOR NOTICE:
 * DataForSEO aggregates reviews from Google, Trustpilot, Yelp and others via their
 * official licensed REST API. DataForSEO assumes Terms-of-Service obligations with
 * underlying platforms as part of their licensed data product.
 * GDPR / legal sign-off required before production deployment — review data may contain
 * personal data (author names, profile URLs) subject to GDPR Art. 6 and Art. 28.
 * Confirm a valid lawful basis and Data Processing Agreement with DataForSEO.
 */

import type { ReviewsAdapter, ReviewsResponse, ReviewsQueryParams, ReviewRecord } from '../../index';
import { getSecret, getSecretOrThrow } from '../../../secrets';

// ── Platform → endpoint slug mapping ────────────────────────────────────────
// Verified from https://docs.dataforseo.com/v3/ Business Data API navigation:
//   Google Reviews:     /v3/business_data/google/reviews/task_post  (task_get/{id})
//   Trustpilot Reviews: /v3/business_data/trustpilot/reviews/task_post (task_get/{id})
// Note: DataForSEO does NOT have a Yelp business_data endpoint; Yelp reviews are
// available via the Yelp direct adapter. Google is the default aggregator path.
const PLATFORM_SLUG: Record<string, string> = {
  google:     'google',
  trustpilot: 'trustpilot',
};
const DEFAULT_PLATFORM_SLUG = 'google';

const DATAFORSEO_BASE = 'https://api.dataforseo.com';
// POST: /v3/business_data/{platform}/reviews/task_post
// GET:  /v3/business_data/{platform}/reviews/task_get/{taskId}

/** Max polling iterations (each ~1 s apart) before giving up on async task */
const MAX_POLL = 20;

async function requireCredentials(): Promise<{ login: string; apiKey: string }> {
  const login  = await getSecret('DATAFORSEO_LOGIN');
  const apiKey = await getSecretOrThrow('DATAFORSEO_API_KEY');
  if (!login) {
    throw new Error(
      'provider key required: DATAFORSEO_LOGIN not configured (set env or Supabase Vault)'
    );
  }
  return { login, apiKey };
}

function authHeader(login: string, apiKey: string): string {
  return `Basic ${Buffer.from(`${login}:${apiKey}`).toString('base64')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class DataForSeoAdapter implements ReviewsAdapter {
  readonly name = 'dataforseo';

  async getReviews({ entity, platform = 'google', limit = 25 }: ReviewsQueryParams): Promise<ReviewsResponse> {
    const { login, apiKey } = await requireCredentials();
    const auth = authHeader(login, apiKey);

    const slug = PLATFORM_SLUG[platform.toLowerCase()] ?? DEFAULT_PLATFORM_SLUG;
    // Verified POST endpoint:
    // https://api.dataforseo.com/v3/business_data/google/reviews/task_post
    // https://api.dataforseo.com/v3/business_data/trustpilot/reviews/task_post
    const taskPostUrl = `${DATAFORSEO_BASE}/v3/business_data/${slug}/reviews/task_post`;

    const body = JSON.stringify([{
      keyword:       entity,
      location_code: 2826,                   // UK default; parameterise via env if needed
      language_code: 'en',
      depth:         Math.min(limit, 100),   // billed per 10 reviews
      sort_by:       'relevant',
    }]);

    // ── Step 1: POST task ────────────────────────────────────────────────────
    const postRes = await fetch(taskPostUrl, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body,
      // next.js: no cache on task_post (idempotent not guaranteed)
    });
    if (!postRes.ok) {
      throw new Error(`DataForSEO task_post returned HTTP ${postRes.status}`);
    }
    const postData = await postRes.json() as Record<string, unknown>;

    if ((postData.status_code as number) !== 20000) {
      throw new Error(
        `DataForSEO API error ${postData.status_code}: ${postData.status_message}`
      );
    }

    const tasks = Array.isArray(postData.tasks) ? postData.tasks as Record<string, unknown>[] : [];
    const taskId = tasks[0]?.id as string | undefined;
    if (!taskId) {
      throw new Error('DataForSEO task_post: no task id returned');
    }

    // ── Step 2: poll task_get until result arrives (or timeout) ─────────────
    // Verified GET endpoint:
    // https://api.dataforseo.com/v3/business_data/google/reviews/task_get/{id}
    // https://api.dataforseo.com/v3/business_data/trustpilot/reviews/task_get/{id}
    const taskGetUrl = `${DATAFORSEO_BASE}/v3/business_data/${slug}/reviews/task_get/${taskId}`;

    let items: Record<string, unknown>[] = [];
    let aggregateRating = 0;
    let totalReviewCount = 0;

    for (let attempt = 0; attempt < MAX_POLL; attempt++) {
      await sleep(1500); // DataForSEO tasks typically complete in 1–5 s

      const getRes = await fetch(taskGetUrl, {
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        next: { revalidate: 3600 },
      });
      if (!getRes.ok) {
        throw new Error(`DataForSEO task_get returned HTTP ${getRes.status}`);
      }
      const getData = await getRes.json() as Record<string, unknown>;

      const getTasks = Array.isArray(getData.tasks) ? getData.tasks as Record<string, unknown>[] : [];
      const firstTask = getTasks[0] as Record<string, unknown> | undefined;

      // status_code 20000 = OK with results; 20100 = task created (not yet ready)
      if (!firstTask || (firstTask.status_code as number) === 20100) continue;
      if ((firstTask.status_code as number) >= 40000) {
        throw new Error(`DataForSEO task error ${firstTask.status_code}: ${firstTask.status_message}`);
      }

      const resultArr = Array.isArray(firstTask.result) ? firstTask.result as Record<string, unknown>[] : [];
      const firstResult = resultArr[0] as Record<string, unknown> | undefined;
      if (!firstResult) continue;

      // Top-level aggregate from result object:
      // result[0].rating.value = average rating; result[0].reviews_count = total
      const aggRating = firstResult.rating as Record<string, unknown> | undefined;
      aggregateRating  = typeof aggRating?.value === 'number' ? aggRating.value : 0;
      totalReviewCount = typeof firstResult.reviews_count === 'number' ? firstResult.reviews_count : 0;

      items = Array.isArray(firstResult.items) ? firstResult.items as Record<string, unknown>[] : [];
      break; // results ready
    }

    // ── Step 3: normalise to ReviewRecord[] ─────────────────────────────────
    const reviews: ReviewRecord[] = items.slice(0, limit).map(item => {
      const itemRating = item.rating as Record<string, unknown> | undefined;
      return {
        // Google/Trustpilot: field is profile_name (verified from task_get response schema)
        author:   String(item.profile_name ?? item.author_title ?? 'Anonymous'),
        rating:   typeof itemRating?.value === 'number' ? itemRating.value : 0,
        text:     String(item.review_text ?? ''),
        date:     String(item.timestamp ?? new Date().toISOString()),
        platform: slug,
        url:      String(item.review_url ?? item.profile_url ?? ''),
      };
    });

    // If we polled but got nothing back (all attempts missed), fall through with empty
    const scoreFromItems = reviews.length > 0
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      : 0;

    return {
      reviews,
      aggregate: {
        score:    Math.round((aggregateRating || scoreFromItems) * 10) / 10,
        count:    totalReviewCount || reviews.length,
        platform: slug,
      },
    };
  }
}
