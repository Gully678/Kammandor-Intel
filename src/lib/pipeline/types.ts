/**
 * KINTEL v2.1 — Declarative connector/pipeline framework types (PRD §8.2/§8.5)
 *
 * GOVERNANCE BOUNDARY:
 *   The pipeline is pure — no network and no DB access live in this slice.
 *   Fetching is injected via ConnectorDef.fetch and the only legal output is
 *   intel.proposed_edit-shaped proposals (kind 'create_entity' /
 *   'create_link', status 'pending') built via src/lib/ontology/propose.ts.
 *   Data expectations at level 'hard' are hard-fail gates: ANY hard failure
 *   holds back the ENTIRE batch ("better stale than wrong").
 */

import type { MapperResult } from '@/lib/ontology/mappers';
import type { ProposedEdit } from '@/lib/ontology/types';

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

/**
 * 'hard' — any failing record holds back the whole batch (mapper/propose
 *          never run); 'warn' — recorded in the report, never blocks.
 */
export type ExpectationLevel = 'hard' | 'warn';

/** A single declarative data-quality check applied to every raw record. */
export interface Expectation {
  /** Stable identifier, e.g. 'required:id' or 'gleif-lei-present'. */
  name: string;
  level: ExpectationLevel;
  /** Human-readable description for review/reporting UIs. */
  description: string;
  /**
   * Pure predicate over one raw record. A throwing check is counted as a
   * failure by the gate — it must never crash the run.
   */
  check(record: unknown): boolean;
}

/** Aggregated failures for one expectation across a batch. */
export interface ExpectationFailure {
  /** The Expectation.name that failed. */
  expectation: string;
  level: ExpectationLevel;
  /** Exact number of failing records (never truncated). */
  failedCount: number;
  /** Indexes of up to the first 5 failing records, for loud reporting. */
  sampleIndexes: number[];
}

/** Loud, structured verdict for a whole batch. */
export interface ExpectationReport {
  /** false iff at least one hard-level expectation failed. */
  batchAccepted: boolean;
  /** Total records evaluated. */
  total: number;
  hardFailures: ExpectationFailure[];
  warnings: ExpectationFailure[];
}

// ---------------------------------------------------------------------------
// Connector definition
// ---------------------------------------------------------------------------

/** A raw batch of records as returned by a connector's injected fetcher. */
export interface RawBatch {
  /** Matches intel.sources.key (e.g. 'gleif'). */
  sourceKey: string;
  /** ISO 8601 timestamp of when the batch was fetched. */
  fetchedAt: string;
  records: unknown[];
}

/** Injected fetcher — all I/O stays outside this slice. */
export type BatchFetcher = () => Promise<RawBatch>;

/** Declarative definition of one connector. */
export interface ConnectorDef {
  /** Matches intel.sources.key. */
  sourceKey: string;
  /** Key into the MAPPERS registry (src/lib/ontology/mappers). */
  mapperKey: string;
  /** Data expectations gating every batch from this source. */
  expectations: Expectation[];
  fetch: BatchFetcher;
}

// ---------------------------------------------------------------------------
// Run dependencies & result
// ---------------------------------------------------------------------------

/** Mapper signature (mirrors MapperFn in src/lib/ontology/mappers). */
export type PipelineMapper = (input: unknown, tenantId: string) => MapperResult;

/**
 * Governed propose function: converts one mapped record into
 * proposed_edit-shaped proposals via the existing propose builders.
 * MUST only emit kind 'create_entity' / 'create_link' — runConnector
 * enforces this as a backstop and throws loudly otherwise.
 */
export type PipelinePropose = (
  sourceKey: string,
  tenantId: string,
  mapped: MapperResult,
) => ProposedEdit[];

/** Batch held back by the hard-fail gate — mapper/propose were never called. */
export interface HeldResult {
  status: 'held';
  sourceKey: string;
  report: ExpectationReport;
}

/** Batch accepted — output is pending proposals only, never direct writes. */
export interface ProposedResult {
  status: 'proposed';
  sourceKey: string;
  report: ExpectationReport;
  /** Records skipped because the mapper threw on them (per-record isolation). */
  skippedRecords: number;
  /** Total proposals emitted (create_entity / create_link, status 'pending'). */
  proposedCount: number;
  proposals: ProposedEdit[];
  /** ISO 8601 timestamp of the run (from injected clock). */
  ranAt: string;
}

export type RunConnectorResult = HeldResult | ProposedResult;
