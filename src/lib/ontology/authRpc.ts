/**
 * KINTEL Phase 2 — Governed-RPC HTTP helper
 *
 * Shared helper for API routes that must call a Postgres RPC AS THE CALLING
 * USER (not the service role), so the function body's `auth.jwt()` /
 * `auth.uid()` see the real caller's claims and any RLS on the underlying
 * tables still applies. This is the ONLY way a client can reach
 * intel.approve_proposed_edit / intel.reject_proposed_edit — see
 * migrations/intel/0012_approve_reject_proposed_edit.sql's governance banner.
 *
 * Mirrors the existing raw-PostgREST-fetch pattern already used in this repo
 * (src/lib/secrets.ts, src/app/api/ontology/ingest/route.ts) rather than
 * introducing @supabase/supabase-js into the server-side TS layer — there is
 * intentionally no supabase-js client here today (see ingest/route.ts's own
 * comment on this). The client-side review UI (src/app/review) is a
 * different runtime (the browser) and uses supabase-js directly there.
 *
 * SECURITY: never call this with the service-role key for an
 * authorization-sensitive RPC — that would bypass the caller's JWT entirely
 * and defeat the tenant/role checks inside the function body.
 */

export interface BearerAuthResult {
  ok:    true;
  token: string;
}

export interface BearerAuthError {
  ok:     false;
  status: 401;
  error:  string;
}

/**
 * Extract a bearer token from the standard `Authorization: Bearer <token>`
 * header. Returns a 401 error result if the header is missing, empty, or
 * malformed. Never throws.
 */
export function requireBearerToken(req: Request): BearerAuthResult | BearerAuthError {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');

  if (!header) {
    return { ok: false, status: 401, error: 'Missing Authorization header.' };
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();

  if (!token) {
    return { ok: false, status: 401, error: 'Authorization header must be "Bearer <token>".' };
  }

  return { ok: true, token };
}

export interface CallRpcAsUserResult {
  ok:     boolean;
  status: number;
  body:   unknown;
}

/**
 * Call a Postgres function exposed via PostgREST's /rpc endpoint, using the
 * CALLER'S bearer token (never the service-role key) so the function sees
 * the user's JWT. Targets the `intel` schema explicitly via Content-Profile,
 * matching this repo's existing PostgREST convention for the intel schema.
 */
export async function callIntelRpcAsUser(
  fnName:      string,
  args:        Record<string, unknown>,
  callerToken: string,
): Promise<CallRpcAsUserResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey     = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    return { ok: false, status: 500, body: { error: 'SUPABASE_URL not configured' } };
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: {
        // PostgREST requires `apikey` on every request; it identifies the
        // API project, NOT the caller's identity. The caller's identity
        // comes from the Authorization bearer below, which is what the
        // function body's auth.jwt()/auth.uid() actually resolve. Falling
        // back to the caller token here (rather than omitting the header)
        // keeps this working even where only SUPABASE_ANON_KEY is unset.
        apikey:            anonKey ?? callerToken,
        Authorization:     `Bearer ${callerToken}`,
        'Content-Type':    'application/json',
        'Content-Profile': 'intel',
      },
      body: JSON.stringify(args),
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    return {
      ok:     false,
      status: 502,
      body:   { error: err instanceof Error ? err.message : 'RPC call failed' },
    };
  }
}

/**
 * Map a Postgres error raised by the RPC (via `raise exception ... using
 * errcode = '...'`) to an HTTP status. `insufficient_privilege` and
 * anon/cross-tenant denials become 403; not-found becomes 404; anything
 * else affecting a governed write is a 400 (bad/invalid request) rather
 * than a 500, since these are expected, well-formed rejections from the
 * function's own validation — not server faults.
 */
export function statusForPostgrestError(body: unknown): number {
  if (typeof body !== 'object' || body === null) return 400;
  const code = (body as Record<string, unknown>).code;
  if (typeof code === 'string') {
    // PostgREST surfaces the Postgres SQLSTATE in `code`.
    if (code === '42501' /* insufficient_privilege */) return 403;
    if (code === 'P0002' /* no_data_found */)          return 404;
  }
  const message = (body as Record<string, unknown>).message;
  if (typeof message === 'string') {
    if (/denied|insufficient_privilege/i.test(message)) return 403;
    if (/not found/i.test(message))                     return 404;
  }
  return 400;
}
