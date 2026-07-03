/**
 * KINTEL v2 — POST /api/signals/scan tests (PRD v2.0 §9.5–9.6)
 *
 * Written FIRST (TDD). Covers:
 *   - 401 for anonymous callers (same bearer guard as /api/ontology/ingest)
 *   - 401 when no tenant resolves (same handoff contract as monitoring-config)
 *   - 400 for invalid bodies (non-array events, >500 events, missing fields)
 *   - happy path: watchlist load -> deterministic match -> dedupe -> insert
 *   - REGRESSION: the km_monitoring_config query must use an explicit column
 *     allowlist — never '*' and never property_api_credentials (secrets).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { signHandoffToken } from '@/lib/handoff/token';

const SECRET = 'test-secret-do-not-use-in-prod';
const AUTH = { Authorization: 'Bearer test-token' };

function makeRequest(opts: {
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): NextRequest {
  return new NextRequest(`http://localhost${opts.path ?? '/api/signals/scan'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

function tokenPath(tenant = 'pfo'): string {
  const token = signHandoffToken(tenant, 120, SECRET);
  return `/api/signals/scan?t=${encodeURIComponent(token)}`;
}

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Stub global fetch with a dispatcher that mimics PostgREST for:
 *   GET  km_monitoring_config  -> watchlistRows
 *   GET  intelligence_alerts   -> existingRows
 *   POST intelligence_alerts   -> insert (ok/failure)
 */
function stubDbFetch(opts: {
  watchlistRows?: unknown[];
  existingRows?: unknown[];
  insertOk?: boolean;
} = {}): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({
        url,
        method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      if (url.includes('km_monitoring_config')) {
        return { ok: true, json: async () => opts.watchlistRows ?? [] };
      }
      if (url.includes('intelligence_alerts') && method === 'GET') {
        return { ok: true, json: async () => opts.existingRows ?? [] };
      }
      if (url.includes('intelligence_alerts') && method === 'POST') {
        const ok = opts.insertOk !== false;
        return { ok, status: ok ? 201 : 500, json: async () => [], text: async () => '' };
      }
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    }),
  );
  return { calls };
}

function validEvents(): unknown[] {
  return [
    {
      title: 'Sukuk issuance in UAE expands',
      description: 'Major issuance announced.',
      url: 'https://news.example/a',
      occurredAt: '2026-07-03T00:00:00Z',
      sourceKey: 'test-feed',
    },
    {
      title: 'New sukuk fund launched',
      url: 'https://news.example/b',
      occurredAt: '2026-07-03T01:00:00Z',
      sourceKey: 'test-feed',
    },
    {
      title: 'Completely unrelated story',
      url: 'https://news.example/c',
      occurredAt: '2026-07-03T02:00:00Z',
      sourceKey: 'test-feed',
    },
  ];
}

const WATCHLIST_ROW = {
  organization_id: 'pfo',
  keywords: ['sukuk'],
  entities: [],
  tickers: [],
  geos: ['UAE'],
};

