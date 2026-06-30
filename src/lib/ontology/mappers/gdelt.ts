/**
 * KINTEL Phase 2 — GDELT event mapper (stub)
 * TODO: Implement full GDELT GKG / event mapping.
 * Expected: maps a GDELT event row to one or more 'event' entities,
 * 'mentionedInEvent' links from involved actors, and provenance rows.
 */

import type { MapperResult } from './gleif';

export type { MapperResult };

/** Map a GDELT event record to ontology objects. */
export function mapGdeltEvent(_input: unknown, _tenantId: string): MapperResult {
  // TODO: implement GDELT event mapper
  return { entities: [], links: [], provenance: [] };
}
