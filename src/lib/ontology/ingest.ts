/**
 * KINTEL Phase 2 — Ontology ingest (connector -> mapper -> propose)
 *
 * GOVERNANCE BOUNDARY (mirrors workers/app/graph.py's persist node and
 * src/lib/ontology/propose.ts):
 *   This module ONLY builds ProposedEdit rows for insertion into
 *   intel.proposed_edit (status='pending'). It NEVER constructs a write to
 *   intel.entity, intel.link, or intel.entity_provenance — those tables are
 *   written only by the slice-3b human-approval application step, after a
 *   reviewer has approved a pending proposal.
 *
 * This file is pure (no network, no DB, no fetch) so it is unit-testable in
 * isolation. The I/O (fetching source records, inserting proposals) lives in
 * src/app/api/ontology/ingest/route.ts.
 */

import { MAPPERS } from './mappers';
import { proposeCreateEntity, proposeCreateLink } from './propose';
import { evaluate } from '@/lib/ai/analyze';
import type { Entity, Link, ProposedEdit } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Exact row shape for an intel.proposed_edit insert.
 * Mirrors migrations/intel/0009_ontology_proposed_edit.sql columns 1:1 and
 * matches the ProposedEdit type already produced by propose.ts /
 * workers/app/ontology.py's propose_create_entity / propose_create_link.
 *
 * Columns: id, tenant_id, kind, payload, proposed_by, rationale, status,
 * reviewed_by, reviewed_at, created_at.
 */
export type ProposedEditInsert = ProposedEdit;

export interface BuildProposedEditsResult {
  edits:   ProposedEditInsert[];
  skipped: number; // count of malformed records that produced nothing
}

/** Identity of the automated proposer for connector-driven ingest. */
export const INGEST_PROPOSED_BY = 'connector-ingest';

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------

/**
 * Run MAPPERS[source] over each record, converting every mapped entity/link
 * into a ProposedEdit via propose.ts's governed helpers.
 *
 * - Unknown source: throws (caller — the route — is responsible for
 *   validating the source against MAPPERS BEFORE calling this and returning
 *   400; this function throwing is a defensive backstop, not the primary
 *   validation path).
 * - Malformed / unmappable record: caught per-record and skipped — never
 *   throws for a single bad record, so one bad row cannot abort a batch.
 * - Never returns a ProposedEdit whose kind targets anything other than
 *   'create_entity' / 'create_link' (i.e. never a direct entity/link write).
 * - Every returned ProposedEdit carries the AIP eval-gate result on its
 *   `evaluation` field (v2 §12.4): evaluate() from src/lib/ai/analyze.ts is
 *   run at propose time, grounded against the same record's own entity ids
 *   so create_link proposals are checked for dangling endpoints. evaluate()
 *   is pure (no network/DB), so this module stays unit-testable offline.
 */
export function buildProposedEditsFromRecords(
  source:  string,
  tenant:  string,
  records: unknown[],
): BuildProposedEditsResult {
  const mapper = MAPPERS[source];
  if (!mapper) {
    throw new Error(`Unknown ontology source: "${source}"`);
  }

  const edits: ProposedEditInsert[] = [];
  let skipped = 0;

  for (const record of records) {
    try {
      const { entities, links, provenance } = mapper(record, tenant);

      // Ground link proposals against the entity ids produced by THIS
      // record's mapping (the mapper's link source/target ids reference
      // these), so the eval gate's grounding check is real rather than
      // merely "well-formed UUID".
      const knownEntityIds = new Set((entities as Entity[]).map(e => e.id));

      for (const entity of entities as Entity[]) {
        const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...entityFields } = entity;
        const rationale = buildRationale(source, 'entity', entity, provenance);
        edits.push(
          withEvaluation(
            proposeCreateEntity(tenant, entityFields, INGEST_PROPOSED_BY, rationale),
            knownEntityIds,
          ),
        );
      }

      for (const link of links as Link[]) {
        const { id: _id, created_at: _createdAt, ...linkFields } = link;
        const rationale = buildRationale(source, 'link', link, provenance);
        edits.push(
          withEvaluation(
            proposeCreateLink(tenant, linkFields, INGEST_PROPOSED_BY, rationale),
            knownEntityIds,
          ),
        );
      }
    } catch {
      // Malformed record: skip it, never abort the batch or throw.
      skipped += 1;
      continue;
    }
  }

  return { edits, skipped };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run the AIP eval gate over a freshly built proposal and record the result
 * on its `evaluation` field (persisted to intel.proposed_edit.evaluation by
 * the ingest route's insert). Pure and non-mutating: evaluate() never writes
 * anywhere, and the proposal itself is returned as a new object.
 */
function withEvaluation(
  edit:           ProposedEdit,
  knownEntityIds: Set<string>,
): ProposedEditInsert {
  return { ...edit, evaluation: evaluate(edit, { knownEntityIds }) };
}

function buildRationale(
  source:     string,
  kind:       'entity' | 'link',
  object:     Entity | Link,
  provenance: { confidence?: number }[],
): string {
  const confidence = provenance[0]?.confidence !== undefined
    ? ` (confidence ${provenance[0].confidence})`
    : '';
  const objectType = 'type' in object ? object.type : 'unknown';
  return `Proposed by connector-ingest from source "${source}": mapped ${kind} of type "${objectType}"${confidence}.`;
}
