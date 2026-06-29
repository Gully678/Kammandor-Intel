/**
 * KINTEL — Markets Connector: Adapter Interface
 * Provider-pluggable: selected via process.env.MARKET_DATA_PROVIDER
 * Default FX provider: 'ecb' (keyless)
 * Default quotes provider: 'twelvedata' (requires TWELVEDATA_KEY)
 *
 * Compliance contract:
 *  - Raw data + provider aggregate only — do NOT compute sentiment here.
 *  - Sentiment scoring is handled exclusively in Kammandor (contract boundary).
 */

export interface QuoteRecord {
  symbol: string;
  price: number;
  changePct: number;
  currency: string;
  asOf: string;       // ISO-8601
  source: string;     // provider name
}

export interface FxRecord {
  pair: string;       // e.g. "USD/EUR"
  rate: number;
  asOf: string;       // ISO-8601
  source: string;
}

export interface QuotesResponse {
  quotes: QuoteRecord[];
}

export interface FxResponse {
  fx: FxRecord[];
}

/** Contract every markets adapter must satisfy */
export interface MarketsAdapter {
  /** Name of this provider — shown in source field */
  readonly name: string;
  getQuotes(symbols: string[]): Promise<QuotesResponse>;
  getFx(pairs: string[]): Promise<FxResponse>;
}

// ── Provider registry ────────────────────────────────────────────────────────

import { EcbAdapter } from './providers/ecb';
import { TwelvedataAdapter } from './providers/twelvedata';
import { OpenExchangeRatesAdapter } from './providers/openexchangerates';
import { AlphaVantageAdapter } from './providers/alphavantage';
import { FinnhubAdapter } from './providers/finnhub';
import { YahooAdapter } from './providers/yahoo';

/**
 * Resolve the active markets adapter.
 * MARKET_DATA_PROVIDER env selects provider.
 * 'ecb'        — keyless, FX only (default)
 * 'twelvedata' — requires TWELVEDATA_KEY (production quotes default)
 * 'openexchangerates' — requires OXR_KEY
 * 'alphavantage'      — requires ALPHAVANTAGE_KEY (dev)
 * 'finnhub'           — requires FINNHUB_KEY (dev)
 * 'yahoo-dev'         — dev only; blocked in production (see YahooAdapter for ToS note)
 */
export function resolveMarketsAdapter(): MarketsAdapter {
  const p = (process.env.MARKET_DATA_PROVIDER ?? 'ecb').toLowerCase();
  switch (p) {
    case 'twelvedata':    return new TwelvedataAdapter();
    case 'openexchangerates': return new OpenExchangeRatesAdapter();
    case 'alphavantage':  return new AlphaVantageAdapter();
    case 'finnhub':       return new FinnhubAdapter();
    case 'yahoo-dev':     return new YahooAdapter();
    case 'ecb':
    default:              return new EcbAdapter();
  }
}
