/**
 * KINTEL v2 — Automate cycle tests (PRD v2.0 §9.5)
 *
 * Written FIRST (TDD). The cycle is PURE orchestration — every side-effect
 * (fetch, pipeline, trace persistence, alert reads/writes) is an injected
 * dependency, so these tests mock ALL of them.
 *
 * GOVERNANCE ASSERTIONS:
 *  - events are fetched ONCE per cycle and shared across tenants (§8.4 —
 *    one connector owns the upstream rate limit);
 *  - a held pipeline is RECORDED loudly and tenants are still scanned;
 *  - one tenant's failure NEVER aborts the other tenants (zero silent
 *    failure — everything lands in summary.failures);
 *  - every tenant watcher run persists an intel.agent_run trace with
 *    trigger 'scheduled' (§13.1 show raw).
 */

import { describe, it, expect, vi } from 'vitest';

import {
  runAutomateCycle,
  toSignalEvents,
  type AutomateCycleDeps,
  type AutomateTenant,
  type StoredAlertKey,
} from '../cycle';
import type { AgentRunRecord } from '@/lib/agents/types';
import type { RawBatch } from '@/lib/pipeline/types';
import type { IntelligenceAlertRow } from '@/lib/signals/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2026-07-03T12:00:00.000Z');

/** Raw GDELT-connector-shaped batch (the normalised artlist record shape). */
const BATCH: RawBatch = {
  sourceKey: 'gdelt',
  fetchedAt: '2026-07-03T11:55:00.000Z',
  records: [
    {
      id: 'gdelt-doc:https://news.example/sukuk',
      name: 'Sukuk issuance expands in UAE',
      url: 'https://news.example/sukuk',
      type: 'news',
      date: '2026-07-03T11:00:00Z',
    },
    {
      id: 'gdelt-doc:https://news.example/quiet',
      name: 'Entirely unrelated quiet story',
      url: 'https://news.example/quiet',
      type: 'news',
    },
  ],
};

const TENANT_A: AutomateTenant = { id: 'tenant-a', watchlist: { keywords: ['sukuk'] } };
const TENANT_B: AutomateTenant = { id: 'tenant-b', watchlist: { keywords: ['sukuk'] } };

interface DepsHarness {
  deps: AutomateCycleDeps;
  traces: AgentRunRecord[];
  inserted: IntelligenceAlertRow[][];
}

function makeDeps(overrides: Partial<AutomateCycleDeps> = {}): DepsHarness {
  const traces: AgentRunRecord[] = [];
  const inserted: IntelligenceAlertRow[][] = [];
  const deps: AutomateCycleDeps = {
    tenants: [TENANT_A, TENANT_B],
    fetchEvents: vi.fn(async () => BATCH),
    runPipeline: vi.fn(async () => ({ status: 'proposed' as const, proposedCount: 4 })),
    persistTrace: vi.fn(async (record: AgentRunRecord) => {
      traces.push(record);
    }),
    insertAlerts: vi.fn(async (rows: IntelligenceAlertRow[]) => {
      inserted.push(rows);
    }),
    listRecentAlerts: vi.fn(async (): Promise<StoredAlertKey[]> => []),
    now: () => FIXED_NOW,
    ...overrides,
  };
  return { deps, traces, inserted };
}

// ---------------------------------------------------------------------------
// toSignalEvents — raw connector records -> SignalEvent shape
// ---------------------------------------------------------------------------

