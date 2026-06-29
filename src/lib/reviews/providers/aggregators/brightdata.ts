/**
 * KINTEL — Bright Data Reviews Aggregator Adapter
 *
 * Verified Bright Data Datasets API v3 endpoint paths:
 *   POST https://api.brightdata.com/datasets/v3/trigger?dataset_id={id}&format=json
 *   GET  https://api.brightdata.com/datasets/v3/progress/{snapshot_id}
 *   GET  https://api.brightdata.com/datasets/v3/snapshot/{snapshot_id}?format=json
 *
 * Auth: Bearer BRIGHTDATA_API_TOKEN
 *
 * Dataset IDs are supplied via environment variables (founder must configure):
 *   BRIGHTDATA_DS_GOOGLE_REVIEWS   — Bright Data dataset_id for Google reviews
 *   BRIGHTDATA_DS_TRUSTPILOT_REVIEWS — dataset_id for Trustpilot reviews
 *   BRIGHTDATA_DS_YELP_REVIEWS     — dataset_id for Yelp reviews
 *
 * Tier: byok / aggregator
 * Cache: 1 h (via Next.js revalidate on snapshot fetch)
 *
 * GDPR / legal sign-off required before production deployment.
 * Review data returned by Bright Data may contain personal data (author names,
 * profile URLs, profile images). Processing requires a valid lawful basis under
 * GDPR Art. 6 and a Data Processing Agreement with Bright Data Ltd.
 * Personal data — see GDPR note in Kammandor operator documentation.
 * This adapter is a licensed-provider API client only; no scraping or anti-bot
 * logic is present here — Bright Data handles that as part of their licensed service.
 */

import type { ReviewsAdapter, ReviewsResponse, ReviewsQueryParams, ReviewRecord } from '../../index';
import { triggerAndFetch } from '../../../brightdata/client';

// ── Dataset ID resolution ────────────────────────────────────────────────────
// Founders must supply these env vars for each platform they wish to use.
// Bright Data dataset IDs look like: gd_lXXXXXXXX  (found in your BD control panel)
const DS_MAP: Record<string, string | undefined> = {
  google:     process.env.BRIGHTDATA_DS_GOOGLE_REVIEWS,
  trustpilot: process.env.BRIGHTDATA_DS_TRUSTPILOT_REVIEWS,
  yelp:       process.env.BRIGHTDATA_DS_YELP_REVIEWS,
};

function requireToken(): void {
  if (!process.env.BRIGHTDATA_API_TOKEN) {
    throw new Error(
      'provider key required: set BRIGHTDATA_API_TOKEN for brightdata provider'
    );
  }
}

export class BrightDataReviewsAdapter implements ReviewsAdapter {
  readonly name = 'brightdata';

  async getReviews({ entity, platform = 'google', limit = 25 }: ReviewsQueryParams): Promise<ReviewsResponse> {
    requireToken();

    const slug = platform.toLowerCase();
    const datasetId = DS_MAP[slug];
    if (!datasetId) {
      throw new Error(
        `provider key required: set BRIGHTDATA_DS_${slug.toUpperCase()}_REVIEWS env var ` +
        `with the Bright Data dataset_id for ${slug} reviews`
      );
    }

    // Input shape for reviews datasets: typically { keyword } or { url }.
    // Exact input fields depend on the dataset; using { keyword } as the universal
    // discovery input — the founder should verify the specific dataset's input schema
    // in the Bright Data control panel and update if needed.
    const inputs = [{ keyword: entity }];

    const raw = await triggerAndFetch(datasetId, inputs);

    const reviews: ReviewRecord[] = raw.slice(0, limit).map(item => {
      // Bright Data reviews datasets normalise to a consistent schema;
      // common field names across Google/Trustpilot/Yelp datasets:
      //   author_name | author | reviewer_name → author
      //   rating | star_rating | stars        → rating (numeric)
      //   review_text | text | content        → text
      //   published_at | date | timestamp     → date
      //   review_url | url                    → url
      const ratingRaw = item.rating ?? item.star_rating ?? item.stars;
      const ratingNum = typeof ratingRaw === 'number'
        ? ratingRaw
        : (typeof ratingRaw === 'string' ? parseFloat(ratingRaw) : 0);

      return {
        author:   String(item.author_name ?? item.author ?? item.reviewer_name ?? 'Anonymous'),
        rating:   isNaN(ratingNum) ? 0 : ratingNum,
        text:     String(item.review_text ?? item.text ?? item.content ?? ''),
        date:     String(item.published_at ?? item.date ?? item.timestamp ?? new Date().toISOString()),
        platform: slug,
        url:      String(item.review_url ?? item.url ?? ''),
      };
    });

    const avgScore = reviews.length > 0
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
      : 0;

    return {
      reviews,
      aggregate: {
        score:    Math.round(avgScore * 10) / 10,
        count:    reviews.length,
        platform: slug,
      },
    };
  }
}
