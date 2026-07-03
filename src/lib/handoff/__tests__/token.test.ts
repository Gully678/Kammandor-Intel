/**
 * KINTEL Phase 4 — signed handoff token tests
 *
 * Covers the SHARED CONTRACT documented in ../token.ts: sign/verify
 * round-trip, tamper detection (payload + signature), expiry, wrong
 * secret, and fail-closed behaviour when no secret is configured.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signHandoffToken, verifyHandoffToken, DEFAULT_HANDOFF_TTL_SECONDS } from '../token';

const SECRET = 'test-secret-do-not-use-in-prod';

describe('signHandoffToken / verifyHandoffToken', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips: sign then verify returns the original tenant', () => {
    const token = signHandoffToken('pfo', 120, SECRET);
    const result = verifyHandoffToken(token, SECRET);
    expect(result).toEqual({ tenant: 'pfo' });
  });

  it('produces a token in the documented `${payload}.${sig}` shape', () => {
    const token = signHandoffToken('pfo', 120, SECRET);
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
    // base64url alphabet only (no +, /, or = padding)
    expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('defaults ttlSeconds to DEFAULT_HANDOFF_TTL_SECONDS (120s) when omitted', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signHandoffToken('pfo', undefined, SECRET);
    const [payload] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    expect(decoded.exp).toBeGreaterThanOrEqual(before + DEFAULT_HANDOFF_TTL_SECONDS - 1);
    expect(decoded.exp).toBeLessThanOrEqual(before + DEFAULT_HANDOFF_TTL_SECONDS + 5);
  });

  it('rejects a token with a tampered payload', () => {
    const token = signHandoffToken('pfo', 120, SECRET);
    const [, sig] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ tenant: 'atlas', exp: Math.floor(Date.now() / 1000) + 120 }), 'utf8').toString('base64url');
    const tampered = `${forgedPayload}.${sig}`;
    expect(verifyHandoffToken(tampered, SECRET)).toBeNull();
  });

  it('rejects a token with a tampered signature', () => {
    const token = signHandoffToken('pfo', 120, SECRET);
    const [payload, sig] = token.split('.');
    // Flip the signature by re-encoding a different (but validly-shaped) buffer.
    const forgedSig = Buffer.from(sig, 'base64url').map((b, i) => (i === 0 ? b ^ 0xff : b));
    const tampered = `${payload}.${Buffer.from(forgedSig).toString('base64url')}`;
    expect(verifyHandoffToken(tampered, SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = signHandoffToken('pfo', 10, SECRET); // exp = +10s from frozen time

    vi.setSystemTime(new Date('2026-01-01T00:00:11Z')); // 11s later -> expired
    expect(verifyHandoffToken(token, SECRET)).toBeNull();
  });

  it('accepts a token at the boundary (not yet expired)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = signHandoffToken('pfo', 10, SECRET);

    vi.setSystemTime(new Date('2026-01-01T00:00:09Z')); // 9s later -> still valid
    expect(verifyHandoffToken(token, SECRET)).toEqual({ tenant: 'pfo' });
  });

  it('rejects verification with the wrong secret', () => {
    const token = signHandoffToken('pfo', 120, SECRET);
    expect(verifyHandoffToken(token, 'a-completely-different-secret')).toBeNull();
  });

  it('verify returns null when no secret is provided (fail closed)', () => {
    const token = signHandoffToken('pfo', 120, SECRET);
    expect(verifyHandoffToken(token, undefined)).toBeNull();
  });

  it('verify returns null for an empty-string secret (fail closed)', () => {
    const token = signHandoffToken('pfo', 120, SECRET);
    expect(verifyHandoffToken(token, '')).toBeNull();
  });

  it('sign throws when no secret is provided', () => {
    expect(() => signHandoffToken('pfo', 120, undefined)).toThrow();
  });

  it('sign throws when secret is an empty string', () => {
    expect(() => signHandoffToken('pfo', 120, '')).toThrow();
  });

  it('sign throws when tenant is an empty string', () => {
    expect(() => signHandoffToken('', 120, SECRET)).toThrow();
  });

  it('sign throws when ttlSeconds is zero or negative', () => {
    expect(() => signHandoffToken('pfo', 0, SECRET)).toThrow();
    expect(() => signHandoffToken('pfo', -5, SECRET)).toThrow();
  });

  it('verify returns null for a malformed token (no dot separator)', () => {
    expect(verifyHandoffToken('not-a-valid-token', SECRET)).toBeNull();
  });

  it('verify returns null for a malformed token (too many dot separators)', () => {
    expect(verifyHandoffToken('a.b.c', SECRET)).toBeNull();
  });

  it('verify returns null for an empty string token', () => {
    expect(verifyHandoffToken('', SECRET)).toBeNull();
  });

  it('verify returns null when the payload is not valid JSON', () => {
    const garbagePayload = Buffer.from('not-json', 'utf8').toString('base64url');
    // Sign the garbage payload with the real secret so only the JSON-shape
    // check is being exercised (signature itself is "valid").
    const { createHmac } = require('node:crypto');
    const sig = createHmac('sha256', SECRET).update(garbagePayload).digest('base64url');
    expect(verifyHandoffToken(`${garbagePayload}.${sig}`, SECRET)).toBeNull();
  });

  it('verify returns null when the payload JSON is missing required fields', () => {
    const { createHmac } = require('node:crypto');
    const badPayload = Buffer.from(JSON.stringify({ tenant: 'pfo' }), 'utf8').toString('base64url'); // no exp
    const sig = createHmac('sha256', SECRET).update(badPayload).digest('base64url');
    expect(verifyHandoffToken(`${badPayload}.${sig}`, SECRET)).toBeNull();
  });

  it('different tenants produce different tokens for the same ttl/secret', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const tokenA = signHandoffToken('pfo', 120, SECRET);
    const tokenB = signHandoffToken('atlas', 120, SECRET);
    expect(tokenA).not.toEqual(tokenB);
  });
});
