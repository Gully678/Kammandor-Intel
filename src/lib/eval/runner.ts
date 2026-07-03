/**
 * KINTEL v2 — gold-suite evaluation runner (PRD v2.0 §9.7 / §15.8)
 *
 * PURE MODULE: no network, no DB, no LLM. Persistence is injected via
 * persistRun's `insert` parameter so the core stays unit-testable in
 * isolation (mirrors src/lib/signals/match.ts's pure-module pattern).
 *
 * ── THE FLOOR IS STRUCTURAL ─────────────────────────────────────────────
 * Founder decision (FOUNDER_DECISIONS_v2_2026-07-03): every capability has
 * a pass bar with a HARD FLOOR of 0.8. A suite may declare a higher bar; a
 * lower declaration is silently raised to 0.8 here — no suite author, flag,
 * or caller can ship below the floor. "Eval before ship, always":
 * gateOrThrow(result) is the release-gate primitive that CI/release steps
 * call before any capability change goes out.
 */

import type {
  EvalCaseFailure,
  EvalRunInsert,
  EvalRunResult,
  EvalRunRow,
  GoldSuite,
} from './types';

/** The founder-set hard floor: no capability ships below an 80% gold-case pass rate. */
export const EVAL_PASS_FLOOR = 0.8;

/**
 * Execute every gold case in a suite against its capability.
 *
 * - Effective bar = max(suite.bar, EVAL_PASS_FLOOR) — the floor cannot be lowered.
 * - floorMet = passRate >= bar.
 * - A case whose run() throws is a FAILED case, never a crashed run — a
 *   broken capability must surface as a failing eval, not a missing one.
 * - Failures are listed by case id (with the author's note when present).
 */
export async function runSuite<I, O>(suite: GoldSuite<I, O>): Promise<EvalRunResult> {
  const bar = Math.max(suite.bar, EVAL_PASS_FLOOR);

  let passed = 0;
  const failures: EvalCaseFailure[] = [];

  for (const goldCase of suite.cases) {
    let caseOk = false;
    try {
      const actual = await suite.run(goldCase.input);
      caseOk = suite.score(actual, goldCase.expected);
    } catch {
      caseOk = false;
    }

    if (caseOk) {
      passed += 1;
    } else {
      failures.push(
        goldCase.note === undefined
          ? { id: goldCase.id }
          : { id: goldCase.id, note: goldCase.note },
      );
    }
  }

  const total = suite.cases.length;
  // An empty suite proves nothing — it can never meet the floor.
  const passRate = total === 0 ? 0 : passed / total;

  return {
    suite: suite.suite,
    capability: suite.capability,
    total,
    passed,
    passRate,
    bar,
    floorMet: passRate >= bar,
    failures,
  };
}

/**
 * Map a run result to an intel.eval_run row (migration intel_0018) and hand
 * it to the injected `insert`. The row carries EXACTLY the writable columns
 * — id and ran_at are DB-generated. In production, `insert` is a raw
 * PostgREST service-role POST to `${SUPABASE_URL}/rest/v1/eval_run` with
 * 'Content-Profile': 'intel' (the insertProposedEdits pattern in
 * src/app/api/ontology/ingest/route.ts); the core here stays pure.
 *
 * Returns the row that was inserted, for logging/inspection.
 */
export async function persistRun(
  result: EvalRunResult,
  insert: EvalRunInsert,
  gitSha?: string,
): Promise<EvalRunRow> {
  const row: EvalRunRow = {
    suite: result.suite,
    capability: result.capability,
    git_sha: gitSha ?? null,
    total: result.total,
    passed: result.passed,
    pass_rate: result.passRate,
    floor_met: result.floorMet,
    results: result.failures.map((f) => ({ ...f })),
  };
  await insert(row);
  return row;
}

/**
 * The release-gate primitive: "eval before ship, always."
 * Throws when the suite's pass rate did not meet its bar; a release/CI step
 * that calls this cannot proceed past a failing evaluation.
 */
export function gateOrThrow(result: EvalRunResult): void {
  if (!result.floorMet) {
    throw new Error(
      `EVAL GATE FAILED: ${result.suite} ${String(result.passRate)} < ${String(result.bar)}`,
    );
  }
}
