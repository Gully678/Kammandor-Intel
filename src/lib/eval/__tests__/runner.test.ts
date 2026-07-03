/**
 * KINTEL v2 — evaluation runner tests (PRD v2.0 §9.7 / §15.8)
 *
 * Covers the founder decision (FOUNDER_DECISIONS_v2_2026-07-03):
 * per-capability pass bars with a HARD FLOOR of 0.8 — a suite may declare
 * a higher bar, never a lower one. The floor is structural in runSuite,
 * not a convention.
 */

import { describe, expect, it } from 'vitest';
import type { EvalRunRow, GoldSuite } from '../types';
import { EVAL_PASS_FLOOR, gateOrThrow, persistRun, runSuite } from '../runner';

/** Build a trivial numeric-echo suite where `input === expected` passes. */
function echoSuite(
  bar: number,
  cases: Array<{ id: string; input: number; expected: number; note?: string }>,
): GoldSuite<number, number> {
  return {
    suite: 'echo-suite',
    capability: 'echo',
    bar,
    cases,
    run: (input) => input,
    score: (actual, expected) => actual === expected,
  };
}

describe('runSuite — structural 0.8 floor', () => {
  it('exports the founder floor as 0.8', () => {
    expect(EVAL_PASS_FLOOR).toBe(0.8);
  });

  it('raises a suite-declared bar below 0.8 up to the floor', async () => {
    const suite = echoSuite(0.5, [
      { id: 'a', input: 1, expected: 1 },
      { id: 'b', input: 2, expected: 2 },
    ]);
    const result = await runSuite(suite);
    expect(result.bar).toBe(0.8);
    expect(result.floorMet).toBe(true);
    expect(result.passRate).toBe(1);
  });

  it('a pass rate above a lowered bar but below the floor still fails the gate', async () => {
    // 3/4 = 0.75 — above the suite's illegal 0.5 bar, below the 0.8 floor.
    const suite = echoSuite(0.5, [
      { id: 'a', input: 1, expected: 1 },
      { id: 'b', input: 2, expected: 2 },
      { id: 'c', input: 3, expected: 3 },
      { id: 'd', input: 4, expected: 999, note: 'deliberate gold mismatch' },
    ]);
    const result = await runSuite(suite);
    expect(result.passRate).toBe(0.75);
    expect(result.bar).toBe(0.8);
    expect(result.floorMet).toBe(false);
    expect(result.failures).toEqual([{ id: 'd', note: 'deliberate gold mismatch' }]);
  });

  it('keeps a suite-declared bar HIGHER than the floor', async () => {
    const cases = Array.from({ length: 8 }, (_, i) => ({
      id: `case-${String(i)}`,
      input: i,
      expected: i === 7 ? -1 : i, // 7/8 = 0.875
    }));
    const result = await runSuite(echoSuite(0.9, cases));
    expect(result.bar).toBe(0.9);
    expect(result.passRate).toBe(0.875);
    expect(result.floorMet).toBe(false);
  });

  it('lists every failing case id, supports async run(), and counts a thrown case as a failure', async () => {
    const suite: GoldSuite<number, number> = {
      suite: 'async-suite',
      capability: 'echo-async',
      bar: 0.8,
      cases: [
        { id: 'ok', input: 1, expected: 1 },
        { id: 'wrong', input: 2, expected: 3 },
        { id: 'boom', input: -1, expected: -1, note: 'capability throws' },
      ],
      run: async (input) => {
        if (input < 0) throw new Error('capability exploded');
        return input;
      },
      score: (actual, expected) => actual === expected,
    };
    const result = await runSuite(suite);
    expect(result.total).toBe(3);
    expect(result.passed).toBe(1);
    expect(result.floorMet).toBe(false);
    expect(result.failures.map((f) => f.id)).toEqual(['wrong', 'boom']);
  });
});

describe('gateOrThrow — the release-gate primitive', () => {
  it('throws the exact EVAL GATE FAILED message when the floor is not met', async () => {
    const result = await runSuite(
      echoSuite(0.8, [
        { id: 'a', input: 1, expected: 1 },
        { id: 'b', input: 2, expected: 99 },
      ]),
    );
    expect(result.floorMet).toBe(false);
    expect(() => gateOrThrow(result)).toThrowError(
      'EVAL GATE FAILED: echo-suite 0.5 < 0.8',
    );
  });

  it('does not throw when the floor is met', async () => {
    const result = await runSuite(echoSuite(0.8, [{ id: 'a', input: 1, expected: 1 }]));
    expect(() => gateOrThrow(result)).not.toThrow();
  });
});

describe('persistRun — row shape matches intel_0018 (intel.eval_run)', () => {
  it('maps the result to EXACTLY the intel.eval_run insert columns', async () => {
    const result = await runSuite(
      echoSuite(0.8, [
        { id: 'a', input: 1, expected: 1 },
        { id: 'b', input: 2, expected: 2 },
        { id: 'c', input: 3, expected: 4, note: 'gold mismatch' },
        { id: 'd', input: 4, expected: 4 },
      ]),
    );

    const inserted: EvalRunRow[] = [];
    const row = await persistRun(result, async (r) => {
      inserted.push(r);
    }, 'abc1234');

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toBe(row);
    // Exact column set from migrations/intel/0018_eval_run_persistence.sql
    // (id and ran_at are DB-generated and must NOT be sent).
    expect(Object.keys(row).sort()).toEqual(
      ['capability', 'floor_met', 'git_sha', 'pass_rate', 'passed', 'results', 'suite', 'total'].sort(),
    );
    expect(row).toEqual({
      suite: 'echo-suite',
      capability: 'echo',
      git_sha: 'abc1234',
      total: 4,
      passed: 3,
      pass_rate: 0.75,
      floor_met: false,
      results: [{ id: 'c', note: 'gold mismatch' }],
    });
  });

  it('defaults git_sha to null when no sha is supplied', async () => {
    const result = await runSuite(echoSuite(0.8, [{ id: 'a', input: 1, expected: 1 }]));
    const row = await persistRun(result, async () => undefined);
    expect(row.git_sha).toBeNull();
    expect(row.floor_met).toBe(true);
    expect(row.pass_rate).toBe(1);
    expect(row.results).toEqual([]);
  });
});
