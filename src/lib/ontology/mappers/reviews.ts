/**
 * KINTEL Phase 2 — Reviews / sentiment mapper (stub)
 * TODO: Implement full reviews mapper.
 * Expected: maps a review record (Trustpilot, G2, App Store, etc.) to an
 * 'event' entity with sentiment properties and mentionedInEvent links.
 */

import type { MapperResult } from './gleif';

export type { MapperResult };

/** Map a review record to ontology objects. */
export function mapReview(_input: unknown, _tenantId: string): MapperResult {
  // TODO: implement reviews mapper
  return { entities: [], links: [], provenance: [] };
}
