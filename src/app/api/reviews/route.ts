import { NextRequest, NextResponse } from 'next/server';
import { isSourceEnabled } from '@/config/featureFlags';
import { resolveReviewsAdapter } from '@/lib/reviews/index';

export const dynamic = 'force-dynamic';

/**
 * KINTEL — Reviews & Sentiment API
 * Provider-pluggable via REVIEWS_PROVIDER env var.
 * Default (keyless dev): 'appstore-rss'.
 *
 * GET /api/reviews
 *   ?entity=<brand or app id>   — required
 *   ?platform=<platform hint>   — optional (e.g. 'appstore', 'google', 'yelp')
 *   ?provider=<override>        — optional runtime provider override
 *   ?limit=<number>             — optional max reviews (default 25)
 *
 * Gated by isSourceEnabled('reviews').
 * Returns raw reviews + provider's own aggregate score.
 * Sentiment scoring is handled exclusively in Kammandor (contract boundary).
 *
 * Per-provider cache rules are applied at adapter level:
 *   google-places: no-store (Google ToS: do not store beyond request)
 *   yelp: ≤24h cache
 *   appstore-rss: ≤1h cache
 */
export async function GET(req: NextRequest) {
  if (!isSourceEnabled('reviews')) {
    return NextResponse.json(
      { error: 'reviews source is not enabled for this platform configuration.' },
      { status: 403 }
    );
  }

  const { searchParams } = req.nextUrl;

  const entity   = (searchParams.get('entity') ?? '').trim();
  const platform = (searchParams.get('platform') ?? '').trim() || undefined;
  const limit    = Math.min(parseInt(searchParams.get('limit') ?? '25', 10) || 25, 200);

  // Runtime provider override — allow ?provider=appstore-rss etc.
  const providerOverride = searchParams.get('provider')?.trim();
  if (providerOverride) {
    process.env.REVIEWS_PROVIDER = providerOverride;
  }

  if (!entity) {
    return NextResponse.json(
      { error: 'entity param is required (brand name or app ID)' },
      { status: 400 }
    );
  }

  try {
    const adapter = resolveReviewsAdapter();
    const result  = await adapter.getReviews({ entity, platform, limit });

    // Enforce per-provider cache headers
    const cacheHeader = adapter.name === 'google-places'
      ? 'no-store'  // Google ToS: do not store beyond request
      : adapter.name === 'yelp'
        ? 'public, s-maxage=86400, stale-while-revalidate=3600'  // ≤24h — Yelp ToS
        : 'public, s-maxage=3600, stale-while-revalidate=600';

    return NextResponse.json(
      {
        provider: adapter.name,
        entity,
        reviews:   result.reviews,
        aggregate: result.aggregate,
        asOf: new Date().toISOString(),
        _note: 'Sentiment scoring handled by Kammandor — raw provider data only.',
      },
      {
        headers: { 'Cache-Control': cacheHeader },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.warn('[KINTEL] reviews route error:', message);
    return NextResponse.json(
      { error: message, reviews: [], aggregate: { score: 0, count: 0, platform: '' } },
      { status: message.includes('provider key required') ? 422 : 502 }
    );
  }
}
