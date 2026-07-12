/**
 * Mission C — ACTION EXECUTOR v1 tests
 * (src/app/api/ontology/actions/execute/route.ts).
 *
 * Style mirrors src/app/api/ontology/ingest/__tests__/route.test.ts: a
 * single mocked global.fetch, asserting exact URLs/bodies per call rather
 * than hitting a real Supabase project. This route makes UP TO THREE fetch
 * calls per queued row (queue read, alert insert, action patch) plus one
 * queue-read fetch for the whole request — tests key off call ORDER and
 * URL substring rather than call count where a row can short-circuit
 * (e.g. missing headline skips the alert insert).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../execute/route';

function makeRequest(opts: { headers?: Record<string, string>; body?: unknown }): NextRequest {
  return new NextRequest('http://localhost/api/ontology/actions/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('POST /api/ontology/actions/execute', () => {
  const ORIGINAL_AUTOMATE = process.env.AUTOMATE_SECRET;
  const ORIGINAL_URL = process.env.SUPABASE_URL;
  const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.AUTOMATE_SECRET = 'test-automate-secret';
    process.env.SUPABASE_URL = 'https://stub.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (ORIGINAL_AUTOMATE === undefined) delete process.env.AUTOMATE_SECRET;
    else process.env.AUTOMATE_SECRET = ORIGINAL_AUTOMATE;
    if (ORIGINAL_URL === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = ORIGINAL_URL;
    if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
  });

  it('returns 401 without a valid x-automate-secret', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = makeRequest({ body: { limit: 5 } });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/automate-secret/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the provided secret does not match', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = makeRequest({ headers: { 'x-automate-secret': 'wrong-secret' }, body: {} });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a queued notify action missing payload.headline is patched to failed with the expected error, and no alert is inserted', async () => {
    const queueRow = {
      id: 'action-1',
      tenant_id: 'tenant-1',
      action_type_key: 'notify',
      status: 'queued',
      payload: { detail: 'no headline here' },
    };

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/rest/v1/action') && (!init || init.method === undefined)) {
        // GET queue read
        return jsonResponse([queueRow]);
      }
      if (String(url).includes('/rest/v1/action') && init?.method === 'PATCH') {
        return jsonResponse(null, 204);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = makeRequest({ headers: { 'x-automate-secret': 'test-automate-secret' }, body: { limit: 5 } });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.picked).toBe(1);
    expect(json.executed).toBe(0);
    expect(json.failed).toBe(1);
    expect(typeof json.skippedOtherTypes).toBe('string');

    // No intelligence_alerts insert must have happened.
    expect(calls.some((c) => c.url.includes('/rest/v1/intelligence_alerts'))).toBe(false);

    // The action PATCH must carry the exact governed error string.
    const patchCall = calls.find((c) => c.url.includes('/rest/v1/action') && c.init?.method === 'PATCH');
    expect(patchCall).toBeDefined();
    const patchBody = JSON.parse(String(patchCall!.init!.body)) as Record<string, unknown>;
    expect(patchBody.status).toBe('failed');
    expect(patchBody.error).toBe('notify payload missing headline');
  });

  it('happy path: an approved notify action inserts an intelligence_alerts row and is patched to executed', async () => {
    const queueRow = {
      id: 'action-2',
      tenant_id: 'tenant-2',
      action_type_key: 'notify',
      status: 'approved',
      payload: { headline: 'Something happened', detail: 'extra context', severity: 'NOTABLE' },
    };

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.includes('/rest/v1/action') && (!init || !init.method)) {
        return jsonResponse([queueRow]);
      }
      if (u.includes('/rest/v1/intelligence_alerts') && init?.method === 'POST') {
        return jsonResponse(null, 201);
      }
      if (u.includes('/rest/v1/action') && init?.method === 'PATCH') {
        return jsonResponse(null, 204);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = makeRequest({ headers: { 'x-automate-secret': 'test-automate-secret' }, body: { limit: 5 } });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.picked).toBe(1);
    expect(json.executed).toBe(1);
    expect(json.failed).toBe(0);

    // Alert insert must target the public (default) profile — no
    // Accept-Profile/Content-Profile header — and the intel.action queue
    // read/patch must carry Content-Profile/Accept-Profile: intel.
    const alertCall = calls.find((c) => c.url.includes('/rest/v1/intelligence_alerts'));
    expect(alertCall).toBeDefined();
    const alertHeaders = alertCall!.init!.headers as Record<string, string>;
    expect(alertHeaders['Content-Profile']).toBeUndefined();
    expect(alertHeaders['Accept-Profile']).toBeUndefined();

    const alertBody = JSON.parse(String(alertCall!.init!.body)) as Record<string, unknown>;
    expect(alertBody.organization_id).toBe('tenant-2');
    expect(alertBody.headline).toBe('Something happened');
    expect(alertBody.severity).toBe('NOTABLE');
    expect(alertBody.status).toBe('open');
    expect(alertBody.detail).toBe('extra context — executed from the governed action queue (intel.action).');

    const patchCall = calls.find((c) => c.url.includes('/rest/v1/action') && c.init?.method === 'PATCH');
    expect(patchCall).toBeDefined();
    const patchHeaders = patchCall!.init!.headers as Record<string, string>;
    expect(patchHeaders['Content-Profile']).toBe('intel');
    const patchBody = JSON.parse(String(patchCall!.init!.body)) as Record<string, unknown>;
    expect(patchBody.status).toBe('executed');
    expect(typeof patchBody.executed_at).toBe('string');
  });

  it('a severity outside the fixed allow-list defaults to BACKGROUND', async () => {
    const queueRow = {
      id: 'action-3',
      tenant_id: 'tenant-3',
      action_type_key: 'notify',
      status: 'queued',
      payload: { headline: 'Edge case severity', severity: 'HIGH' },
    };

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.includes('/rest/v1/action') && (!init || !init.method)) {
        return jsonResponse([queueRow]);
      }
      if (u.includes('/rest/v1/intelligence_alerts') && init?.method === 'POST') {
        return jsonResponse(null, 201);
      }
      if (u.includes('/rest/v1/action') && init?.method === 'PATCH') {
        return jsonResponse(null, 204);
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = makeRequest({ headers: { 'x-automate-secret': 'test-automate-secret' }, body: {} });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.executed).toBe(1);

    const alertCall = calls.find((c) => c.url.includes('/rest/v1/intelligence_alerts'));
    const alertBody = JSON.parse(String(alertCall!.init!.body)) as Record<string, unknown>;
    // 'HIGH' is not in the fixed allow-list (CRITICAL|NOTABLE|BACKGROUND) —
    // must default to 'BACKGROUND', never pass the invalid value through.
    expect(alertBody.severity).toBe('BACKGROUND');
  });

  it('only selects notify rows in status queued/approved — the query itself excludes other types and awaiting_approval', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      expect(u).toContain('action_type_key=eq.notify');
      expect(u).toContain('status=in.%28queued%2Capproved%29');
      return jsonResponse([]);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const req = makeRequest({ headers: { 'x-automate-secret': 'test-automate-secret' }, body: {} });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.picked).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
