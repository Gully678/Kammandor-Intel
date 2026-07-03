/**
 * KINTEL v2 — Automate cycle (PRD v2.0 §9.5: scheduled governed reasoning)
 *
 * PURE ORCHESTRATION: no network, no DB, no LLM in this module. Every
 * side-effect — fetching events, running the connector pipeline, persisting
 * agent traces, reading/writing alerts — is an INJECTED dependency
 * (mirroring src/lib/agents/runner.ts and src/lib/pipeline/run.ts), so the
 * whole cycle is unit-testable in isolation.
 *
 * ── ONE CYCLE ───────────────────────────────────────────────────────────
 *  (a) fetch events ONCE and share the batch across every tenant — one
 *      connector owns the upstream rate limit (§8.4);
 *  (b) run the connector pipeline over the batch: expectations gate →
 *      either 'held' (recorded LOUDLY in the summary, never silently
 *      dropped) or pending proposals inserted into the governed review
 *      queue (intel.proposed_edit — the injected runPipeline owns that
 *      insert; nothing here ever writes the ontology directly);
 *  (c) per tenant: run the WATCHER agent via runAgent (trigger 'scheduled',
 *      trace persisted per invocation — §13.1 show raw): raw records →
 *      SignalEvent shape → matchSignals → toAlertRows → dedupe against the
 *      tenant's recent alerts → insertAlerts (public.intelligence_alerts,
 *      the contracted sink — NEVER daily_briefings, NEVER intel.entity);
 *  (d) return a CycleSummary counting everything.
 *
 * FAILURE DOCTRINE (zero silent failure): one tenant's failure NEVER
 * aborts the other tenants; a pipeline failure never blocks the watcher
 * scans; every error is collected in summary.failures with its stage.
 */

import { watcherAgent } from '@/lib/agents/registry';
import { runAgent } from '@/lib/agents/runner';
import type { TracePersist } from '@/lib/agents/types';
import type { RawBatch } from '@/lib/pipeline/types';
import { dedupeKey, dedupeKeyFromStoredAlert } from '@/lib/signals/alerts';
import type {
  IntelligenceAlertRow,
  MatchedSignal,
  SignalEvent,
  SignalWatchlist,
} from '@/lib/signals/types';

// ---------------------------------------------------------------------------
// Dependency & summary types
// ---------------------------------------------------------------------------

/** One tenant participating in the cycle: id + its non-sensitive watchlist. */
export interface AutomateTenant {
  id: string;
  watchlist: SignalWatchlist;
}

/** What the injected pipeline step reports back (it owns the proposal insert). */
export interface PipelineOutcome {
  /** 'held' — the expectations gate rejected the batch; nothing proposed. */
  status: 'proposed' | 'held';
  /** Pending proposals inserted into the governed queue (when 'proposed'). */
  proposedCount?: number;
}

/** Dedupe columns of an already-stored public.intelligence_alerts row. */
export interface StoredAlertKey {
  source_url: string | null;
  headline: string | null;
}

/** ALL side-effects, injected — the cycle itself performs no I/O. */
export interface AutomateCycleDeps {
  tenants: AutomateTenant[];
  /** Fetch the shared event batch (the GDELT connector fetch). Called ONCE. */
  fetchEvents: () => Promise<RawBatch>;
  /**
   * Run the connector pipeline over the shared batch (runConnector bound
   * with the governed intel.proposed_edit insert). Must return 'held' when
   * the expectations gate rejects the batch — never throw for that case.
   */
  runPipeline: (batch: RawBatch) => Promise<PipelineOutcome>;
  /** Persist one intel.agent_run lineage row (intel_0019 — §13.1 show raw). */
  persistTrace: TracePersist;
  /** Insert alert rows into public.intelligence_alerts (the ONLY alert sink). */
  insertAlerts: (rows: IntelligenceAlertRow[]) => Promise<void>;
  /** Recent alerts for one tenant, for de-duplication (source_url/headline). */
  listRecentAlerts: (tenantId: string) => Promise<StoredAlertKey[]>;
  /** Injected clock for deterministic tests (defaults to system time). */
  now?: () => Date;
}

/** Pipeline verdict as recorded in the summary — always explicit, never silent. */
export type CyclePipelineStatus = 'proposed' | 'held' | 'failed' | 'skipped';

export interface CyclePipelineSummary {
  status: CyclePipelineStatus;
  proposedCount?: number;
}

/** Per-tenant watcher outcome. */
export interface TenantScanSummary {
  tenantId: string;
  matched: number;
  inserted: number;
  skippedDuplicates: number;
}

/** Where in the cycle something failed. */
export type CycleStage = 'fetch' | 'pipeline' | 'watcher';

export interface CycleFailure {
  stage: CycleStage;
  tenantId?: string;
  error: string;
}

/** The full, loud record of one cycle — returned to the route as JSON. */
export interface CycleSummary {
  startedAt: string;
  finishedAt: string;
  /** Raw records in the shared batch (0 when the fetch itself failed). */
  events: number;
  pipeline: CyclePipelineSummary;
  tenants: TenantScanSummary[];
  failures: CycleFailure[];
}

