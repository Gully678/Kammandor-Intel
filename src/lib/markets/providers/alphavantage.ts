/**
 * KINTEL — Alpha Vantage Markets Adapter (DEV)
 * Source: https://www.alphavantage.co — Licensed data API
 * Auth: ALPHAVANTAGE_KEY env var (required)
 * Tier: dev (free tier available; premium for real-time)
 *
 * Compliance: Data licensed via Alpha Vantage subscription.
 *             Free tier rate-limited (25 req/day); premium lifts limits.
 * Cache: 5 min (real-time endpoints update every 1–5 min).
 */

import type { MarketsAdapter, QuotesResponse, FxResponse, QuoteRecord, FxRecord } from '../index';

function requireKey(): string {
  const key = process.env.ALPHAVANTAGE_KEY;
  if (!key) throw new Error('provider key required: set ALPHAVANTAGE_KEY for alphavantage provider');
  return key;
}

export class AlphaVantageAdapter implements MarketsAdapter {
  readonly name = 'alphavantage';

  async getQuotes(symbols: string[]): Promise<QuotesResponse> {
    const key = requireKey();
    const quotes: QuoteRecord[] = [];
    // AV has no batch quote endpoint — serial (rate-limit aware)
    await Promise.allSettled(
      symbols.slice(0, 5).map(async (symbol) => {
        const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
        const res = await fetch(url, { next: { revalidate: 300 } });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const gq = (typeof data === 'object' && data !== null)
          ? (data as Record<string, unknown>)['Global Quote'] as Record<string, string> | undefined
          : undefined;
        if (!gq) return;
        const price = parseFloat(gq['05. price'] ?? '');
        const changePct = parseFloat(gq['10. change percent']?.replace('%', '') ?? '');
        if (isNaN(price)) return;
        quotes.push({
          symbol,
          price,
          changePct: isNaN(changePct) ? 0 : changePct,
          currency: 'USD',
          asOf: gq['07. latest trading day'] ?? new Date().toISOString(),
          source: 'alphavantage',
        });
      })
    );
    return { quotes };
  }

  async getFx(pairs: string[]): Promise<FxResponse> {
    const key = requireKey();
    const fx: FxRecord[] = [];
    await Promise.allSettled(
      pairs.slice(0, 5).map(async (pair) => {
        const [from, to] = pair.toUpperCase().split('/');
        if (!from || !to) return;
        const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${key}`;
        const res = await fetch(url, { next: { revalidate: 300 } });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const block = (typeof data === 'object' && data !== null)
          ? (data as Record<string, unknown>)['Realtime Currency Exchange Rate'] as Record<string, string> | undefined
          : undefined;
        if (!block) return;
        const rate = parseFloat(block['5. Exchange Rate'] ?? '');
        if (isNaN(rate)) return;
        fx.push({
          pair: `${from}/${to}`,
          rate,
          asOf: block['6. Last Refreshed'] ?? new Date().toISOString(),
          source: 'alphavantage',
        });
      })
    );
    return { fx };
  }
}
