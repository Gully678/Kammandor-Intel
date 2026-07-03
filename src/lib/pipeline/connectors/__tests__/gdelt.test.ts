/**
 * KINTEL v2.1 — GDELT declarative connector tests (PRD §8.2/§8.5)
 *
 * NO LIVE NETWORK: every test injects a mock fetchImpl. The real GDELT DOC
 * 2.0 API is never called from this suite.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { runExpectations } from '../../expectations';
import { runConnector, type RunConnectorDeps } from '../../run';
import {
  GDELT_EXPECTATIONS,
  makeGdeltConnector,
  type GdeltFetchImpl,
} from '../gdelt';

import { mapGdeltEvent, type MapperResult } from '@/lib/ontology/mappers';
import { proposeCreateEntity, proposeCreateLink } from '@/lib/ontology/propose';
import type { Entity, Link, ProposedEdit } from '@/lib/ontology/types';

const TENANT_ID = 'test-tenant-uuid-0001';

// ---------------------------------------------------------------------------
// Fixtures — realistic GDELT DOC 2.0 artlist JSON (mode=artlist&format=json)
// ---------------------------------------------------------------------------

const GDELT_ARTLIST_FIXTURE = {
  articles: [
    {
      url: 'https://example.com/news/copper-sanctions',
      url_mobile: 'https://m.example.com/news/copper-sanctions',
      title: 'New sanctions ripple through copper markets',
      seendate: '20260703T081500Z',
      socialimage: 'https://example.com/img/copper.jpg',
      domain: 'example.com',
      language: 'English',
      sourcecountry: 'United Kingdom',
    },
    {
      url: 'https://news.example.org/red-sea-shipping',
      url_mobile: '',
      title: 'Red Sea shipping disruption widens',
      seendate: '20260703T074200Z',
      socialimage: '',
      domain: 'news.example.org',
      language: 'English',
      sourcecountry: 'United States',
    },
  ],
};

/** Minimal mock response satisfying the injected fetch contract. */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function mockFetch(body: unknown, status = 200): GdeltFetchImpl & ReturnType<typeof vi.fn> {
  return vi.fn(async (_url: string) => jsonResponse(body, status)) as never;
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
    mapper: vi.fn(mapGdeltEvent),
    propose: vi.fn(governedPropose),
    now: () => '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Connector shape
// ---------------------------------------------------------------------------

describe('makeGdeltConnector — declarative shape', () => {
  it('declares sourceKey gdelt, mapperKey gdelt and the GDELT expectations', () => {
    const def = makeGdeltConnector(mockFetch(GDELT_ARTLIST_FIXTURE));
    expect(def.sourceKey).toBe('gdelt');
    expect(def.mapperKey).toBe('gdelt');
    expect(def.expectations).toBe(GDELT_EXPECTATIONS);
  });
});

// ---------------------------------------------------------------------------
// URL construction (query / maxrecords / timespan)
// ---------------------------------------------------------------------------

describe('makeGdeltConnector — URL construction', () => {
  it('builds the DOC 2.0 artlist URL from ctx params', async () => {
    const fetchImpl = mockFetch(GDELT_ARTLIST_FIXTURE);
    const def = makeGdeltConnector(fetchImpl);

    await def.fetch({ query: 'copper AND sanctions', maxRecords: 50 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(fetchImpl.mock.calls[0]?.[0] as string);
    expect(url.origin + url.pathname).toBe('https://api.gdeltproject.org/api/v2/doc/doc');
    expect(url.searchParams.get('query')).toBe('copper AND sanctions');
    expect(url.searchParams.get('mode')).toBe('artlist');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('maxrecords')).toBe('50');
  });

  it('applies sane defaults when ctx is omitted (query set, maxrecords <= 250, default timespan)', async () => {
    const fetchImpl = mockFetch(GDELT_ARTLIST_FIXTURE);
    const def = makeGdeltConnector(fetchImpl);

    await def.fetch();

    const url = new URL(fetchImpl.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get('query')).toBeTruthy();
    const maxrecords = Number(url.searchParams.get('maxrecords'));
    expect(maxrecords).toBeGreaterThanOrEqual(1);
    expect(maxrecords).toBeLessThanOrEqual(250);
    expect(url.searchParams.get('timespan')).toBe('1d');
  });

  it('clamps maxRecords to the GDELT cap of 250', async () => {
    const fetchImpl = mockFetch(GDELT_ARTLIST_FIXTURE);
    const def = makeGdeltConnector(fetchImpl);

    await def.fetch({ maxRecords: 9999 });

    const url = new URL(fetchImpl.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get('maxrecords')).toBe('250');
  });

  it('derives timespan (in minutes) from ctx.since', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));

    const fetchImpl = mockFetch(GDELT_ARTLIST_FIXTURE);
    const def = makeGdeltConnector(fetchImpl);

    await def.fetch({ since: '2026-07-02T12:00:00.000Z' }); // exactly 24h ago

    const url = new URL(fetchImpl.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get('timespan')).toBe('1440min');
  });

  it('falls back to the default timespan when ctx.since is unparseable', async () => {
    const fetchImpl = mockFetch(GDELT_ARTLIST_FIXTURE);
    const def = makeGdeltConnector(fetchImpl);

    await def.fetch({ since: 'not-a-date' });

    const url = new URL(fetchImpl.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get('timespan')).toBe('1d');
  });
});

