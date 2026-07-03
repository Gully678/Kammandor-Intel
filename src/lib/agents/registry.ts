/**
 * KINTEL v2 — governed agent registry (PRD v2.0 §9.1)
 *
 * PURE MODULE: composing this registry performs no I/O and calls no model.
 * Each AgentDef binds EXISTING, already-governed capabilities as named
 * tools; the binding is COMPLETE — the runner passes only these tools to
 * the agent body, nothing implicit (least privilege is structural).
 *
 * ── GOVERNANCE ──────────────────────────────────────────────────────────
 * - Agents NEVER write the ontology. Their write-shaped tools only EMIT
 *   rows for governed sinks: intelligence_alerts inserts (watcher) or
 *   pending intel.proposed_edit proposals (resolver/analyst). Applying
 *   anything remains a human-approved, application-layer step.
 * - No LLM emits a figure or a severity: watcher and resolver are fully
 *   deterministic; the analyst's only model path is the existing governed
 *   analyze pipeline (src/lib/ai/analyze.ts), and its purpose requires
 *   every output to pass the evaluate() gate before surfacing.
 */

import {
  analyzeEntities,
  evaluate,
  type AnalyzeEntitiesInput,
  type AnalyzeEntitiesResult,
  type EvaluateContext,
  type EvaluationResult,
} from '@/lib/ai/analyze';
import {
  buildMergeProposal,
  findMergeCandidates,
  type MergeCandidate,
} from '@/lib/ontology/resolve';
import type { Entity, ProposedEdit } from '@/lib/ontology/types';
import { toAlertRows } from '@/lib/signals/alerts';
import { matchSignals } from '@/lib/signals/match';
import type {
  IntelligenceAlertRow,
  MatchedSignal,
  SignalEvent,
  SignalWatchlist,
} from '@/lib/signals/types';
import type { AgentDef, AgentTool } from './types';

// ---------------------------------------------------------------------------
// Watcher — deterministic signal engine over the tenant watchlist
// ---------------------------------------------------------------------------

export interface WatcherTools extends Record<string, AgentTool<never, unknown>> {
  matchSignals: AgentTool<
    { events: SignalEvent[]; watchlist: SignalWatchlist },
    MatchedSignal[]
  >;
  toAlertRows: AgentTool<
    { tenantId: string; signals: MatchedSignal[] },
    IntelligenceAlertRow[]
  >;
}

export const watcherAgent: AgentDef<WatcherTools> = {
  key: 'watcher',
  purpose: 'Watch incoming events against the tenant watchlist and raise governed alerts',
  tier: 'fast',
  tools: {
    matchSignals: {
      name: 'matchSignals',
      description:
        'Deterministically match a batch of events against the tenant watchlist; severity is rule-based, never model-set.',
      invoke: ({ events, watchlist }) => matchSignals(events, watchlist),
    },
    toAlertRows: {
      name: 'toAlertRows',
      description:
        'Shape matched signals into intelligence alert rows (the contracted alert sink) — never touches the ontology.',
      invoke: ({ tenantId, signals }) => toAlertRows(tenantId, signals),
    },
  },
};

// ---------------------------------------------------------------------------
// Resolver — deterministic duplicate detection, proposals only
// ---------------------------------------------------------------------------

export interface ResolverTools extends Record<string, AgentTool<never, unknown>> {
  findMergeCandidates: AgentTool<{ entities: readonly Entity[] }, MergeCandidate[]>;
  buildMergeProposal: AgentTool<
    { candidate: MergeCandidate; proposedBy: string; tenantId: string },
    ProposedEdit
  >;
}

export const resolverAgent: AgentDef<ResolverTools> = {
  key: 'resolver',
  purpose: 'Detect duplicate entities and propose needs-review merges',
  tier: 'fast',
  tools: {
    findMergeCandidates: {
      name: 'findMergeCandidates',
      description:
        'Deterministically find possible duplicate entities within a tenant batch (identifier and name evidence).',
      invoke: ({ entities }) => findMergeCandidates(entities),
    },
    buildMergeProposal: {
      name: 'buildMergeProposal',
      description:
        'Turn a duplicate candidate into a pending, needs-review proposal for the review queue — it never merges anything itself.',
      invoke: ({ candidate, proposedBy, tenantId }) =>
        buildMergeProposal(candidate, proposedBy, tenantId),
    },
  },
};

// ---------------------------------------------------------------------------
// Analyst — the ONLY model-touching agent; analyze entry stays injectable
// ---------------------------------------------------------------------------

/** The governed analyze pipeline entry (src/lib/ai/analyze.ts signature). */
export type AnalyzeFn = (input: AnalyzeEntitiesInput) => Promise<AnalyzeEntitiesResult>;

export interface AnalystTools extends Record<string, AgentTool<never, unknown>> {
  analyze: AgentTool<AnalyzeEntitiesInput, AnalyzeEntitiesResult>;
  evaluate: AgentTool<
    { proposal: ProposedEdit; context?: EvaluateContext },
    EvaluationResult
  >;
}

/**
 * Build the analyst agent. The analyze entry is INJECTABLE (defaults to the
 * real src/lib/ai/analyze.ts pipeline) so composing the registry stays pure
 * and tests never need a live model; evaluate is always the real gate.
 */
export function buildAnalystAgent(analyzeFn: AnalyzeFn = analyzeEntities): AgentDef<AnalystTools> {
  return {
    key: 'analyst',
    purpose:
      'Explain event impact over the ontology; every output evaluate()-gated before surfacing',
    tier: 'balanced',
    tools: {
      analyze: {
        name: 'analyze',
        description:
          'Run the existing governed analysis pipeline over typed entities and links; it only ever returns pending proposals.',
        invoke: (input) => analyzeFn(input),
      },
      evaluate: {
        name: 'evaluate',
        description:
          'Deterministic evaluation gate for a proposed edit — structure, type validity, grounding, and risk-range checks.',
        invoke: ({ proposal, context }) => evaluate(proposal, context),
      },
    },
  };
}

export const analystAgent: AgentDef<AnalystTools> = buildAnalystAgent();

// ---------------------------------------------------------------------------
// The registry — exactly these three governed agents
// ---------------------------------------------------------------------------

export const AGENT_REGISTRY: Record<string, AgentDef> = {
  watcher: watcherAgent,
  resolver: resolverAgent,
  analyst: analystAgent,
};
