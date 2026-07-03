/**
 * KINTEL v2 — agent registry tests (PRD v2.0 §9.1)
 *
 * The registry composes REAL capabilities into governed agents with
 * complete, least-privilege tool bindings. Governance under test:
 *   - exactly three agents, with the declared tiers and bindings;
 *   - the watcher's write-shaped tool emits intelligence_alerts rows only;
 *   - the resolver's write-shaped tool emits a pending (needs-review)
 *     ProposedEdit — it never writes the ontology;
 *   - the analyst's analyze entry is injectable so the registry stays pure.
 */

import { describe, expect, it } from 'vitest';
import type { Entity } from '@/lib/ontology/types';
import type { SignalEvent, SignalWatchlist } from '@/lib/signals/types';
import type { AnalyzeEntitiesResult } from '@/lib/ai/analyze';
import { runAgent } from '../runner';
import {
  AGENT_REGISTRY,
  analystAgent,
  buildAnalystAgent,
  resolverAgent,
  watcherAgent,
} from '../registry';
import type { AgentRunRecord, TracePersist } from '../types';

function capturePersist(): { rows: AgentRunRecord[]; persist: TracePersist } {
  const rows: AgentRunRecord[] = [];
  const persist: TracePersist = (record) => {
    rows.push(record);
    return Promise.resolve();
  };
  return { rows, persist };
}

const TENANT = 'aaaaaaaa-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

