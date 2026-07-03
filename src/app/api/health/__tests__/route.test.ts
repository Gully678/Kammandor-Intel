/**
 * KINTEL v2.5 — /api/health route tests (PRD §14/§15: observability +
 * zero-silent-failure)
 *
 * Written FIRST (TDD). Covers the liveness surface's duties:
 *   - 200 'ok' when the database answers and both secrets are configured;
 *   - database unreachable → STILL 200, body says status 'degraded' +
 *     checks.database 'unreachable' (the monitor decides — never a
 *     silent 500);
 *   - missing secrets → 'missing' flags (explicit not-configured state);
 *   - gitSha resolution: VERCEL_GIT_COMMIT_SHA → RENDER_GIT_COMMIT →
 *     'unknown';
 *   - REGRESSION: the body NEVER contains service-role key material,
 *     Supabase URLs, or secret values (it is an unauthenticated surface).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import pkg from '../../../../../package.json';
import { GET } from '../route';
import { getSecret } from '@/lib/secrets';

vi.mock('@/lib/secrets', () => ({
  getSecret: vi.fn(),
}));

const SERVICE_KEY = 'test-service-role-key-material';
const SUPABASE_URL = 'https://example-project.supabase.co';
const HANDOFF_SECRET = 'test-handoff-secret-value';
const AUTOMATE_SECRET = 'test-automate-secret-value';

/** Stub global fetch for the database probe; records every request. */
function stubDbFetch(opts: { ok?: boolean; reject?: boolean } = {}): {
  calls: { url: string; init: RequestInit | undefined }[];
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (opts.reject) throw new Error('network unreachable');
      return {
        ok: opts.ok ?? true,
        status: opts.ok === false ? 500 : 200,
        json: async () => [{ key: 'gdelt' }],
      };
    }),
  );
  return { calls };
}

describe('/api/health', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    process.env.AUTOMATE_SECRET = AUTOMATE_SECRET;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.RENDER_GIT_COMMIT;
    vi.mocked(getSecret).mockReset();
    vi.mocked(getSecret).mockResolvedValue(HANDOFF_SECRET);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("200 'ok' when the database answers and both secrets are configured", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc1234def';
    stubDbFetch({ ok: true });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.status).toBe('ok');
    expect(body.version).toBe(pkg.version);
    expect(body.gitSha).toBe('abc1234def');
    expect(body.checks).toEqual({
      database: 'ok',
      handoffSecret: 'configured',
      automateSecret: 'configured',
    });
    expect(typeof body.time).toBe('string');
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it('probes intel.sources via service PostgREST with a bounded (3s) signal', async () => {
    const { calls } = stubDbFetch({ ok: true });
    await GET();

    const probe = calls.find((c) => c.url.includes('/rest/v1/sources'));
    expect(probe).toBeDefined();
    expect(probe!.url).toContain('limit=1');
    // intel schema targeted explicitly for the read
    const headers = probe!.init?.headers as Record<string, string>;
    expect(headers['Accept-Profile']).toBe('intel');
    // bounded probe — never hangs the liveness surface
    expect(probe!.init?.signal).toBeDefined();
  });

  it("database HTTP failure → STILL 200, status 'degraded', database 'unreachable' (never a silent 500)", async () => {
    stubDbFetch({ ok: false });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.checks.database).toBe('unreachable');
  });

  it("database network error → STILL 200, status 'degraded', database 'unreachable'", async () => {
    stubDbFetch({ reject: true });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.checks.database).toBe('unreachable');
  });

  it("missing env → 'missing' secret flags + database 'unreachable', still 200", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.AUTOMATE_SECRET;
    vi.mocked(getSecret).mockResolvedValue(undefined);
    const { calls } = stubDbFetch();

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.checks).toEqual({
      database: 'unreachable',
      handoffSecret: 'missing',
      automateSecret: 'missing',
    });
    // no DB config → no probe fired (nothing to leak, nothing to hang on)
    expect(calls.filter((c) => c.url.includes('/rest/v1/'))).toHaveLength(0);
  });

  it('gitSha falls back VERCEL_GIT_COMMIT_SHA → RENDER_GIT_COMMIT → unknown', async () => {
    stubDbFetch();

    process.env.RENDER_GIT_COMMIT = 'render-sha-1';
    let body = await (await GET()).json();
    expect(body.gitSha).toBe('render-sha-1');

    process.env.VERCEL_GIT_COMMIT_SHA = 'vercel-sha-1';
    body = await (await GET()).json();
    expect(body.gitSha).toBe('vercel-sha-1'); // Vercel wins when both exist

    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.RENDER_GIT_COMMIT;
    body = await (await GET()).json();
    expect(body.gitSha).toBe('unknown');
  });

  it('REGRESSION: body never contains key material, secret values, or Supabase URLs', async () => {
    stubDbFetch({ ok: false }); // even the failure body must leak nothing

    const res = await GET();
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain(SERVICE_KEY);
    expect(raw).not.toContain(HANDOFF_SECRET);
    expect(raw).not.toContain(AUTOMATE_SECRET);
    expect(raw).not.toContain(SUPABASE_URL);
    expect(raw).not.toContain('supabase.co');
  });
});
