/**
 * KINTEL v2.3 — POST /api/ontology/query tests (PRD §10.2 graph surface)
 *
 * Written FIRST (TDD). Covers:
 *   - 401 when no tenant resolves
 *   - 400 for a bad shape (missing start / no type-or-ids / bad direction)
 *   - 400 when traversal depth exceeds 3
 *   - happy path: a 2-hop traversal executed as sequential tenant-scoped
 *     selects returning deduplicated nodes + edges
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { signHandoffToken } from '@/lib/handoff/token';

const SECRET = 'test-secret-do-not-use-in-prod';
const TENANT = 'pfo';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function makeRequest(body: unknown): NextRequest {
  const t = encodeURIComponent(signHandoffToken(TENANT, 120, SECRET));
  return new NextRequest(`http://localhost/api/ontology/query?t=${t}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function entityRow(id: string, type: string, name: string): Record<string, unknown> {
  return {
    id,
    type,
    canonical_name: name,
    properties: {},
    risk_score: null,
    risk_category: null,
    lei: null,
    company_number: null,
    imo: null,
    mmsi: null,
    isin: null,
    wallet_address: null,
    jurisdiction_code: null,
    created_at: '2026-07-01T00:00:00+00:00',
    updated_at: '2026-07-01T00:00:00+00:00',
  };
}

function linkRow(id: string, source: string, target: string, type: string): Record<string, unknown> {
  return { id, source_entity_id: source, target_entity_id: target, type, properties: {} };
}

/** Queue-based PostgREST stub: entity and link responses are consumed in order. */
function stubDbFetch(entityPages: unknown[][], linkPages: unknown[][]): { calls: string[] } {
  const calls: string[] = [];
  const entities = [...entityPages];
  const links = [...linkPages];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/rest/v1/link')) {
        return { ok: true, json: async () => links.shift() ?? [] };
      }
      if (url.includes('/rest/v1/entity')) {
        return { ok: true, json: async () => entities.shift() ?? [] };
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    }),
  );
  return { calls };
}

describe('POST /api/ontology/query', () => {
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
    stubDbFetch([], []);
    const res = await POST(
      new NextRequest('http://localhost/api/ontology/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: { type: 'company' } }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 for bad shapes', async () => {
    stubDbFetch([], []);
    for (const bad of [
      {},
      { start: {} },
      { start: { type: 'starship' } },
      { start: { ids: 'not-an-array' } },
      { start: { ids: [A] }, traverse: [{ direction: 'up' }] },
      { start: { ids: ['not-a-uuid'] } },
    ]) {
      const res = await POST(makeRequest(bad));
      expect(res.status).toBe(400);
    }
  });

  it('returns 400 when traversal depth exceeds 3', async () => {
    stubDbFetch([], []);
    const res = await POST(
      makeRequest({
        start: { ids: [A] },
        traverse: [
          { direction: 'out' },
          { direction: 'out' },
          { direction: 'out' },
          { direction: 'out' },
        ],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.error)).toContain('3');
  });

  it('executes a 2-hop traversal as sequential tenant-scoped selects and returns nodes + edges', async () => {
    const { calls } = stubDbFetch(
      [
        [entityRow(A, 'deal', 'Ijara Sukuk 2026-A')],
        [entityRow(B, 'company', 'Counterparty Ltd')],
        [entityRow(C, 'person', 'J. Director')],
      ],
      [
        [linkRow('e1', A, B, 'deal_company')],
        [linkRow('e2', C, B, 'isDirectorOf')],
      ],
    );

    const res = await POST(
      makeRequest({
        start: { ids: [A] },
        traverse: [
          { direction: 'out', linkType: 'deal_company' },
          { direction: 'in', targetType: 'person' },
        ],
        limit: 10,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.nodes.map((n: { id: string }) => n.id).sort()).toEqual([A, B, C].sort());
    expect(body.edges).toHaveLength(2);
    expect(body.edges[0]).toMatchObject({ id: 'e1', source: A, target: B, type: 'deal_company' });
    expect(body.edges[1]).toMatchObject({ id: 'e2', source: C, target: B, type: 'isDirectorOf' });

    for (const u of calls) {
      const p = new URL(u).searchParams;
      expect(p.get('tenant_id')).toBe(`eq.${TENANT}`);
      expect(p.get('select') ?? '').not.toContain('*');
    }

    const hop1 = calls.find((u) => u.includes('/rest/v1/link'));
    expect(new URL(hop1 as string).searchParams.get('type')).toBe('eq.deal_company');
  });
});
