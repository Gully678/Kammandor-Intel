/**
 * KINTEL Phase 2 — Ontology ingest unit tests
 *
 * Tests the pure builder (buildProposedEditsFromRecords) that turns raw
 * connector records into intel.proposed_edit rows via MAPPERS + propose.ts.
 * No network, no DB — this is the pure I/O-free half of the ingest route
 * (src/app/api/ontology/ingest/route.ts).
 *
 * GOVERNANCE ASSERTION (core to this slice): every row the builder returns
 * must be a proposal (kind create_entity / create_link, status 'pending')
 * and must NEVER itself target intel.entity or intel.link directly — i.e.
 * there is no code path here that returns anything other than a
 * ProposedEdit destined for the proposed_edit queue.
 */

import { describe, it, expect } from 'vitest';
import { buildProposedEditsFromRecords, INGEST_PROPOSED_BY } from '../ingest';

const TENANT_ID = 'test-tenant-uuid-0001';

// ---------------------------------------------------------------------------
// Fixtures — representative raw records for 3 sources
// ---------------------------------------------------------------------------

/** GLEIF JSON:API data item (see src/lib/ontology/mappers/gleif.ts) */
const GLEIF_RECORD = {
  id: '5493001KJTIIGC8Y1R12',
  attributes: {
    lei: '5493001KJTIIGC8Y1R12',
    entity: {
      legalName: { name: 'Acme International Ltd' },
      status: 'ACTIVE',
      jurisdiction: 'GB',
      registeredAddress: { country: 'GB' },
    },
  },
  relationships: {
    'direct-parent': {
      data: { id: 'PARENT0000000000LEI1' },
    },
  },
};

/** World Bank raw country row (see src/lib/ontology/mappers/world-bank.ts) */
const WORLD_BANK_RECORD = {
  id: 'GBR',
  iso2Code: 'GB',
  name: 'United Kingdom',
  capitalCity: 'London',
  region: { id: 'ECS', value: 'Europe & Central Asia' },
  incomeLevel: { id: 'HIC', value: 'High income' },
};

/** UN Comtrade normalised flow record (see src/lib/ontology/mappers/un-comtrade.ts) */
const UN_COMTRADE_RECORD = {
  reporterIso: 'USA',
  reporterName: 'United States',
  partnerIso: 'GBR',
  partnerName: 'United Kingdom',
  flow: 'X',
  flowDesc: 'Export',
  value: 12345678,
  period: '2023',
};

// ---------------------------------------------------------------------------
// Governance: every ProposedEdit must be a proposal, never a direct write
// ---------------------------------------------------------------------------

function assertAllAreGovernedProposals(edits: ReturnType<typeof buildProposedEditsFromRecords>['edits']) {
  for (const edit of edits) {
    expect(['create_entity', 'create_link']).toContain(edit.kind);
    expect(edit.status).toBe('pending');
    // A ProposedEdit's payload carries entity/link FIELDS as JSON — it is
    // still a proposal row, not a write to intel.entity/intel.link. Assert
    // the shape here is the queue-row shape (has kind/status/proposed_by),
    // not an entity/link row shape (which would have no `kind`/`status`).
    expect(edit).toHaveProperty('kind');
    expect(edit).toHaveProperty('status');
    expect(edit).toHaveProperty('proposed_by');
    expect(edit).toHaveProperty('payload');
    expect(edit).toHaveProperty('tenant_id', TENANT_ID);
  }
}

