/**
 * KINTEL — Yahoo Finance Adapter
 *
 * COMPLIANCE WARNING — DO NOT USE IN PRODUCTION
 * Yahoo Finance does not provide an authorised public API.
 * Using Yahoo Finance data endpoints in production violates Yahoo's Terms of Service.
 * This adapter is provided for LOCAL DEVELOPMENT ONLY.
 *
 * Guard: This adapter throws "Yahoo blocked in production (ToS)" unless BOTH:
 *   - MARKET_DATA_PROVIDER === 'yahoo-dev'   AND
 *   - INTEL_DEV_MODE === 'true'
 * are set. This prevents accidental production use.
 *
 * For production, use MARKET_DATA_PROVIDER=twelvedata with TWELVEDATA_KEY.
 */

import type { MarketsAdapter, QuotesResponse, FxResponse, QuoteRecord } from '../index';

function assertDevOnly(): void {
  const isDevMode = process.env.INTEL_DEV_MODE === 'true';
  const isYahooDev = process.env.MARKET_DATA_PROVIDER === 'yahoo-dev';
  if (!isDevMode || !isYahooDev) {
    // Yahoo blocked in production (ToS): Yahoo Finance does not authorise programmatic
    // access to its data endpoints. Production use violates Yahoo's Terms of Service.
    throw new Error(
      'Yahoo blocked in production (ToS): Yahoo Finance does not authorise programmatic access. ' +
      'To use in local dev only, set MARKET_DATA_PROVIDER=yahoo-dev AND INTEL_DEV_MODE=true. ' +
      'Use MARKET_DATA_PROVIDER=twelvedata for production.'
    );
  }
}

export class YahooAdapter implements MarketsAdapter {
  readonly name = 'yahoo-dev';

  async getQuotes(symbols: string[]): Promise<QuotesResponse> {
    assertDevOnly();
    const quotes: QuoteRecord[] = [];
    await Promise.allSettled(
      symbols.map(async (symbol) => {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) return;
          const data: unknown = await res.json();
          const result = (data as any)?.chart?.result?.[0];
          if (!result) return;
          const meta = result.meta;
          const price = meta.regularMarketPrice ?? 0;
          const prev  = meta.chartPreviousClose ?? price;
          if (!price) return;
          quotes.push({
            symbol,
            price: Math.round(price * 100) / 100,
            changePct: prev ? Math.round(((price - prev) / prev) * 10000) / 100 : 0,
            currency: meta.currency ?? 'USD',
            asOf: new Date().toISOString(),
            source: 'yahoo-dev',
          });
        } catch { /* silent */ }
      })
    );
    return { quotes };
  }

  async getFx(_pairs: string[]): Promise<FxResponse> {
    assertDevOnly();
    // Yahoo FX tickers not reliable — direct users to ECB or twelvedata
    return {
      fx: [],
      // @ts-expect-error: consumer note
      _note: 'Yahoo dev adapter does not implement FX. Use ecb or twelvedata for FX.',
    };
  }
}
