/**
 * KINTEL Phase 4 — Signed short-TTL handoff token
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SHARED CONTRACT — if you change this format, mirror the change in   ║
 * ║  the MAIN Kammandor app's signer (whatever composes the Intel embed   ║
 * ║  URL / iframe src). Both sides MUST use the same secret              ║
 * ║  (INTEL_HANDOFF_SECRET) and the same payload/signature scheme below, ║
 * ║  or every handoff will fail closed (verify() returning null).        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * PURPOSE
 * The Intel app is embedded (iframe/link) by the main Kammandor app with a
 * `?tenant=` context so tenant-scoped panels/watchlists can be shown. A
 * plain `?tenant=` query param is trivially spoofable by anyone who can
 * edit a URL — it must never be trusted as-is (see resolveTenant.ts). This
 * module lets the main app hand off a TENANT identity to the Intel app via
 * a short-lived, HMAC-signed token instead, so the Intel app can trust the
 * tenant claim came from a party that holds the shared secret, and that the
 * token cannot be replayed indefinitely.
 *
 * FORMAT
 *   payload   = base64url( JSON.stringify({ tenant, exp }) )   // exp = epoch seconds
 *   signature = base64url( HMAC-SHA256(payload, secret) )
 *   token     = `${payload}.${signature}`
 *
 * SECURITY NOTES
 * - Signature comparison is constant-time (crypto.timingSafeEqual) to avoid
 *   timing side-channels on the comparison itself.
 * - Verification is FAIL-CLOSED: any of {missing secret, malformed token,
 *   bad base64/JSON, signature mismatch, expired ttl} resolves to `null`.
 *   Callers must treat `null` as "no tenant resolved", never as "public
 *   tenant" or any other default.
 * - Secret resolution: callers should resolve INTEL_HANDOFF_SECRET via
 *   src/lib/secrets.ts's getSecret() (async) and pass the resolved string
 *   in; the functions in this module stay synchronous so they are trivial
 *   to unit-test and are not tied to a particular secret-resolution
 *   strategy. If no secret is provided/resolved: signHandoffToken() throws
 *   (a caller must never mint a token when unable to sign it correctly),
 *   and verifyHandoffToken() returns null (fail closed — never verify
 *   against an absent secret).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface HandoffPayload {
  tenant: string;
  exp:    number; // epoch seconds
}

export interface VerifiedHandoff {
  tenant: string;
}

/** Default TTL for a freshly signed handoff token, in seconds. */
export const DEFAULT_HANDOFF_TTL_SECONDS = 120;

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecodeToString(input: string): string | null {
  try {
    // Buffer.from with 'base64url' tolerates missing padding and -/_ chars;
    // it does NOT validate that the input round-trips, so callers must
    // still JSON.parse the result inside a try/catch (done by callers here).
    return Buffer.from(input, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function computeSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Sign a handoff token for `tenant`, valid for `ttlSeconds` from now.
 *
 * Throws if `secret` is missing/empty — a token must never be minted
 * without a real secret to sign it with. Throws if `tenant` is empty.
 */
export function signHandoffToken(
  tenant: string,
  ttlSeconds: number = DEFAULT_HANDOFF_TTL_SECONDS,
  secret?: string,
): string {
  if (!secret) {
    throw new Error('signHandoffToken: INTEL_HANDOFF_SECRET is not configured.');
  }
  if (!tenant) {
    throw new Error('signHandoffToken: "tenant" must be a non-empty string.');
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('signHandoffToken: "ttlSeconds" must be a positive number.');
  }

  const exp: number = Math.floor(Date.now() / 1000) + Math.floor(ttlSeconds);
  const payloadJson = JSON.stringify({ tenant, exp } satisfies HandoffPayload);
  const payload = base64UrlEncode(payloadJson);
  const sig = computeSignature(payload, secret);

  return `${payload}.${sig}`;
}

/**
 * Verify a handoff token previously produced by signHandoffToken().
 *
 * FAIL-CLOSED: returns `null` for any of — missing secret, malformed token
 * shape, undecodable/non-JSON payload, payload not matching the expected
 * shape, signature mismatch, or an expired `exp`. Never throws.
 */
export function verifyHandoffToken(token: string, secret?: string): VerifiedHandoff | null {
  if (!secret) return null; // fail closed: never verify without a real secret
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  // Recompute the expected signature and compare in constant time.
  const expectedSig = computeSignature(payload, secret);

  const sigBuf = Buffer.from(sig, 'base64url');
  const expectedSigBuf = Buffer.from(expectedSig, 'base64url');

  // timingSafeEqual requires equal-length buffers; unequal length is
  // itself a mismatch (and safe to short-circuit — length is not secret).
  if (sigBuf.length !== expectedSigBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedSigBuf)) return null;

  const payloadJson = base64UrlDecodeToString(payload);
  if (payloadJson === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).tenant !== 'string' ||
    !(parsed as Record<string, unknown>).tenant ||
    typeof (parsed as Record<string, unknown>).exp !== 'number'
  ) {
    return null;
  }

  const { tenant, exp } = parsed as HandoffPayload;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (exp < nowSeconds) return null; // expired

  return { tenant };
}
