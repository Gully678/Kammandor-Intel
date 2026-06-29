/**
 * KINTEL — Apple App Store RSS Reviews Adapter (KEYLESS)
 * Source: https://itunes.apple.com/rss/customerreviews/id={appId}/json
 * Auth: NONE (public RSS feed)
 * Tier: free
 *
 * AMBER — LEGAL REVIEW REQUIRED BEFORE COMMERCIAL PRODUCTION USE
 * Apple does not publish a formal commercial-use licence for this RSS feed.
 * The feed is publicly accessible but Apple's developer ToS does not explicitly
 * permit redistribution or storage of review data for commercial purposes.
 * Obtain legal sign-off before deploying to production at commercial scale.
 *
 * Usage: entity = Apple App ID (numeric string, e.g. '284882215' for Facebook)
 *        platform param is ignored (always appstore)
 *
 * Cache: short-lived — Apple RSS updates continuously; do not cache > 1 h.
 * Note: RSS provides up to 50 reviews per page (10 pages max).
 *       Aggregate score is computed from the returned sample, not the store total.
 */

import type { ReviewsAdapter, ReviewsResponse, ReviewsQueryParams, ReviewRecord } from '../index';

export class AppStoreRssAdapter implements ReviewsAdapter {
  readonly name = 'appstore-rss';

  async getReviews({ entity, limit = 25 }: ReviewsQueryParams): Promise<ReviewsResponse> {
    // entity = numeric App Store app ID
    const appId = entity.replace(/\D/g, '');
    if (!appId) {
      return { reviews: [], aggregate: { score: 0, count: 0, platform: 'appstore' } };
    }

    const url = `https://itunes.apple.com/rss/customerreviews/id=${appId}/json`;
    const res = await fetch(url, {
      next: { revalidate: 3600 }, // short-lived: Apple RSS updates continuously
    });

    if (!res.ok) {
      throw new Error(`App Store RSS returned HTTP ${res.status}`);
    }

    const data: unknown = await res.json();
    const feed = (typeof data === 'object' && data !== null)
      ? (data as Record<string, unknown>).feed as Record<string, unknown> | undefined
      : undefined;

    if (!feed) return { reviews: [], aggregate: { score: 0, count: 0, platform: 'appstore' } };

    const entries = Array.isArray(feed.entry) ? feed.entry as Record<string, unknown>[] : [];
    // First entry is app metadata, not a review — skip if it has no im:rating
    const reviewEntries = entries.filter(e => {
      const rating = (e['im:rating'] as Record<string, string> | undefined)?.label;
      return rating !== undefined && !isNaN(parseInt(rating, 10));
    });

    const reviews: ReviewRecord[] = reviewEntries.slice(0, limit).map(e => {
      const author = (e.author as Record<string, Record<string, string>> | undefined)?.name?.label ?? 'Anonymous';
      const rating = parseInt(String((e['im:rating'] as Record<string, string>)?.label ?? '0'), 10);
      const text   = (e.content as Record<string, string> | undefined)?.label ?? '';
      const date   = (e.updated as Record<string, string> | undefined)?.label ?? new Date().toISOString();
      const url    = (e.link as Record<string, Record<string, string>> | undefined)?.attributes?.href ?? '';
      const title  = (e.title as Record<string, string> | undefined)?.label ?? '';
      return {
        author,
        rating,
        text: title ? `${title}: ${text}` : text,
        date,
        platform: 'appstore',
        url,
      };
    });

    // Aggregate from sample (provider does not expose total store average via RSS)
    const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
    const avgScore    = reviews.length > 0 ? Math.round((totalRating / reviews.length) * 10) / 10 : 0;

    return {
      reviews,
      aggregate: {
        score: avgScore,
        count: reviews.length,
        platform: 'appstore',
      },
    };
  }
}
