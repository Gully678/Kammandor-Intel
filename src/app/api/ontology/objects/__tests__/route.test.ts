/**
 * KINTEL v2.3 — GET /api/ontology/objects tests (PRD §10 headless read surface)
 *
 * Written FIRST (TDD). Covers:
 *   - 401 when no tenant resolves (signed handoff contract, same as
 *     /api/intel/monitoring-config)
 *   - 400 for an unknown ?type=
 *   - happy path: explicit column allowlist (never '*'), tenant_id scoping,
 *     Accept-Profile: intel, grouped identifiers in the response
 *   - limit clamping (default 50, max 200)
 *   - created_at keyset cursor in and nextCursor out
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
  return new NextRequest(`http://localhost/api/ontology/objects?t=${t}${sep}`);
}

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}

function entityRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'company',
    canonical_name: 'Pitt Family Office FZE',
    properties: { sector: 'family office' },
    risk_score: 12.5,
    risk_category: 'low',
    lei: '5493001KJTIIGC8Y1R12',
    company_number: null,
    imo: null,
    mmsi: null,
    isin: null,
    wallet_address: null,
    jurisdiction_code: 'AE',
    created_at: '2026-07-01T00:00:00+00:00',
    updated_at: '2026-07-02T00:00:00+00:00',
    ...overrides,
  };
}

function stubDbFetch(rows: unknown[] = [], ok = true): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return { ok, status: ok ? 200 : 500, json: async () => rows };
    }),
  );
  return { calls };
}

describe('GET /api/ontology/objects', () => {
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
    const res = await GET(new NextRequest('http://localhost/api/ontology/objects'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for a type not in ENTITY_TYPES', async () => {
    stubDbFetch();
    const res = await GET(tokenised('type=starship'));
    expect(res.status).toBe(400);
  });

  it('lists objects with grouped identifiers, tenant scoping, an explicit column allowlist and the intel profile', async () => {
    const { calls } = stubDbFetch([entityRow()]);
    const res = await GET(tokenised('type=company&q=pitt'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.objects).toHaveLength(1);
    expect(body.objects[0]).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      type: 'company',
      canonical_name: 'Pitt Family Office FZE',
      risk_score: 12.5,
      risk_category: 'low',
      identifiers: { lei: '5493001KJTIIGC8Y1R12', jurisdiction_code: 'AE' },
    });
    expect(body.objects[0].tenant_id).toBeUndefined();
    expect(body.nextCursor).toBeNull();

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.pathname).toContain('/rest/v1/entity');
    expect(url.searchParams.get('tenant_id')).toBe(`eq.${TENANT}`);
    expect(url.searchParams.get('type')).toBe('eq.company');
    expect(url.searchParams.get('canonical_name')).toContain('ilike.');
    const select = url.searchParams.get('select') ?? '';
    expect(select).not.toContain('*');
    expect(select.split(',')).toEqual(
      expect.arrayContaining(['id', 'type', 'canonical_name', 'risk_score', 'created_at', 'updated_at']),
    );
    expect(calls[0].headers['Accept-Profile']).toBe('intel');
  });

  it('clamps limit to 200 and defaults to 50', async () => {
    const { calls } = stubDbFetch([]);
    await GET(tokenised('limit=99999'));
    expect(new URL(calls[0].url).searchParams.get('limit')).toBe('200');
    await GET(tokenised());
    expect(new URL(calls[1].url).searchParams.get('limit')).toBe('50');
  });

  it('applies the cursor as a created_at keyset filter and returns nextCursor when the page is full', async () => {
    const rows = [
      entityRow({ id: '22222222-2222-4222-8222-222222222222', created_at: '2026-07-02T00:00:00+00:00' }),
      entityRow({ id: '33333333-3333-4333-8333-333333333333', created_at: '2026-07-01T00:00:00+00:00' }),
    ];
    const { calls } = stubDbFetch(rows);
    const res = await GET(tokenised('limit=2&cursor=2026-07-03T00%3A00%3A00%2B00%3A00'));
    const body = await res.json();

    const url = new URL(calls[0].url);
    expect(url.searchParams.get('created_at')).toBe('lt.2026-07-03T00:00:00+00:00');
    expect(body.nextCursor).toBe('2026-07-01T00:00:00+00:00');
  });

  it('fails loudly (502) when the object store cannot be reached', async () => {
    stubDbFetch([], false);
    const res = await GET(tokenised());
    expect(res.status).toBe(502);
  });
});
