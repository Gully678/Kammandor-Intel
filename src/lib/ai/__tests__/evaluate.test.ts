/**
 * KINTEL Slice 4 — evaluate() eval-gate unit tests
 *
 * Pure function tests: no LLM/network/DB involved. Confirms evaluate()
 * enforces structure, type validity, grounding, risk range, and confidence
 * per the Slice 4 brief, and that the optional second (`context`) argument
 * is genuinely optional (single-arg callers keep compiling/passing).
 */

import { describe, it, expect } from 'vitest';
import { evaluate } from '../analyze';
import type { ProposedEdit } from '@/lib/ontology/types';

// ─── fixtures ──────────────────────────────────────────────────────────────

const TENANT = 'tenant-test';

// Well-formed UUIDs (matches propose.ts crypto.randomUUID() shape and the
// mappers' pseudoUuid() fixtures: 8-4-4-4-12 hex, case-insensitive).
const ENTITY_A = '11111111-0000-4000-8000-000000000001';
const ENTITY_B = '22222222-0000-4000-8000-000000000002';
const UNKNOWN_ENTITY = '99999999-0000-4000-8000-000000000009';

function baseEdit(overrides: Partial<ProposedEdit> = {}): ProposedEdit {
  return {
    id:          'edit-001',
    tenant_id:   TENANT,
    kind:        'create_entity',
    payload:     { type: 'company', canonical_name: 'Acme Corp', properties: {} },
    proposed_by: 'ai-moe-analyzer',
    rationale:   'Found in filing.',
    status:      'pending',
    created_at:  new Date().toISOString(),
    ...overrides,
  };
}

function createLinkEdit(overrides: Partial<ProposedEdit> = {}): ProposedEdit {
  return baseEdit({
    kind: 'create_link',
    payload: {
      tenant_id:        TENANT,
      source_entity_id: ENTITY_A,
      target_entity_id: ENTITY_B,
      type:             'isDirectorOf',
      strength:         null,
      properties:       {},
    },
    ...overrides,
  });
}

// ─── backward compatibility (single-arg call) ───────────────────────────────

describe('evaluate() — backward compatibility', () => {
  it('accepts a single argument (no context) and still returns a result', () => {
    const result = evaluate(baseEdit());
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('checks');
    expect(Array.isArray(result.checks)).toBe(true);
  });

  it('passes a well-formed create_entity with no context at all', () => {
    const result = evaluate(baseEdit());
    expect(result.passed).toBe(true);
  });
});

// ─── passing cases ───────────────────────────────────────────────────────────

describe('evaluate() — passing proposals', () => {
  it('passes a well-formed create_entity proposal', () => {
    const result = evaluate(baseEdit());
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.checks.some((c) => c.startsWith('PASS'))).toBe(true);
  });

  it('passes a well-formed create_link proposal with grounding satisfied', () => {
    const edit = createLinkEdit();
    const result = evaluate(edit, {
      knownEntityIds: new Set([ENTITY_A, ENTITY_B]),
    });
    expect(result.passed).toBe(true);
    expect(result.checks.some((c) => c.includes('grounded'))).toBe(true);
  });

  it('passes a well-formed create_link proposal when knownEntityIds is an array', () => {
    const edit = createLinkEdit();
    const result = evaluate(edit, {
      knownEntityIds: [ENTITY_A, ENTITY_B],
    });
    expect(result.passed).toBe(true);
  });

  it('passes a create_link with well-formed UUIDs when no knownEntityIds context is given', () => {
    // Grounding against a known-id set is only enforced when the caller
    // supplies one; UUID well-formedness is still checked either way.
    const edit = createLinkEdit();
    const result = evaluate(edit);
    expect(result.passed).toBe(true);
  });
});

// ─── hard-fail cases ─────────────────────────────────────────────────────────

