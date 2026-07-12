/**
 * KINTEL Phase 2 — Ontology ingest route auth-hardening tests (slice 3b,
 * hardened again — see route.ts's POST doc comment and authRpc.ts's
 * verifySupabaseUserToken doc comment for the full rationale).
 *
 * The ingest route (src/app/api/ontology/ingest/route.ts) writes only to
 * intel.proposed_edit, but must reject anonymous AND forged callers. These
 * tests assert:
 *   - No auth at all -> 401.
 *   - Malformed Authorization header -> 401.
 *   - A syntactically valid but JUNK bearer token -> 401 (Supabase's
 *     /auth/v1/user rejects it — this is the actual hardening: the old
 *     presence-only check would have let this through).
 *   - A valid x-automate-secret (matching env AUTOMATE_SECRET) -> passes the
 *     gate WITHOUT ever calling Supabase.
 *   - A wrong x-automate-secret -> 401, even when AUTOMATE_SECRET is set.
 *   - A bearer token that Supabase's /auth/v1/user resolves to a real user
 *     -> passes the gate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

function makeRequest(opts: { headers?: Record<string, string>; body?: unknown }): NextRequest {
  return new NextRequest('http://localhost/api/ontology/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

describe('POST /api/ontology/ingest — auth hardening', () => {
  const ORIGINAL_AUTOMATE    = process.env.AUTOMATE_SECRET;
  const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
  const ORIGINAL_ANON_KEY    = process.env.SUPABASE_ANON_KEY;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env.AUTOMATE_SECRET;
    process.env.SUPABASE_URL      = 'https://stub.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'stub-anon-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (ORIGINAL_AUTOMATE === undefined) delete process.env.AUTOMATE_SECRET;
    else process.env.AUTOMATE_SECRET = ORIGINAL_AUTOMATE;
    if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
    if (ORIGINAL_ANON_KEY === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = ORIGINAL_ANON_KEY;
  });

  it('returns 401 when no auth is provided at all (no Authorization, no x-automate-secret)', async () => {
    const req = makeRequest({ body: { source: 'gleif', tenant: 'test-tenant' } });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/Authorization/i);
  });

  it('returns 401 when Authorization header is empty', async () => {
    const req = makeRequest({
      headers: { Authorization: '' },
      body: { source: 'gleif', tenant: 'test-tenant' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header is malformed (no Bearer prefix)', async () => {
    const req = makeRequest({
      headers: { Authorization: 'sometoken' },
      body: { source: 'gleif', tenant: 'test-tenant' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 for a syntactically valid but JUNK bearer token (Supabase rejects it)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain('/auth/v1/user');
      return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = makeRequest({
      headers: { Authorization: 'Bearer junk-token-not-a-real-session' },
      body: { source: 'gleif', tenant: 'test-tenant' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes the auth gate with a valid x-automate-secret WITHOUT calling Supabase', async () => {
    process.env.AUTOMATE_SECRET = 'test-automate-secret';
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = makeRequest({
      headers: { 'x-automate-secret': 'test-automate-secret' },
      body: {},
    });
    const res = await POST(req);
    // 400 (past the auth gate) for missing "source" — proves auth passed.
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/source/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a wrong x-automate-secret even when AUTOMATE_SECRET is configured', async () => {
    process.env.AUTOMATE_SECRET = 'correct-secret';
    const req = makeRequest({
      headers: { 'x-automate-secret': 'wrong-secret' },
      body: {},
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('clears the auth gate with a Supabase-verified Bearer token and proceeds to body validation', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain('/auth/v1/user');
      return new Response(JSON.stringify({ id: 'real-user-uuid' }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = makeRequest({
      headers: { Authorization: 'Bearer real-session-token' },
      body: {},
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/source/i);
  });

  it('is case-insensitive on the Authorization header name and Bearer scheme', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'real-user-uuid' }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = makeRequest({ headers: { authorization: 'bearer real-session-token' }, body: {} });
    const res = await POST(req);
    // 400 (past the gate), not 401.
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// v2 §12.4 — ingest persists the eval-gate result on every inserted row.
//
// Stubs global fetch (the route's ONLY DB transport — a raw PostgREST POST
// to intel.proposed_edit; see the route's governance banner) and asserts
// each inserted row carries a structured `evaluation` object produced at
// propose time. Also re-asserts the governance boundary: exactly one fetch,
// targeting only /rest/v1/proposed_edit. Auth uses x-automate-secret here
// (not a bearer token) precisely so this stays a single-fetch test — a
// bearer token would add a second fetch (the Supabase verification call).
// ---------------------------------------------------------------------------

describe('POST /api/ontology/ingest — persists evaluation on inserted proposed_edit rows (v2 §12.4)', () => {
  const ORIGINAL_URL      = process.env.SUPABASE_URL;
  const ORIGINAL_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ORIGINAL_AUTOMATE = process.env.AUTOMATE_SECRET;
  const originalFetch = globalThis.fetch;

  const GLEIF_RECORD = {
    id: '5493001KJTIIGC8Y1R12',
    attributes: {
      lei: '5493001KJTIIGC8Y1R12',
      entity: {
        legalName: { name: 'Acme International Ltd' },
        status: 'ACTIVE',
        jurisdiction: 'GB',
        registeredAddress: { country: 'GB' },
      },
    },
  };

  beforeEach(() => {
    process.env.SUPABASE_URL              = 'https://stub.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key';
    process.env.AUTOMATE_SECRET           = 'stub-automate-secret';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (ORIGINAL_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_URL;
    if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
    if (ORIGINAL_AUTOMATE === undefined) delete process.env.AUTOMATE_SECRET;
    else process.env.AUTOMATE_SECRET = ORIGINAL_AUTOMATE;
  });

  it('every inserted proposed_edit row carries a structured evaluation object', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = makeRequest({
      headers: { 'x-automate-secret': 'stub-automate-secret' },
      body: { source: 'gleif', tenant: 'test-tenant', records: [GLEIF_RECORD] },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.proposed).toBeGreaterThan(0);

    // Governance: exactly one write, and only to intel.proposed_edit.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/rest/v1/proposed_edit');

    const rows = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(json.proposed);
    for (const row of rows) {
      expect(row.status).toBe('pending');
      expect(row.evaluation).toBeDefined();
      const evaluation = row.evaluation as { passed: boolean; score: number; checks: string[] };
      expect(typeof evaluation.passed).toBe('boolean');
      expect(typeof evaluation.score).toBe('number');
      expect(Array.isArray(evaluation.checks)).toBe(true);
    }
  });
});
