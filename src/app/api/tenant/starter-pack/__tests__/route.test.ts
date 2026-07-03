/**
 * KINTEL v2.4 — POST /api/tenant/starter-pack tests (PRD §17.5)
 *
 * Written FIRST (TDD). Covers:
 *   - 401 anonymous (same bearer guard as /api/signals/scan)
 *   - 401 when no tenant resolves from the signed handoff contract
 *   - 403 when the caller's JWT app_metadata.cp_role is not a provisioning
 *     role (super_admin / owner / admin) — fail closed on opaque tokens
 *   - 400 unknown / missing pack
 *   - happy path: one upsert into intel.tenant_source_flags with
 *     on_conflict=tenant_id,source_key + merge-duplicates (idempotent),
 *     valid auth_mode values only (never the invalid literal 'platform')
 *   - 502 on DB failure (zero silent failure)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { signHandoffToken } from '@/lib/handoff/token';
import { STARTER_PACKS } from '@/config/starter-packs';

const SECRET = 'test-secret-do-not-use-in-prod';
const VALID_AUTH_MODES = ['none', 'platform-key', 'tenant-key']; // migrations/intel/0002 CHECK

function fakeSupabaseJwt(cpRole?: string): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload: Record<string, unknown> = { sub: 'user-1', role: 'authenticated' };
  payload.app_metadata = cpRole === undefined ? {} : { cp_role: cpRole };
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.fakesig`;
}

function makeRequest(opts: {
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): NextRequest {
  return new NextRequest(`http://localhost${opts.path ?? '/api/tenant/starter-pack'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

function tokenPath(tenant = 'pfo'): string {
  const token = signHandoffToken(tenant, 120, SECRET);
  return `/api/tenant/starter-pack?t=${encodeURIComponent(token)}`;
}

function adminHeaders(role = 'admin'): Record<string, string> {
  return { Authorization: `Bearer ${fakeSupabaseJwt(role)}` };
}

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Stub global fetch, mimicking PostgREST for POST intel.tenant_source_flags. */
function stubDbFetch(opts: { upsertOk?: boolean } = {}): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: (init?.method ?? 'GET').toUpperCase(),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      if (url.includes('tenant_source_flags')) {
        const ok = opts.upsertOk !== false;
        return { ok, status: ok ? 201 : 500, json: async () => [], text: async () => '' };
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    }),
  );
  return { calls };
}

describe('POST /api/tenant/starter-pack', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.INTEL_HANDOFF_SECRET = SECRET;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('401 when there is no Authorization header', async () => {
    stubDbFetch();
    const res = await POST(makeRequest({ path: tokenPath(), body: { pack: 'finance' } }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBeTruthy();
  });

  it('403 when the bearer token is not a decodable JWT (fail closed)', async () => {
    stubDbFetch();
    const res = await POST(
      makeRequest({
        path: tokenPath(),
        headers: { Authorization: 'Bearer just-an-opaque-string' },
        body: { pack: 'finance' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('403 when cp_role is not a provisioning role', async () => {
    for (const role of ['user', 'executive', 'accountant']) {
      stubDbFetch();
      const res = await POST(
        makeRequest({ path: tokenPath(), headers: adminHeaders(role), body: { pack: 'finance' } }),
      );
      expect(res.status, `role "${role}" must be rejected`).toBe(403);
    }
  });

  it('403 when app_metadata carries no cp_role at all', async () => {
    stubDbFetch();
    const res = await POST(
      makeRequest({
        path: tokenPath(),
        headers: { Authorization: `Bearer ${fakeSupabaseJwt()}` }, // app_metadata: {}
        body: { pack: 'finance' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('400 for an unknown pack', async () => {
    stubDbFetch();
    const res = await POST(
      makeRequest({ path: tokenPath(), headers: adminHeaders(), body: { pack: 'crypto-degen' } }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('pack');
  });

  it('400 when the body is missing a pack or is invalid JSON', async () => {
    stubDbFetch();
    const noPack = await POST(makeRequest({ path: tokenPath(), headers: adminHeaders(), body: {} }));
    expect(noPack.status).toBe(400);

    const badJson = new NextRequest(`http://localhost${tokenPath()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: '{not json',
    });
    expect((await POST(badJson)).status).toBe(400);
  });

  it('401 when no tenant resolves (no handoff token)', async () => {
    stubDbFetch();
    const res = await POST(makeRequest({ headers: adminHeaders(), body: { pack: 'finance' } }));
    expect(res.status).toBe(401);
  });

  it('happy path: upserts one row per pack source into intel.tenant_source_flags', async () => {
    const { calls } = stubDbFetch();
    const res = await POST(
      makeRequest({ path: tokenPath('pfo'), headers: adminHeaders('owner'), body: { pack: 'finance' } }),
    );
    expect(res.status).toBe(200);

    const financePack = STARTER_PACKS['finance']!;
    const body = await res.json();
    expect(body.pack).toBe('finance');
    expect(body.applied).toBe(financePack.sources.length);
    expect(body.sources).toEqual(financePack.sources);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe('POST');
    const url = new URL(call.url);
    expect(url.pathname).toBe('/rest/v1/tenant_source_flags');
    expect(url.searchParams.get('on_conflict')).toBe('tenant_id,source_key');
    expect(call.headers['Content-Profile']).toBe('intel');
    expect(call.headers['Prefer']).toContain('resolution=merge-duplicates');

    const rows = call.body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(financePack.sources.length);
    for (const row of rows) {
      expect(row.tenant_id).toBe('pfo');
      expect(VALID_AUTH_MODES).toContain(row.auth_mode); // never the invalid 'platform'
      expect(typeof row.enabled).toBe('boolean');
      const packSource = financePack.sources.find((s) => s.key === row.source_key);
      expect(packSource, `unexpected row for "${String(row.source_key)}"`).toBeDefined();
      expect(row.enabled).toBe(packSource!.enabled);
    }
  });

  it('idempotency: re-provisioning sends the identical upsert and the same response', async () => {
    const { calls } = stubDbFetch();
    const first = await POST(
      makeRequest({ path: tokenPath('pfo'), headers: adminHeaders(), body: { pack: 'marketing' } }),
    );
    const second = await POST(
      makeRequest({ path: tokenPath('pfo'), headers: adminHeaders(), body: { pack: 'marketing' } }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual(calls[0]!.body);
    expect(calls[1]!.url).toBe(calls[0]!.url);
  });

  it('502 when the upsert fails at the database (zero silent failure)', async () => {
    stubDbFetch({ upsertOk: false });
    const res = await POST(
      makeRequest({ path: tokenPath(), headers: adminHeaders(), body: { pack: 'generic' } }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBeTruthy();
  });

  it('502 when the database is not configured (never a silent no-op)', async () => {
    stubDbFetch();
    delete process.env.SUPABASE_URL;
    const res = await POST(
      makeRequest({ path: tokenPath(), headers: adminHeaders(), body: { pack: 'generic' } }),
    );
    expect(res.status).toBe(502);
  });
});