// ---------------------------------------------------------------------------
// Raw connector records -> SignalEvent shape
// ---------------------------------------------------------------------------

/**
 * Map the shared raw batch into the SignalEvent shape the watcher consumes.
 * Records without a usable title are SKIPPED (a headline is the minimum an
 * alert can carry) — never fabricated. occurredAt falls back to the batch
 * fetch time when the record carries no date.
 */
export function toSignalEvents(batch: RawBatch): SignalEvent[] {
  const events: SignalEvent[] = [];
  for (const record of batch.records) {
    if (record === null || typeof record !== 'object') continue;
    const r = record as Record<string, unknown>;
    const title = typeof r.name === 'string' ? r.name.trim() : '';
    if (title === '') continue; // no headline — nothing an alert could say
    const event: SignalEvent = {
      title,
      occurredAt:
        typeof r.date === 'string' && r.date !== '' ? r.date : batch.fetchedAt,
      sourceKey: batch.sourceKey,
    };
    if (typeof r.id === 'string' && r.id !== '') event.id = r.id;
    if (typeof r.url === 'string' && r.url !== '') event.url = r.url;
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// The cycle
// ---------------------------------------------------------------------------

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run one full automate cycle. NEVER throws for a stage failure — every
 * error is collected in summary.failures (zero silent failure); only a bug
 * in the orchestration itself could escape, and the route backstops that.
 */
export async function runAutomateCycle(deps: AutomateCycleDeps): Promise<CycleSummary> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const failures: CycleFailure[] = [];
  const tenants: TenantScanSummary[] = [];
  let pipeline: CyclePipelineSummary = { status: 'skipped' };

  // (a) — fetch ONCE; the shared batch feeds the pipeline and every tenant.
  let batch: RawBatch | null = null;
  try {
    batch = await deps.fetchEvents();
  } catch (err) {
    failures.push({ stage: 'fetch', error: errorText(err) });
  }

  if (batch !== null) {
    // (b) — pipeline: expectations → held (recorded, loud) or proposals
    // into the governed queue. A pipeline failure never blocks the scans.
    try {
      const outcome = await deps.runPipeline(batch);
      pipeline =
        outcome.status === 'proposed'
          ? { status: 'proposed', proposedCount: outcome.proposedCount ?? 0 }
          : { status: 'held' };
    } catch (err) {
      pipeline = { status: 'failed' };
      failures.push({ stage: 'pipeline', error: errorText(err) });
    }

    // (c) — per-tenant watcher scans over the SAME shared batch.
    const events = toSignalEvents(batch);
    for (const tenant of deps.tenants) {
      try {
        tenants.push(await scanTenant(tenant, events, deps, now));
      } catch (err) {
        // One tenant's failure NEVER aborts the others; the failed run has
        // already been traced as 'failed' by runAgent (never silent).
        failures.push({ stage: 'watcher', tenantId: tenant.id, error: errorText(err) });
      }
    }
  }

  return {
    startedAt,
    finishedAt: now().toISOString(),
    events: batch === null ? 0 : batch.records.length,
    pipeline,
    tenants,
    failures,
  };
}

/**
 * One tenant's governed watcher run. Executed via runAgent so the agent
 * body sees ONLY the watcher's declared tools (least privilege) and every
 * invocation lands in a persisted intel.agent_run trace with trigger
 * 'scheduled'. Dedupe + insert use the injected deps — the same
 * listRecentAlerts / insertAlerts contract as /api/signals/scan.
 */
async function scanTenant(
  tenant: AutomateTenant,
  events: SignalEvent[],
  deps: AutomateCycleDeps,
  now: () => Date,
): Promise<TenantScanSummary> {
  let scan: TenantScanSummary = {
    tenantId: tenant.id,
    matched: 0,
    inserted: 0,
    skippedDuplicates: 0,
  };

  await runAgent(
    watcherAgent,
    {
      tenantId: tenant.id,
      trigger: 'scheduled',
      input: { sourceKey: 'automate-cycle', events: events.length },
    },
    { persist: deps.persistTrace, now },
    async (tools) => {
      const matched = await tools.matchSignals.invoke({
        events,
        watchlist: tenant.watchlist,
      });

      // Dedupe against this tenant's recent alerts (and within this batch).
      const existing = await deps.listRecentAlerts(tenant.id);
      const seen = new Set(existing.map((row) => dedupeKeyFromStoredAlert(tenant.id, row)));
      const fresh: MatchedSignal[] = [];
      let skippedDuplicates = 0;
      for (const signal of matched) {
        const key = dedupeKey(tenant.id, signal.event);
        if (seen.has(key)) {
          skippedDuplicates += 1;
          continue;
        }
        seen.add(key);
        fresh.push(signal);
      }

      const rows = await tools.toAlertRows.invoke({ tenantId: tenant.id, signals: fresh });
      if (rows.length > 0) {
        await deps.insertAlerts(rows); // the ONLY alert write path
      }

      scan = {
        tenantId: tenant.id,
        matched: matched.length,
        inserted: rows.length,
        skippedDuplicates,
      };
      return scan;
    },
  );

  return scan;
}
