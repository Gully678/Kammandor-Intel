/**
 * KINTEL v2.1 — Declarative connector/pipeline framework tests (PRD §8.2/§8.5)
 *
 * GOVERNANCE ASSERTIONS (core to this slice):
 *  - Data expectations at level 'hard' are HARD-FAIL gates: ANY hard failure
 *    holds back the ENTIRE batch — mapper and propose are never invoked, and
 *    nothing is partially propagated ("better stale than wrong").
 *  - Pipeline output is ONLY intel.proposed_edit-shaped proposals built via
 *    the existing propose builders (kind create_entity / create_link,
 *    status 'pending') — never a direct entity/link/provenance write.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  runExpectations,
  required,
  isoTimestamp,
  numericRange,
} from '../expectations';
import { runConnector, type RunConnectorDeps } from '../run';
import { makeGleifConnector, GLEIF_EXPECTATIONS } from '../connectors/gleif';
import type { ConnectorDef, Expectation, RawBatch } from '../types';

import { mapGleifRecord, type MapperResult } from '@/lib/ontology/mappers';
import { proposeCreateEntity, proposeCreateLink } from '@/lib/ontology/propose';
import type { Entity, Link, ProposedEdit } from '@/lib/ontology/types';

const TENANT_ID = 'test-tenant-uuid-0001';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Valid GLEIF JSON:API data item — the true input shape mapGleifRecord consumes. */
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
};

function batchOf(records: unknown[], sourceKey = 'gleif'): RawBatch {
  return { sourceKey, fetchedAt: '2026-07-03T00:00:00.000Z', records };
}

/** Governed propose fn built on the EXISTING propose builders (the only legal output path). */
function governedPropose(sourceKey: string, tenantId: string, mapped: MapperResult): ProposedEdit[] {
  const edits: ProposedEdit[] = [];
  for (const entity of mapped.entities as Entity[]) {
    const { id: _i, created_at: _c, updated_at: _u, ...fields } = entity;
    edits.push(proposeCreateEntity(tenantId, fields, 'connector-ingest', `from ${sourceKey}`));
  }
  for (const link of mapped.links as Link[]) {
    const { id: _i, created_at: _c, ...fields } = link;
    edits.push(proposeCreateLink(tenantId, fields, 'connector-ingest', `from ${sourceKey}`));
  }
  return edits;
}

