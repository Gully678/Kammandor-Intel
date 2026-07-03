/**
 * KINTEL v2.3 — GET /api/ontology/objects/[id] tests (PRD §10)
 *
 * Written FIRST (TDD). Covers:
 *   - 401 when no tenant resolves
 *   - 404 for a malformed id (no DB round-trip) and for an id not in tenant
 *   - happy path: full governed object view — links in both directions with
 *     LINK_TYPE_CATALOGUE labels where catalogued, provenance rows including
 *     licence fields, and change_log versions capped at 20
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { signHandoffToken } from '@/lib/handoff/token';

const SECRET = 'test-secret-do-not-use-in-prod';
const TENANT = 'pfo';
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function makeReq(id: string): { req: NextRequest; ctx: { params: Promise<{ id: string }> } } {
  const t = encodeURIComponent(signHandoffToken(TENANT, 120, SECRET));
  return {
    req: new NextRequest(`http://localhost/api/ontology/objects/${id}?t=${t}`),
    ctx: { params: Promise.resolve({ id }) },
  };
}

const ENTITY_ROW = {
  id: ID,
  type: 'deal',
  canonical_name: 'Ijara Sukuk 2026-A',
  properties: {},
  risk_score: null,
  risk_category: null,
  lei: null,
  company_number: null,
  imo: null,
  mmsi: null,
  isin: null,
  wallet_address: null,
  jurisdiction_code: 'AE',
  created_at: '2026-07-01T00:00:00+00:00',
  updated_at: '2026-07-02T00:00:00+00:00',
};

interface StubOpts {
  entityRows?: unknown[];
  linksOut?: unknown[];
  linksIn?: unknown[];
  provenance?: unknown[];
  versions?: unknown[];
}

function stubDbFetch(opts: StubOpts = {}): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      const params = new URL(url).searchParams;
      // NOTE: entity_provenance must be matched BEFORE entity ('/rest/v1/entity'
      // is a prefix of '/rest/v1/entity_provenance').
      if (url.includes('/rest/v1/entity_provenance')) {
        return { ok: true, json: async () => opts.provenance ?? [] };
      }
      if (url.includes('/rest/v1/entity')) {
        return { ok: true, json: async () => opts.entityRows ?? [] };
      }
      if (url.includes('/rest/v1/link')) {
        const rows = params.get('source_entity_id') ? opts.linksOut : opts.linksIn;
        return { ok: true, json: async () => rows ?? [] };
      }
      if (url.includes('/rest/v1/change_log')) {
        return { ok: true, json: async () => opts.versions ?? [] };
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    }),
  );
  return { calls };
}

describe('GET /api/ontology/objects/[id]', () => {
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
    const res = await GET(new NextRequest(`http://localhost/api/ontology/objects/${ID}`), {
      params: Promise.resolve({ id: ID }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 for a malformed (non-UUID) id without touching the DB', async () => {
    const { calls } = stubDbFetch();
    const { req, ctx } = makeReq('not-a-uuid');
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('returns 404 when the object does not exist in the tenant', async () => {
    stubDbFetch({ entityRows: [] });
    const { req, ctx } = makeReq(ID);
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns the full governed view: labelled links both ways, provenance with licence fields, versions capped at 20', async () => {
    const { calls } = stubDbFetch({
      entityRows: [ENTITY_ROW],
      linksOut: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          source_entity_id: ID,
          target_entity_id: OTHER,
          type: 'deal_company',
          properties: { role: 'counterparty' },
          created_at: '2026-07-01T00:00:00+00:00',
        },
      ],
      linksIn: [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          source_entity_id: OTHER,
          target_entity_id: ID,
          type: 'isNamedInDeal',
          properties: {},
          created_at: '2026-07-01T00:00:00+00:00',
        },
      ],
      provenance: [
        {
          source_key: 'gleif',
          source_url: 'https://api.gleif.org/x',
          fetched_at: '2026-06-30T00:00:00+00:00',
          confidence: 0.9,
          licence_class: 'public-open',
          licence_terms: 'CC0',
          property_path: 'properties.lei',
        },
      ],
      versions: [
        {
          op: 'UPDATE',
          actor: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          changed_at: '2026-07-02T00:00:00+00:00',
          before: { risk_score: null },
          after: { risk_score: 12.5 },
        },
      ],
    });

    const { req, ctx } = makeReq(ID);
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.object.id).toBe(ID);
    expect(body.object.identifiers.jurisdiction_code).toBe('AE');

    expect(body.links).toHaveLength(2);
    const out = body.links.find((l: { direction: string }) => l.direction === 'out');
    const inbound = body.links.find((l: { direction: string }) => l.direction === 'in');
    expect(out).toMatchObject({ type: 'deal_company', label: 'Deal ↔ Company', source: ID, target: OTHER });
    expect(inbound.type).toBe('isNamedInDeal');
    expect(inbound.label).toBeUndefined();

    expect(body.provenance).toEqual([
      expect.objectContaining({
        source_key: 'gleif',
        licence_class: 'public-open',
        licence_terms: 'CC0',
        property_path: 'properties.lei',
        confidence: 0.9,
      }),
    ]);

    expect(body.versions).toEqual([
      expect.objectContaining({ op: 'UPDATE', changed_at: '2026-07-02T00:00:00+00:00' }),
    ]);

    const changeLogUrl = calls.find((u) => u.includes('/rest/v1/change_log'));
    expect(changeLogUrl).toBeDefined();
    const clParams = new URL(changeLogUrl as string).searchParams;
    expect(clParams.get('limit')).toBe('20');
    expect(clParams.get('table_name')).toBe('eq.entity');
    expect(clParams.get('tenant_id')).toBe(`eq.${TENANT}`);

    for (const u of calls) {
      const p = new URL(u).searchParams;
      expect(p.get('select') ?? '').not.toContain('*');
    }
  });
});
