/**
 * KINTEL — Google Places Reviews Adapter
 * Source: https://developers.google.com/maps/documentation/places/web-service
 * Auth: GOOGLE_PLACES_KEY env var (required)
 * Tier: byok / premium
 *
 * GOOGLE ToS: DO NOT STORE BEYOND REQUEST
 * Google Places API ToS (Section 3.2.3) prohibits caching, storing, or persisting
 * place data including reviews beyond the duration of a single user session / request.
 * This adapter sets revalidate:0 (no server-side cache) and includes this comment
 * to enforce the constraint at the code level.
 * Ref: https://developers.google.com/maps/terms#3-license-requirements
 *
 * Compliance: official Places API only — no scraping, no headless browser.
 * Cache: revalidate:0 — Google ToS: do not store beyond request.
 */

import type { ReviewsAdapter, ReviewsResponse, ReviewsQueryParams, ReviewRecord } from '../index';

function requireKey(): string {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) throw new Error('provider key required: set GOOGLE_PLACES_KEY for google-places provider');
  return key;
}

export class GooglePlacesAdapter implements ReviewsAdapter {
  readonly name = 'google-places';

  async getReviews({ entity, limit = 5 }: ReviewsQueryParams): Promise<ReviewsResponse> {
    const key = requireKey();
    // Google Places returns max 5 reviews per place regardless of limit

    // Step 1: find place_id
    const searchRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(entity)}&inputtype=textquery&fields=place_id,name&key=${key}`,
      {
        // Google ToS: do not store beyond request
        cache: 'no-store',
      }
    );
    if (!searchRes.ok) throw new Error(`Google Places search returned HTTP ${searchRes.status}`);
    const searchData = await searchRes.json() as Record<string, unknown>;
    const candidates = Array.isArray(searchData.candidates) ? searchData.candidates as Record<string, unknown>[] : [];
    if (candidates.length === 0) return { reviews: [], aggregate: { score: 0, count: 0, platform: 'google' } };

    const placeId = String(candidates[0].place_id ?? '');
    if (!placeId) return { reviews: [], aggregate: { score: 0, count: 0, platform: 'google' } };

    // Step 2: fetch place details including reviews
    const detailsRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,rating,user_ratings_total,reviews&key=${key}`,
      {
        // Google ToS: do not store beyond request
        cache: 'no-store',
      }
    );
    if (!detailsRes.ok) throw new Error(`Google Places details returned HTTP ${detailsRes.status}`);
    const detailsData = await detailsRes.json() as Record<string, unknown>;
    const result = typeof detailsData.result === 'object' && detailsData.result !== null ? detailsData.result as Record<string, unknown> : {};
    const rawReviews = Array.isArray(result.reviews) ? result.reviews as Record<string, unknown>[] : [];

    const reviews: ReviewRecord[] = rawReviews.slice(0, limit).map(r => ({
      author: String(r.author_name ?? 'Anonymous'),
      rating: typeof r.rating === 'number' ? r.rating : 0,
      text: String(r.text ?? ''),
      date: typeof r.time === 'number' ? new Date(r.time * 1000).toISOString() : new Date().toISOString(),
      platform: 'google',
      url: String(r.author_url ?? `https://maps.google.com/?cid=${placeId}`),
    }));

    return {
      reviews,
      aggregate: {
        score: typeof result.rating === 'number' ? result.rating : 0,
        count: typeof result.user_ratings_total === 'number' ? result.user_ratings_total : reviews.length,
        platform: 'google',
      },
    };
  }
}
