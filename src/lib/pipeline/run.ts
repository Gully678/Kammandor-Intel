/**
 * KINTEL v2.1 — Connector pipeline runner (PRD §8.2/§8.5)
 *
 * GOVERNANCE (non-negotiable):
 *  - HARD-FAIL GATE: if the expectation report rejects the batch, the run
 *    returns status 'held' with the loud report and NEITHER the mapper NOR
 *    propose is ever invoked — no partial or silent propagation.
 *  - PROPOSALS ONLY: the only legal output is intel.proposed_edit-shaped
 *    proposals (kind 'create_entity' / 'create_link', status 'pending')
 *    built via the existing propose builders. A propose fn emitting any
 *    other kind trips a backstop that throws loudly.
 *  - PURE SLICE: no network and no DB access here — the fetcher and the
 *    propose fn are injected dependencies.
 */

import { runExpectations } from './expectations';
import type {
  ConnectorDef,
  PipelineMapper,
  PipelinePropose,
  RunConnectorResult,
} from './types';
import type { ProposedEdit } from '@/lib/ontology/types';

/** Injected dependencies — keeps this slice free of I/O. */
export interface RunConnectorDeps {
  tenantId: string;
  mapper: PipelineMapper;
  propose: PipelinePropose;
  /** Injected clock for deterministic runs (defaults to system time). */
  now?: () => string;
}

/** The only ProposedEdit kinds a connector pipeline may emit. */
const ALLOWED_PROPOSAL_KINDS: ReadonlySet<ProposedEdit['kind']> = new Set([
  'create_entity',
  'create_link',
]);

/** Backstop: throws loudly if a propose fn emits anything but pending create proposals. */
function assertGovernedProposals(edits: ProposedEdit[], sourceKey: string): void {
  for (const edit of edits) {
    if (!ALLOWED_PROPOSAL_KINDS.has(edit.kind)) {
      throw new Error(
        `Governance violation in connector '${sourceKey}': pipeline output must be ` +
        `create_entity / create_link proposals only, got kind '${edit.kind}'. ` +
        `Direct or update-style writes are forbidden in the connector pipeline.`,
      );
    }
  }
}

/**
 * Run one declarative connector end to end:
 *   fetch (injected) → expectations gate → mapper → governed propose.
 *
 * - Expectation failures never throw: 'held' is a return value.
 * - A mapper throw on one record skips that record only (counted in
 *   skippedRecords) — one bad row cannot abort an accepted batch.
 */
export async function runConnector(
  def: ConnectorDef,
  deps: RunConnectorDeps,
): Promise<RunConnectorResult> {
  const batch = await def.fetch();

  // --- HARD-FAIL GATE: evaluated BEFORE any mapping or proposing.
  const report = runExpectations(batch.records, def.expectations);
  if (!report.batchAccepted) {
    return { status: 'held', sourceKey: def.sourceKey, report };
  }

  // --- Batch accepted: map + propose, per-record isolation for mapper errors.
  const proposals: ProposedEdit[] = [];
  let skippedRecords = 0;

  for (const record of batch.records) {
    let mapped;
    try {
      mapped = deps.mapper(record, deps.tenantId);
    } catch {
      skippedRecords += 1; // one unmappable record never aborts the batch
      continue;
    }
    const edits = deps.propose(def.sourceKey, deps.tenantId, mapped);
    assertGovernedProposals(edits, def.sourceKey);
    proposals.push(...edits);
  }

  return {
    status: 'proposed',
    sourceKey: def.sourceKey,
    report,
    skippedRecords,
    proposedCount: proposals.length,
    proposals,
    ranAt: (deps.now ?? (() => new Date().toISOString()))(),
  };
}
