/**
 * KINTEL Phase 2 — Markets / financial instrument mapper (stub)
 * TODO: Implement full instrument mapper.
 * Expected: maps a market data record (FX pair, equity, commodity) to an
 * 'instrument' entity with ISIN / ticker, and pricedBy links if applicable.
 */

import type { MapperResult } from './gleif';

export type { MapperResult };

/** Map a market data instrument record to ontology objects. */
export function mapMarketsInstrument(_input: unknown, _tenantId: string): MapperResult {
  // TODO: implement markets instrument mapper
  return { entities: [], links: [], provenance: [] };
}