describe('evaluate() — hard failures', () => {
  it('fails when payload is not an object', () => {
    const edit = baseEdit({ payload: null as unknown as Record<string, unknown> });
    const result = evaluate(edit);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.includes('payload is not an object'))).toBe(true);
  });

  it('fails create_entity when required field "type" is missing', () => {
    const edit = baseEdit({ payload: { canonical_name: 'No Type Co' } });
    const result = evaluate(edit);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.includes('missing required field "type"'))).toBe(true);
  });

  it('fails create_entity when "type" is not a valid ObjectType', () => {
    const edit = baseEdit({ payload: { type: 'spaceship', properties: {} } });
    const result = evaluate(edit);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.includes('not a valid ObjectType'))).toBe(true);
  });

  it('fails create_link when required fields are missing', () => {
    const edit = baseEdit({
      kind: 'create_link',
      payload: { type: 'isDirectorOf' }, // missing source/target
    });
    const result = evaluate(edit);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.includes('missing required field(s)'))).toBe(true);
    expect(result.checks.some((c) => c.includes('source_entity_id'))).toBe(true);
    expect(result.checks.some((c) => c.includes('target_entity_id'))).toBe(true);
  });

  it('fails create_link when "type" is not a valid LinkType', () => {
    const edit = createLinkEdit({
      payload: {
        source_entity_id: ENTITY_A,
        target_entity_id: ENTITY_B,
        type: 'friendsWith', // not in LinkType
      },
    });
    const result = evaluate(edit);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.includes('not a valid LinkType'))).toBe(true);
  });

  it('fails create_link when source_entity_id is not a well-formed UUID', () => {
    const edit = createLinkEdit({
      payload: {
        source_entity_id: 'not-a-uuid',
        target_entity_id: ENTITY_B,
        type: 'isDirectorOf',
      },
    });
    const result = evaluate(edit);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.includes('is not a well-formed UUID'))).toBe(true);
  });

  it('fails create_link when target_entity_id does not match any known entity (dangling link)', () => {
    const edit = createLinkEdit({
      payload: {
        source_entity_id: ENTITY_A,
        target_entity_id: UNKNOWN_ENTITY,
        type: 'isDirectorOf',
      },
    });
    const result = evaluate(edit, { knownEntityIds: new Set([ENTITY_A, ENTITY_B]) });
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.includes('would dangle'))).toBe(true);
  });

  it('fails when payload.risk_score is out of the [0, 10] range (create_entity)', () => {
    const edit = baseEdit({ payload: { type: 'company', risk_score: 15, properties: {} } });
    const result = evaluate(edit);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.includes('outside the valid range [0, 10]'))).toBe(true);
  });

  it('fails when payload.risk_score is negative', () => {
    const edit = baseEdit({ payload: { type: 'company', risk_score: -1, properties: {} } });
    const result = evaluate(edit);
    expect(result.passed).toBe(false);
  });

  it('fails when patch.risk_score is out of range for an update_entity proposal', () => {
    // update_entity/update_link payloads are shaped `{ id, patch }` by
    // propose.ts's proposeUpdate() — evaluate() must look under patch too.
    const edit = baseEdit({
      kind: 'update_entity',
      payload: { id: ENTITY_A, patch: { risk_score: 999, risk_category: 'critical' } },
    });
    const result = evaluate(edit);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.includes('outside the valid range [0, 10]'))).toBe(true);
  });

  it('fails when risk_score is not a number', () => {
    const edit = baseEdit({ payload: { type: 'company', risk_score: 'high', properties: {} } });
    const result = evaluate(edit);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.includes('is not a finite number'))).toBe(true);
  });

  it('fails on an unknown proposal kind', () => {
    const edit = baseEdit({ kind: 'delete_entity' as unknown as ProposedEdit['kind'] });
    const result = evaluate(edit);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.includes('unknown kind'))).toBe(true);
  });

  it('passes risk_score at the exact boundaries 0 and 10', () => {
    const low = evaluate(baseEdit({ payload: { type: 'company', risk_score: 0, properties: {} } }));
    const high = evaluate(baseEdit({ payload: { type: 'company', risk_score: 10, properties: {} } }));
    expect(low.passed).toBe(true);
    expect(high.passed).toBe(true);
  });
});

// ─── confidence (soft) ───────────────────────────────────────────────────────

describe('evaluate() — confidence threshold (soft)', () => {
  it('passes but scores lower when confidence is below the default threshold (0.3)', () => {
    const edit = baseEdit({ payload: { type: 'company', confidence: 0.1, properties: {} } });
    const withLowConfidence = evaluate(edit);
    const withoutConfidenceField = evaluate(baseEdit());

    expect(withLowConfidence.passed).toBe(true); // soft — does not hard-fail
    expect(withLowConfidence.checks.some((c) => c.includes('below threshold'))).toBe(true);
    expect(withLowConfidence.score).toBeLessThan(withoutConfidenceField.score);
  });

  it('passes cleanly when confidence meets a caller-supplied minConfidence', () => {
    const edit = baseEdit({ payload: { type: 'company', confidence: 0.5, properties: {} } });
    const result = evaluate(edit, { minConfidence: 0.4 });
    expect(result.passed).toBe(true);
    expect(result.checks.some((c) => c.includes('meets threshold 0.4'))).toBe(true);
  });

  it('flags confidence that meets the default threshold but fails a stricter caller-supplied one', () => {
    const edit = baseEdit({ payload: { type: 'company', confidence: 0.5, properties: {} } });
    const result = evaluate(edit, { minConfidence: 0.9 });
    expect(result.passed).toBe(true); // still soft
    expect(result.checks.some((c) => c.includes('below threshold 0.9'))).toBe(true);
  });

  it('reads confidence from a nested provenance.confidence field too', () => {
    const edit = baseEdit({
      payload: { type: 'company', provenance: { confidence: 0.05 }, properties: {} },
    });
    const result = evaluate(edit);
    expect(result.checks.some((c) => c.includes('below threshold'))).toBe(true);
  });

  it('does not penalize when no confidence value is present at all', () => {
    const result = evaluate(baseEdit());
    expect(result.checks.some((c) => c.toLowerCase().includes('confidence'))).toBe(false);
  });
});

// ─── rationale (soft, retained from pre-Slice-4 stub) ───────────────────────

describe('evaluate() — rationale (soft)', () => {
  it('warns but does not hard-fail on empty rationale', () => {
    const edit = baseEdit({ rationale: '' });
    const result = evaluate(edit);
    expect(result.passed).toBe(true);
    expect(result.checks.some((c) => c.includes('rationale is empty'))).toBe(true);
  });
});
