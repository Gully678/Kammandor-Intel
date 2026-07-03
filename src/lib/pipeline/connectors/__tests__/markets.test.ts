/**
 * KINTEL v2.1 — markets-fx declarative connector tests (PRD §8.2/§8.5)
 *
 * NO LIVE NETWORK: every test injects a mock fetchImpl and a fake env.
 * Per FOUNDER_DECISIONS_v2 (free/keyless only; licensed vendor not
 * contracted) the connector must be EXPLICITLY not-configured when the
 * vendor env is absent — a loud throw, never a silent empty (NFR §15.3).
 */

import { describe, it, expect, vi } from 'vitest';

import { runConnector, type RunConnectorDeps } from '../../run';
import {
  MARKETS_EXPECTATIONS,
  makeMarketsConnector,
  type MarketsFetchImpl,
} from '../markets';

import { mapMarketsInstrument, type MapperResult } from '@/lib/ontology/mappers';
import { proposeCreateEntity, proposeCreateLink } from '@/lib/ontology/propose';
import type { Entity, Link, ProposedEdit } from '@/lib/ontology/types';

const TENANT_ID = 'test-tenant-uuid-0001';

const FAKE_ENV = {
  MARKETS_FX_BASE_URL: 'https://vendor.example.com/v1',
  MARKETS_FX_API_KEY: 'test-api-key',
};

/** Vendor payload following the MarketsAdapter contract (FxResponse/QuotesResponse). */
const VENDOR_FIXTURE = {
  fx: [
    { pair: 'USD/EUR', rate: 0.9123, asOf: '2026-07-03T08:00:00Z', source: 'vendor' },
    { pair: 'USD/AED', rate: 3.6725, asOf: '2026-07-03T08:00:00Z', source: 'vendor' },
  ],
  quotes: [
    { symbol: 'XAUUSD', price: 3312.5, changePct: 0.42, currency: 'USD', asOf: '2026-07-03T08:00:00Z', source: 'vendor' },
  ],
};

