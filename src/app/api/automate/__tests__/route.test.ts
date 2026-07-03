/**
 * KINTEL v2 — /api/automate route tests (PRD v2.0 §9.5)
 *
 * Written FIRST (TDD). runAutomateCycle is mocked (the cycle has its own
 * suite in src/lib/automate/__tests__/cycle.test.ts) — these tests cover
 * the route's OWN duties:
 *   - shared-secret guard: 401 on absent/mismatched x-automate-secret,
 *     503 'automate not configured' when AUTOMATE_SECRET is unset
 *     (explicit not-configured state — never silently open);
 *   - GET accepted with identical guard semantics, INCLUDING ?secret=
 *     (Vercel cron sends GET and cannot set custom headers on Hobby);
 *   - tenant watchlists loaded server-side with an EXPLICIT column
 *     allowlist — REGRESSION: never '*', never property_api_credentials;
 *   - 200 happy path returns the CycleSummary as JSON; unexpected errors
 *     surface as a safe 500.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, POST } from '../route';
import { runAutomateCycle, type CycleSummary } from '@/lib/automate/cycle';

vi.mock('@/lib/automate/cycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/automate/cycle')>();
  return { ...actual, runAutomateCycle: vi.fn() };
});

const SECRET = 'test-automate-secret-do-not-use';

const FAKE_SUMMARY: CycleSummary = {
  startedAt: '2026-07-03T12:00:00.000Z',
  finishedAt: '2026-07-03T12:00:05.000Z',
  events: 2,
  pipeline: { status: 'proposed', proposedCount: 4 },
  tenants: [{ tenantId: 'tenant-a', matched: 1, inserted: 1, skippedDuplicates: 0 }],
  failures: [],
};

function makeRequest(opts: {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  query?: string;
} = {}): NextRequest {
  return new NextRequest(`http://localhost/api/automate${opts.query ?? ''}`, {
    method: opts.method ?? 'POST',
    headers: opts.headers ?? {},
  });
}

/** Stub PostgREST for the tenant watchlist load; records every fetch URL. */
function stubDbFetch(watchlistRows: unknown[] = []): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('km_monitoring_config')) {
        return { ok: true, json: async () => watchlistRows };
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    }),
  );
  return { urls };
}

describe('/api/automate', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AUTOMATE_SECRET = SECRET;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    vi.mocked(runAutomateCycle).mockReset();
    vi.mocked(runAutomateCycle).mockResolvedValue(FAKE_SUMMARY);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('503 explicit not-configured when AUTOMATE_SECRET is unset (never silently open)', async () => {
    delete process.env.AUTOMATE_SECRET;
    stubDbFetch();
    const res = await POST(makeRequest({ headers: { 'x-automate-secret': SECRET } }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('not configured');
    expect(runAutomateCycle).not.toHaveBeenCalled();
  });

  it('401 when the secret header is absent', async () => {
    stubDbFetch();
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(runAutomateCycle).not.toHaveBeenCalled();
  });

  it('401 when the secret header mismatches', async () => {
    const db = stubDbFetch();
    const res = await POST(makeRequest({ headers: { 'x-automate-secret': 'wrong-secret' } }));
    expect(res.status).toBe(401);
    expect(runAutomateCycle).not.toHaveBeenCalled();
    expect(db.urls).toHaveLength(0); // nothing touched before the guard
  });

  it('401 when the ?secret= query param mismatches (cron path)', async () => {
    stubDbFetch();
    const res = await GET(makeRequest({ method: 'GET', query: '?secret=wrong' }));
    expect(res.status).toBe(401);
    expect(runAutomateCycle).not.toHaveBeenCalled();
  });

  it('200 happy path (POST + header): returns the CycleSummary as JSON', async () => {
    stubDbFetch([
      {
        organization_id: 'tenant-a',
        keywords: ['sukuk'],
        entities: [],
        tickers: [],
        geos: ['UAE'],
        property_api_credentials: { must: 'never-reach-the-watchlist' },
      },
    ]);
    const res = await POST(makeRequest({ headers: { 'x-automate-secret': SECRET } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FAKE_SUMMARY);

    // The cycle received the allowlisted tenant watchlist — and ONLY that.
    expect(runAutomateCycle).toHaveBeenCalledTimes(1);
    const deps = vi.mocked(runAutomateCycle).mock.calls[0]?.[0];
    expect(deps?.tenants).toEqual([
      {
        id: 'tenant-a',
        watchlist: { keywords: ['sukuk'], entities: [], tickers: [], geos: ['UAE'] },
      },
    ]);
    expect(JSON.stringify(deps?.tenants)).not.toContain('property_api_credentials');
  });

  it('200 via GET with ?secret= (Vercel cron cannot set custom headers on Hobby)', async () => {
    stubDbFetch();
    const res = await GET(
      makeRequest({ method: 'GET', query: `?secret=${encodeURIComponent(SECRET)}` }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FAKE_SUMMARY);
  });

  it("REGRESSION: watchlist query uses the explicit allowlist — never '*', never property_api_credentials", async () => {
    const db = stubDbFetch();
    await POST(makeRequest({ headers: { 'x-automate-secret': SECRET } }));

    const watchlistUrl = db.urls.find((u) => u.includes('km_monitoring_config'));
    expect(watchlistUrl).toBeDefined();
    expect(watchlistUrl).toContain(
      `select=${encodeURIComponent('organization_id,keywords,entities,tickers,geos')}`,
    );
    expect(watchlistUrl).not.toContain('*');
    expect(watchlistUrl).not.toContain('property_api_credentials');
  });

  it('502 loud failure when the tenant watchlists cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => [] })),
    );
    const res = await POST(makeRequest({ headers: { 'x-automate-secret': SECRET } }));
    expect(res.status).toBe(502);
    expect(runAutomateCycle).not.toHaveBeenCalled();
  });

  it('500 safe message when the cycle throws unexpectedly', async () => {
    stubDbFetch();
    vi.mocked(runAutomateCycle).mockRejectedValue(new Error('secret-internal-detail'));
    const res = await POST(makeRequest({ headers: { 'x-automate-secret': SECRET } }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('secret-internal-detail');
  });
});
