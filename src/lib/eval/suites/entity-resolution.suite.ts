/**
 * KINTEL v2 — gold suite: entity resolution merge candidates (PRD v2.0 §9.7)
 *
 * Capability under test: findMergeCandidates (src/lib/ontology/resolve.ts).
 * Cases are hand-authored from the documented rules (PRD v2.0 §7.7):
 * identifier match => 0.95, normalised-name match => 0.7, hard exclusions
 * across type/tenant, deterministic primary selection, pair de-duplication.
 *
 * Deterministic by construction: pure inputs, no I/O.
 * Bar is 1.0 — any regression on any gold case must fail the gate.
 */

import { findMergeCandidates } from '@/lib/ontology/resolve';
import type { Entity } from '@/lib/ontology/types';
import type { GoldSuite } from '../types';

/** Unambiguous projection of a MergeCandidate (evidence wording is not pinned here). */
export interface MergePair {
  primaryId: string;
  duplicateId: string;
  confidence: number;
}

const TENANT_A = 'tenant-aaaa-0001';
const TENANT_B = 'tenant-bbbb-0002';

function makeEntity(overrides: Partial<Entity> & { id: string }): Entity {
  return {
    tenant_id: TENANT_A,
    type: 'company',
    properties: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function pairsEqual(a: MergePair[], b: MergePair[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((pair, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      pair.primaryId === other.primaryId &&
      pair.duplicateId === other.duplicateId &&
      pair.confidence === other.confidence
    );
  });
}

export const entityResolutionSuite: GoldSuite<Entity[], MergePair[]> = {
  suite: 'entity-resolution',
  capability: 'findMergeCandidates',
  bar: 1,
  run: (entities) =>
    findMergeCandidates(entities).map((c) => ({
      primaryId: c.primaryId,
      duplicateId: c.duplicateId,
      confidence: c.confidence,
    })),
  score: pairsEqual,
  cases: [
    {
      id: 'shared-identifier-confidence-095',
      note: 'Same-type, same-tenant entities sharing a promoted identifier (lei) => confidence 0.95',
      input: [
        makeEntity({
          id: 'alpha-1',
          canonical_name: 'Alpha Commodities',
          lei: '5493001KJTIIGC8Y1R12',
          created_at: '2026-01-01T00:00:00.000Z',
        }),
        makeEntity({
          id: 'alpha-2',
          canonical_name: 'Alpha Holdings',
          lei: '5493001KJTIIGC8Y1R12',
          created_at: '2026-02-01T00:00:00.000Z',
        }),
      ],
      expected: [{ primaryId: 'alpha-1', duplicateId: 'alpha-2', confidence: 0.95 }],
    },
    {
      id: 'name-only-match-confidence-07',
      note: 'No shared identifier but equal normalised canonical names (case-insensitive) => 0.7',
      input: [
        makeEntity({
          id: 'nova-1',
          canonical_name: 'Nova Metals',
          created_at: '2026-01-05T00:00:00.000Z',
        }),
        makeEntity({
          id: 'nova-2',
          canonical_name: 'NOVA Metals',
          created_at: '2026-01-09T00:00:00.000Z',
        }),
      ],
      expected: [{ primaryId: 'nova-1', duplicateId: 'nova-2', confidence: 0.7 }],
    },
    {
      id: 'different-type-excluded',
      note: 'Identifiers are NEVER compared across types (company vs fund) — no candidate',
      input: [
        makeEntity({
          id: 'typ-1',
          type: 'company',
          canonical_name: 'Meridian Capital',
          lei: '5493001KJTIIGC8Y1R12',
        }),
        makeEntity({
          id: 'typ-2',
          type: 'fund',
          canonical_name: 'Meridian Capital',
          lei: '5493001KJTIIGC8Y1R12',
        }),
      ],
      expected: [],
    },
    {
      id: 'cross-tenant-excluded',
      note: 'Candidates are never proposed across tenants, even on an exact identifier match',
      input: [
        makeEntity({
          id: 'ten-1',
          tenant_id: TENANT_A,
          canonical_name: 'Baltica Grain',
          lei: '529900T8BM49AURSDO55',
        }),
        makeEntity({
          id: 'ten-2',
          tenant_id: TENANT_B,
          canonical_name: 'Baltica Grain',
          lei: '529900T8BM49AURSDO55',
        }),
      ],
      expected: [],
    },
    {
      id: 'legal-suffix-normalisation',
      note: 'Trailing legal-form suffixes (FZE) are stripped before name comparison => 0.7',
      input: [
        makeEntity({
          id: 'pfo-1',
          canonical_name: 'Pitt Family Office FZE',
          created_at: '2026-01-01T00:00:00.000Z',
        }),
        makeEntity({
          id: 'pfo-2',
          canonical_name: 'Pitt Family Office',
          created_at: '2026-01-02T00:00:00.000Z',
        }),
      ],
      expected: [{ primaryId: 'pfo-1', duplicateId: 'pfo-2', confidence: 0.7 }],
    },
    {
      id: 'primary-is-earlier-created-at',
      note: 'The earlier-created record is the primary regardless of input order',
      input: [
        makeEntity({
          id: 'ent-young',
          canonical_name: 'Helios Energy',
          imo: '9074729',
          created_at: '2026-03-01T00:00:00.000Z',
        }),
        makeEntity({
          id: 'ent-old',
          canonical_name: 'Helios Energy',
          imo: '9074729',
          created_at: '2026-01-15T00:00:00.000Z',
        }),
      ],
      expected: [{ primaryId: 'ent-old', duplicateId: 'ent-young', confidence: 0.95 }],
    },
    {
      id: 'pair-dedupe-three-way',
      note: 'Each unordered pair appears at most once: three duplicates => exactly three pairs (created_at tie => lower id is primary)',
      input: [
        makeEntity({ id: 'trio-a', canonical_name: 'Trio Alpha', isin: 'US0378331005' }),
        makeEntity({ id: 'trio-b', canonical_name: 'Trio Beta', isin: 'US0378331005' }),
        makeEntity({ id: 'trio-c', canonical_name: 'Trio Gamma', isin: 'US0378331005' }),
      ],
      expected: [
        { primaryId: 'trio-a', duplicateId: 'trio-b', confidence: 0.95 },
        { primaryId: 'trio-a', duplicateId: 'trio-c', confidence: 0.95 },
        { primaryId: 'trio-b', duplicateId: 'trio-c', confidence: 0.95 },
      ],
    },
    {
      id: 'no-candidates-for-unrelated-entities',
      note: 'Different names and no shared identifiers => empty result, never a silent guess',
      input: [
        makeEntity({ id: 'solo-1', canonical_name: 'Meridian Shipping' }),
        makeEntity({ id: 'solo-2', canonical_name: 'Danube Logistics' }),
      ],
      expected: [],
    },
  ],
};