// ---------------------------------------------------------------------------
// JSON → RawBatch normalisation
// ---------------------------------------------------------------------------

describe('makeGdeltConnector — artlist normalisation', () => {
  it('normalises the artlist into RawBatch records matching the mapper input shape', async () => {
    const def = makeGdeltConnector(mockFetch(GDELT_ARTLIST_FIXTURE));

    const batch = await def.fetch({ query: 'copper' });

    expect(batch.sourceKey).toBe('gdelt');
    expect(Date.parse(batch.fetchedAt)).not.toBeNaN();
    expect(batch.records).toHaveLength(2);

    const first = batch.records[0] as Record<string, unknown>;
    expect(first.name).toBe('New sanctions ripple through copper markets');
    expect(first.url).toBe('https://example.com/news/copper-sanctions');
    expect(first.type).toBe('news');
    expect(first.date).toBe('2026-07-03T08:15:00Z'); // seendate → ISO 8601
    expect(typeof first.id).toBe('string');
    expect(first.id).not.toBe('');
  });

  it('returns an empty (real) batch when GDELT returns no articles — never fabricates records', async () => {
    const def = makeGdeltConnector(mockFetch({ articles: [] }));
    const batch = await def.fetch();
    expect(batch.records).toEqual([]);
  });

  it('throws on non-200 responses with the status in the message', async () => {
    const def = makeGdeltConnector(mockFetch({}, 502));
    await expect(def.fetch()).rejects.toThrow(/502/);
  });

  it('propagates network errors from the injected fetcher (caller handles)', async () => {
    const failing: GdeltFetchImpl = async () => {
      throw new Error('ECONNRESET');
    };
    const def = makeGdeltConnector(failing);
    await expect(def.fetch()).rejects.toThrow('ECONNRESET');
  });

  it('throws loudly on an unexpected response shape instead of returning fabricated records', async () => {
    const def = makeGdeltConnector(mockFetch('not json we expected'));
    await expect(def.fetch()).rejects.toThrow(/unexpected/i);
  });
});

// ---------------------------------------------------------------------------
// Expectations align with the REAL mapper — end to end through runConnector
// ---------------------------------------------------------------------------

describe('GDELT_EXPECTATIONS — aligned with mapGdeltEvent', () => {
  it('accepts a normalised fixture batch and produces valid pending proposals via runConnector', async () => {
    const def = makeGdeltConnector(mockFetch(GDELT_ARTLIST_FIXTURE));
    const deps = makeDeps();

    const result = await runConnector(def, deps);

    expect(result.status).toBe('proposed');
    if (result.status !== 'proposed') return;
    expect(result.sourceKey).toBe('gdelt');
    expect(result.skippedRecords).toBe(0);
    expect(result.proposedCount).toBe(2); // one Event entity per article
    expect(deps.propose).toHaveBeenCalledTimes(2);
    for (const proposal of result.proposals) {
      expect(proposal.kind).toBe('create_entity');
      expect(proposal.status).toBe('pending');
      expect(proposal.tenant_id).toBe(TENANT_ID);
      expect((proposal.payload as Record<string, unknown>).type).toBe('event');
    }
  });

  it('normalised records pass the hard expectations exactly (no gate/mapper drift)', async () => {
    const def = makeGdeltConnector(mockFetch(GDELT_ARTLIST_FIXTURE));
    const batch = await def.fetch();

    const report = runExpectations(batch.records, GDELT_EXPECTATIONS);
    expect(report.batchAccepted).toBe(true);

    // Every gated record must actually map to at least one entity — the
    // hard expectation mirrors the mapper's real requirement (name present).
    for (const record of batch.records) {
      const mapped = mapGdeltEvent(record, TENANT_ID);
      expect(mapped.entities.length).toBeGreaterThan(0);
    }
  });

  it('HARD-FAIL: an article without a title holds back the whole batch — mapper/propose never run', async () => {
    const broken = {
      articles: [
        GDELT_ARTLIST_FIXTURE.articles[0],
        { url: 'https://example.com/untitled', seendate: '20260703T000000Z', domain: 'example.com' },
      ],
    };
    const def = makeGdeltConnector(mockFetch(broken));
    const deps = makeDeps();

    const result = await runConnector(def, deps);

    expect(result.status).toBe('held');
    if (result.status !== 'held') return;
    expect(result.report.batchAccepted).toBe(false);
    expect(result.report.hardFailures.length).toBeGreaterThan(0);
    expect(deps.mapper).not.toHaveBeenCalled();
    expect(deps.propose).not.toHaveBeenCalled();
  });
});
