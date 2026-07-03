/**
 * KINTEL Phase 2 — Entity resolution helpers
 * Stable key derivation and deduplication logic.
 * No DB access — pure functions safe to use in any context.
 */

import type { Entity, ProposedEdit } from './types';
import { proposeUpdate } from './propose';

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------

/**
 * Pick the strongest stable identifier for an entity.
 * Priority: lei > company_number > imo > isin > wallet_address > jurisdiction_code
 * Returns null when no identifier is set.
 */
export function resolveEntityKey(entity: Entity): string | null {
  if (entity.lei)              return `lei:${entity.lei}`;
  if (entity.company_number)   return `cn:${entity.company_number}`;
  if (entity.imo)              return `imo:${entity.imo}`;
  if (entity.isin)             return `isin:${entity.isin}`;
  if (entity.wallet_address)   return `wallet:${entity.wallet_address}`;
  if (entity.jurisdiction_code) return `jur:${entity.jurisdiction_code}`;
  return null;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Merge a list of Entity objects by resolved key.
 * When two entities share the same key, the later one (higher array index) wins
 * for all scalar fields, while `properties` is deeply merged (later wins on conflict).
 * Entities with no resolvable key are kept as-is (no deduplication possible).
 */
export function dedupeEntities(entities: Entity[]): Entity[] {
  const keyed = new Map<string, Entity>();
  const unkeyed: Entity[] = [];

  for (const entity of entities) {
    const key = resolveEntityKey(entity);
    if (key === null) {
      unkeyed.push(entity);
      continue;
    }

    const existing = keyed.get(key);
    if (!existing) {
      keyed.set(key, entity);
    } else {
      // Merge: scalar fields from the newer entity win; properties deep-merge
      keyed.set(key, {
        ...existing,
        ...entity,
        properties: {
          ...existing.properties,
          ...entity.properties,
        },
      });
    }
  }

  return [...keyed.values(), ...unkeyed];
}

// ---------------------------------------------------------------------------
// Entity resolution — merge candidates (PRD v2.0 §7.7)
//
// "An ambiguous match is a first-class state, never a silent guess."
//
// findMergeCandidates is pure and deterministic: no DB access, no mutation of
// its input, same output for the same input regardless of array order.
// buildMergeProposal only constructs a ProposedEdit (status 'pending') for the
// intel.proposed_edit review queue — it NEVER writes to intel.entity.
// ---------------------------------------------------------------------------

/**
 * Promoted identifier columns considered strong evidence of identity.
 * Note: jurisdiction_code is deliberately excluded — many distinct entities
 * legitimately share a jurisdiction.
 */
const PROMOTED_IDENTIFIERS = [
  'lei',
  'company_number',
  'imo',
  'mmsi',
  'isin',
  'wallet_address',
] as const;

type PromotedIdentifier = (typeof PROMOTED_IDENTIFIERS)[number];

/** Legal-form suffixes stripped during canonical-name normalisation. */
const LEGAL_SUFFIXES: ReadonlySet<string> = new Set([
  'ltd', 'limited', 'llc', 'inc', 'plc', 'fze', 'gmbh',
]);

/**
 * A possible duplicate pair, expressed as a needs-review candidate.
 * `primaryId` is the record to keep (earlier created_at; tie → lower id);
 * `duplicateId` is the record proposed for merge into the primary.
 */
export interface MergeCandidate {
  primaryId:   string;
  duplicateId: string;
  confidence:  number;
  evidence:    string[];
}

/**
 * Normalise a canonical name for comparison:
 * lowercase, strip punctuation, collapse whitespace, trim, and drop trailing
 * legal-form suffixes (ltd/limited/llc/inc/plc/fze/gmbh).
 */
export function normaliseCanonicalName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);

  while (words.length > 1) {
    const last = words[words.length - 1];
    if (last !== undefined && LEGAL_SUFFIXES.has(last)) {
      words.pop();
    } else {
      break;
    }
  }

  return words.join(' ');
}

