import { NextRequest, NextResponse } from 'next/server';
import { isSourceEnabled } from '@/config/featureFlags';
import { resolveSocialAdapter } from '@/lib/social/index';
import type { SocialProfileType } from '@/lib/social/index';

export const dynamic = 'force-dynamic';

/**
 * KINTEL — Social & People Intelligence Route
 * Source: Bright Data LinkedIn/Social Datasets API (licensed data product)
 *
 * GET /api/social?type=company|person&query=<name>&url=<url>&limit=10
 *
 * Gated by isSourceEnabled('social').
 * Returns raw provider profile data — NO scoring or sentiment computed here;
 * that is Kammandor's responsibility per architecture contract.
 *
 * GDPR / personal data notice:
 * This endpoint returns personal data (names, locations, employment history,
 * follower counts, profile URLs). Processing requires a valid lawful basis
 * under GDPR Art. 6 and a Data Processing Agreement with Bright Data Ltd.
 * Do not expose this endpoint publicly without operator compliance sign-off.
 *
 * Returns 422 if the required provider keys are not configured.
 */

const VALID_TYPES = new Set<SocialProfileType>(['company', 'person', 'job', 'post']);

export async function GET(req: NextRequest) {
  // Feature-flag gate
  if (!isSourceEnabled('social')) {
    return NextResponse.json(
      { error: 'social source is not enabled for this platform configuration.' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const rawType  = searchParams.get('type') ?? 'person';
  const query    = searchParams.get('query') ?? undefined;
  const url      = searchParams.get('url')   ?? undefined;
  const limitStr = searchParams.get('limit');
  const limit    = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 10, 1), 50) : 10;

  const type = VALID_TYPES.has(rawType as SocialProfileType)
    ? (rawType as SocialProfileType)
    : 'person';

  if (!query && !url) {
    return NextResponse.json(
      { error: 'Provide either query= (name/keyword) or url= (direct profile URL).' },
      { status: 400 }
    );
  }

  try {
    const adapter = resolveSocialAdapter();
    const result  = await adapter.getProfiles({ type, query, url, limit });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, s-maxage=3600, stale-while-revalidate=300' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Graceful 422 for missing credentials
    if (msg.includes('provider key required')) {
      return NextResponse.json(
        {
          error: 'provider key required',
          detail: msg,
          hint: 'Set BRIGHTDATA_API_KEY and the relevant BRIGHTDATA_DS_LI_* env vars.',
        },
        { status: 422 }
      );
    }

    console.warn('[KINTEL] /api/social error:', msg);
    return NextResponse.json({ error: 'Internal error fetching social profiles' }, { status: 500 });
  }
}
