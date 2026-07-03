/**
 * KINTEL Phase 2 — authRpc helper unit tests (slice 3b)
 *
 * Pure-function coverage for the bearer-token extraction and Postgres
 * error-to-HTTP-status mapping used by the ingest/approve/reject routes.
 * No network — callIntelRpcAsUser's actual fetch behaviour is exercised
 * indirectly by the route-level tests (which assert it degrades to a
 * non-401 failure when SUPABASE_URL is unset, never a false 200).
 */

import { describe, it, expect } from 'vitest';
import { requireBearerToken, statusForPostgrestError } from '../authRpc';

function fakeRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost/test', { headers });
}

describe('requireBearerToken', () => {
  it('rejects a request with no Authorization header', () => {
    const result = requireBearerToken(fakeRequest({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('rejects an empty Authorization header', () => {
    const result = requireBearerToken(fakeRequest({ Authorization: '' }));
    expect(result.ok).toBe(false);
  });

  it('rejects a non-Bearer scheme', () => {
    const result = requireBearerToken(fakeRequest({ Authorization: 'Basic dXNlcjpwYXNz' }));
    expect(result.ok).toBe(false);
  });

  it('rejects "Bearer" with no token', () => {
    const result = requireBearerToken(fakeRequest({ Authorization: 'Bearer' }));
    expect(result.ok).toBe(false);
  });

  it('rejects "Bearer " with only whitespace after it', () => {
    const result = requireBearerToken(fakeRequest({ Authorization: 'Bearer    ' }));
    expect(result.ok).toBe(false);
  });

  it('accepts a well-formed Bearer token', () => {
    const result = requireBearerToken(fakeRequest({ Authorization: 'Bearer abc.def.ghi' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.token).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the "Bearer" scheme keyword', () => {
    const result = requireBearerToken(fakeRequest({ Authorization: 'bearer abc.def.ghi' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.token).toBe('abc.def.ghi');
  });

  it('trims surrounding whitespace from the token', () => {
    const result = requireBearerToken(fakeRequest({ Authorization: 'Bearer   abc.def.ghi   ' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.token).toBe('abc.def.ghi');
  });
});

describe('statusForPostgrestError', () => {
  it('maps insufficient_privilege SQLSTATE (42501) to 403', () => {
    expect(statusForPostgrestError({ code: '42501', message: 'denied' })).toBe(403);
  });

  it('maps a "denied" message to 403 even without a recognised code', () => {
    expect(statusForPostgrestError({ message: 'approve_proposed_edit: denied — role user is not an approver' })).toBe(403);
  });

  it('maps a "not found" message to 404', () => {
    expect(statusForPostgrestError({ message: 'approve_proposed_edit: proposed_edit x not found' })).toBe(404);
  });

  it('maps the P0002 (no_data_found) code to 404', () => {
    expect(statusForPostgrestError({ code: 'P0002', message: 'not found' })).toBe(404);
  });

  it('defaults to 400 for an unrecognised error shape', () => {
    expect(statusForPostgrestError({ code: '22023', message: 'invalid_parameter_value' })).toBe(400);
  });

  it('defaults to 400 for a non-object body', () => {
    expect(statusForPostgrestError('plain text error')).toBe(400);
    expect(statusForPostgrestError(null)).toBe(400);
    expect(statusForPostgrestError(undefined)).toBe(400);
  });
});
