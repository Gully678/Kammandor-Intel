/**
 * KINTEL Phase 4 — Resolve the effective tenant from an incoming request
 *
 * Resolution order (first match wins):
 *   1. Signed handoff token — `?t=` query param, or `x-intel-handoff` header.
 *      Verified via verifyHandoffToken() (see token.ts). This is the ONLY
 *      trusted source of tenant identity in production.
 *   2. Plain `?tenant=` query param — back-compat/dev ONLY, and only
 *      honoured when INTEL_ALLOW_UNSIGNED_TENANT === 'true'. This flag
 *      defaults to false/unset, so a plain tenant param is IGNORED by
 *      default and must never be trusted as a tenant identity in
 *      production. Do not flip this flag on in production environments.
 *
 * Returns the resolved tenant string, or `null` if no tenant could be
 * resolved (never throws).
 */

import type { NextRequest } from 'next/server';
import { verifyHandoffToken } from './token';

const HANDOFF_QUERY_PARAM  = 't';
const HANDOFF_HEADER       = 'x-intel-handoff';
const UNSIGNED_QUERY_PARAM = 'tenant';

/**
 * Whether plain, unsigned `?tenant=` params are honoured. Defaults to
 * false unless INTEL_ALLOW_UNSIGNED_TENANT is exactly the string 'true'.
 * Read live (not cached) so tests can toggle process.env per-case.
 */
function unsignedTenantAllowed(): boolean {
  return process.env.INTEL_ALLOW_UNSIGNED_TENANT === 'true';
}

/**
 * Resolve the effective tenant for `req`, preferring a signed handoff
 * token over a plain query param. `secret` should be the resolved
 * INTEL_HANDOFF_SECRET value (see src/lib/secrets.ts's getSecret(), which
 * is async — callers resolve it once per-request and pass it in here so
 * this function itself can stay synchronous and easy to test).
 */
export function resolveTenantFromRequest(
  req: Pick<NextRequest, 'headers' | 'nextUrl'>,
  secret?: string,
): string | null {
  const token =
    req.nextUrl.searchParams.get(HANDOFF_QUERY_PARAM) ??
    req.headers.get(HANDOFF_HEADER);

  if (token) {
    const verified = verifyHandoffToken(token, secret);
    if (verified) return verified.tenant;
    // A present-but-invalid token is NOT a signal to fall back to the
    // unsigned param — an attacker could always supply a garbage `?t=`
    // to force fallback. Only the ABSENCE of a token param/header allows
    // considering the unsigned dev path below.
    return null;
  }

  if (unsignedTenantAllowed()) {
    const plain = req.nextUrl.searchParams.get(UNSIGNED_QUERY_PARAM);
    if (plain) return plain;
  }

  return null;
}
