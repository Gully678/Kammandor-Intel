/**
 * KINTEL v2 — governed agent runner (PRD v2.0 §9.1 / §13.1)
 *
 * PURE MODULE: no network, no DB, no LLM. Persistence is INJECTED via
 * deps.persist (mirroring src/lib/eval/runner.ts's persistRun pattern), so
 * the governance core is unit-testable in isolation.
 *
 * ── WHAT THE RUNNER GUARANTEES ──────────────────────────────────────────
 * 1. LEAST PRIVILEGE (structural): the body receives a frozen object holding
 *    ONLY the agent's declared tool binding — wrapped, key-for-key. A tool
 *    outside the binding does not exist in the body's scope, at the type
 *    level or at runtime. The runner never adds tools of its own.
 * 2. SHOW RAW (§13.1): every wrapped invocation appends an AgentToolCall
 *    (tool name, timestamp, ok flag, shape-only summary — never raw
 *    payloads/secrets) to the run's trace, in call order.
 * 3. NO SILENT FAILURE: success persists a 'succeeded' intel.agent_run row;
 *    any throw persists a 'failed' row (error message + partial trace) and
 *    the original error is RETHROWN to the caller.
 */

import type {
  AgentDef,
  AgentRunRecord,
  AgentRunResult,
  AgentToolCall,
  AgentTriggerKind,
  AnyAgentTool,
  ToolBinding,
  TracePersist,
  WrappedTools,
} from './types';

/** Per-run context: who it is for, what started it, and its input payload. */
export interface AgentRunContext {
  tenantId: string | null;
  trigger: AgentTriggerKind;
  input: unknown;
}

/** Injected dependencies — persistence is mandatory, the clock is optional. */
export interface AgentRunDeps {
  persist: TracePersist;
  now?: () => Date;
}

/** Longest error text carried into a tool-call summary. */
const SUMMARY_ERROR_MAX_LENGTH = 200;

/**
 * Shape-only description of a tool result for the lineage trace.
 * Deliberately NEVER includes the value itself: counts and types only, so
 * secrets, figures, and raw document text can never leak into the trace
 * (§13.1 — the full input/output of the RUN is persisted separately and
 * deliberately; per-call summaries stay safe by construction).
 */
export function summariseResult(value: unknown): string {
  if (value === undefined || value === null) return 'returned no value';
  if (Array.isArray(value)) {
    return `returned a list of ${String(value.length)} item(s)`;
  }
  switch (typeof value) {
    case 'string':
      return `returned text (${String(value.length)} characters)`;
    case 'number':
      return 'returned a number';
    case 'boolean':
      return 'returned a yes/no value';
    case 'object':
      return `returned a record with ${String(Object.keys(value as object).length)} field(s)`;
    default:
      return `returned a ${typeof value}`;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wrap one bound tool so every invocation appends to the trace before the
 * result (or error) reaches the body. The wrapped tool keeps the original
 * name/description and call signature.
 */
function wrapTool(
  tool: AnyAgentTool,
  trace: AgentToolCall[],
  now: () => Date,
): AnyAgentTool {
  return {
    name: tool.name,
    description: tool.description,
    invoke: async (input: never): Promise<unknown> => {
      const at = now().toISOString();
      try {
        const output = await tool.invoke(input);
        trace.push({ tool: tool.name, at, ok: true, summary: summariseResult(output) });
        return output;
      } catch (err) {
        const truncated = errorMessage(err).slice(0, SUMMARY_ERROR_MAX_LENGTH);
        trace.push({ tool: tool.name, at, ok: false, summary: `failed: ${truncated}` });
        throw err;
      }
    },
  };
}

/**
 * Build the body's tool surface: EXACTLY the declared binding keys, each
 * wrapped for tracing, frozen so nothing can be added or replaced mid-run.
 */
function wrapBinding<TTools extends ToolBinding>(
  tools: TTools,
  trace: AgentToolCall[],
  now: () => Date,
): WrappedTools<TTools> {
  const wrapped: Record<string, AnyAgentTool> = {};
  for (const key of Object.keys(tools)) {
    const tool = tools[key];
    if (tool === undefined) continue; // unreachable for own keys; satisfies strict indexing
    wrapped[key] = wrapTool(tool, trace, now);
  }
  return Object.freeze(wrapped) as WrappedTools<TTools>;
}

/**
 * Execute one governed agent run.
 *
 * The body receives ONLY the agent's wrapped tool binding. On success a
 * 'succeeded' intel.agent_run row (migration intel_0019 — exact writable
 * columns) is persisted and the result returned; on any throw a 'failed'
 * row is persisted and the original error is rethrown. Never silent.
 */
export async function runAgent<TTools extends ToolBinding>(
  def: AgentDef<TTools>,
  run: AgentRunContext,
  deps: AgentRunDeps,
  body: (tools: WrappedTools<TTools>) => Promise<unknown>,
): Promise<AgentRunResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const toolCalls: AgentToolCall[] = [];
  const tools = wrapBinding(def.tools, toolCalls, now);

  const baseRecord = {
    agent_key: def.key,
    tenant_id: run.tenantId,
    trigger_kind: run.trigger,
    input: run.input,
    started_at: startedAt,
  } as const;

  try {
    const output = await body(tools);
    const record: AgentRunRecord = {
      ...baseRecord,
      status: 'succeeded',
      tool_calls: toolCalls,
      output,
      error: null,
      finished_at: now().toISOString(),
    };
    await deps.persist(record);
    return { status: 'succeeded', output, toolCalls };
  } catch (err) {
    const record: AgentRunRecord = {
      ...baseRecord,
      status: 'failed',
      tool_calls: toolCalls,
      output: null,
      error: errorMessage(err),
      finished_at: now().toISOString(),
    };
    try {
      await deps.persist(record);
    } catch {
      // The lineage insert itself failed. The agent's ORIGINAL error must
      // still reach the caller (rethrow below) — losing it behind a
      // persistence error would be exactly the silent failure §13.1 bans.
    }
    throw err;
  }
}
