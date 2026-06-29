/**
 * KINTEL — Apify Reviews Aggregator Adapter
 * Source: https://apify.com/store — Official Apify REST API (Actor runs)
 * Auth: APIFY_TOKEN env var (required)
 * Tier: byok / premium
 *
 * AGGREGATOR NOTICE:
 * Apify provides hosted actors that retrieve reviews from Google, Trustpilot, Yelp,
 * Glassdoor, Play Store and others. Actors run in Apify's cloud environment.
 * Apify's usage terms and the individual actor ToS govern data use.
 * The aggregator assumes the Terms of Service burden with underlying platforms,
 * but operators are responsible for ensuring their specific actor usage is compliant.
 * GDPR / data-processing legal sign-off required before production deployment
 * (review data may contain personal data subject to GDPR Art. 6 and Art. 28).
 *
 * Default actor: apify/google-maps-reviews (configurable via APIFY_ACTOR_ID).
 * Compliance: calls Apify official REST API only — no direct scraping.
 * Cache: 1 h.
 */

import type { ReviewsAdapter, ReviewsResponse, ReviewsQueryParams, ReviewRecord } from '../../index';

function requireToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('provider key required: set APIFY_TOKEN for apify provider');
  return token;
}

export class ApifyAdapter implements ReviewsAdapter {
  readonly name = 'apify';

  async getReviews({ entity, limit = 25 }: ReviewsQueryParams): Promise<ReviewsResponse> {
    const token = requireToken();
    const actorId = process.env.APIFY_ACTOR_ID ?? 'apify~google-maps-reviews';

    // Run actor synchronously (waits for result, timeout 60 s)
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=60`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchStringsArray: [entity],
          maxReviews: Math.min(limit, 200),
          language: 'en',
        }),
        next: { revalidate: 3600 },
      }
    );
    if (!runRes.ok) throw new Error(`Apify actor run returned HTTP ${runRes.status}`);
    const items = await runRes.json() as Record<string, unknown>[];

    const reviews: ReviewRecord[] = (Array.isArray(items) ? items : []).slice(0, limit).map(item => {
      const reviewsArr = Array.isArray(item.reviews) ? item.reviews as Record<string, unknown>[] : [item];
      return reviewsArr.map(r => ({
        author: String(r.reviewerName ?? r.author ?? 'Anonymous'),
        rating: typeof r.stars === 'number' ? r.stars : (typeof r.rating === 'number' ? r.rating : 0),
        text: String(r.text ?? r.reviewText ?? ''),
        date: String(r.publishedAtDate ?? r.date ?? new Date().toISOString()),
        platform: 'google',
        url: String(r.reviewUrl ?? r.url ?? ''),
      }));
    }).flat();

    const avgScore = reviews.length > 0
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
      : 0;

    return { reviews, aggregate: { score: avgScore, count: reviews.length, platform: 'google' } };
  }
}
