import { NextRequest, NextResponse } from 'next/server';
import { isSourceEnabled } from '@/config/featureFlags';
import { resolveMarketsAdapter } from '@/lib/markets/index';

export const dynamic = 'force-dynamic';

/**
 * KINTEL — Markets API
 * Provider-pluggable via MARKET_DATA_PROVIDER env var.
 * Default FX provider: 'ecb' (keyless).
 * Default quotes provider: 'twelvedata' (requires TWELVEDATA_KEY).
 *
 * GET /api/markets
 *   ?symbols=RTX,LMT,GC=F   — comma-separated quote symbols
 *   ?pairs=USD/EUR,GBP/EUR   — comma-separated FX pairs
 *
 * Gated by isSourceEnabled('markets-fx').
 * Returns raw data + provider's own aggregates only.
 * Sentiment scoring is handled exclusively in Kammandor (contract boundary).
 */
export async function GET(req: NextRequest) {
  if (!isSourceEnabled('markets-fx')) {
    return NextResponse.json(
      { error: 'markets-fx source is not enabled for this platform configuration.' },
      { status: 403 }
    );
  }

  const { searchParams } = req.nextUrl;

  const symbolsParam = searchParams.get('symbols') ?? '';
  const pairsParam   = searchParams.get('pairs')   ?? '';

  const symbols = symbolsParam
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const pairs = pairsParam
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  try {
    const adapter = resolveMarketsAdapter();
    const [quotesRes, fxRes] = await Promise.all([
      symbols.length > 0 ? adapter.getQuotes(symbols) : Promise.resolve({ quotes: [] }),
      pairs.length   > 0 ? adapter.getFx(pairs)       : Promise.resolve({ fx: [] }),
    ]);

    return NextResponse.json(
      {
        provider: adapter.name,
        quotes:   quotesRes.quotes,
        fx:       fxRes.fx,
        asOf:     new Date().toISOString(),
      },
      {
        headers: {
          // Cache header is provider-dependent; ECB is safe for 24 h
          'Cache-Control': adapter.name === 'ecb'
            ? 'public, s-maxage=86400, stale-while-revalidate=3600'
            : 'public, s-maxage=60, stale-while-revalidate=30',
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.warn('[KINTEL] markets route error:', message);
    return NextResponse.json(
      { error: message, quotes: [], fx: [] },
      { status: message.includes('provider key required') ? 422 : 502 }
    );
  }
}
