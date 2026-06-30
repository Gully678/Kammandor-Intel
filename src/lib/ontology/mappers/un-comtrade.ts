/**
 * KINTEL Phase 2 — UN Comtrade trade flow mapper (stub)
 * TODO: Implement full UN Comtrade mapping.
 * Expected: maps a Comtrade flow record to reporter/partner Jurisdiction entities
 * and a connectedJurisdiction link representing the bilateral trade relationship.
 */

import type { MapperResult } from './gleif';

export type { MapperResult };

/** Map a UN Comtrade trade flow record to ontology objects. */
export function mapUnComtradeFlow(_input: unknown, _tenantId: string): MapperResult {
  // TODO: implement UN Comtrade mapper
  return { entities: [], links: [], provenance: [] };
}
