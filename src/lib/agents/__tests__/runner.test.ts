/**
 * KINTEL v2 — governed agent runner tests (PRD v2.0 §9.1 / §13.1)
 *
 * The runner is the governance boundary: every tool invocation is traced,
 * every run persists a lineage row shaped exactly like intel.agent_run
 * (migration intel_0019), and failures are persisted AND rethrown — never
 * swallowed. Persistence is injected so the core stays pure.
 */

import { describe, expect, it } from 'vitest';
import { runAgent } from '../runner';
import type {
  AgentDef,
  AgentRunRecord,
  AgentTool,
  TracePersist,
} from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function capturePersist(): { rows: AgentRunRecord[]; persist: TracePersist } {
  const rows: AgentRunRecord[] = [];
  const persist: TracePersist = (record) => {
    rows.push(record);
    return Promise.resolve();
  };
  return { rows, persist };
}

const double: AgentTool<number, number> = {
  name: 'double',
  description: 'Doubles a number',
  invoke: (n) => n * 2,
};

const shout: AgentTool<string, string> = {
  name: 'shout',
  description: 'Uppercases text',
  invoke: (s) => s.toUpperCase(),
};

const explode: AgentTool<string, never> = {
  name: 'explode',
  description: 'Always throws',
  invoke: () => {
    throw new Error('tool blew up');
  },
};

function testAgent(): AgentDef<{ double: typeof double; shout: typeof shout }> {
  return {
    key: 'test-agent',
    purpose: 'Exercise the runner in tests',
    tier: 'fast',
    tools: { double, shout },
  };
}

const RUN = { tenantId: 'aaaaaaaa-0000-0000-0000-000000000001', trigger: 'manual' as const, input: { n: 21 } };

/** Writable columns of intel.agent_run (migration intel_0019); id is identity. */
const INTEL_0019_WRITABLE_COLUMNS = [
  'agent_key',
  'tenant_id',
  'trigger_kind',
  'status',
  'input',
  'tool_calls',
  'output',
  'error',
  'started_at',
  'finished_at',
].sort();

// ---------------------------------------------------------------------------
// Tracing
// ---------------------------------------------------------------------------

