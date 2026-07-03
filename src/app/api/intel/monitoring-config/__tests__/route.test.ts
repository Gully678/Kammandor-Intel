/**
 * KINTEL Phase 4 — GET /api/intel/monitoring-config tests
 *
 * Covers: 401 when no valid tenant resolves (no token, or unsigned param
 * ignored by default); a valid signed token resolves the tenant and the
 * route reads that tenant's row via PostgREST (mocked); defensive handling
 * of missing rows / unreachable DB / partial columns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { signHandoffToken } from '@/lib/handoff/token';

const SECRET = 'test-secret-do-not-use-in-prod';

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

describe('GET /api/intel/monitoring-config', () => {
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

  it('returns 401 when no token and no tenant param are present', async () => {
    const req = makeRequest('/api/intel/monitoring-config');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 when only a plain ?tenant= param is present (flag off by default)', async () => {
    const req = makeRequest('/api/intel/monitoring-config?tenant=pfo');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 for a tampered token', async () => {
    const token = signHandoffToken('pfo', 120, SECRET);
    const tampered = token.slice(0, -2) + 'zz';
    const req = makeRequest(`/api/intel/monitoring-config?t=${encodeURIComponent(tampered)}`);
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('resolves the tenant from a valid token and returns its monitoring-config row', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'row-1',
          organization_id: 'pfo',
          reseller_id: 'r-1',
          keywords: ['commodity', 'sukuk'],
          tickers: ['GOLD'],
          handles: ['@pfo'],
          entities: ['Lotus'],
          geos: ['UAE', 'UK'],
          feeds: { rss: ['x'] },
          intel: { mapFocus: { lat: 25.2, lng: 55.3 } },
          property_api_credentials: { secret: 'DO_NOT_LEAK' },
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const token = signHandoffToken('pfo', 120, SECRET);
    const req = makeRequest(`/api/intel/monitoring-config?t=${encodeURIComponent(token)}`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      organizationId: 'pfo',
      keywords: ['commodity', 'sukuk'],
      tickers: ['GOLD'],
      handles: ['@pfo'],
      entities: ['Lotus'],
      geographies: ['UAE', 'UK'],
      feeds: { rss: ['x'] },
      intel: { mapFocus: { lat: 25.2, lng: 55.3 } },
    });
    // SECURITY: sensitive/internal columns must never reach the client.
    expect(json).not.toHaveProperty('property_api_credentials');
    expect(json).not.toHaveProperty('reseller_id');
    expect(JSON.stringify(json)).not.toContain('DO_NOT_LEAK');

    // Confirm the PostgREST call targeted the right table/tenant with the
    // service-role key, and did NOT send an intel-schema Content-Profile
    // header (km_monitoring_config lives in the default public schema).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain('/rest/v1/km_monitoring_config');
    expect(String(calledUrl)).toContain('organization_id=eq.pfo');
    expect(calledOpts.headers.apikey).toBe('test-service-role-key');
    expect(calledOpts.headers['Content-Profile']).toBeUndefined();
  });

  it('returns {} when the tenant has no monitoring-config row', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));

    const token = signHandoffToken('pfo', 120, SECRET);
    const req = makeRequest(`/api/intel/monitoring-config?t=${encodeURIComponent(token)}`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it('returns {} (not an error) when PostgREST responds with a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

    const token = signHandoffToken('pfo', 120, SECRET);
    const req = makeRequest(`/api/intel/monitoring-config?t=${encodeURIComponent(token)}`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it('returns {} (not an error) when fetch throws (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const token = signHandoffToken('pfo', 120, SECRET);
    const req = makeRequest(`/api/intel/monitoring-config?t=${encodeURIComponent(token)}`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it('returns {} (not an error) when SUPABASE_URL/SERVICE_ROLE_KEY are not configured', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const token = signHandoffToken('pfo', 120, SECRET);
    const req = makeRequest(`/api/intel/monitoring-config?t=${encodeURIComponent(token)}`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honours a plain ?tenant= param when INTEL_ALLOW_UNSIGNED_TENANT=true', async () => {
    process.env.INTEL_ALLOW_UNSIGNED_TENANT = 'true';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => [{ organization_id: 'atlas', keywords: ['fx'] }] }),
    );

    const req = makeRequest('/api/intel/monitoring-config?tenant=atlas');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ organizationId: 'atlas', keywords: ['fx'] });
  });

  it('drops non-string entries from array fields defensively', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ organization_id: 'pfo', keywords: ['ok', 42, null, 'also-ok'] }],
    }));

    const token = signHandoffToken('pfo', 120, SECRET);
    const req = makeRequest(`/api/intel/monitoring-config?t=${encodeURIComponent(token)}`);
    const res = await GET(req);
    const json = await res.json();
    expect(json.keywords).toEqual(['ok', 'also-ok']);
  });
});
