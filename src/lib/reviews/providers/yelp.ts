/**
 * KINTEL — Yelp Reviews Adapter
 * Source: https://www.yelp.com/developers/documentation/v3 — Official Fusion API
 * Auth: YELP_API_KEY env var (required)
 * Tier: byok
 *
 * Yelp ToS cache constraint: review data must not be cached or stored for more than 24 h.
 * Ref: Yelp Fusion API Terms of Use, Section 5 (Data Storage / Caching).
 * This adapter sets revalidate:86400 (≤24h cache) to enforce the constraint.
 *
 * Compliance: Yelp Fusion official API only — no scraping.
 * Cache: ≤24h — Yelp ToS maximum permitted caching period.
 */

import type { ReviewsAdapter, ReviewsResponse, ReviewsQueryParams, ReviewRecord } from '../index';

function requireKey(): string {
  const key = process.env.YELP_API_KEY;
  if (!key) throw new Error('provider key required: set YELP_API_KEY for yelp provider');
  return key;
}

export class YelpAdapter implements ReviewsAdapter {
  readonly name = 'yelp';

  async getReviews({ entity, limit = 20 }: ReviewsQueryParams): Promise<ReviewsResponse> {
    const key = requireKey();

    // Step 1: search for business
    const searchRes = await fetch(
      `https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(entity)}&limit=1`,
      {
        headers: { Authorization: `Bearer ${key}` },
        next: { revalidate: 86400 }, // ≤24h — Yelp ToS maximum permitted caching period
      }
    );
    if (!searchRes.ok) throw new Error(`Yelp business search returned HTTP ${searchRes.status}`);
    const searchData = await searchRes.json() as Record<string, unknown>;
    const businesses = Array.isArray(searchData.businesses) ? searchData.businesses as Record<string, unknown>[] : [];
    if (businesses.length === 0) return { reviews: [], aggregate: { score: 0, count: 0, platform: 'yelp' } };

    const business = businesses[0];
    const businessId = String(business.id ?? '');
    if (!businessId) return { reviews: [], aggregate: { score: 0, count: 0, platform: 'yelp' } };

    // Step 2: fetch reviews (Yelp returns max 3 per call on free tier)
    const reviewsRes = await fetch(
      `https://api.yelp.com/v3/businesses/${businessId}/reviews?limit=${Math.min(limit, 50)}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        next: { revalidate: 86400 }, // ≤24h — Yelp ToS maximum permitted caching period
      }
    );
    if (!reviewsRes.ok) throw new Error(`Yelp reviews returned HTTP ${reviewsRes.status}`);
    const reviewsData = await reviewsRes.json() as Record<string, unknown>;
    const rawReviews = Array.isArray(reviewsData.reviews) ? reviewsData.reviews as Record<string, unknown>[] : [];

    const reviews: ReviewRecord[] = rawReviews.map(r => {
      const user = typeof r.user === 'object' && r.user !== null ? r.user as Record<string, unknown> : {};
      return {
        author: String(user.name ?? 'Anonymous'),
        rating: typeof r.rating === 'number' ? r.rating : 0,
        text: String(r.text ?? ''),
        date: String(r.time_created ?? new Date().toISOString()),
        platform: 'yelp',
        url: String(r.url ?? `https://www.yelp.com/biz/${businessId}`),
      };
    });

    return {
      reviews,
      aggregate: {
        score: typeof business.rating === 'number' ? business.rating : 0,
        count: typeof business.review_count === 'number' ? business.review_count : reviews.length,
        platform: 'yelp',
      },
    };
  }
}
