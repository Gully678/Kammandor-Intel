/**
 * KINTEL v2 — governed agent structure types (PRD v2.0 §9.1 / §13.1)
 *
 * PURE MODULE: types only — no network, no DB, no LLM.
 *
 * ── GOVERNANCE LAWS ENCODED HERE ────────────────────────────────────────
 * 1. LEAST PRIVILEGE IS STRUCTURAL. An agent's tools live in its AgentDef
 *    binding and NOWHERE else: the runner hands the body a wrapped object
 *    with exactly the declared keys (WrappedTools is a mapped type over the
 *    binding, so an undeclared tool is a compile-time error AND absent at
 *    runtime). Nothing implicit is ever in scope.
 * 2. SHOW RAW (§13.1). Every tool invocation is traced (AgentToolCall) and
 *    every run persists an AgentRunRecord mirroring the writable columns of
 *    intel.agent_run (migration intel_0019) — the regulator-facing lineage.
 * 3. PERSISTENCE IS INJECTED (TracePersist) so this core stays pure and
 *    unit-testable, mirroring src/lib/eval/runner.ts's persistRun pattern.
 */

/** A single named capability an agent may call. I/O typed end-to-end. */
export interface AgentTool<I = unknown, O = unknown> {
  /** Stable tool name — appears verbatim in the per-invocation trace. */
  name: string;
  /** Plain-language description of what the tool does (no schema jargon). */
  description: string;
  invoke(input: I): Promise<O> | O;
}

/**
 * Widest tool shape, used only as a binding constraint. `invoke` is declared
 * in method position, so concrete AgentTool<I, O> members check bivariantly
 * against it — no `any` required anywhere in the structure.
 */
export type AnyAgentTool = AgentTool<never, unknown>;

/** A complete tool binding: every capability the agent may EVER call. */
export type ToolBinding = Record<string, AnyAgentTool>;

/** Routing tier for an agent (cost/latency class — never a privilege class). */
export type AgentTier = 'fast' | 'balanced' | 'critical';

/**
 * A governed agent definition. `tools` is the COMPLETE binding — the runner
 * passes only these to the body; nothing else is in scope (§9.1).
 */
export interface AgentDef<TTools extends ToolBinding = ToolBinding> {
  /** Registry key; persisted as intel.agent_run.agent_key. */
  key: string;
  /** What this agent exists to do, in plain language. */
  purpose: string;
  tier: AgentTier;
  tools: TTools;
}

/**
 * The exact tool surface a body receives: the declared binding keys, frozen,
 * each invocation traced. Same call signatures as the underlying tools.
 */
export type WrappedTools<TTools extends ToolBinding = ToolBinding> = {
  readonly [K in keyof TTools]: TTools[K];
};

/** What started this run — mirrors the intel_0019 trigger_kind CHECK. */
export type AgentTriggerKind = 'scheduled' | 'event' | 'manual';

/** Terminal statuses a persisted run can carry ('running' is DB-default only). */
export type AgentRunStatus = 'succeeded' | 'failed';

/** One traced tool invocation (§13.1 show raw — safe summary, never raw payloads). */
export interface AgentToolCall {
  /** The tool's declared name. */
  tool: string;
  /** ISO-8601 timestamp of the invocation (from the injected clock). */
  at: string;
  /** Whether the tool returned normally. */
  ok: boolean;
  /** Shape-only summary of the outcome — NEVER raw content or secrets. */
  summary?: string;
}

/**
 * Exact insert shape for one intel.agent_run row (migration intel_0019).
 * Carries EXACTLY the writable columns — `id` is a DB identity column.
 * Key order/names must never drift from the migration.
 */
export interface AgentRunRecord {
  agent_key: string;
  tenant_id: string | null;
  trigger_kind: AgentTriggerKind;
  status: AgentRunStatus;
  input: unknown;
  tool_calls: AgentToolCall[];
  output: unknown;
  error: string | null;
  started_at: string;
  finished_at: string;
}

/** What runAgent returns to its caller (the persisted row is the source of truth). */
export interface AgentRunResult {
  status: AgentRunStatus;
  output: unknown;
  toolCalls: AgentToolCall[];
  error?: string;
}

/**
 * Injected persistence for the lineage row. In production this is a
 * service-role insert into intel.agent_run (the persistRun/insert pattern in
 * src/lib/eval/runner.ts); in tests it is an in-memory capture.
 */
export type TracePersist = (record: AgentRunRecord) => Promise<void>;