describe('POST /api/signals/scan', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.INTEL_HANDOFF_SECRET = SECRET;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    delete process.env.INTEL_ALLOW_UNSIGNED_TENANT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------- auth
  it('returns 401 when the Authorization header is missing', async () => {
    const res = await POST(makeRequest({ path: tokenPath(), body: { events: [] } }));
    expect(res.status).toBe(401);
  });

  it('returns 401 when the Authorization header is malformed', async () => {
    const res = await POST(
      makeRequest({ path: tokenPath(), headers: { Authorization: 'nope' }, body: { events: [] } }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when no tenant can be resolved (bearer ok, no handoff token)', async () => {
    const res = await POST(makeRequest({ headers: AUTH, body: { events: validEvents() } }));
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------- validation
  it('returns 400 for a non-JSON body', async () => {
    const req = new NextRequest(`http://localhost${tokenPath()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...AUTH },
      body: 'not-json{{{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when events is not an array', async () => {
    const res = await POST(
      makeRequest({ path: tokenPath(), headers: AUTH, body: { events: 'nope' } }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when more than 500 events are submitted', async () => {
    const events = Array.from({ length: 501 }, (_, i) => ({
      title: `Event ${i}`,
      occurredAt: '2026-07-03T00:00:00Z',
      sourceKey: 'test-feed',
    }));
    const res = await POST(makeRequest({ path: tokenPath(), headers: AUTH, body: { events } }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when an event is missing title/sourceKey/occurredAt', async () => {
    for (const bad of [
      { sourceKey: 'test-feed', occurredAt: '2026-07-03T00:00:00Z' },
      { title: 'x', occurredAt: '2026-07-03T00:00:00Z' },
      { title: 'x', sourceKey: 'test-feed' },
    ]) {
      const res = await POST(
        makeRequest({ path: tokenPath(), headers: AUTH, body: { events: [bad] } }),
      );
      expect(res.status).toBe(400);
    }
  });

  // ---------------------------------------------------------- happy path
  it('matches against the watchlist, dedupes, inserts, and reports counts', async () => {
    const { calls } = stubDbFetch({
      watchlistRows: [WATCHLIST_ROW],
      // Event B's url already has an alert in the last 7 days -> skipped.
      existingRows: [{ source_url: 'https://news.example/b', headline: 'old' }],
    });

    const res = await POST(
      makeRequest({ path: tokenPath(), headers: AUTH, body: { events: validEvents() } }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ scanned: 3, matched: 2, inserted: 1, skippedDuplicates: 1 });

    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('intelligence_alerts'));
    expect(insert).toBeDefined();
    const rows = insert!.body as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: 'pfo',
      headline: 'Sukuk issuance in UAE expands',
      severity: 'CRITICAL',
      source_url: 'https://news.example/a',
      status: 'open',
    });
    expect(String(rows[0]!.detail)).toContain('Source: test-feed');
  });

  it('inserts nothing and reports zeros when nothing matches', async () => {
    const { calls } = stubDbFetch({ watchlistRows: [WATCHLIST_ROW] });
    const res = await POST(
      makeRequest({
        path: tokenPath(),
        headers: AUTH,
        body: {
          events: [
            {
              title: 'Completely unrelated story',
              occurredAt: '2026-07-03T00:00:00Z',
              sourceKey: 'test-feed',
            },
          ],
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scanned: 1,
      matched: 0,
      inserted: 0,
      skippedDuplicates: 0,
    });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('dedupes repeated events within the same batch', async () => {
    stubDbFetch({ watchlistRows: [WATCHLIST_ROW] });
    const dup = {
      title: 'New sukuk fund launched',
      url: 'https://news.example/b',
      occurredAt: '2026-07-03T00:00:00Z',
      sourceKey: 'test-feed',
    };
    const res = await POST(
      makeRequest({ path: tokenPath(), headers: AUTH, body: { events: [dup, dup] } }),
    );
    const json = await res.json();
    expect(json).toEqual({ scanned: 2, matched: 2, inserted: 1, skippedDuplicates: 1 });
  });

  it('returns 502 (not a silent success) when the alert insert fails', async () => {
    stubDbFetch({ watchlistRows: [WATCHLIST_ROW], insertOk: false });
    const res = await POST(
      makeRequest({ path: tokenPath(), headers: AUTH, body: { events: validEvents() } }),
    );
    expect(res.status).toBe(502);
  });

  // ---------------------------------------------------------- regression
  it('REGRESSION: never selects * or property_api_credentials from km_monitoring_config', async () => {
    const { calls } = stubDbFetch({ watchlistRows: [WATCHLIST_ROW] });
    await POST(
      makeRequest({ path: tokenPath(), headers: AUTH, body: { events: validEvents() } }),
    );

    const wlCall = calls.find((c) => c.url.includes('km_monitoring_config'));
    expect(wlCall).toBeDefined();
    const decoded = decodeURIComponent(wlCall!.url);
    expect(decoded).not.toContain('property_api_credentials');
    const select = new URL(wlCall!.url).searchParams.get('select');
    expect(select).toBeTruthy();
    expect(select).not.toContain('*');
    expect(decoded).toContain('organization_id=eq.pfo');
  });
});
