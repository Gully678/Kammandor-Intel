/**
 * KINTEL v2 — Entity-resolution / dedup unit tests (PRD v2.0 §7.7)
 *
 * "An ambiguous match is a first-class state, never a silent guess."
 *
 * GOVERNANCE ASSERTION: findMergeCandidates never writes anything — it is a
 * pure, deterministic function. buildMergeProposal only ever emits a
 * ProposedEdit (kind 'update_entity', status 'pending') destined for the
 * intel.proposed_edit queue; nothing here touches intel.entity directly.
 */

import { describe, it, expect } from 'vitest';
import type { Entity } from '../types';
import {
  resolveEntityKey,
  dedupeEntities,
  findMergeCandidates,
  buildMergeProposal,
  type MergeCandidate,
} from '../resolve';

const TENANT_A = 'tenant-aaaa-0001';
const TENANT_B = 'tenant-bbbb-0002';

function makeEntity(overrides: Partial<Entity> & { id: string }): Entity {
  return {
    tenant_id:  TENANT_A,
    type:       'company',
    properties: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// findMergeCandidates
// ---------------------------------------------------------------------------

describe('findMergeCandidates', () => {
  it('flags same-type entities sharing a promoted identifier at confidence 0.95 with identifier evidence', () => {
    const a = makeEntity({
      id: 'ent-a', canonical_name: 'Alpha Trading',
      lei: '5493001KJTIIGC8Y1R12',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const b = makeEntity({
      id: 'ent-b', canonical_name: 'Alpha Trading International',
      lei: '5493001KJTIIGC8Y1R12',
      created_at: '2026-02-01T00:00:00.000Z',
    });

    const candidates = findMergeCandidates([a, b]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({
      primaryId:   'ent-a',
      duplicateId: 'ent-b',
      confidence:  0.95,
      evidence:    ['Same lei: 5493001KJTIIGC8Y1R12'],
    });
  });

  it('collects one evidence line per matching identifier but still one candidate per pair (pair de-duplication)', () => {
    const a = makeEntity({
      id: 'ent-a',
      lei: 'LEI-1', company_number: 'CN-1',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const b = makeEntity({
      id: 'ent-b',
      lei: 'LEI-1', company_number: 'CN-1',
      created_at: '2026-02-01T00:00:00.000Z',
    });

    const candidates = findMergeCandidates([a, b]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].confidence).toBe(0.95);
    expect(candidates[0].evidence).toEqual([
      'Same lei: LEI-1',
      'Same company_number: CN-1',
    ]);
  });

  it('flags normalised-name-only matches at confidence 0.7 with name evidence', () => {
    const a = makeEntity({
      id: 'ent-a', canonical_name: 'Beta Commodities',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const b = makeEntity({
      id: 'ent-b', canonical_name: 'beta commodities',
      created_at: '2026-02-01T00:00:00.000Z',
    });

    const candidates = findMergeCandidates([a, b]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({
      primaryId:   'ent-a',
      duplicateId: 'ent-b',
      confidence:  0.7,
      evidence:    ['Same normalised name: beta commodities'],
    });
  });

  it('normalises legal suffixes and punctuation (Pitt Family Office FZE ≈ pitt family office)', () => {
    const a = makeEntity({
      id: 'ent-a', canonical_name: 'Pitt Family Office FZE',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const b = makeEntity({
      id: 'ent-b', canonical_name: '  pitt   family office.',
      created_at: '2026-02-01T00:00:00.000Z',
    });

    const candidates = findMergeCandidates([a, b]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].confidence).toBe(0.7);
    expect(candidates[0].evidence).toEqual(['Same normalised name: pitt family office']);
  });

  it('does NOT pair entities of different type even when an identifier matches (CAS-number caution, PRD §7.7)', () => {
    const company = makeEntity({
      id: 'ent-a', type: 'company', isin: 'US0378331005',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const instrument = makeEntity({
      id: 'ent-b', type: 'instrument', isin: 'US0378331005',
      created_at: '2026-02-01T00:00:00.000Z',
    });

    expect(findMergeCandidates([company, instrument])).toEqual([]);
  });

  it('never pairs across tenants, even on identical identifiers and names', () => {
    const a = makeEntity({
      id: 'ent-a', tenant_id: TENANT_A,
      canonical_name: 'Gamma Ltd', lei: 'LEI-X',
    });
    const b = makeEntity({
      id: 'ent-b', tenant_id: TENANT_B,
      canonical_name: 'Gamma Ltd', lei: 'LEI-X',
    });

    expect(findMergeCandidates([a, b])).toEqual([]);
  });

  it('chooses the earlier created_at as primary regardless of array order', () => {
    const older = makeEntity({
      id: 'ent-z-older', lei: 'LEI-2',
      created_at: '2025-06-01T00:00:00.000Z',
    });
    const newer = makeEntity({
      id: 'ent-a-newer', lei: 'LEI-2',
      created_at: '2026-06-01T00:00:00.000Z',
    });

    // Newer first in the array — primary must still be the older row.
    const candidates = findMergeCandidates([newer, older]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].primaryId).toBe('ent-z-older');
    expect(candidates[0].duplicateId).toBe('ent-a-newer');
  });

  it('falls back to the lower id string when created_at ties', () => {
    const a = makeEntity({ id: 'ent-b', lei: 'LEI-3' });
    const b = makeEntity({ id: 'ent-a', lei: 'LEI-3' });

    const candidates = findMergeCandidates([a, b]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].primaryId).toBe('ent-a');
    expect(candidates[0].duplicateId).toBe('ent-b');
  });

  it('returns no candidates for unrelated entities and is pure (input untouched)', () => {
    const a = makeEntity({ id: 'ent-a', canonical_name: 'Delta', lei: 'LEI-D' });
    const b = makeEntity({ id: 'ent-b', canonical_name: 'Epsilon', lei: 'LEI-E' });
    const snapshot = JSON.parse(JSON.stringify([a, b]));

    expect(findMergeCandidates([a, b])).toEqual([]);
    expect([a, b]).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// buildMergeProposal
// ---------------------------------------------------------------------------

describe('buildMergeProposal', () => {
  const candidate: MergeCandidate = {
    primaryId:   'ent-primary',
    duplicateId: 'ent-duplicate',
    confidence:  0.95,
    evidence:    ['Same lei: LEI-1', 'Same company_number: CN-1'],
  };

  it('emits the exact update_entity proposed_edit insert shape — a needs-review proposal, never an applied write', () => {
    const proposal = buildMergeProposal(candidate, 'entity-resolution-agent', TENANT_A);

    expect(proposal.kind).toBe('update_entity');
    expect(proposal.status).toBe('pending');
    expect(proposal.tenant_id).toBe(TENANT_A);
    expect(proposal.proposed_by).toBe('entity-resolution-agent');
    expect(proposal.payload).toEqual({
      id: 'ent-duplicate',
      patch: {
        properties: {
          merged_into:      'ent-primary',
          merge_confidence: 0.95,
          merge_evidence:   ['Same lei: LEI-1', 'Same company_number: CN-1'],
        },
      },
    });
    expect(proposal.rationale).toBe(
      'Possible duplicate of ent-primary — Same lei: LEI-1; Same company_number: CN-1; requires human review',
    );
    expect(proposal.id).toBeTruthy();
    expect(proposal.created_at).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Existing exports remain intact (additive-only law)
// ---------------------------------------------------------------------------

describe('existing resolve.ts exports (regression)', () => {
  it('resolveEntityKey and dedupeEntities still behave as before', () => {
    const a = makeEntity({ id: 'ent-a', lei: 'LEI-1', properties: { x: 1 } });
    const b = makeEntity({ id: 'ent-b', lei: 'LEI-1', properties: { y: 2 } });

    expect(resolveEntityKey(a)).toBe('lei:LEI-1');
    const merged = dedupeEntities([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].properties).toEqual({ x: 1, y: 2 });
  });
});
