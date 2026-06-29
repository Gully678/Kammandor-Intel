/**
 * KINTEL — Twelve Data Markets Adapter
 * Source: https://twelvedata.com — Licensed REST API
 * Auth: TWELVEDATA_KEY env var (required for production use)
 * Tier: Premium (paid plans support equities/FX/indices)
 *
 * Production default for quotes (equities, indices, ETFs, FX).
 * Rate limits: per-plan; adapter respects API limits via single batch call.
 *
 * Compliance: Data licensed via Twelve Data subscription.
 *             Adhere to redistribution clauses in your plan's ToS.
 * Cache: 1 min for quotes (real-time plan), 24 h if end-of-day plan.
 */

import type { MarketsAdapter, QuotesResponse, FxResponse, QuoteRecord, FxRecord } from '../index';

const BASE = 'https://api.twelvedata.com';

function requireKey(): string {
  const key = process.env.TWELVEDATA_KEY;
  if (!key) throw new Error('provider key required: set TWELVEDATA_KEY for twelvedata provider');
  return key;
}

export class TwelvedataAdapter implements MarketsAdapter {
  readonly name = 'twelvedata';

  async getQuotes(symbols: string[]): Promise<QuotesResponse> {
    const key = requireKey();
    if (symbols.length === 0) return { quotes: [] };
    // Batch up to 120 symbols per call (plan-dependent)
    const batch = symbols.slice(0, 120).join(',');
    const url = `${BASE}/quote?symbol=${encodeURIComponent(batch)}&apikey=${key}`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`Twelve Data API returned HTTP ${res.status}`);
    const data: unknown = await res.json();

    const quotes: QuoteRecord[] = [];
    const raw = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};

    // Single symbol: API returns the object directly
    // Multiple symbols: API returns { SYMBOL: {...}, ... }
    const items: Record<string, unknown>[] =
      symbols.length === 1
        ? [raw]
        : Object.values(raw).filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);

    for (const item of items) {
      const price = parseFloat(String(item.close ?? item.price ?? ''));
      const prev  = parseFloat(String(item.previous_close ?? ''));
      const changePct = (!isNaN(price) && !isNaN(prev) && prev !== 0)
        ? ((price - prev) / prev) * 100
        : parseFloat(String(item.percent_change ?? '0'));
      if (isNaN(price)) continue;
      quotes.push({
        symbol: String(item.symbol ?? ''),
        price,
        changePct: Math.round(changePct * 100) / 100,
        currency: String(item.currency ?? 'USD'),
        asOf: String(item.datetime ?? new Date().toISOString()),
        source: 'twelvedata',
      });
    }
    return { quotes };
  }

  async getFx(pairs: string[]): Promise<FxResponse> {
    const key = requireKey();
    if (pairs.length === 0) return { fx: [] };
    const batch = pairs.slice(0, 120).join(',');
    const url = `${BASE}/exchange_rate?symbol=${encodeURIComponent(batch)}&apikey=${key}`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`Twelve Data API returned HTTP ${res.status}`);
    const data: unknown = await res.json();
    const raw = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};

    const fxRecords: FxRecord[] = [];
    const items: Record<string, unknown>[] =
      pairs.length === 1
        ? [raw]
        : Object.values(raw).filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);

    for (const item of items) {
      const rate = parseFloat(String(item.rate ?? ''));
      if (isNaN(rate)) continue;
      fxRecords.push({
        pair: String(item.symbol ?? ''),
        rate,
        asOf: String(item.timestamp ?? new Date().toISOString()),
        source: 'twelvedata',
      });
    }
    return { fx: fxRecords };
  }
}