describe('runAgent — per-invocation trace (§13.1 show raw)', () => {
  it('traces every bound tool call in order with ok flags', async () => {
    const { rows, persist } = capturePersist();

    const result = await runAgent(testAgent(), RUN, { persist }, async (tools) => {
      const a = await tools.double.invoke(21);
      const b = await tools.shout.invoke('quiet');
      const c = await tools.double.invoke(a);
      return { a, b, c };
    });

    expect(result.status).toBe('succeeded');
    expect(result.toolCalls.map((c) => c.tool)).toEqual(['double', 'shout', 'double']);
    expect(result.toolCalls.every((c) => c.ok)).toBe(true);
    expect(result.toolCalls.every((c) => typeof c.at === 'string' && c.at.length > 0)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tool_calls).toEqual(result.toolCalls);
  });

  it('traces a throwing tool as ok:false and lets the error propagate', async () => {
    const { rows, persist } = capturePersist();
    const def: AgentDef<{ explode: typeof explode }> = {
      key: 'exploder',
      purpose: 'Fails on purpose',
      tier: 'fast',
      tools: { explode },
    };

    await expect(
      runAgent(def, RUN, { persist }, async (tools) => tools.explode.invoke('boom')),
    ).rejects.toThrow('tool blew up');

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.status).toBe('failed');
    expect(row?.tool_calls).toHaveLength(1);
    expect(row?.tool_calls[0]?.ok).toBe(false);
  });

  it('uses the injected clock for started_at, finished_at, and tool timestamps', async () => {
    const { rows, persist } = capturePersist();
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 6, 3, 12, 0, tick++));

    await runAgent(testAgent(), RUN, { persist, now }, async (tools) => {
      await tools.double.invoke(1);
      return 'done';
    });

    const row = rows[0];
    expect(row?.started_at).toBe('2026-07-03T12:00:00.000Z');
    expect(row?.tool_calls[0]?.at).toBe('2026-07-03T12:00:01.000Z');
    expect(row?.finished_at).toBe('2026-07-03T12:00:02.000Z');
  });

  it('keeps raw payload text out of the trace — summaries are shape-only', async () => {
    const { rows, persist } = capturePersist();
    const secret = 'sk-SECRET-DO-NOT-LEAK-12345';
    const echo: AgentTool<string, string> = {
      name: 'echo',
      description: 'Returns its input',
      invoke: (s) => s,
    };
    const def: AgentDef<{ echo: typeof echo }> = {
      key: 'echoer',
      purpose: 'Echo test',
      tier: 'fast',
      tools: { echo },
    };

    const result = await runAgent(
      def,
      { tenantId: null, trigger: 'event', input: null },
      { persist },
      async (tools) => {
        await tools.echo.invoke(secret);
        return null;
      },
    );

    expect(JSON.stringify(result.toolCalls)).not.toContain(secret);
    expect(JSON.stringify(rows[0]?.tool_calls)).not.toContain(secret);
    expect(result.toolCalls[0]?.summary).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Persistence — intel_0019 row contract
// ---------------------------------------------------------------------------

describe('runAgent — intel.agent_run persistence (intel_0019)', () => {
  it('persists a succeeded row whose keys match intel_0019 writable columns exactly', async () => {
    const { rows, persist } = capturePersist();

    await runAgent(testAgent(), RUN, { persist }, async (tools) => tools.double.invoke(2));

    const row = rows[0];
    expect(row).toBeDefined();
    expect(Object.keys(row as object).sort()).toEqual(INTEL_0019_WRITABLE_COLUMNS);
    expect(row?.agent_key).toBe('test-agent');
    expect(row?.tenant_id).toBe(RUN.tenantId);
    expect(row?.trigger_kind).toBe('manual');
    expect(row?.status).toBe('succeeded');
    expect(row?.input).toEqual({ n: 21 });
    expect(row?.output).toBe(4);
    expect(row?.error).toBeNull();
  });

  it('persists a failed row with the error message AND rethrows (no silent failure)', async () => {
    const { rows, persist } = capturePersist();

    await expect(
      runAgent(testAgent(), RUN, { persist }, async () => {
        throw new Error('body collapsed');
      }),
    ).rejects.toThrow('body collapsed');

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('body collapsed');
    expect(row?.output).toBeNull();
    expect(Object.keys(row as object).sort()).toEqual(INTEL_0019_WRITABLE_COLUMNS);
  });

  it('stringifies non-Error throws into the persisted error column', async () => {
    const { rows, persist } = capturePersist();

    await expect(
      runAgent(testAgent(), RUN, { persist }, async () => {
        throw 'raw string failure';
      }),
    ).rejects.toBe('raw string failure');

    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.error).toBe('raw string failure');
  });
});

// ---------------------------------------------------------------------------
// Least privilege — the binding is structural
// ---------------------------------------------------------------------------

describe('runAgent — least-privilege binding (§9.1)', () => {
  it('hands the body exactly the declared tool keys — nothing more, and frozen', async () => {
    const { persist } = capturePersist();

    await runAgent(testAgent(), RUN, { persist }, async (tools) => {
      expect(Object.keys(tools).sort()).toEqual(['double', 'shout']);
      expect(Object.isFrozen(tools)).toBe(true);
      expect((tools as Record<string, unknown>).buildMergeProposal).toBeUndefined();

      // Structural (compile-time) gate: an undeclared tool is a type error.
      // @ts-expect-error — explode is not in this agent's binding
      tools.explode;

      return null;
    });
  });

  it('returns the body output untouched on success', async () => {
    const { persist } = capturePersist();
    const result = await runAgent(testAgent(), RUN, { persist }, async (tools) => ({
      answer: await tools.double.invoke(4),
    }));
    expect(result.status).toBe('succeeded');
    expect(result.output).toEqual({ answer: 8 });
    expect(result.error).toBeUndefined();
  });
});
