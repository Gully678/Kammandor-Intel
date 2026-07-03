'use client';

/**
 * KINTEL Phase 2 — Analyst review inbox
 * /review
 *
 * Lists pending intel.proposed_edit rows for the signed-in user's tenant
 * (scoped by RLS via the user's own Supabase session — this page never
 * uses a service-role key) and lets an authorised reviewer Approve/Reject
 * each one. The actual authz decision is made server-side inside
 * intel.approve_proposed_edit / intel.reject_proposed_edit (see
 * migrations/intel/0012_approve_reject_proposed_edit.sql) — this page is
 * a convenience UI, never the security boundary. A signed-in user with a
 * non-approver role will see Approve/Reject fail with a 403 from the API,
 * which this page surfaces as an inline error rather than hiding.
 *
 * AUTH GAP (see slice3b-report.md for full detail): this Intel app had NO
 * existing Supabase auth/session mechanism anywhere in the codebase before
 * this slice (no supabase-js, no cookie session, no middleware auth check —
 * confirmed by repo-wide search). This page adds a MINIMAL magic-link
 * sign-in gate using @supabase/supabase-js's browser client so that pending
 * edits can only be listed/actioned by someone who has completed Supabase
 * auth and whose resulting JWT carries real app_metadata claims. This is a
 * best-effort UI convenience; it is NOT the security boundary — see the
 * RPC's own authz block for that.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient';

interface ProposedEditRow {
  id:           string;
  tenant_id:    string;
  kind:         'create_entity' | 'update_entity' | 'create_link' | 'update_link';
  payload:      Record<string, unknown>;
  proposed_by:  string;
  rationale?:   string | null;
  status:       'pending' | 'approved' | 'rejected' | 'applied';
  created_at:   string;
}

type ActionState = 'idle' | 'pending' | 'error';

export default function ReviewInboxPage() {
  const supabase = getSupabaseBrowserClient();

  const [session, setSession]         = useState<Session | null | undefined>(undefined);
  const [email, setEmail]             = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [authError, setAuthError]     = useState<string | null>(null);

  const [edits, setEdits]             = useState<ProposedEditRow[]>([]);
  const [loading, setLoading]         = useState(false);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [actionState, setActionState] = useState<Record<string, ActionState>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});

  // ---------------------------------------------------------------------
  // Auth: track the Supabase session (or null if not configured / signed out)
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!supabase) {
      setSession(null);
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  // ---------------------------------------------------------------------
  // Load pending edits — reads via the user's own session, so RLS (once
  // real tenant-isolation policies are added to intel.proposed_edit) scopes
  // this to the caller's tenant. Uses PostgREST directly (same pattern as
  // the rest of this repo's server code) rather than supabase-js's
  // .schema('intel').from(...) query builder, to keep exactly one HTTP
  // convention for talking to PostgREST across this slice.
  // ---------------------------------------------------------------------
  const loadPendingEdits = useCallback(async () => {
    if (!supabase || !session) return;
    setLoading(true);
    setLoadError(null);
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anonKey) {
        setLoadError('Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing).');
        return;
      }

      const res = await fetch(
        `${url}/rest/v1/proposed_edit?status=eq.pending&order=created_at.desc&select=*`,
        {
          headers: {
            apikey:            anonKey,
            Authorization:     `Bearer ${session.access_token}`,
            'Accept-Profile':  'intel',
          },
        },
      );

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setLoadError(`Failed to load pending edits (HTTP ${res.status}). ${text.slice(0, 200)}`);
        setEdits([]);
        return;
      }

      const rows = (await res.json()) as ProposedEditRow[];
      setEdits(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load pending edits.');
    } finally {
      setLoading(false);
    }
  }, [supabase, session]);

  useEffect(() => {
    if (session) void loadPendingEdits();
  }, [session, loadPendingEdits]);

  // ---------------------------------------------------------------------
  // Magic-link sign-in
  // ---------------------------------------------------------------------
  async function handleSendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    if (!supabase) {
      setAuthError('Supabase is not configured on this deployment.');
      return;
    }
    if (!email.trim()) {
      setAuthError('Enter an email address.');
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    if (error) {
      setAuthError(error.message);
      return;
    }
    setMagicLinkSent(true);
  }

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setEdits([]);
  }

  // ---------------------------------------------------------------------
  // Approve / Reject — calls the governed API routes with the session's
  // bearer token. The server-side RPC is the actual authz boundary; a 403
  // here means the signed-in user is authenticated but not an approver for
  // this tenant, and is shown as such rather than swallowed.
  // ---------------------------------------------------------------------
  async function callAction(edit: ProposedEditRow, action: 'approve' | 'reject') {
    if (!session) return;
    setActionState(s => ({ ...s, [edit.id]: 'pending' }));
    setActionError(s => ({ ...s, [edit.id]: '' }));

    try {
      const res = await fetch(`/api/ontology/proposed-edit/${edit.id}/${action}`, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: action === 'reject' ? JSON.stringify({}) : undefined,
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
        setActionState(s => ({ ...s, [edit.id]: 'error' }));
        setActionError(s => ({ ...s, [edit.id]: message }));
        return;
      }

      // Optimistic-ish refresh: drop the actioned row locally, then
      // re-fetch in the background to reconcile with the server.
      setEdits(prev => prev.filter(e => e.id !== edit.id));
      setActionState(s => ({ ...s, [edit.id]: 'idle' }));
      void loadPendingEdits();
    } catch (err) {
      setActionState(s => ({ ...s, [edit.id]: 'error' }));
      setActionError(s => ({
        ...s,
        [edit.id]: err instanceof Error ? err.message : `Failed to ${action}.`,
      }));
    }
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  if (session === undefined) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--bg-void,#04040A)] text-[var(--on-ink,#FAF6EE)]">
        <p className="text-sm opacity-70">Loading…</p>
      </main>
    );
  }

  if (!supabase) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--bg-void,#04040A)] text-[var(--on-ink,#FAF6EE)] p-6">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-lg font-semibold">Review inbox unavailable</h1>
          <p className="text-sm opacity-70">
            Supabase auth is not configured on this deployment. Set
            NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable
            sign-in.
          </p>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--bg-void,#04040A)] text-[var(--on-ink,#FAF6EE)] p-6">
        <form
          onSubmit={handleSendMagicLink}
          className="w-full max-w-sm space-y-4 rounded-lg border border-[var(--card-border,#EAE2D2)]/20 bg-[var(--bg-panel-solid,#0C0E1A)] p-6"
        >
          <h1 className="text-lg font-semibold">Sign in to review pending edits</h1>
          {magicLinkSent ? (
            <p className="text-sm text-[var(--live,#0E9F6E)]">
              Magic link sent to {email}. Check your inbox.
            </p>
          ) : (
            <>
              <label className="block text-sm opacity-80" htmlFor="review-email">
                Work email
              </label>
              <input
                id="review-email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded border border-[var(--card-border,#EAE2D2)]/30 bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--gold,#E8A020)]"
              />
              <button
                type="submit"
                className="w-full rounded bg-[var(--gold,#E8A020)] px-3 py-2 text-sm font-medium text-[var(--ink,#16141C)] hover:opacity-90"
              >
                Send magic link
              </button>
            </>
          )}
          {authError && <p className="text-sm text-red-400">{authError}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--bg-void,#04040A)] text-[var(--on-ink,#FAF6EE)] p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Review inbox</h1>
            <p className="text-sm opacity-60">
              Pending proposed edits · signed in as {session.user.email}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void loadPendingEdits()}
              className="rounded border border-[var(--card-border,#EAE2D2)]/30 px-3 py-1.5 text-sm hover:border-[var(--gold,#E8A020)]"
            >
              Refresh
            </button>
            <button
              onClick={() => void handleSignOut()}
              className="rounded border border-[var(--card-border,#EAE2D2)]/30 px-3 py-1.5 text-sm hover:border-red-400"
            >
              Sign out
            </button>
          </div>
        </header>

        {loading && <p className="text-sm opacity-60">Loading pending edits…</p>}
        {loadError && <p className="text-sm text-red-400">{loadError}</p>}
        {!loading && !loadError && edits.length === 0 && (
          <p className="text-sm opacity-60">No pending edits.</p>
        )}

        <ul className="space-y-3">
          {edits.map(edit => (
            <li
              key={edit.id}
              className="rounded-lg border border-[var(--card-border,#EAE2D2)]/20 bg-[var(--bg-panel-solid,#0C0E1A)] p-4 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="rounded bg-[var(--gold,#E8A020)]/15 px-2 py-0.5 text-xs font-mono uppercase tracking-wide text-[var(--gold,#E8A020)]">
                  {edit.kind}
                </span>
                <span className="text-xs opacity-50">
                  {new Date(edit.created_at).toLocaleString()}
                </span>
              </div>

              <p className="text-sm">
                <span className="opacity-60">Proposed by </span>
                <span className="font-medium">{edit.proposed_by}</span>
              </p>

              {edit.rationale && (
                <p className="text-sm opacity-80">{edit.rationale}</p>
              )}

              <details className="text-xs opacity-70">
                <summary className="cursor-pointer select-none opacity-80">
                  Payload / provenance
                </summary>
                <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-2">
                  {JSON.stringify(edit.payload, null, 2)}
                </pre>
              </details>

              {actionError[edit.id] && (
                <p className="text-sm text-red-400">{actionError[edit.id]}</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  disabled={actionState[edit.id] === 'pending'}
                  onClick={() => void callAction(edit, 'approve')}
                  className="rounded bg-[var(--live,#0E9F6E)] px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={actionState[edit.id] === 'pending'}
                  onClick={() => void callAction(edit, 'reject')}
                  className="rounded border border-red-400/60 px-3 py-1.5 text-sm font-medium text-red-300 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
