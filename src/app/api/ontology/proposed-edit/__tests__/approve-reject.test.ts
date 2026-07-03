/**
 * KINTEL Phase 2 — Governed approve/reject route tests (slice 3b)
 *
 * These routes (approve/route.ts, reject/route.ts) are thin, unprivileged
 * pass-throughs to intel.approve_proposed_edit / intel.reject_proposed_edit
 * via PostgREST — see migrations/intel/0012_approve_reject_proposed_edit.sql
 * for the actual authz enforcement (tenant match + approver role), which
 * runs INSIDE the SQL function and cannot be exercised without a live
 * Supabase project. What IS testable here, without any network/DB, is the
 * route-level contract this slice is responsible for:
 *   - No/malformed Authorization header -> 401, before any RPC call attempt.
 *   - Missing "id" path param -> 400.
 *   - A syntactically valid bearer token clears the gate and the route
 *     attempts the RPC call (which will fail in this offline test
 *     environment since SUPABASE_URL is unset/unreachable — asserted as a
 *     501/500/502-class response, i.e. NOT 401, proving the auth gate was
 *     passed and the failure is downstream network/config, not auth).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as approvePOST } from '../[id]/approve/route';
import { POST as rejectPOST } from '../[id]/reject/route';

function makeRequest(path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;

describe('POST /api/ontology/proposed-edit/[id]/approve', () => {
  beforeEach(() => {
    // Ensure a deterministic "unreachable" RPC target rather than an
    // accidental real network call in CI.
    delete process.env.SUPABASE_URL;
  });
  afterEach(() => {
    if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  });

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest('/api/ontology/proposed-edit/00000000-0000-0000-0000-000000000001/approve');
    const res = await approvePOST(req, makeContext('00000000-0000-0000-0000-000000000001'));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/Authorization/i);
  });

  it('returns 401 when Authorization header is malformed', async () => {
    const req = makeRequest('/api/ontology/proposed-edit/00000000-0000-0000-0000-000000000001/approve', {
      headers: { Authorization: 'Basic abc123' },
    });
    const res = await approvePOST(req, makeContext('00000000-0000-0000-0000-000000000001'));
    expect(res.status).toBe(401);
  });

  it('never reaches the RPC call when unauthenticated (no SUPABASE_URL-not-configured leak as a 401 bypass)', async () => {
    // Even with SUPABASE_URL unset (which would otherwise 500 from the RPC
    // helper), a missing bearer token must short-circuit to 401 BEFORE any
    // RPC attempt — proving auth is checked first, unconditionally.
    const req = makeRequest('/api/ontology/proposed-edit/00000000-0000-0000-0000-000000000001/approve');
    const res = await approvePOST(req, makeContext('00000000-0000-0000-0000-000000000001'));
    expect(res.status).toBe(401);
  });

  it('with a valid bearer token, passes the auth gate and fails downstream (not 401)', async () => {
    const req = makeRequest('/api/ontology/proposed-edit/00000000-0000-0000-0000-000000000001/approve', {
      headers: { Authorization: 'Bearer test-access-token' },
    });
    const res = await approvePOST(req, makeContext('00000000-0000-0000-0000-000000000001'));
    // SUPABASE_URL is deliberately unset in this offline test -> the RPC
    // helper itself returns a 500 "not configured" response. The important
    // assertion is NOT 401 — proving the bearer token cleared the gate.
    expect(res.status).not.toBe(401);
  });
});

describe('POST /api/ontology/proposed-edit/[id]/reject', () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
  });
  afterEach(() => {
    if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  });

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest('/api/ontology/proposed-edit/00000000-0000-0000-0000-000000000002/reject');
    const res = await rejectPOST(req, makeContext('00000000-0000-0000-0000-000000000002'));
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header is present but empty after Bearer', async () => {
    const req = makeRequest('/api/ontology/proposed-edit/00000000-0000-0000-0000-000000000002/reject', {
      headers: { Authorization: 'Bearer ' },
    });
    const res = await rejectPOST(req, makeContext('00000000-0000-0000-0000-000000000002'));
    expect(res.status).toBe(401);
  });

  it('accepts an optional reason in the body without affecting the auth gate', async () => {
    const req = makeRequest('/api/ontology/proposed-edit/00000000-0000-0000-0000-000000000002/reject', {
      headers: { Authorization: 'Bearer test-access-token' },
      body: { reason: 'duplicate entity' },
    });
    const res = await rejectPOST(req, makeContext('00000000-0000-0000-0000-000000000002'));
    expect(res.status).not.toBe(401);
  });

  it('with a valid bearer token, passes the auth gate and fails downstream (not 401)', async () => {
    const req = makeRequest('/api/ontology/proposed-edit/00000000-0000-0000-0000-000000000002/reject', {
      headers: { Authorization: 'Bearer test-access-token' },
    });
    const res = await rejectPOST(req, makeContext('00000000-0000-0000-0000-000000000002'));
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// v2 §12.4 — reject reason pass-through to the governed RPC.
//
// intel.reject_proposed_edit now PERSISTS p_reason into
// intel.proposed_edit.reason (migrations/intel/0015). These tests stub
// global fetch (the route's only transport — see authRpc.ts) and assert the
// route forwards the optional body reason as p_reason, byte-for-byte,
// without loosening the 401 gate.
// ---------------------------------------------------------------------------

describe('POST /api/ontology/proposed-edit/[id]/reject — reason pass-through (v2 §12.4)', () => {
  const EDIT_ID = '00000000-0000-0000-0000-000000000003';
  const ORIGINAL_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.SUPABASE_URL      = 'https://stub.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'stub-anon-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
    if (ORIGINAL_ANON_KEY === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = ORIGINAL_ANON_KEY;
  });

  function stubRpcFetch() {
    const fetchMock = vi.fn(async () =>
      new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('forwards the body reason as p_reason to intel.reject_proposed_edit', async () => {
    const fetchMock = stubRpcFetch();

    const req = makeRequest(`/api/ontology/proposed-edit/${EDIT_ID}/reject`, {
      headers: { Authorization: 'Bearer test-access-token' },
      body: { reason: 'duplicate entity' },
    });
    const res = await rejectPOST(req, makeContext(EDIT_ID));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/rpc/reject_proposed_edit');
    expect(JSON.parse(String(init.body))).toEqual({
      p_edit_id: EDIT_ID,
      p_reason:  'duplicate entity',
    });
  });

  it('sends p_reason: null when no reason is provided in the body', async () => {
    const fetchMock = stubRpcFetch();

    const req = makeRequest(`/api/ontology/proposed-edit/${EDIT_ID}/reject`, {
      headers: { Authorization: 'Bearer test-access-token' },
      body: {},
    });
    const res = await rejectPOST(req, makeContext(EDIT_ID));

    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      p_edit_id: EDIT_ID,
      p_reason:  null,
    });
  });

  it('still returns 401 (and never calls the RPC) when unauthenticated, even with a reason body', async () => {
    const fetchMock = stubRpcFetch();

    const req = makeRequest(`/api/ontology/proposed-edit/${EDIT_ID}/reject`, {
      body: { reason: 'duplicate entity' },
    });
    const res = await rejectPOST(req, makeContext(EDIT_ID));

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