describe('toSignalEvents', () => {
  it('maps raw GDELT records to SignalEvents (title, url, occurredAt, sourceKey)', () => {
    const events = toSignalEvents(BATCH);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      title: 'Sukuk issuance expands in UAE',
      url: 'https://news.example/sukuk',
      occurredAt: '2026-07-03T11:00:00Z',
      sourceKey: 'gdelt',
    });
    // No date on the record -> falls back to the batch fetch time.
    expect(events[1]?.occurredAt).toBe(BATCH.fetchedAt);
  });

  it('skips records without a usable title instead of fabricating one', () => {
    const events = toSignalEvents({
      ...BATCH,
      records: [{ id: 'x', name: '', url: 'https://news.example/x' }, null, 42],
    });
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runAutomateCycle
// ---------------------------------------------------------------------------

describe('runAutomateCycle', () => {
  it('happy path: fetches ONCE, runs pipeline, scans every tenant, counts everything', async () => {
    const { deps, inserted } = makeDeps();
    const summary = await runAutomateCycle(deps);

    // one shared fetch (§8.4) and one pipeline run over that exact batch
    expect(deps.fetchEvents).toHaveBeenCalledTimes(1);
    expect(deps.runPipeline).toHaveBeenCalledTimes(1);
    expect(deps.runPipeline).toHaveBeenCalledWith(BATCH);

    expect(summary.events).toBe(2);
    expect(summary.pipeline).toEqual({ status: 'proposed', proposedCount: 4 });
    expect(summary.failures).toEqual([]);
    expect(summary.startedAt).toBe(FIXED_NOW.toISOString());
    expect(summary.finishedAt).toBe(FIXED_NOW.toISOString());

    // both tenants matched the sukuk story and inserted exactly one alert
    expect(summary.tenants).toEqual([
      { tenantId: 'tenant-a', matched: 1, inserted: 1, skippedDuplicates: 0 },
      { tenantId: 'tenant-b', matched: 1, inserted: 1, skippedDuplicates: 0 },
    ]);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]?.[0]).toMatchObject({
      organization_id: 'tenant-a',
      headline: 'Sukuk issuance expands in UAE',
      status: 'open',
    });
  });

  it('pipeline held: recorded loudly in the summary and tenants are STILL scanned', async () => {
    const { deps, inserted } = makeDeps({
      runPipeline: vi.fn(async () => ({ status: 'held' as const })),
    });
    const summary = await runAutomateCycle(deps);

    expect(summary.pipeline.status).toBe('held');
    expect(summary.tenants).toHaveLength(2);
    expect(inserted).toHaveLength(2); // watcher scan still delivered alerts
    expect(summary.failures).toEqual([]);
  });

  it('pipeline THROW: failure recorded at stage pipeline, tenants still scanned', async () => {
    const { deps } = makeDeps({
      runPipeline: vi.fn(async () => {
        throw new Error('proposed_edit insert refused');
      }),
    });
    const summary = await runAutomateCycle(deps);

    expect(summary.pipeline.status).toBe('failed');
    expect(summary.failures).toEqual([
      { stage: 'pipeline', error: 'proposed_edit insert refused' },
    ]);
    expect(summary.tenants).toHaveLength(2);
  });

  it("one tenant's insertAlerts throw never aborts the other tenants", async () => {
    const { deps, traces } = makeDeps({
      insertAlerts: vi.fn(async (rows: IntelligenceAlertRow[]) => {
        if (rows[0]?.organization_id === 'tenant-a') {
          throw new Error('alert insert failed for tenant-a');
        }
      }),
    });
    const summary = await runAutomateCycle(deps);

    expect(summary.failures).toEqual([
      { stage: 'watcher', tenantId: 'tenant-a', error: 'alert insert failed for tenant-a' },
    ]);
    // tenant-b completed in full despite tenant-a's failure
    expect(summary.tenants).toEqual([
      { tenantId: 'tenant-b', matched: 1, inserted: 1, skippedDuplicates: 0 },
    ]);
    // and the failed run was STILL traced (never silent) — status 'failed'
    const tenantATrace = traces.find((t) => t.tenant_id === 'tenant-a');
    expect(tenantATrace?.status).toBe('failed');
    expect(tenantATrace?.error).toContain('alert insert failed for tenant-a');
  });

  it('dedupes against recent alerts: duplicate skipped, nothing re-inserted', async () => {
    const { deps, inserted } = makeDeps({
      listRecentAlerts: vi.fn(async (): Promise<StoredAlertKey[]> => [
        { source_url: 'https://news.example/sukuk', headline: null },
      ]),
    });
    const summary = await runAutomateCycle(deps);

    expect(summary.tenants).toEqual([
      { tenantId: 'tenant-a', matched: 1, inserted: 0, skippedDuplicates: 1 },
      { tenantId: 'tenant-b', matched: 1, inserted: 0, skippedDuplicates: 1 },
    ]);
    expect(inserted).toHaveLength(0); // insertAlerts never called with an empty batch
  });

  it("persists one intel.agent_run trace per tenant with trigger 'scheduled'", async () => {
    const { deps, traces } = makeDeps();
    await runAutomateCycle(deps);

    expect(traces).toHaveLength(2);
    for (const trace of traces) {
      expect(trace.agent_key).toBe('watcher');
      expect(trace.trigger_kind).toBe('scheduled');
      expect(trace.status).toBe('succeeded');
      // §13.1: every wrapped tool invocation appears in the trace
      expect(trace.tool_calls.map((c) => c.tool)).toEqual(['matchSignals', 'toAlertRows']);
    }
    expect(traces.map((t) => t.tenant_id)).toEqual(['tenant-a', 'tenant-b']);
  });

  it('fetch failure: loud fetch-stage failure, pipeline skipped, no tenant scans', async () => {
    const { deps, inserted } = makeDeps({
      fetchEvents: vi.fn(async () => {
        throw new Error('GDELT DOC API request failed: HTTP 503');
      }),
    });
    const summary = await runAutomateCycle(deps);

    expect(summary.events).toBe(0);
    expect(summary.pipeline).toEqual({ status: 'skipped' });
    expect(summary.failures).toEqual([
      { stage: 'fetch', error: 'GDELT DOC API request failed: HTTP 503' },
    ]);
    expect(summary.tenants).toEqual([]);
    expect(deps.runPipeline).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });
});
