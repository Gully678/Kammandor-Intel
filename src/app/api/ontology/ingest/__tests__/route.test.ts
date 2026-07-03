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

import { describe, it, expect } from 'vitest';
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
