/**
 * KINTEL v2.1 — GLEIF declarative connector (PRD §8.2/§8.5)
 *
 * Wraps the existing 'gleif' source + mapper (src/lib/ontology/mappers/gleif.ts)
 * in a ConnectorDef with data expectations matched to the mapper's TRUE input
 * shape (a GLEIF JSON:API data item):
 *  - HARD: an LEI must be derivable (attributes.lei, falling back to id) —
 *    exactly what mapGleifRecord needs to key the company entity. Records
 *    without it hold back the entire batch.
 *  - WARN: attributes.entity should be present (name/status/jurisdiction);
 *    the mapper tolerates its absence (lei-only records still map), so this
 *    is recorded loudly but never blocks.
 */

import { required } from '../expectations';
import type { BatchFetcher, ConnectorDef, Expectation } from '../types';

/** True iff the value is a non-empty string. */
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** HARD: LEI derivable from attributes.lei or (JSON:API) top-level id. */
const gleifLeiPresent: Expectation = {
  name: 'gleif-lei-present',
  level: 'hard',
  description:
    'An LEI must be present (attributes.lei, or the JSON:API id fallback) — ' +
    'without it the mapper cannot key the company entity',
  check(record: unknown): boolean {
    if (record === null || typeof record !== 'object') return false;
    const item = record as Record<string, unknown>;
    const attrs = (item.attributes ?? {}) as Record<string, unknown>;
    return nonEmptyString(attrs.lei) || nonEmptyString(item.id);
  },
};

/** Data expectations for the GLEIF source, ordered hard-first. */
export const GLEIF_EXPECTATIONS: Expectation[] = [
  gleifLeiPresent,
  required('attributes.entity', 'warn'),
];

/**
 * Build the declarative GLEIF connector. The fetcher is injected — no
 * network I/O lives in this slice.
 */
export function makeGleifConnector(fetch: BatchFetcher): ConnectorDef {
  return {
    sourceKey: 'gleif',
    mapperKey: 'gleif',
    expectations: GLEIF_EXPECTATIONS,
    fetch,
  };
}