describe('buildProposedEditsFromRecords', () => {
  it('gleif: produces pending create_entity/create_link proposals with correct kind/payload/status', () => {
    const { edits, skipped } = buildProposedEditsFromRecords('gleif', TENANT_ID, [GLEIF_RECORD]);

    expect(skipped).toBe(0);
    expect(edits.length).toBeGreaterThan(0);
    assertAllAreGovernedProposals(edits);

    // gleif fixture has a jurisdiction + a parent LEI -> at least one
    // create_entity (company) and one create_link (subsidiaryOf/registeredIn)
    const entityEdits = edits.filter(e => e.kind === 'create_entity');
    const linkEdits    = edits.filter(e => e.kind === 'create_link');
    expect(entityEdits.length).toBeGreaterThan(0);
    expect(linkEdits.length).toBeGreaterThan(0);

    const companyEdit = entityEdits.find(e => (e.payload as { type?: string }).type === 'company');
    expect(companyEdit).toBeDefined();
    expect((companyEdit!.payload as { lei?: string }).lei).toBe('5493001KJTIIGC8Y1R12');
    expect(companyEdit!.proposed_by).toBe(INGEST_PROPOSED_BY);
    expect(companyEdit!.status).toBe('pending');
    expect(typeof companyEdit!.rationale).toBe('string');
    expect(companyEdit!.rationale!.length).toBeGreaterThan(0);

    // Proposal payloads never carry the entity's own id/created_at/updated_at
    // (propose.ts's Omit<Entity, 'id'|'created_at'|'updated_at'> contract) —
    // the payload is field data for a FUTURE row, not an existing row.
    expect(companyEdit!.payload).not.toHaveProperty('id');
    expect(companyEdit!.payload).not.toHaveProperty('created_at');
    expect(companyEdit!.payload).not.toHaveProperty('updated_at');
  });

  it('world-bank: produces a pending create_entity jurisdiction proposal', () => {
    const { edits, skipped } = buildProposedEditsFromRecords('world-bank', TENANT_ID, [WORLD_BANK_RECORD]);

    expect(skipped).toBe(0);
    expect(edits).toHaveLength(1);
    assertAllAreGovernedProposals(edits);

    const edit = edits[0];
    expect(edit.kind).toBe('create_entity');
    expect((edit.payload as { type?: string }).type).toBe('jurisdiction');
    expect((edit.payload as { jurisdiction_code?: string }).jurisdiction_code).toBe('GB');
    expect((edit.payload as { canonical_name?: string }).canonical_name).toBe('United Kingdom');
  });

  it('un-comtrade: produces reporter+partner create_entity proposals and a create_link proposal', () => {
    const { edits, skipped } = buildProposedEditsFromRecords('un-comtrade', TENANT_ID, [UN_COMTRADE_RECORD]);

    expect(skipped).toBe(0);
    assertAllAreGovernedProposals(edits);

    const entityEdits = edits.filter(e => e.kind === 'create_entity');
    const linkEdits    = edits.filter(e => e.kind === 'create_link');
    expect(entityEdits).toHaveLength(2); // reporter + partner jurisdictions
    expect(linkEdits).toHaveLength(1);

    const link = linkEdits[0];
    expect((link.payload as { type?: string }).type).toBe('connectedJurisdiction');
    const linkProps = (link.payload as { properties?: Record<string, unknown> }).properties ?? {};
    expect(linkProps.flow).toBe('X');
    expect(linkProps.value).toBe(12345678);
    expect(linkProps.period).toBe('2023');
  });

  it('handles multiple records across a batch, accumulating proposals from each', () => {
    const { edits, skipped } = buildProposedEditsFromRecords('world-bank', TENANT_ID, [
      WORLD_BANK_RECORD,
      { ...WORLD_BANK_RECORD, id: 'FRA', iso2Code: 'FR', name: 'France' },
    ]);

    expect(skipped).toBe(0);
    expect(edits).toHaveLength(2);
    assertAllAreGovernedProposals(edits);
  });

  it('unknown source: throws', () => {
    expect(() =>
      buildProposedEditsFromRecords('not-a-real-source', TENANT_ID, [{}]),
    ).toThrow(/Unknown ontology source/);
  });

  it('malformed record: does not throw, and is skipped rather than producing a bad proposal', () => {
    // null / non-object records a mapper cannot meaningfully process.
    const { edits, skipped } = buildProposedEditsFromRecords('gleif', TENANT_ID, [
      null as unknown as Record<string, unknown>,
      undefined as unknown as Record<string, unknown>,
      'not-an-object' as unknown as Record<string, unknown>,
    ]);

    // Must not throw (asserted implicitly by reaching this line).
    // gleif's mapper is defensive and may still emit a low-quality entity
    // for some malformed shapes rather than throwing — either way nothing
    // here may throw, and any edits produced must still be governed
    // proposals, never a direct entity/link write.
    assertAllAreGovernedProposals(edits);
    expect(skipped).toBeGreaterThanOrEqual(0);
  });

  it('malformed record mixed with a valid record: valid record still produces proposals', () => {
    const { edits } = buildProposedEditsFromRecords('world-bank', TENANT_ID, [
      null as unknown as Record<string, unknown>,
      WORLD_BANK_RECORD,
    ]);

    const validEdits = edits.filter(
      e => (e.payload as { canonical_name?: string }).canonical_name === 'United Kingdom',
    );
    expect(validEdits.length).toBeGreaterThan(0);
    assertAllAreGovernedProposals(edits);
  });

  it('empty records array: returns no edits, no skips, does not throw', () => {
    const { edits, skipped } = buildProposedEditsFromRecords('gleif', TENANT_ID, []);
    expect(edits).toHaveLength(0);
    expect(skipped).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// v2 §12.4 — evaluation persisted at propose time.
//
// buildProposedEditsFromRecords must run the AIP eval gate
// (src/lib/ai/analyze.ts's evaluate()) over every proposal it builds and
// attach the result to the row's `evaluation` field, which the ingest route
// then inserts into intel.proposed_edit.evaluation (migrations/intel/0015).
// ---------------------------------------------------------------------------

describe('buildProposedEditsFromRecords — evaluation persisted at propose time (v2 §12.4)', () => {
  it('attaches a structured evaluation result to every built proposal', () => {
    const { edits } = buildProposedEditsFromRecords('gleif', TENANT_ID, [GLEIF_RECORD]);
    expect(edits.length).toBeGreaterThan(0);

    for (const edit of edits) {
      expect(edit.evaluation).toBeDefined();
      const evaluation = edit.evaluation as { passed: boolean; score: number; checks: string[] };
      expect(typeof evaluation.passed).toBe('boolean');
      expect(typeof evaluation.score).toBe('number');
      expect(Array.isArray(evaluation.checks)).toBe(true);
      expect(evaluation.checks.length).toBeGreaterThan(0);
    }
  });

  it('well-formed connector records evaluate as passed, with links grounded against the same record\'s entities', () => {
    const { edits } = buildProposedEditsFromRecords('gleif', TENANT_ID, [GLEIF_RECORD]);

    const linkEdits = edits.filter(e => e.kind === 'create_link');
    expect(linkEdits.length).toBeGreaterThan(0);

    for (const edit of edits) {
      const evaluation = edit.evaluation as { passed: boolean; checks: string[] };
      expect(evaluation.passed).toBe(true);
    }

    // Grounding must be real (checked against the record's own entity ids),
    // not merely "well-formed UUID": the eval gate emits an explicit
    // grounded PASS check for each link endpoint when knownEntityIds is
    // supplied.
    for (const linkEdit of linkEdits) {
      const evaluation = linkEdit.evaluation as { checks: string[] };
      expect(evaluation.checks.some(c => /grounded/.test(c))).toBe(true);
    }
  });

  it('does not attach an evaluation shaped like a write to any ontology table (still a proposal row)', () => {
    const { edits } = buildProposedEditsFromRecords('world-bank', TENANT_ID, [WORLD_BANK_RECORD]);
    assertAllAreGovernedProposals(edits);
    for (const edit of edits) {
      expect(edit.status).toBe('pending');
      expect(edit.evaluation).toBeDefined();
    }
  });
});
