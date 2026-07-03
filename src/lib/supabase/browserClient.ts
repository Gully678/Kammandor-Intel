/**
 * KINTEL Phase 2 — Supabase browser auth client
 *
 * MINIMAL client-side auth for the review inbox (src/app/review). This is
 * the FIRST use of @supabase/supabase-js in this repo — the server-side TS
 * layer intentionally uses raw PostgREST fetches instead (see
 * src/lib/secrets.ts, src/lib/ontology/authRpc.ts), but a real interactive
 * sign-in flow (magic link, session persistence, token refresh) is exactly
 * what supabase-js's browser client is for, and reimplementing that by hand
 * would be a worse security posture, not a better one.
 *
 * Uses ONLY the public anon key — safe to ship to the browser. Nothing in
 * this file can bypass RLS or the approve/reject RPC's own authz; it only
 * establishes the session whose access token later gets sent as the
 * Authorization: Bearer header on /api/ontology/proposed-edit/*.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to be
 * set (see .env.example). If either is missing, getSupabaseBrowserClient()
 * returns null and callers must render a "not configured" state rather than
 * throwing — this must never crash the page.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    cached = null;
    return cached;
  }

  cached = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cached;
}
