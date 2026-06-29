/**
 * KINTEL — G2 Reviews Adapter
 * Source: https://data.g2.com/api — Official G2 Data API
 * Auth: G2_API_TOKEN env var (required)
 * Tier: byok (tenant supplies token)
 *
 * Compliance: Data accessed via G2's official API.
 *             G2 ToS prohibits scraping; this adapter uses the authorised API only.
 *             Review redistribution governed by G2 API terms.
 * Cache: 24 h — G2 review data does not update in real time.
 */

import type { ReviewsAdapter, ReviewsResponse, ReviewsQueryParams, ReviewRecord } from '../index';

function requireToken(): string {
  const token = process.env.G2_API_TOKEN;
  if (!token) throw new Error('provider key required: set G2_API_TOKEN for g2 provider');
  return token;
}

export class G2Adapter implements ReviewsAdapter {
  readonly name = 'g2';

  async getReviews({ entity, limit = 25 }: ReviewsQueryParams): Promise<ReviewsResponse> {
    const token = requireToken();

    // Search for product by name
    const searchRes = await fetch(
      `https://data.g2.com/api/v1/products?filter[name]=${encodeURIComponent(entity)}&page[size]=1`,
      {
        headers: { Authorization: `Token token="${token}"`, 'Content-Type': 'application/vnd.api+json' },
        next: { revalidate: 86400 }, // cacheable: G2 data updates daily
      }
    );
    if (!searchRes.ok) throw new Error(`G2 product search returned HTTP ${searchRes.status}`);
    const searchData = await searchRes.json() as Record<string, unknown>;
    const products = Array.isArray(searchData.data) ? searchData.data as Record<string, unknown>[] : [];
    if (products.length === 0) return { reviews: [], aggregate: { score: 0, count: 0, platform: 'g2' } };

    const productId = String((products[0] as { id?: unknown }).id ?? '');
    if (!productId) return { reviews: [], aggregate: { score: 0, count: 0, platform: 'g2' } };

    // Fetch reviews for product
    const reviewsRes = await fetch(
      `https://data.g2.com/api/v1/reviews?filter[product_id]=${productId}&page[size]=${Math.min(limit, 100)}`,
      {
        headers: { Authorization: `Token token="${token}"`, 'Content-Type': 'application/vnd.api+json' },
        next: { revalidate: 86400 }, // cacheable: G2 data updates daily
      }
    );
    if (!reviewsRes.ok) throw new Error(`G2 reviews returned HTTP ${reviewsRes.status}`);
    const reviewsData = await reviewsRes.json() as Record<string, unknown>;
    const rawReviews = Array.isArray(reviewsData.data) ? reviewsData.data as Record<string, unknown>[] : [];

    const reviews: ReviewRecord[] = rawReviews.map(r => {
      const attrs = typeof r.attributes === 'object' && r.attributes !== null ? r.attributes as Record<string, unknown> : {};
      return {
        author: String(attrs.reviewer_name ?? 'Anonymous'),
        rating: typeof attrs.star_rating === 'number' ? attrs.star_rating : 0,
        text: String(attrs.comment_answers ?? attrs.body ?? ''),
        date: String(attrs.submitted_at ?? new Date().toISOString()),
        platform: 'g2',
        url: `https://www.g2.com/products/${String(attrs.product_slug ?? '')}`,
      };
    });

    // Provider aggregate from product meta
    const productAttrs = typeof products[0].attributes === 'object' && products[0].attributes !== null
      ? products[0].attributes as Record<string, unknown>
      : {};
    const score = typeof productAttrs.star_rating === 'number' ? productAttrs.star_rating : 0;
    const count = typeof productAttrs.reviews_count === 'number' ? productAttrs.reviews_count : reviews.length;

    return { reviews, aggregate: { score, count, platform: 'g2' } };
  }
}
