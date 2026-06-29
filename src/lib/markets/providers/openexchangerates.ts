/**
 * KINTEL — Open Exchange Rates Adapter
 * Source: https://openexchangerates.org — Licensed FX data API
 * Auth: OXR_KEY env var (required)
 * Tier: byok (tenant supplies key)
 *
 * Free plan: USD base only, hourly updates.
 * Paid plans: any base currency, shorter intervals.
 *
 * Compliance: Data licensed via Open Exchange Rates subscription.
 * Cache: 1 h (hourly update cadence on free tier).
 */

import type { MarketsAdapter, QuotesResponse, FxResponse, FxRecord } from '../index';

function requireKey(): string {
  const key = process.env.OXR_KEY;
  if (!key) throw new Error('provider key required: set OXR_KEY for openexchangerates provider');
  return key;
}

export class OpenExchangeRatesAdapter implements MarketsAdapter {
  readonly name = 'openexchangerates';

  /** OXR is FX only — equity quotes not supported */
  async getQuotes(_symbols: string[]): Promise<QuotesResponse> {
    return {
      quotes: [],
      // @ts-expect-error: consumer transparency note
      _note: 'Open Exchange Rates provides FX rates only. Use twelvedata for equity quotes.',
    };
  }

  async getFx(pairs: string[]): Promise<FxResponse> {
    const key = requireKey();
    // OXR free plan is USD-base; extract target currencies from pairs
    const targets = pairs.map(p => {
      const upper = p.toUpperCase().replace('/', '');
      if (upper.startsWith('USD')) return upper.slice(3);
      if (upper.endsWith('USD'))   return upper.slice(0, upper.length - 3);
      return upper;
    }).filter(Boolean);

    const symbols = [...new Set(targets)].join(',');
    const url = `https://openexchangerates.org/api/latest.json?app_id=${key}&symbols=${symbols}&base=USD`;
    const res = await fetch(url, {
      next: { revalidate: 3600 }, // cacheable: OXR updates hourly on free tier
    });
    if (!res.ok) throw new Error(`Open Exchange Rates API returned HTTP ${res.status}`);
    const data: unknown = await res.json();
    const raw = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
    const rates = (typeof raw.rates === 'object' && raw.rates !== null) ? raw.rates as Record<string, number> : {};
    const timestamp = typeof raw.timestamp === 'number' ? new Date(raw.timestamp * 1000).toISOString() : new Date().toISOString();

    const fx: FxRecord[] = Object.entries(rates).map(([currency, rate]) => ({
      pair: `${currency}/USD`,
      rate,
      asOf: timestamp,
      source: 'openexchangerates',
    }));
    return { fx };
  }
}