function identifierValue(entity: Entity, key: PromotedIdentifier): string | null {
  const value = entity[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Deterministic primary selection: earlier created_at wins; tie → lower id. */
function orderPair(a: Entity, b: Entity): [primary: Entity, duplicate: Entity] {
  if (a.created_at < b.created_at) return [a, b];
  if (b.created_at < a.created_at) return [b, a];
  return a.id <= b.id ? [a, b] : [b, a];
}

/**
 * Find possible duplicate entities within a batch.
 *
 * Rules (PRD v2.0 §7.7):
 * - Same tenant_id AND same type are hard preconditions — identifiers are
 *   never compared across types (CAS-number caution) or across tenants.
 * - Matching non-null promoted identifier → confidence 0.95, one evidence
 *   line per matching identifier ('Same <identifier>: <value>').
 * - Otherwise, normalised canonical-name equality → confidence 0.7.
 * - Each unordered pair appears at most once (pair de-duplication).
 *
 * Pure and deterministic: performs no I/O and never mutates `entities`.
 */
export function findMergeCandidates(entities: readonly Entity[]): MergeCandidate[] {
  const candidates: MergeCandidate[] = [];
  const seenPairs = new Set<string>();

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const left = entities[i];
      const right = entities[j];
      if (left === undefined || right === undefined) continue;

      // Hard gates: never across tenants, never across types, never self.
      if (left.id === right.id) continue;
      if (left.tenant_id !== right.tenant_id) continue;
      if (left.type !== right.type) continue;

      const pairKey =
        left.id < right.id ? `${left.id} ${right.id}` : `${right.id} ${left.id}`;
      if (seenPairs.has(pairKey)) continue;

      const [primary, duplicate] = orderPair(left, right);

      // Tier 1 — promoted identifier match (one evidence line per identifier)
      const identifierEvidence: string[] = [];
      for (const key of PROMOTED_IDENTIFIERS) {
        const a = identifierValue(primary, key);
        const b = identifierValue(duplicate, key);
        if (a !== null && b !== null && a === b) {
          identifierEvidence.push(`Same ${key}: ${a}`);
        }
      }

      // Tier 2 — normalised canonical-name equality
      const primaryName = primary.canonical_name
        ? normaliseCanonicalName(primary.canonical_name)
        : '';
      const duplicateName = duplicate.canonical_name
        ? normaliseCanonicalName(duplicate.canonical_name)
        : '';
      const nameMatches = primaryName.length > 0 && primaryName === duplicateName;

      if (identifierEvidence.length > 0) {
        seenPairs.add(pairKey);
        candidates.push({
          primaryId:   primary.id,
          duplicateId: duplicate.id,
          confidence:  0.95,
          evidence:    nameMatches
            ? [...identifierEvidence, `Same normalised name: ${primaryName}`]
            : identifierEvidence,
        });
      } else if (nameMatches) {
        seenPairs.add(pairKey);
        candidates.push({
          primaryId:   primary.id,
          duplicateId: duplicate.id,
          confidence:  0.7,
          evidence:    [`Same normalised name: ${primaryName}`],
        });
      }
    }
  }

  return candidates;
}

/**
 * Turn a MergeCandidate into a governed, needs-review ProposedEdit.
 *
 * GOVERNANCE: this performs NO database write. It returns an update_entity
 * proposal (status 'pending') that records the possible merge in the
 * duplicate's properties; a human reviewer must approve it before any
 * application-layer job acts on it.
 */
export function buildMergeProposal(
  candidate:  MergeCandidate,
  proposedBy: string,
  tenantId:   string,
): ProposedEdit {
  const rationale =
    `Possible duplicate of ${candidate.primaryId} — ` +
    `${candidate.evidence.join('; ')}; requires human review`;

  return proposeUpdate(
    tenantId,
    'update_entity',
    candidate.duplicateId,
    {
      properties: {
        merged_into:      candidate.primaryId,
        merge_confidence: candidate.confidence,
        merge_evidence:   [...candidate.evidence],
      },
    },
    proposedBy,
    rationale,
  );
}
