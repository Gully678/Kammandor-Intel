/**
 * KINTEL v2 — evaluation framework types (PRD v2.0 §9.7 / §15.8)
 *
 * PURE MODULE: value types only — no I/O, no DB coupling. The framework's
 * core contract is "no AI capability ships without a passing gold-suite
 * run": a GoldSuite pins a capability's behaviour to hand-authored
 * gold-standard cases, and the runner (runner.ts) enforces the founder's
 * structural 0.8 pass floor (FOUNDER_DECISIONS_v2_2026-07-03 — a suite may
 * declare a HIGHER bar, never a lower one).
 *
 * Persistence is INJECTED (see persistRun in runner.ts): this module never
 * imports a DB client. EvalRunRow mirrors the writable columns of
 * intel.eval_run (migrations/intel/0018_eval_run_persistence.sql) exactly.
 */

/** One hand-authored gold-standard case: an input with its unambiguous expected output. */
export interface GoldCase<I, O> {
  /** Stable, human-readable case id — appears in failure lists and run history. */
  id: string;
  input: I;
  expected: O;
  /** Optional plain-language note on what behaviour the case pins down. */
  note?: string;
}

/**
 * A gold-standard evaluation suite for one capability under test.
 *
 * `run` invokes the capability (sync or async); `score` decides whether the
 * actual output matches the gold expectation. Both must be deterministic —
 * gold suites never depend on network, time, or randomness.
 */
export interface GoldSuite<I, O> {
  /** Suite identifier, e.g. 'signals-match' — the intel.eval_run.suite value. */
  suite: string;
  /** Capability under test, e.g. 'matchSignals' — the intel.eval_run.capability value. */
  capability: string;
  /**
   * Suite-declared pass bar (0–1). The runner enforces
   * max(bar, 0.8): the 0.8 floor is structural and cannot be lowered.
   */
  bar: number;
  cases: GoldCase<I, O>[];
  run(input: I): O | Promise<O>;
  score(actual: O, expected: O): boolean;
}

/** A failing gold case, referenced by id (plus its note when the author gave one). */
export interface EvalCaseFailure {
  id: string;
  note?: string;
}

/** The outcome of one runSuite() execution. */
export interface EvalRunResult {
  suite: string;
  capability: string;
  /** Number of gold cases executed. */
  total: number;
  /** Number of gold cases whose actual output matched the expectation. */
  passed: number;
  /** passed / total (0 when the suite has no cases). */
  passRate: number;
  /** Effective bar actually applied: max(suite.bar, 0.8). */
  bar: number;
  /** True when passRate >= bar — the ship/no-ship signal. */
  floorMet: boolean;
  failures: EvalCaseFailure[];
}

/**
 * Insert shape for one intel.eval_run row — key-for-key the writable columns
 * of migration intel_0018 (id and ran_at are DB-generated and never sent).
 */
export interface EvalRunRow {
  suite: string;
  capability: string;
  git_sha: string | null;
  total: number;
  passed: number;
  /** 0–1, matching the pass_rate CHECK constraint. */
  pass_rate: number;
  floor_met: boolean;
  /** The failing-case detail persisted as jsonb (empty array on a clean run). */
  results: EvalCaseFailure[];
}

/**
 * Injected persistence function. In production this is a raw-PostgREST
 * service-role insert into intel.eval_run (the same server-side pattern as
 * insertProposedEdits in src/app/api/ontology/ingest/route.ts, with
 * 'Content-Profile': 'intel'); in tests it is an in-memory capture. The
 * runner core stays pure either way.
 */
export type EvalRunInsert = (row: EvalRunRow) => Promise<void>;
