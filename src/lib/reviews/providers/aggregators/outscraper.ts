/**
 * KINTEL — Outscraper Reviews Aggregator Adapter
 * Source: https://outscraper.com/api-docs/ — Official REST API
 * Auth: OUTSCRAPER_KEY env var (required)
 * Tier: byok / premium
 *
 * AGGREGATOR NOTICE:
 * Outscraper retrieves reviews from Google Maps, Yelp, Trustpilot, Play Store, and others
 * via their official licensed data service. Outscraper assumes the Terms of Service burden
 * with underlying platforms.
 * GDPR / data-processing legal sign-off required before production deployment
 * (review data may contain personal data subject to GDPR Art. 6 and Art. 28).
 *
 * Compliance: calls Outscraper official REST API only — no direct scraping.
 * Cache: 1 h.
 */

import type { ReviewsAdapter, ReviewsResponse, ReviewsQueryParams, ReviewRecord } from '../../index';

function requireKey(): string {
  const key = process.env.OUTSCRAPER_KEY;
  if (!key) throw new Error('provider key required: set OUTSCRAPER_KEY for outscraper provider');
  return key;
}

export class OutscraperAdapter implements ReviewsAdapter {
  readonly name = 'outscraper';

  async getReviews({ entity, limit = 25 }: ReviewsQueryParams): Promise<ReviewsResponse> {
    const key = requireKey();

    const url = `https://api.app.outscraper.com/maps/reviews-v3?query=${encodeURIComponent(entity)}&reviewsLimit=${Math.min(limit, 100)}&async=false`;
    const res = await fetch(url, {
      headers: { 'X-API-KEY': key },
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`Outscraper API returned HTTP ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    const rawData = Array.isArray(data.data) ? data.data as Record<string, unknown>[][] : [];
    const items = rawData.flat();

    const reviews: ReviewRecord[] = items.slice(0, limit).map(item => ({
      author: String(item.author_title ?? item.name ?? 'Anonymous'),
      rating: typeof item.review_rating === 'number' ? item.review_rating : 0,
      text: String(item.review_text ?? ''),
      date: String(item.review_datetime_utc ?? new Date().toISOString()),
      platform: 'google',
      url: String(item.review_link ?? ''),
    }));

    const score = items.length > 0
      ? Math.round((items.reduce((s, i) => s + (typeof i.rating === 'number' ? i.rating : 0), 0) / items.length) * 10) / 10
      : 0;

    return { reviews, aggregate: { score, count: reviews.length, platform: 'google' } };
  }
}