function mockFetch(body: unknown, status = 200): MarketsFetchImpl & ReturnType<typeof vi.fn> {
  return vi.fn(async (_url: string) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as never;
}

/** Governed propose fn built on the EXISTING propose builders (the only legal output path). */
function governedPropose(sourceKey: string, tenantId: string, mapped: MapperResult): ProposedEdit[] {
  const edits: ProposedEdit[] = [];
  for (const entity of mapped.entities as Entity[]) {
    const { id: _i, created_at: _c, updated_at: _u, ...fields } = entity;
    edits.push(proposeCreateEntity(tenantId, fields, 'connector-ingest', `from ${sourceKey}`));
  }
  for (const link of mapped.links as Link[]) {
    const { id: _i, created_at: _c, ...fields } = link;
    edits.push(proposeCreateLink(tenantId, fields, 'connector-ingest', `from ${sourceKey}`));
  }
  return edits;
}

function makeDeps(overrides: Partial<RunConnectorDeps> = {}): RunConnectorDeps {
  return {
    tenantId: TENANT_ID,
    mapper: vi.fn(mapMarketsInstrument),
    propose: vi.fn(governedPropose),
    now: () => '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Explicit not-configured state (NFR §15.3 — never a silent empty)
// ---------------------------------------------------------------------------

describe('makeMarketsConnector — env gate', () => {
  it('throws the explicit not-configured error when vendor env is absent, without calling the fetcher', async () => {
    const fetchImpl = mockFetch(VENDOR_FIXTURE);
    const def = makeMarketsConnector(fetchImpl, {});

    await expect(def.fetch()).rejects.toThrow(
      'markets-fx connector not configured — licensed vendor pending founder approval',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws when only one of MARKETS_FX_BASE_URL / MARKETS_FX_API_KEY is set', async () => {
    const urlOnly = makeMarketsConnector(mockFetch(VENDOR_FIXTURE), {
      MARKETS_FX_BASE_URL: FAKE_ENV.MARKETS_FX_BASE_URL,
    });
    await expect(urlOnly.fetch()).rejects.toThrow(/not configured/);

    const keyOnly = makeMarketsConnector(mockFetch(VENDOR_FIXTURE), {
      MARKETS_FX_API_KEY: FAKE_ENV.MARKETS_FX_API_KEY,
    });
    await expect(keyOnly.fetch()).rejects.toThrow(/not configured/);
  });

  it('the not-configured throw surfaces through runConnector (loud, never a silent empty batch)', async () => {
    const def = makeMarketsConnector(mockFetch(VENDOR_FIXTURE), {});
    const deps = makeDeps();
    await expect(runConnector(def, deps)).rejects.toThrow(/not configured/);
    expect(deps.mapper).not.toHaveBeenCalled();
    expect(deps.propose).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy path with fake env + fake fetcher
// ---------------------------------------------------------------------------

describe('makeMarketsConnector — configured happy path', () => {
  it('declares sourceKey markets-fx, mapperKey markets-fx and the markets expectations', () => {
    const def = makeMarketsConnector(mockFetch(VENDOR_FIXTURE), FAKE_ENV);
    expect(def.sourceKey).toBe('markets-fx');
    expect(def.mapperKey).toBe('markets-fx');
    expect(def.expectations).toBe(MARKETS_EXPECTATIONS);
  });

  it('calls the vendor base URL with the API key and normalises fx + quotes into one RawBatch', async () => {
    const fetchImpl = mockFetch(VENDOR_FIXTURE);
    const def = makeMarketsConnector(fetchImpl, FAKE_ENV);

    const batch = await def.fetch();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(fetchImpl.mock.calls[0]?.[0] as string);
    expect(url.href.startsWith(FAKE_ENV.MARKETS_FX_BASE_URL)).toBe(true);
    expect(url.searchParams.get('apikey')).toBe(FAKE_ENV.MARKETS_FX_API_KEY);

    expect(batch.sourceKey).toBe('markets-fx');
    expect(batch.records).toHaveLength(3); // 2 fx + 1 quote
  });

  it('produces valid pending proposals end to end via runConnector with a spy propose', async () => {
    const def = makeMarketsConnector(mockFetch(VENDOR_FIXTURE), FAKE_ENV);
    const deps = makeDeps();

    const result = await runConnector(def, deps);

    expect(result.status).toBe('proposed');
    if (result.status !== 'proposed') return;
    expect(result.sourceKey).toBe('markets-fx');
    expect(result.skippedRecords).toBe(0);
    expect(result.proposedCount).toBe(3); // one Instrument entity per record
    expect(deps.propose).toHaveBeenCalledTimes(3);
    for (const proposal of result.proposals) {
      expect(proposal.kind).toBe('create_entity');
      expect(proposal.status).toBe('pending');
      expect(proposal.tenant_id).toBe(TENANT_ID);
      expect((proposal.payload as Record<string, unknown>).type).toBe('instrument');
    }
  });

  it('throws on non-200 vendor responses with the status in the message', async () => {
    const def = makeMarketsConnector(mockFetch({}, 429), FAKE_ENV);
    await expect(def.fetch()).rejects.toThrow(/429/);
  });

  it('throws loudly on an unexpected vendor response shape — never fabricates records', async () => {
    const def = makeMarketsConnector(mockFetch({ nonsense: true }), FAKE_ENV);
    await expect(def.fetch()).rejects.toThrow(/unexpected/i);
  });
});

// ---------------------------------------------------------------------------
// Expectations align with the REAL mapper contract
// ---------------------------------------------------------------------------

describe('MARKETS_EXPECTATIONS — aligned with mapMarketsInstrument', () => {
  it('HARD-FAIL: a record with neither symbol nor pair holds back the whole batch', async () => {
    const broken = {
      fx: [
        VENDOR_FIXTURE.fx[0],
        { rate: 1.234, asOf: '2026-07-03T08:00:00Z', source: 'vendor' }, // no pair
      ],
    };
    const def = makeMarketsConnector(mockFetch(broken), FAKE_ENV);
    const deps = makeDeps();

    const result = await runConnector(def, deps);

    expect(result.status).toBe('held');
    if (result.status !== 'held') return;
    expect(result.report.hardFailures.length).toBeGreaterThan(0);
    expect(deps.mapper).not.toHaveBeenCalled();
    expect(deps.propose).not.toHaveBeenCalled();
  });

  it('every gated record actually maps to an Instrument entity (no gate/mapper drift)', async () => {
    const def = makeMarketsConnector(mockFetch(VENDOR_FIXTURE), FAKE_ENV);
    const batch = await def.fetch();

    for (const record of batch.records) {
      const mapped = mapMarketsInstrument(record, TENANT_ID);
      expect(mapped.entities.length).toBe(1);
      expect(mapped.entities[0]?.type).toBe('instrument');
    }
  });
});