describe('AGENT_REGISTRY — three governed agents, complete bindings', () => {
  it('contains exactly watcher, resolver, and analyst', () => {
    expect(Object.keys(AGENT_REGISTRY).sort()).toEqual(['analyst', 'resolver', 'watcher']);
    expect(AGENT_REGISTRY.watcher).toBe(watcherAgent);
    expect(AGENT_REGISTRY.resolver).toBe(resolverAgent);
    expect(AGENT_REGISTRY.analyst).toBe(analystAgent);
  });

  it('declares the correct tiers and COMPLETE tool bindings (nothing implicit)', () => {
    expect(watcherAgent.tier).toBe('fast');
    expect(Object.keys(watcherAgent.tools).sort()).toEqual(['matchSignals', 'toAlertRows']);

    expect(resolverAgent.tier).toBe('fast');
    expect(Object.keys(resolverAgent.tools).sort()).toEqual([
      'buildMergeProposal',
      'findMergeCandidates',
    ]);

    expect(analystAgent.tier).toBe('balanced');
    expect(Object.keys(analystAgent.tools).sort()).toEqual(['analyze', 'evaluate']);

    for (const [key, def] of Object.entries(AGENT_REGISTRY)) {
      expect(def.key).toBe(key);
      expect(def.purpose.length).toBeGreaterThan(10);
      for (const tool of Object.values(def.tools)) {
        expect(tool.name.length).toBeGreaterThan(0);
        expect(tool.description.length).toBeGreaterThan(0);
        expect(typeof tool.invoke).toBe('function');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Watcher — end to end through the runner, bound tools only
// ---------------------------------------------------------------------------

describe('watcherAgent — events × watchlist → governed alert rows', () => {
  const events: SignalEvent[] = [
    {
      title: 'Sanctions announced against Acme Ltd',
      description: 'Regulators moved against the company today.',
      occurredAt: '2026-07-01T09:00:00Z',
      sourceKey: 'gdelt',
      entities: ['Acme Ltd'],
      url: 'https://example.com/acme-sanctions',
    },
    {
      title: 'Unrelated sports result',
      occurredAt: '2026-07-01T10:00:00Z',
      sourceKey: 'gdelt',
    },
  ];
  const watchlist: SignalWatchlist = { entities: ['Acme Ltd'] };

  it('yields intelligence_alerts rows via its two bound tools, fully traced', async () => {
    const { rows, persist } = capturePersist();

    const result = await runAgent(
      watcherAgent,
      { tenantId: TENANT, trigger: 'event', input: { eventCount: events.length } },
      { persist },
      async (tools) => {
        const matched = await tools.matchSignals.invoke({ events, watchlist });
        return tools.toAlertRows.invoke({ tenantId: TENANT, signals: matched });
      },
    );

    expect(result.status).toBe('succeeded');
    const alerts = result.output as Array<Record<string, unknown>>;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      organization_id: TENANT,
      headline: 'Sanctions announced against Acme Ltd',
      status: 'open',
      source_url: 'https://example.com/acme-sanctions',
    });
    expect(['CRITICAL', 'NOTABLE', 'BACKGROUND']).toContain(alerts[0]?.severity);

    // Lineage: both bound tools traced, in order, in the persisted row.
    expect(rows[0]?.tool_calls.map((c) => c.tool)).toEqual(['matchSignals', 'toAlertRows']);
    expect(rows[0]?.agent_key).toBe('watcher');
  });
});

// ---------------------------------------------------------------------------
// Resolver — duplicates become needs-review proposals, never writes
// ---------------------------------------------------------------------------

describe('resolverAgent — duplicate entities → pending merge proposal', () => {
  const base = {
    tenant_id: TENANT,
    type: 'company' as const,
    properties: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
  const entities: Entity[] = [
    { ...base, id: 'e-1', canonical_name: 'Acme Ltd', lei: 'LEI-123' as Entity['lei'] },
    {
      ...base,
      id: 'e-2',
      canonical_name: 'ACME Limited',
      lei: 'LEI-123' as Entity['lei'],
      created_at: '2026-02-01T00:00:00Z',
    },
  ];

  it('yields a needs-review ProposedEdit via its bound tools only', async () => {
    const { rows, persist } = capturePersist();

    const result = await runAgent(
      resolverAgent,
      { tenantId: TENANT, trigger: 'scheduled', input: { entityCount: entities.length } },
      { persist },
      async (tools) => {
        const candidates = await tools.findMergeCandidates.invoke({ entities });
        expect(candidates).toHaveLength(1);
        expect(candidates[0]?.confidence).toBe(0.95);
        const candidate = candidates[0];
        if (!candidate) throw new Error('expected a merge candidate');
        return tools.buildMergeProposal.invoke({
          candidate,
          proposedBy: 'agent:resolver',
          tenantId: TENANT,
        });
      },
    );

    const proposal = result.output as Record<string, unknown>;
    // Needs-review shape: a pending update_entity proposal for the review
    // queue — the resolver NEVER writes intel.entity itself.
    expect(proposal.status).toBe('pending');
    expect(proposal.kind).toBe('update_entity');
    expect(proposal.tenant_id).toBe(TENANT);
    expect(proposal.proposed_by).toBe('agent:resolver');
    expect(proposal.rationale).toContain('requires human review');
    const payload = proposal.payload as { id: string; patch: { properties: Record<string, unknown> } };
    expect(payload.id).toBe('e-2');
    expect(payload.patch.properties.merged_into).toBe('e-1');

    expect(rows[0]?.tool_calls.map((c) => c.tool)).toEqual([
      'findMergeCandidates',
      'buildMergeProposal',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Analyst — injectable analyze keeps the registry pure; evaluate gates output
// ---------------------------------------------------------------------------

describe('analystAgent — analyze is injectable; every output is evaluate()-gated', () => {
  it('runs an injected analyze fn and gates its proposals through evaluate', async () => {
    const { persist } = capturePersist();

    const fakeResult: AnalyzeEntitiesResult = {
      narrative: 'Concentrated exposure to a single counterparty.',
      proposedEdits: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          tenant_id: TENANT,
          kind: 'update_entity',
          payload: { id: 'e-1', patch: { risk_score: 7.5, risk_category: 'high' } },
          proposed_by: 'ai-moe-analyzer',
          rationale: 'Elevated exposure',
          status: 'pending',
          created_at: '2026-07-01T00:00:00Z',
        },
      ],
      evaluations: [],
    };
    const injected = buildAnalystAgent(() => Promise.resolve(fakeResult));
    expect(Object.keys(injected.tools).sort()).toEqual(['analyze', 'evaluate']);
    expect(injected.tier).toBe('balanced');

    const result = await runAgent(
      injected,
      { tenantId: TENANT, trigger: 'manual', input: { objective: 'test' } },
      { persist },
      async (tools) => {
        const analysis = await tools.analyze.invoke({
          tenantId: TENANT,
          entities: [],
          links: [],
          objective: 'test',
        });
        const gates = await Promise.all(
          analysis.proposedEdits.map((p) => tools.evaluate.invoke({ proposal: p })),
        );
        return { narrative: analysis.narrative, gates };
      },
    );

    const output = result.output as {
      narrative: string;
      gates: Array<{ passed: boolean; score: number; checks: string[] }>;
    };
    expect(output.narrative).toContain('counterparty');
    expect(output.gates).toHaveLength(1);
    expect(output.gates[0]?.passed).toBe(true);
    expect(result.toolCalls.map((c) => c.tool)).toEqual(['analyze', 'evaluate']);
  });

  it('the default analyst binding exposes the real pipeline entries without invoking them', () => {
    // Purity: constructing/inspecting the registry must not call any model.
    expect(analystAgent.purpose).toContain('evaluate');
    expect(analystAgent.tools.analyze.description.length).toBeGreaterThan(0);
    expect(analystAgent.tools.evaluate.description.length).toBeGreaterThan(0);
  });
});
