/**
 * KINTEL — Trustpilot Reviews Adapter
 * Source: https://developers.trustpilot.com — Official Business API
 * Auth: TRUSTPILOT_API_KEY (+ OAuth flow for private data; public endpoints key-only)
 * Tier: byok (tenant supplies credentials)
 *
 * Compliance: Data accessed via Trustpilot official Business API.
 *             Trustpilot ToS prohibits scraping; this adapter uses the authorised API only.
 *             Review text redistribution: adhere to Trustpilot's content policy.
 * Cache: 1 h — Trustpilot updates review data frequently.
 */

import type { ReviewsAdapter, ReviewsResponse, ReviewsQueryParams, ReviewRecord } from '../index';

function requireKey(): string {
  const key = process.env.TRUSTPILOT_API_KEY;
  if (!key) throw new Error('provider key required: set TRUSTPILOT_API_KEY for trustpilot provider');
  return key;
}

export class TrustpilotAdapter implements ReviewsAdapter {
  readonly name = 'trustpilot';

  async getReviews({ entity, limit = 25 }: ReviewsQueryParams): Promise<ReviewsResponse> {
    const key = requireKey();

    // Step 1: find business unit by domain/name
    const searchRes = await fetch(
      `https://api.trustpilot.com/v1/business-units/search?query=${encodeURIComponent(entity)}&apikey=${key}`,
      { next: { revalidate: 3600 } }
    );
    if (!searchRes.ok) throw new Error(`Trustpilot search returned HTTP ${searchRes.status}`);
    const searchData = await searchRes.json() as Record<string, unknown>;
    const units = Array.isArray(searchData.businessUnits) ? searchData.businessUnits as Record<string, unknown>[] : [];
    if (units.length === 0) return { reviews: [], aggregate: { score: 0, count: 0, platform: 'trustpilot' } };

    const businessUnitId = String(units[0].id ?? '');
    if (!businessUnitId) return { reviews: [], aggregate: { score: 0, count: 0, platform: 'trustpilot' } };

    // Step 2: fetch reviews
    const reviewsRes = await fetch(
      `https://api.trustpilot.com/v1/business-units/${businessUnitId}/reviews?apikey=${key}&perPage=${Math.min(limit, 100)}`,
      { next: { revalidate: 3600 } }
    );
    if (!reviewsRes.ok) throw new Error(`Trustpilot reviews returned HTTP ${reviewsRes.status}`);
    const reviewsData = await reviewsRes.json() as Record<string, unknown>;
    const rawReviews = Array.isArray(reviewsData.reviews) ? reviewsData.reviews as Record<string, unknown>[] : [];

    const reviews: ReviewRecord[] = rawReviews.map(r => {
      const stars = typeof r.stars === 'number' ? r.stars : 0;
      const consumer = typeof r.consumer === 'object' && r.consumer !== null ? r.consumer as Record<string, unknown> : {};
      return {
        author: String(consumer.displayName ?? 'Anonymous'),
        rating: stars,
        text: String(r.text ?? ''),
        date: String(r.createdAt ?? new Date().toISOString()),
        platform: 'trustpilot',
        url: `https://www.trustpilot.com/reviews/${businessUnitId}`,
      };
    });

    // Provider aggregate
    const summaryRes = await fetch(
      `https://api.trustpilot.com/v1/business-units/${businessUnitId}?apikey=${key}`,
      { next: { revalidate: 3600 } }
    );
    let score = 0;
    let count = reviews.length;
    if (summaryRes.ok) {
      const summary = await summaryRes.json() as Record<string, unknown>;
      const scoreData = typeof summary.score === 'object' && summary.score !== null ? summary.score as Record<string, unknown> : {};
      score = typeof scoreData.trustScore === 'number' ? scoreData.trustScore : 0;
      count = typeof summary.numberOfReviews === 'object' && summary.numberOfReviews !== null
        ? ((summary.numberOfReviews as Record<string, number>).total ?? count)
        : count;
    }

    return { reviews, aggregate: { score, count, platform: 'trustpilot' } };
  }
}
