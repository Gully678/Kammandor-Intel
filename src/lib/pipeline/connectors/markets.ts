/**
 * KINTEL v2.1 — markets-fx declarative connector (PRD §8.2/§8.5)
 *
 * FOUNDER DECISION (FOUNDER_DECISIONS_v2): sources are free/keyless only —
 * a licensed markets vendor is NOT yet contracted. This connector therefore
 * ships env-gated: it requires an injected fetcher plus vendor configuration
 * (MARKETS_FX_BASE_URL, MARKETS_FX_API_KEY). When that configuration is
 * absent, fetch() throws an EXPLICIT not-configured error — never a silent
 * empty batch (NFR §15.3). No default fetch implementation is provided.
 *
 * Provisional vendor contract (aligned with MarketsAdapter in
 * src/lib/markets/index.ts — the shapes the 'markets-fx' mapper consumes):
 *   GET {MARKETS_FX_BASE_URL}/fx?apikey=… → { fx?: FxRecord[], quotes?: QuoteRecord[] }
 *   FxRecord:    { pair, rate, asOf, source }
 *   QuoteRecord: { symbol, price, changePct, currency, asOf, source }
 *
 * Expectations (matched to what mapMarketsInstrument actually requires):
 *  - HARD: a ticker — non-empty `symbol` or `pair`. Without it the mapper
 *    silently drops the record; the gate holds the whole batch back loudly.
 *  - WARN: `asOf` present; a finite `price` or `rate` — the mapper tolerates
 *    their absence but a quote without a value is worth flagging.
 */

import { required } from '../expectations';
import type { ConnectorDef, Expectation, RawBatch } from '../types';

// ---------------------------------------------------------------------------
// Fetch contract
// ---------------------------------------------------------------------------

/** Minimal structural fetch contract — globalThis.fetch satisfies it. */
export type MarketsFetchImpl = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Vendor configuration read from env (or an injected env map in tests). */
export interface MarketsEnv {
  MARKETS_FX_BASE_URL?: string;
  MARKETS_FX_API_KEY?: string;
}

/** Loud, explicit not-configured error (NFR §15.3 — never a silent empty). */
export const MARKETS_NOT_CONFIGURED_MESSAGE =
  'markets-fx connector not configured — licensed vendor pending founder approval ' +
  '(FOUNDER_DECISIONS_v2: free/keyless sources only until a vendor is contracted; ' +
  'set MARKETS_FX_BASE_URL and MARKETS_FX_API_KEY once approved)';

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

/** True iff the value is a non-empty string. */
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** True iff the value is a finite number. */
function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * HARD: mapMarketsInstrument requires a non-empty `symbol` (quote) or
 * `pair` (FX) to key the Instrument entity — otherwise it silently drops
 * the record, so the gate blocks the batch loudly instead.
 */
const marketsTickerPresent: Expectation = {
  name: 'markets-ticker-present',
  level: 'hard',
  description:
    "Record must carry a non-empty 'symbol' (quote) or 'pair' (FX) — " +
    'without a ticker the markets mapper cannot key the Instrument entity',
  check(record: unknown): boolean {
    if (record === null || typeof record !== 'object') return false;
    const item = record as Record<string, unknown>;
    return nonEmptyString(item.symbol) || nonEmptyString(item.pair);
  },
};

/** WARN: a quote/FX row should carry a finite price or rate. */
const marketsValueNumeric: Expectation = {
  name: 'markets-value-numeric',
  level: 'warn',
  description: "Record should carry a finite 'price' (quote) or 'rate' (FX)",
  check(record: unknown): boolean {
    if (record === null || typeof record !== 'object') return false;
    const item = record as Record<string, unknown>;
    return finiteNumber(item.price) || finiteNumber(item.rate);
  },
};

/** Data expectations for the markets-fx source, ordered hard-first. */
export const MARKETS_EXPECTATIONS: Expectation[] = [
  marketsTickerPresent,
  required('asOf', 'warn'),
  marketsValueNumeric,
];

// ---------------------------------------------------------------------------
// Connector factory
// ---------------------------------------------------------------------------

/** Collect fx + quote rows from the vendor payload; throws on unknown shapes. */
function extractRecords(body: unknown): unknown[] {
  if (Array.isArray(body)) return body; // bare array of records is accepted
  if (body === null || typeof body !== 'object') {
    throw new Error(
      'markets-fx vendor returned an unexpected response shape (expected { fx?, quotes? } ' +
      'or an array of records) — refusing to fabricate records',
    );
  }
  const payload = body as Record<string, unknown>;
  const fx = payload.fx;
  const quotes = payload.quotes;
  if (fx === undefined && quotes === undefined) {
    throw new Error(
      "markets-fx vendor returned an unexpected response shape (neither 'fx' nor 'quotes' " +
      'present) — refusing to fabricate records',
    );
  }
  const records: unknown[] = [];
  if (fx !== undefined) {
    if (!Array.isArray(fx)) throw new Error("markets-fx vendor returned an unexpected 'fx' value (expected an array)");
    records.push(...fx);
  }
  if (quotes !== undefined) {
    if (!Array.isArray(quotes)) throw new Error("markets-fx vendor returned an unexpected 'quotes' value (expected an array)");
    records.push(...quotes);
  }
  return records;
}

/**
 * Build the declarative markets-fx connector. The fetcher is REQUIRED
 * (no default): per founder decision there is no keyless vendor to fall
 * back to, and this connector must never fetch implicitly.
 *
 * @param fetchImpl injected fetcher (tests pass a mock; prod passes fetch)
 * @param env       vendor configuration source (defaults to process.env)
 */
export function makeMarketsConnector(
  fetchImpl: MarketsFetchImpl,
  env: MarketsEnv = (typeof process !== 'undefined' ? (process.env as MarketsEnv) : {}),
): ConnectorDef {
  return {
    sourceKey: 'markets-fx',
    mapperKey: 'markets-fx',
    expectations: MARKETS_EXPECTATIONS,
    async fetch(): Promise<RawBatch> {
      const baseUrl = env.MARKETS_FX_BASE_URL;
      const apiKey = env.MARKETS_FX_API_KEY;
      if (!nonEmptyString(baseUrl) || !nonEmptyString(apiKey)) {
        throw new Error(MARKETS_NOT_CONFIGURED_MESSAGE);
      }

      const url = new URL(`${baseUrl.replace(/\/+$/, '')}/fx`);
      url.searchParams.set('apikey', apiKey);

      const response = await fetchImpl(url.toString()); // network errors propagate
      if (!response.ok) {
        throw new Error(`markets-fx vendor request failed: HTTP ${response.status}`);
      }
      const body: unknown = await response.json();
      return {
        sourceKey: 'markets-fx',
        fetchedAt: new Date().toISOString(),
        records: extractRecords(body),
      };
    },
  };
}
