/**
 * KINTEL — DataForSEO Reviews Aggregator Adapter
 * Source: https://docs.dataforseo.com/v3/business_data/reviews/
 * Auth: DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD env vars (required)
 * Tier: byok / premium
 *
 * AGGREGATOR NOTICE:
 * DataForSEO aggregates reviews from Google, Trustpilot, Yelp, Play Store, Glassdoor
 * and others via their official REST API. DataForSEO assumes the Terms of Service burden
 * with the underlying platforms as part of their licensed data product.
 * GDPR / data-processing legal sign-off required before production deployment
 * (review data may contain personal data subject to GDPR Art. 6 and Art. 28).
 *
 * Compliance: calls DataForSEO official REST API only — no scraping.
 * Cache: 1 h.
 */

import type { ReviewsAdapter, ReviewsResponse, ReviewsQueryParams, ReviewRecord } from '../../index';

function requireCredentials(): { login: string; password: string } {
  const login    = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error('provider key required: set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD for dataforseo provider');
  }
  return { login, password };
}

export class DataForSeoAdapter implements ReviewsAdapter {
  readonly name = 'dataforseo';

  async getReviews({ entity, platform = 'google', limit = 25 }: ReviewsQueryParams): Promise<ReviewsResponse> {
    const { login, password } = requireCredentials();
    const auth = Buffer.from(`${login}:${password}`).toString('base64');

    // DataForSEO Business Data API — Reviews endpoint
    const body = JSON.stringify([{
      keyword: entity,
      location_code: 2826, // UK default; parameterise as needed
      language_code: 'en',
      depth: Math.min(limit, 100),
    }]);

    const res = await fetch(
      `https://api.dataforseo.com/v3/business_data/${platform}/reviews/task_post`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body,
        next: { revalidate: 3600 },
      }
    );
    if (!res.ok) throw new Error(`DataForSEO API returned HTTP ${res.status}`);
    const data = await res.json() as Record<string, unknown>;

    // DataForSEO returns task IDs; for live results use task_get with the returned ID
    // This is a simplified synchronous path — production should use async task pattern
    const tasks = Array.isArray(data.tasks) ? data.tasks as Record<string, unknown>[] : [];
    const items = tasks.flatMap(t => {
      const resultArr = Array.isArray((t as any)?.result) ? (t as any).result as Record<string, unknown>[] : [];
      return resultArr.flatMap(r => Array.isArray(r.items) ? r.items as Record<string, unknown>[] : []);
    });

    const reviews: ReviewRecord[] = items.slice(0, limit).map(item => ({
      author: String(item.author_title ?? item.author ?? 'Anonymous'),
      rating: typeof item.rating === 'object' && item.rating !== null
        ? ((item.rating as Record<string, unknown>).value as number ?? 0)
        : (typeof item.rating === 'number' ? item.rating : 0),
      text: String(item.review_text ?? item.text ?? ''),
      date: String(item.timestamp ?? item.time_iso ?? new Date().toISOString()),
      platform,
      url: String(item.url ?? ''),
    }));

    const totalScore = reviews.length > 0
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      : 0;

    return {
      reviews,
      aggregate: { score: Math.round(totalScore * 10) / 10, count: reviews.length, platform },
    };
  }
}
