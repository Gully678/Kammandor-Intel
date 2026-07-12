'use client';

/**
 * AuthHashBridge — magic-link session rescue (mounted once in the root layout).
 *
 * THE BUG THIS FIXES: Supabase magic links redirect to the project's Site URL
 * (the map page, `/`) unless signInWithOtp passes an allow-listed
 * emailRedirectTo. The session tokens arrive in the URL HASH
 * (#access_token=…) — but the map page never instantiated the Supabase
 * browser client, so the tokens were silently dropped and /review asked the
 * user to sign in again. (Observed live 2026-07-13: magic link landed on
 * `/?layers=…` and the session evaporated.)
 *
 * WHAT IT DOES: on ANY page load whose URL hash carries a Supabase auth
 * token, lazily create the shared browser client (detectSessionInUrl: true
 * parses + persists the hash session), strip the hash from the address bar,
 * and hand the user to /review — the page they were signing in for.
 *
 * WHAT IT NEVER DOES: no effect at all on normal page loads (the hash check
 * is the first statement); no server round-trips of its own; never throws —
 * a missing client (unconfigured env) simply leaves the page untouched.
 * Uses ONLY the public anon key via getSupabaseBrowserClient (see
 * src/lib/supabase/browserClient.ts's security note).
 */

import { useEffect } from 'react';

export default function AuthHashBridge() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || !/access_token=|type=magiclink|type=recovery/.test(hash)) return;

    let cancelled = false;

    (async () => {
      try {
        const { getSupabaseBrowserClient } = await import('@/lib/supabase/browserClient');
        const client = getSupabaseBrowserClient();
        if (!client) return; // env not configured — leave the page alone

        // getSession() awaits the client's internal initialisation, which is
        // what parses + persists the hash tokens (detectSessionInUrl: true).
        const { data } = await client.auth.getSession();
        if (cancelled || !data.session) return;

        // Session captured. Clean the address bar (never leave tokens in
        // history) and hand off to the review inbox.
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search,
        );
        window.location.assign('/review');
      } catch {
        // Never break the host page over an auth rescue attempt.
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return null;
}
