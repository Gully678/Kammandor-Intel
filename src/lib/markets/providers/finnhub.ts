/**
 * KINTEL — Finnhub Markets Adapter (DEV)
 * Source: https://finnhub.io — Licensed financial data API
 * Auth: FINNHUB_KEY env var (required)
 * Tier: dev (free tier: 60 req/min, US equities only)
 *
 * Compliance: Data licensed via Finnhub.io subscription.
 * Cache: 1 min (free tier data delayed 15 min for exchanges requiring it).
 */

import type { MarketsAdapter, QuotesResponse, FxResponse, QuoteRecord, FxRecord } from '../index';

function requireKey(): string {
  const key = process.env.FINNHUB_KEY;
  if (!key) throw new Error('provider key required: set FINNHUB_KEY for finnhub provider');
  return key;
}

export class FinnhubAdapter implements MarketsAdapter {
  readonly name = 'finnhub';

  async getQuotes(symbols: string[]): Promise<QuotesResponse> {
    const key = requireKey();
    const quotes: QuoteRecord[] = [];
    await Promise.allSettled(
      symbols.slice(0, 10).map(async (symbol) => {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`;
        const res = await fetch(url, { next: { revalidate: 60 } });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const q = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
        const price = typeof q.c === 'number' ? q.c : 0;
        const prev  = typeof q.pc === 'number' ? q.pc : 0;
        if (price === 0) return;
        const changePct = prev !== 0 ? ((price - prev) / prev) * 100 : 0;
        quotes.push({
          symbol,
          price,
          changePct: Math.round(changePct * 100) / 100,
          currency: 'USD',
          asOf: typeof q.t === 'number' ? new Date(q.t * 1000).toISOString() : new Date().toISOString(),
          source: 'finnhub',
        });
      })
    );
    return { quotes };
  }

  async getFx(pairs: string[]): Promise<FxResponse> {
    const key = requireKey();
    const fx: FxRecord[] = [];
    await Promise.allSettled(
      pairs.slice(0, 10).map(async (pair) => {
        // Finnhub forex format: "OANDA:EUR_USD"
        const normalised = pair.toUpperCase().replace('/', '_');
        const url = `https://finnhub.io/api/v1/quote?symbol=OANDA:${normalised}&token=${key}`;
        const res = await fetch(url, { next: { revalidate: 60 } });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const q = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
        const rate = typeof q.c === 'number' ? q.c : 0;
        if (rate === 0) return;
        fx.push({
          pair,
          rate,
          asOf: typeof q.t === 'number' ? new Date(q.t * 1000).toISOString() : new Date().toISOString(),
          source: 'finnhub',
        });
      })
    );
    return { fx };
  }
}
