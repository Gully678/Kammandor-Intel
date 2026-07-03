/**
 * KINTEL Phase 4 — resolveTenantFromRequest tests
 *
 * Verifies the resolution order documented in ../resolveTenant.ts:
 * signed token (query `?t=` or `x-intel-handoff` header) wins; a plain
 * `?tenant=` param is honoured ONLY when INTEL_ALLOW_UNSIGNED_TENANT is
 * exactly 'true', and is otherwise ignored.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resolveTenantFromRequest } from '../resolveTenant';
import { signHandoffToken } from '../token';

const SECRET = 'test-secret-do-not-use-in-prod';

function makeRequest(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers });
}

describe('resolveTenantFromRequest', () => {
  const originalFlag = process.env.INTEL_ALLOW_UNSIGNED_TENANT;

  beforeEach(() => {
    delete process.env.INTEL_ALLOW_UNSIGNED_TENANT;
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.INTEL_ALLOW_UNSIGNED_TENANT;
    } else {
      process.env.INTEL_ALLOW_UNSIGNED_TENANT = originalFlag;
    }
  });

  it('resolves the tenant from a valid signed `?t=` token', () => {
    const token = signHandoffToken('pfo', 120, SECRET);
    const req = makeRequest(`/?t=${encodeURIComponent(token)}`);
    expect(resolveTenantFromRequest(req, SECRET)).toBe('pfo');
  });

  it('resolves the tenant from a valid signed token in the x-intel-handoff header', () => {
    const token = signHandoffToken('atlas', 120, SECRET);
    const req = makeRequest('/', { 'x-intel-handoff': token });
    expect(resolveTenantFromRequest(req, SECRET)).toBe('atlas');
  });

  it('prefers the `?t=` query token over the header when both are present', () => {
    const queryToken = signHandoffToken('pfo', 120, SECRET);
    const headerToken = signHandoffToken('atlas', 120, SECRET);
    const req = makeRequest(`/?t=${encodeURIComponent(queryToken)}`, { 'x-intel-handoff': headerToken });
    expect(resolveTenantFromRequest(req, SECRET)).toBe('pfo');
  });

  it('returns null for a tampered `?t=` token, even with the unsigned flag on', () => {
    process.env.INTEL_ALLOW_UNSIGNED_TENANT = 'true';
    const token = signHandoffToken('pfo', 120, SECRET);
    const tampered = token.slice(0, -2) + 'zz';
    const req = makeRequest(`/?t=${encodeURIComponent(tampered)}&tenant=atlas`);
    // A present-but-invalid token must not downgrade to the unsigned param.
    expect(resolveTenantFromRequest(req, SECRET)).toBeNull();
  });

  it('returns null for an expired `?t=` token', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = signHandoffToken('pfo', 10, SECRET);

    vi.setSystemTime(new Date('2026-01-01T00:00:11Z')); // 11s later -> expired
    const req = makeRequest(`/?t=${encodeURIComponent(token)}`);
    expect(resolveTenantFromRequest(req, SECRET)).toBeNull();
    vi.useRealTimers();
  });

  it('ignores a plain `?tenant=` param when the flag is unset (default off)', () => {
    const req = makeRequest('/?tenant=pfo');
    expect(resolveTenantFromRequest(req, SECRET)).toBeNull();
  });

  it('ignores a plain `?tenant=` param when the flag is explicitly not "true"', () => {
    process.env.INTEL_ALLOW_UNSIGNED_TENANT = 'false';
    const req = makeRequest('/?tenant=pfo');
    expect(resolveTenantFromRequest(req, SECRET)).toBeNull();
  });

  it('honours a plain `?tenant=` param when the flag is exactly "true"', () => {
    process.env.INTEL_ALLOW_UNSIGNED_TENANT = 'true';
    const req = makeRequest('/?tenant=pfo');
    expect(resolveTenantFromRequest(req, SECRET)).toBe('pfo');
  });

  it('returns null when no token and no tenant param are present', () => {
    const req = makeRequest('/');
    expect(resolveTenantFromRequest(req, SECRET)).toBeNull();
  });

  it('returns null when a token is present but no secret is configured (fail closed)', () => {
    const token = signHandoffToken('pfo', 120, SECRET);
    const req = makeRequest(`/?t=${encodeURIComponent(token)}`);
    expect(resolveTenantFromRequest(req, undefined)).toBeNull();
  });
});
