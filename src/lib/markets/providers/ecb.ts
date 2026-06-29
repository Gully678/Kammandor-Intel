/**
 * KINTEL — ECB SDMX Markets Adapter (KEYLESS — Free public API)
 * Source: European Central Bank Statistical Data Warehouse
 * URL pattern: https://data-api.ecb.europa.eu/service/data/EXR/D.{CUR}.EUR.SP00.A
 * Format: CSV (text/csv), lastNObservations=1 for latest daily rate
 *
 * This is the DEFAULT FX provider (no key required).
 * Coverage: EUR as base; any ECB-tracked currency pair.
 *
 * Compliance: ECB data is freely redistributable under ECB terms of use.
 * Cache: 24 h — rates update once daily (14:15 CET working days).
 * Note: getQuotes() is not supported by ECB FX data — returns empty quotes
 *       with a clear message; use a keyed quotes provider for equities/indices.
 */

import type { MarketsAdapter, QuotesResponse, FxResponse, FxRecord } from '../index';

const ECB_BASE = 'https://data-api.ecb.europa.eu/service/data/EXR';

/** Parse ECB CSV: first data row after header gives TIME_PERIOD and OBS_VALUE */
function parseCsvRow(csv: string): { date: string; value: number } | null {
  const lines = csv.trim().split('\n');
  // Header is line 0; data starts line 1
  if (lines.length < 2) return null;
  const header = lines[0].split(',');
  const data   = lines[1].split(',');
  const timeIdx  = header.indexOf('TIME_PERIOD');
  const valueIdx = header.indexOf('OBS_VALUE');
  if (timeIdx < 0 || valueIdx < 0) return null;
  const value = parseFloat(data[valueIdx]);
  if (isNaN(value)) return null;
  return { date: data[timeIdx]?.trim() ?? '', value };
}

export class EcbAdapter implements MarketsAdapter {
  readonly name = 'ecb';

  /** ECB does not provide equity quotes. Returns empty with a provider note. */
  async getQuotes(_symbols: string[]): Promise<QuotesResponse> {
    return {
      quotes: [],
      // @ts-expect-error: extra field for consumer transparency
      _note: 'ECB provider does not supply equity/index quotes. Set MARKET_DATA_PROVIDER=twelvedata and provide TWELVEDATA_KEY.',
    };
  }

  /**
   * Fetch FX rates from ECB SDMX.
   * @param pairs  Array of ISO-4217 currency codes relative to EUR base,
   *               e.g. ['USD', 'GBP', 'JPY'] or full pair strings 'USD/EUR'.
   * ECB rates are quoted as {currency}/EUR (units of currency per 1 EUR).
   * Cache: 24 h — data updates once per ECB business day.
   */
  async getFx(pairs: string[]): Promise<FxResponse> {
    // Normalise: accept 'USD/EUR', 'USD', 'EURUSD' etc. → extract the non-EUR leg
    const currencies = pairs.map(p => {
      const upper = p.toUpperCase().replace('/', '');
      if (upper.startsWith('EUR')) return upper.slice(3);
      if (upper.endsWith('EUR'))   return upper.slice(0, upper.length - 3);
      return p.toUpperCase(); // treat as raw currency code
    }).filter(Boolean);

    const uniqueCurrencies = [...new Set(currencies)];
    if (uniqueCurrencies.length === 0) return { fx: [] };

    const results: FxRecord[] = [];

    await Promise.allSettled(
      uniqueCurrencies.map(async (currency) => {
        try {
          const url = `${ECB_BASE}/D.${currency}.EUR.SP00.A?format=csvdata&lastNObservations=1`;
          const res = await fetch(url, {
            next: { revalidate: 86400 }, // cacheable: ECB data updates once per business day
          });
          if (!res.ok) return;
          const csv = await res.text();
          const parsed = parseCsvRow(csv);
          if (!parsed) return;
          results.push({
            pair: `${currency}/EUR`,
            rate: parsed.value,
            asOf: parsed.date,
            source: 'ecb',
          });
        } catch {
          // silent — partial results acceptable
        }
      })
    );

    return { fx: results };
  }
}
