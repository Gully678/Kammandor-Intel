/**
 * KINTEL Mission B — External entity resolution: pure matching helpers
 *
 * GOVERNANCE: pure functions only — no network, no DB, no mutation. Every
 * match rule here is DETERMINISTIC (exact, normalised-name equality via
 * resolve.ts's normaliseCanonicalName). There is no fuzzy matching, no
 * scoring, and no LLM in this file. Callers (the gleif/ofac API routes)
 * are responsible for all I/O and for turning a match into a governed
 * ProposedEdit (GLEIF) or an informational alert row (OFAC) — never a
 * direct write to intel.entity/link/entity_provenance/crosswalk, and never
 * an auto-action for a sanctions match.
 */

import { normaliseCanonicalName } from './resolve';

// ---------------------------------------------------------------------------
// GLEIF — LEI enrichment matching
// ---------------------------------------------------------------------------

export interface GleifMatch {
  lei:       string;
  legalName: string;
}

export type GleifMatchOutcome =
  | { status: 'matched'; match: GleifMatch }
  | { status: 'no-match' }
  | { status: 'ambiguous' };

interface GleifRecordLike {
  id?:         unknown;
  attributes?: {
    lei?:    unknown;
    entity?: {
      legalName?: {
        name?: unknown;
      };
    };
  };
}

/** Extract a GLEIF record's LEI: prefers attributes.lei, falls back to the record's own `id`. */
export function extractGleifLei(record: unknown): string | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as GleifRecordLike;
  const attrLei = r.attributes?.lei;
  if (typeof attrLei === 'string' && attrLei.length > 0) return attrLei;
  if (typeof r.id === 'string' && r.id.length > 0) return r.id;
  return null;
}

/** Extract a GLEIF record's legal name (attributes.entity.legalName.name). */
export function extractGleifLegalName(record: unknown): string | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as GleifRecordLike;
  const name = r.attributes?.entity?.legalName?.name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

/**
 * DETERMINISTIC GLEIF match rule (no fuzz):
 *   normaliseCanonicalName(entityName) === normaliseCanonicalName(record legal name)
 * for EXACTLY ONE record among the candidates.
 *
 * - Empty/blank entityName, or no candidate records at all: 'no-match'.
 * - Zero candidates whose legal name normalises to the target: 'no-match'.
 * - Two or more candidates with DISTINCT LEIs whose legal name normalises to
 *   the target: 'ambiguous' — an ambiguous match is a first-class state,
 *   never a silent guess (mirrors resolve.ts's findMergeCandidates doctrine).
 * - Multiple records sharing the SAME LEI (e.g. a duplicate/paginated
 *   response) collapse to a single match rather than a false ambiguity.
 *
 * Pure and deterministic: no I/O, no mutation of `records`.
 */
export function pickUniqueGleifMatch(
  entityName: string,
  records: readonly unknown[],
): GleifMatchOutcome {
  const target = normaliseCanonicalName(entityName);
  if (target.length === 0) return { status: 'no-match' };

  const matchesByLei = new Map<string, GleifMatch>();
  for (const record of records) {
    const legalName = extractGleifLegalName(record);
    const lei = extractGleifLei(record);
    if (legalName === null || lei === null) continue;
    if (normaliseCanonicalName(legalName) !== target) continue;
    matchesByLei.set(lei, { lei, legalName });
  }

  if (matchesByLei.size === 0) return { status: 'no-match' };
  if (matchesByLei.size > 1) return { status: 'ambiguous' };

  const only = [...matchesByLei.values()][0];
  return { status: 'matched', match: only };
}

// ---------------------------------------------------------------------------
// OFAC — SDN name-screening matching
// ---------------------------------------------------------------------------

/**
 * DETERMINISTIC OFAC name-screening rule (no fuzz): true iff
 * normaliseCanonicalName(entityName) equals normaliseCanonicalName(one of
 * sdnNames). Blank/empty entityName never matches (avoids a degenerate
 * '' === '' false positive when both sides normalise to empty).
 *
 * This is a NAME match only — it is never sufficient grounds for an
 * ontology write or an auto-action. See the /api/ontology/screen/ofac route:
 * a true result here produces, at most, one informational
 * public.intelligence_alerts row for human review.
 */
export function ofacNameMatches(entityName: string, sdnNames: readonly string[]): boolean {
  const target = normaliseCanonicalName(entityName);
  if (target.length === 0) return false;
  return sdnNames.some((name) => normaliseCanonicalName(name) === target);
}

/**
 * Split an OFAC SDN 'aliases' cell (semicolon-separated, per the
 * OpenSanctions targets.simple.csv projection consumed by
 * src/lib/pipeline/connectors/ofac-sdn.ts) into individual candidate names.
 * Empty/undefined input yields an empty list.
 */
export function splitSdnAliases(aliases: string | undefined | null): string[] {
  if (!aliases) return [];
  return aliases
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function sdnField(record: unknown, key: string): string {
  if (typeof record !== 'object' || record === null) return '';
  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

/**
 * All candidate names for one raw OFAC SDN record (the connector's
 * `name` field plus every alias in `aliases`), ready to pass to
 * ofacNameMatches. Defensive against non-object/malformed records — never
 * throws, returns an empty list instead.
 */
export function sdnRecordNames(record: unknown): string[] {
  const names: string[] = [];
  const name = sdnField(record, 'name');
  if (name.length > 0) names.push(name);
  names.push(...splitSdnAliases(sdnField(record, 'aliases')));
  return names;
}

/** The SDN record's identifier (`id`, falling back to `uid`), or '' if absent. */
export function sdnRecordId(record: unknown): string {
  const id = sdnField(record, 'id');
  if (id.length > 0) return id;
  return sdnField(record, 'uid');
}
