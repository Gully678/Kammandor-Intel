/**
 * KINTEL Phase 2 — Markets / financial instrument mapper
 * Transforms a market data record (FX pair or equity/commodity quote) into
 * an ontology Instrument entity.
 *
 * Source key: 'markets-fx'
 * API: provider-pluggable (see src/lib/markets/index.ts) — quotes (QuoteRecord)
 * and FX pairs (FxRecord) share the connector but have distinct shapes:
 *
 *   QuoteRecord: { symbol, price, changePct, currency, asOf, source }
 *   FxRecord:    { pair, rate, asOf, source }
 *
 * This mapper accepts either shape (distinguished by presence of `symbol` vs
 * `pair`) and produces one Instrument entity per call.
 *
 * No links are produced: a single quote/FX row carries no second entity
 * (exchange, issuer) to link against in this connector's current shape.
 */

import type { Entity, Provenance } from '../types';
import type { MapperResult } from './gleif';

export type { MapperResult };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function makeEntityBase(tenantId: string): Pick<Entity, 'tenant_id' | 'properties' | 'created_at' | 'updated_at'> {
  return { tenant_id: tenantId, properties: {}, created_at: now(), updated_at: now() };
}

function pseudoUuid(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(h).toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-000000000000`;
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

/**
 * Map a single market data record (quote or FX pair) to an Instrument entity.
 *
 * Expected input shape — one of:
 *   { symbol: string, price: number, changePct: number, currency: string, asOf: string, source: string }
 *   { pair: string, rate: number, asOf: string, source: string }
 */
export function mapMarketsInstrument(input: unknown, tenantId: string): MapperResult {
  const row = (input as Record<string, unknown>) ?? {};

  const symbol: string = typeof row.symbol === 'string' ? row.symbol : '';
  const pair:   string = typeof row.pair   === 'string' ? row.pair   : '';
  const ticker = symbol || pair;

  // Defensive: no identifiable instrument ticker/pair — nothing to map.
  if (!ticker) {
    return { entities: [], links: [], provenance: [] };
  }

  const price:     number | undefined = typeof row.price     === 'number' && !isNaN(row.price)     ? row.price     : undefined;
  const changePct: number | undefined = typeof row.changePct === 'number' && !isNaN(row.changePct) ? row.changePct : undefined;
  const currency:  string | undefined = typeof row.currency  === 'string' ? row.currency : undefined;
  const rate:      number | undefined = typeof row.rate      === 'number' && !isNaN(row.rate)      ? row.rate      : undefined;
  const asOf:      string | undefined = typeof row.asOf      === 'string' ? row.asOf : undefined;
  const provider:  string = typeof row.source === 'string' ? row.source : 'markets-fx';

  const instrumentKind = pair ? 'fx' : 'quote';
  const entityId = pseudoUuid(`markets:instrument:${ticker}`);

  const entity: Entity = {
    ...makeEntityBase(tenantId),
    id:             entityId,
    type:           'instrument',
    canonical_name: ticker,
    isin: undefined, // not available from this connector shape
    properties: {
      instrument_kind: instrumentKind,
      symbol: symbol || undefined,
      pair:   pair   || undefined,
      price,
      change_pct: changePct,
      currency,
      rate,
      as_of: asOf,
      provider,
      source: 'markets-fx',
    },
  };

  const provenance: Provenance[] = [
    {
      id:         pseudoUuid(`markets:prov:${ticker}:${asOf ?? ''}`),
      entity_id:  entityId,
      source_key: 'markets-fx',
      source_url: undefined,
      fetched_at: now(),
      confidence: 0.8,
      raw:        input,
    },
  ];

  return { entities: [entity], links: [], provenance };
}
