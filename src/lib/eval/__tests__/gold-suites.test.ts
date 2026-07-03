/**
 * KINTEL v2 — gold suites ARE part of CI (PRD v2.0 §9.7)
 *
 * "Eval before ship, always": both gold-standard suites are executed inside
 * vitest on every run. A capability regression that breaks a gold case
 * fails CI here, not in production.
 */

import { describe, expect, it } from 'vitest';
import { gateOrThrow, runSuite } from '../runner';
import { signalsMatchSuite } from '../suites/signals-match.suite';
import { entityResolutionSuite } from '../suites/entity-resolution.suite';

describe('gold suite: signals-match (matchSignals severity contract)', () => {
  it('has at least 8 gold cases and a bar no lower than the 0.8 floor', () => {
    expect(signalsMatchSuite.cases.length).toBeGreaterThanOrEqual(8);
    expect(signalsMatchSuite.bar).toBeGreaterThanOrEqual(0.8);
  });

  it('passes every gold case (passRate === 1, floorMet true) and clears the gate', async () => {
    const result = await runSuite(signalsMatchSuite);
    expect(result.failures).toEqual([]);
    expect(result.passRate).toBe(1);
    expect(result.floorMet).toBe(true);
    expect(result.total).toBe(signalsMatchSuite.cases.length);
    expect(result.passed).toBe(result.total);
    expect(() => gateOrThrow(result)).not.toThrow();
  });
});

describe('gold suite: entity-resolution (findMergeCandidates contract)', () => {
  it('has at least 8 gold cases and a bar no lower than the 0.8 floor', () => {
    expect(entityResolutionSuite.cases.length).toBeGreaterThanOrEqual(8);
    expect(entityResolutionSuite.bar).toBeGreaterThanOrEqual(0.8);
  });

  it('passes every gold case (passRate === 1, floorMet true) and clears the gate', async () => {
    const result = await runSuite(entityResolutionSuite);
    expect(result.failures).toEqual([]);
    expect(result.passRate).toBe(1);
    expect(result.floorMet).toBe(true);
    expect(result.total).toBe(entityResolutionSuite.cases.length);
    expect(result.passed).toBe(result.total);
    expect(() => gateOrThrow(result)).not.toThrow();
  });
});
