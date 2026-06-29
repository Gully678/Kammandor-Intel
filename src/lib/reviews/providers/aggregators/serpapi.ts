/**
 * KINTEL — SerpApi Reviews Aggregator Adapter
 * Source: https://serpapi.com/reviews-api — Official REST API
 * Auth: SERPAPI_KEY env var (required)
 * Tier: byok / premium
 *
 * AGGREGATOR NOTICE:
 * SerpApi retrieves reviews from Google, Yelp, and other platforms via their
 * official licensed search result API. SerpApi assumes the Terms of Service burden
 * with underlying platforms.
 * GDPR / data-processing legal sign-off required before production deployment
 * (review data may contain personal data subject to GDPR Art. 6 and Art. 28).
 *
 * Compliance: calls SerpApi official REST API only — no direct scraping.
 * Cache: 1 h.
 */

import type { ReviewsAdapter, ReviewsResponse, ReviewsQueryParams, ReviewRecord } from '../../index';

function requireKey(): string {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error('provider key required: set SERPAPI_KEY for serpapi provider');
  return key;
}

export class SerpApiAdapter implements ReviewsAdapter {
  readonly name = 'serpapi';

  async getReviews({ entity, limit = 25 }: ReviewsQueryParams): Promise<ReviewsResponse> {
    const key = requireKey();

    const url = `https://serpapi.com/search.json?engine=google_maps_reviews&q=${encodeURIComponent(entity)}&api_key=${key}&num=${Math.min(limit, 200)}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`SerpApi returned HTTP ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    const rawReviews = Array.isArray(data.reviews) ? data.reviews as Record<string, unknown>[] : [];

    const reviews: ReviewRecord[] = rawReviews.slice(0, limit).map(r => ({
      author: String(r.user ? (r.user as Record<string, unknown>).name ?? 'Anonymous' : 'Anonymous'),
      rating: typeof r.rating === 'number' ? r.rating : 0,
      text: String(r.snippet ?? r.text ?? ''),
      date: String(r.date ?? new Date().toISOString()),
      platform: 'google',
      url: String(r.link ?? ''),
    }));

    // Provider aggregate from place_info
    const placeInfo = typeof data.place_info === 'object' && data.place_info !== null ? data.place_info as Record<string, unknown> : {};
    const score = typeof placeInfo.rating === 'number' ? placeInfo.rating : 0;
    const count = typeof placeInfo.reviews === 'number' ? placeInfo.reviews : reviews.length;

    return { reviews, aggregate: { score, count, platform: 'google' } };
  }
}