function makeDeps(overrides: Partial<RunConnectorDeps> = {}): RunConnectorDeps {
  return {
    tenantId: TENANT_ID,
    mapper: vi.fn(mapGleifRecord),
    propose: vi.fn(governedPropose),
    now: () => '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

function defWith(records: unknown[], expectations: Expectation[]): ConnectorDef {
  return {
    sourceKey: 'gleif',
    mapperKey: 'gleif',
    expectations,
    fetch: vi.fn(async () => batchOf(records)),
  };
}

// ---------------------------------------------------------------------------
// runExpectations
// ---------------------------------------------------------------------------

describe('runExpectations', () => {
  it('accepts a batch when every record passes every expectation', () => {
    const report = runExpectations([GLEIF_RECORD, GLEIF_RECORD], [required('id', 'hard')]);
    expect(report.batchAccepted).toBe(true);
    expect(report.total).toBe(2);
    expect(report.hardFailures).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('HARD-FAIL: any single hard failure holds back the whole batch — no partial acceptance', () => {
    const records = [GLEIF_RECORD, { attributes: {} }, GLEIF_RECORD]; // one bad among good
    const report = runExpectations(records, [required('id', 'hard')]);
    expect(report.batchAccepted).toBe(false);
    expect(report.hardFailures).toHaveLength(1);
    expect(report.hardFailures[0]).toMatchObject({ expectation: 'required:id', failedCount: 1, sampleIndexes: [1] });
  });

  it('warn-level failures are recorded but never block the batch', () => {
    const report = runExpectations([{ id: 'x' }, {}], [required('id', 'warn')]);
    expect(report.batchAccepted).toBe(true);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatchObject({ expectation: 'required:id', failedCount: 1, sampleIndexes: [1] });
  });

  it('caps sampleIndexes at 5 per expectation while failedCount stays exact', () => {
    const records = Array.from({ length: 8 }, () => ({}));
    const report = runExpectations(records, [required('id', 'hard')]);
    expect(report.hardFailures[0]?.failedCount).toBe(8);
    expect(report.hardFailures[0]?.sampleIndexes).toEqual([0, 1, 2, 3, 4]);
  });

  it('a throwing check() counts as a failure, never crashes the gate', () => {
    const bomb: Expectation = {
      name: 'bomb', level: 'hard', description: 'always throws',
      check() { throw new Error('boom'); },
    };
    const report = runExpectations([{}], [bomb]);
    expect(report.batchAccepted).toBe(false);
    expect(report.hardFailures[0]?.failedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Reusable expectation helpers
// ---------------------------------------------------------------------------

describe('reusable expectation helpers', () => {
  it('required() fails on missing field, null, empty string, and non-object records', () => {
    const exp = required('lei', 'hard');
    expect(exp.check({ lei: 'X' })).toBe(true);
    expect(exp.check({})).toBe(false);
    expect(exp.check({ lei: null })).toBe(false);
    expect(exp.check({ lei: '' })).toBe(false);
    expect(exp.check('not-an-object')).toBe(false);
    expect(exp.check(null)).toBe(false);
  });

  it('required() supports safe dot-path access into nested records', () => {
    const exp = required('attributes.entity', 'warn');
    expect(exp.check(GLEIF_RECORD)).toBe(true);
    expect(exp.check({ attributes: {} })).toBe(false);
    expect(exp.check({ attributes: 'flat' })).toBe(false);
  });

  it('isoTimestamp() rejects bad timestamps and non-strings', () => {
    const exp = isoTimestamp('fetchedAt', 'hard');
    expect(exp.check({ fetchedAt: '2026-07-03T00:00:00.000Z' })).toBe(true);
    expect(exp.check({ fetchedAt: 'not-a-date' })).toBe(false);
    expect(exp.check({ fetchedAt: 1234567890 })).toBe(false);
    expect(exp.check({})).toBe(false);
  });

  it('numericRange() rejects out-of-range and non-numeric values', () => {
    const exp = numericRange('confidence', 0, 1, 'hard');
    expect(exp.check({ confidence: 0.95 })).toBe(true);
    expect(exp.check({ confidence: 0 })).toBe(true);
    expect(exp.check({ confidence: 1.5 })).toBe(false);
    expect(exp.check({ confidence: -0.1 })).toBe(false);
    expect(exp.check({ confidence: 'high' })).toBe(false);
    expect(exp.check({ confidence: NaN })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runConnector
// ---------------------------------------------------------------------------

describe('runConnector', () => {
  it("HARD-FAIL gate: hard failure returns status 'held' and NEVER calls mapper or propose", async () => {
    const deps = makeDeps();
    const def = defWith([{ attributes: {} }], [required('id', 'hard')]);
    const result = await runConnector(def, deps);
    expect(result.status).toBe('held');
    expect(result.report.batchAccepted).toBe(false);
    expect(deps.mapper).not.toHaveBeenCalled();
    expect(deps.propose).not.toHaveBeenCalled();
  });

  it('mixed batch with ONE hard failure among valid records → whole batch held (no partial propagation)', async () => {
    const deps = makeDeps();
    const def = defWith([GLEIF_RECORD, { attributes: {} }, GLEIF_RECORD], [required('id', 'hard')]);
    const result = await runConnector(def, deps);
    expect(result.status).toBe('held');
    expect(deps.mapper).not.toHaveBeenCalled(); // not even for the valid records
    expect(deps.propose).not.toHaveBeenCalled();
  });

  it('warn-only failures still accept the batch and propose', async () => {
    const deps = makeDeps();
    const def = defWith([GLEIF_RECORD, { id: 'LEI-ONLY' }], [required('attributes.entity', 'warn')]);
    const result = await runConnector(def, deps);
    expect(result.status).toBe('proposed');
    expect(result.report.warnings).toHaveLength(1);
    expect(deps.propose).toHaveBeenCalled();
  });

  it('happy path returns proposedCount and only proposed_edit-shaped output (pending create_entity/create_link)', async () => {
    const proposeSpy = vi.fn(governedPropose);
    const deps = makeDeps({ propose: proposeSpy });
    const def = defWith([GLEIF_RECORD], [required('id', 'hard')]);
    const result = await runConnector(def, deps);
    expect(result.status).toBe('proposed');
    if (result.status !== 'proposed') return;
    expect(result.proposedCount).toBeGreaterThan(0);
    const allEdits = proposeSpy.mock.results.flatMap(r => r.value as ProposedEdit[]);
    expect(allEdits).toHaveLength(result.proposedCount);
    for (const edit of allEdits) {
      expect(['create_entity', 'create_link']).toContain(edit.kind);
      expect(edit.status).toBe('pending');
      expect(edit.tenant_id).toBe(TENANT_ID);
    }
  });

  it('a mapper throw on one record is skipped without aborting the batch', async () => {
    const throwingMapper = vi.fn((input: unknown, tenantId: string): MapperResult => {
      if ((input as { id?: string }).id === 'BAD') throw new Error('unmappable');
      return mapGleifRecord(input, tenantId);
    });
    const deps = makeDeps({ mapper: throwingMapper });
    const def = defWith([GLEIF_RECORD, { id: 'BAD' }], []);
    const result = await runConnector(def, deps);
    expect(result.status).toBe('proposed');
    if (result.status !== 'proposed') return;
    expect(result.skippedRecords).toBe(1);
    expect(result.proposedCount).toBeGreaterThan(0);
  });

  it('GOVERNANCE BACKSTOP: a propose fn emitting a non-proposal kind makes the run throw loudly', async () => {
    const rogue = vi.fn((): ProposedEdit[] => ([{
      id: 'x', tenant_id: TENANT_ID,
      kind: 'update_entity' as const, // legal ProposedEdit kind, but not a connector-pipeline output
      payload: {}, proposed_by: 'rogue', rationale: 'direct-ish write', status: 'pending' as const,
      created_at: '2026-07-03T00:00:00.000Z',
    }]));
    const deps = makeDeps({ propose: rogue });
    const def = defWith([GLEIF_RECORD], []);
    await expect(runConnector(def, deps)).rejects.toThrow(/create_entity|create_link|governance/i);
  });

  it("expectation failures never throw — 'held' is a return value, not an exception", async () => {
    const deps = makeDeps();
    const def = defWith([{}], [required('id', 'hard')]);
    await expect(runConnector(def, deps)).resolves.toMatchObject({ status: 'held' });
  });
});

// ---------------------------------------------------------------------------
// GLEIF declarative connector
// ---------------------------------------------------------------------------

describe('gleif connector definition', () => {
  it('is keyed to the existing gleif source and mapper', () => {
    const def = makeGleifConnector(async () => batchOf([]));
    expect(def.sourceKey).toBe('gleif');
    expect(def.mapperKey).toBe('gleif');
    expect(def.expectations.length).toBeGreaterThanOrEqual(2);
  });

  it("expectations match the mapper's true input shape: a record the mapper maps fully passes cleanly", () => {
    const report = runExpectations([GLEIF_RECORD], GLEIF_EXPECTATIONS);
    expect(report.batchAccepted).toBe(true);
    expect(report.warnings).toEqual([]);
    // Cross-check against the actual mapper: same record yields a company with the LEI
    const mapped = mapGleifRecord(GLEIF_RECORD, TENANT_ID);
    const company = (mapped.entities as Entity[]).find(e => e.type === 'company');
    expect(company?.lei).toBe(GLEIF_RECORD.attributes.lei);
  });

  it('hard-fails a record with no LEI (neither attributes.lei nor id) — exactly what the mapper needs', () => {
    const report = runExpectations([{ attributes: { entity: { legalName: { name: 'No LEI Ltd' } } } }], GLEIF_EXPECTATIONS);
    expect(report.batchAccepted).toBe(false);
    expect(report.hardFailures[0]?.expectation).toBe('gleif-lei-present');
  });

  it('only warns (still accepts) when attributes.entity is missing — mapper tolerates it', () => {
    const report = runExpectations([{ id: '5493001KJTIIGC8Y1R12', attributes: { lei: '5493001KJTIIGC8Y1R12' } }], GLEIF_EXPECTATIONS);
    expect(report.batchAccepted).toBe(true);
    expect(report.warnings).toHaveLength(1);
    // Mapper indeed still produces an entity from such a record (lei-only)
    const mapped = mapGleifRecord({ id: '5493001KJTIIGC8Y1R12', attributes: { lei: '5493001KJTIIGC8Y1R12' } }, TENANT_ID);
    expect((mapped.entities as Entity[])[0]?.lei).toBe('5493001KJTIIGC8Y1R12');
  });

  it('end-to-end through runConnector: gleif hard failure holds the batch before mapper/propose', async () => {
    const deps = makeDeps();
    const def = makeGleifConnector(async () => batchOf([GLEIF_RECORD, { attributes: {} }]));
    const result = await runConnector(def, deps);
    expect(result.status).toBe('held');
    expect(deps.mapper).not.toHaveBeenCalled();
    expect(deps.propose).not.toHaveBeenCalled();
  });
});
