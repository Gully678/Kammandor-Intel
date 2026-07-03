/**
 * KINTEL Phase 2 — Ontology ingest route auth-hardening tests (slice 3b)
 *
 * The ingest route (src/app/api/ontology/ingest/route.ts) writes only to
 * intel.proposed_edit, but as of slice 3b it must still reject anonymous
 * callers. These tests assert:
 *   - No Authorization header -> 401, before any body/source validation.
 *   - Malformed Authorization header -> 401.
 *   - A syntactically valid bearer token clears the auth gate and the
 *     route proceeds to its existing (pre-3b) body validation — proven by
 *     getting a 400 for a bad body rather than a 401. This does NOT
 *     exercise real Supabase verification (there is none at this layer —
 *     see authRpc.ts's docstring); the RPC-calling routes are what
 *     actually verify the token server-side.
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

describe('POST /api/ontology/ingest — auth hardening (slice 3b)', () => {
  it('returns 401 when Authorization header is missing', async () => {
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

  it('clears the auth gate with a valid Bearer header and proceeds to body validation', async () => {
    // Empty body -> the route's existing (pre-3b) validation rejects with
    // 400 "Unknown or missing source" — proving we got PAST the 401 gate.
    const req = makeRequest({
      headers: { Authorization: 'Bearer test-access-token' },
      body: {},
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/source/i);
  });

  it('is case-insensitive on the Authorization header name and Bearer scheme', async () => {
    const req = makeRequest({
      headers: { authorization: 'bearer test-access-token' },
      body: {},
    });
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
// targeting only /rest/v1/proposed_edit.
// ---------------------------------------------------------------------------

describe('POST /api/ontology/ingest — persists evaluation on inserted proposed_edit rows (v2 §12.4)', () => {
  const ORIGINAL_URL = process.env.SUPABASE_URL;
  const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (ORIGINAL_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_URL;
    if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
  });

  it('every inserted proposed_edit row carries a structured evaluation object', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = makeRequest({
      headers: { Authorization: 'Bearer test-access-token' },
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
