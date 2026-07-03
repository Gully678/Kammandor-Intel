/**
 * KINTEL v2.3 — GET /api/signals/alerts tests (PRD §10 dashboard feed)
 *
 * Written FIRST (TDD). Covers:
 *   - 401 when no tenant resolves
 *   - 400 for malformed status/severity filters
 *   - happy path: tenant scoping, explicit column allowlist on
 *     public.intelligence_alerts, severity/status filter pass-through
 *   - limit clamping (default 50, max 200)
 *   - 502 when the alert store is unreachable (fail loudly, never silently)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { signHandoffToken } from '@/lib/handoff/token';

const SECRET = 'test-secret-do-not-use-in-prod';
const TENANT = 'pfo';

function tokenised(query = ''): NextRequest {
  const t = encodeURIComponent(signHandoffToken(TENANT, 120, SECRET));
  const sep = query ? `&${query}` : '';
  return new NextRequest(`http://localhost/api/signals/alerts?t=${t}${sep}`);
}

const ALERT_ROW = {
  id: '44444444-4444-4444-8444-444444444444',
  headline: 'Sukuk issuance in UAE expands',
  detail: 'Major issuance announced.',
  severity: 'high',
  source_url: 'https://news.example/a',
  status: 'open',
  created_at: '2026-07-03T00:00:00+00:00',
};

function stubDbFetch(rows: unknown[] = [], ok = true): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      calls.push(String(input));
      return { ok, status: ok ? 200 : 500, json: async () => rows };
    }),
  );
  return { calls };
}

describe('GET /api/signals/alerts', () => {
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

  it('returns 401 when no tenant can be resolved', async () => {
    stubDbFetch();
    const res = await GET(new NextRequest('http://localhost/api/signals/alerts'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for a malformed severity filter', async () => {
    stubDbFetch();
    const res = await GET(tokenised('severity=%3B%20drop%20table'));
    expect(res.status).toBe(400);
  });

  it('lists alerts tenant-scoped with an explicit column allowlist and severity/status filters', async () => {
    const { calls } = stubDbFetch([ALERT_ROW]);
    const res = await GET(tokenised('severity=high&status=open'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.alerts).toEqual([expect.objectContaining({
      id: ALERT_ROW.id,
      headline: ALERT_ROW.headline,
      severity: 'high',
      status: 'open',
      source_url: ALERT_ROW.source_url,
    })]);

    const url = new URL(calls[0] as string);
    expect(url.pathname).toContain('/rest/v1/intelligence_alerts');
    expect(url.searchParams.get('organization_id')).toBe(`eq.${TENANT}`);
    expect(url.searchParams.get('severity')).toBe('eq.high');
    expect(url.searchParams.get('status')).toBe('eq.open');
    expect(url.searchParams.get('select')).toBe(
      'id,headline,detail,severity,source_url,status,created_at',
    );
  });

  it('clamps limit to 200 and defaults to 50', async () => {
    const { calls } = stubDbFetch([]);
    await GET(tokenised('limit=9999'));
    expect(new URL(calls[0] as string).searchParams.get('limit')).toBe('200');
    await GET(tokenised());
    expect(new URL(calls[1] as string).searchParams.get('limit')).toBe('50');
  });

  it('fails loudly (502) when the alert store cannot be reached', async () => {
    stubDbFetch([], false);
    const res = await GET(tokenised());
    expect(res.status).toBe(502);
  });
});
