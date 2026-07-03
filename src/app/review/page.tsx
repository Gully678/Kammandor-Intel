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
import { SOURCES, type LicenceClass } from '@/config/sources';

interface ProposedEditRow {
  id:           string;
  tenant_id:    string;
  kind:         'create_entity' | 'update_entity' | 'create_link' | 'update_link';
  payload:      Record<string, unknown>;
  proposed_by:  string;
  rationale?:   string | null;
  status:       'pending' | 'approved' | 'rejected' | 'applied';
  created_at:   string;
  /** Why a rejected proposal was turned down (v2 §12.4) — null while pending. */
  reason?:      string | null;
  /** Automatic-check result recorded when the proposal was created (v2 §12.4). */
  evaluation?:  unknown;
}

type ActionState = 'idle' | 'pending' | 'error';

// ---------------------------------------------------------------------------
// Evaluation display — the automatic checks recorded when the proposal was
// created (see src/lib/ai/analyze.ts's evaluate() and src/lib/ontology/
// ingest.ts, which stores the result alongside the proposal). Shown in plain
// language; the reviewer never needs to know how it is stored.
// ---------------------------------------------------------------------------

interface EvaluationDisplay {
  passed: boolean;
  score:  number;
  checks: string[];
}

function isEvaluationDisplay(value: unknown): value is EvaluationDisplay {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.passed === 'boolean' &&
    typeof rec.score === 'number' &&
    Array.isArray(rec.checks) &&
    rec.checks.every(c => typeof c === 'string')
  );
}

type CheckOutcome = 'pass' | 'fail' | 'warn';

function splitCheck(check: string): { outcome: CheckOutcome; text: string } {
  if (check.startsWith('PASS: ')) return { outcome: 'pass', text: check.slice(6) };
  if (check.startsWith('FAIL: ')) return { outcome: 'fail', text: check.slice(6) };
  if (check.startsWith('WARN: ')) return { outcome: 'warn', text: check.slice(6) };
  return { outcome: 'warn', text: check };
}

const CHECK_CHIP_CLASSES: Record<CheckOutcome, string> = {
  pass: 'border-[var(--live,#0E9F6E)]/40 bg-[var(--live,#0E9F6E)]/10 text-[var(--live,#0E9F6E)]',
  fail: 'border-red-400/50 bg-red-400/10 text-red-300',
  warn: 'border-amber-400/50 bg-amber-400/10 text-amber-300',
};

const CHECK_CHIP_ICON: Record<CheckOutcome, string> = { pass: '\u2713', fail: '\u2715', warn: '!' };

function EvaluationSection({ evaluation }: { evaluation: unknown }) {
  if (!isEvaluationDisplay(evaluation)) return null;

  return (
    <section aria-label="Automatic checks" className="space-y-1.5">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide opacity-60">
          Automatic checks
        </h3>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
            evaluation.passed
              ? CHECK_CHIP_CLASSES.pass
              : CHECK_CHIP_CLASSES.fail
          }`}
        >
          {evaluation.passed ? 'Passed' : 'Needs attention'}
        </span>
        <span className="text-xs opacity-50">
          Quality score {Math.round(evaluation.score * 100)}%
        </span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {evaluation.checks.map(check => {
          const { outcome, text } = splitCheck(check);
          return (
            <li
              key={check}
              className={`rounded-full border px-2 py-0.5 text-[11px] leading-4 ${CHECK_CHIP_CLASSES[outcome]}`}
            >
              <span aria-hidden="true">{CHECK_CHIP_ICON[outcome]}</span> {text}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sources display — where each piece of proposed information came from.
// Proposal payloads may carry a `provenance` array (source, licence, fetch
// time, confidence, which field it supports); the source registry
// (src/config/sources.ts) supplies the human label and default licence.
// ---------------------------------------------------------------------------

interface ProvenanceEntryDisplay {
  source_key?:    string;
  source_url?:    string;
  fetched_at?:    string;
  confidence?:    number;
  licence_class?: LicenceClass;
  licence_terms?: string;
  property_path?: string;
}

const LICENCE_LABELS: Record<LicenceClass, string> = {
  'licensed':           'Licensed data',
  'public-attribution': 'Public \u2014 credit the source',
  'public-open':        'Public \u2014 open use',
  'proprietary':        'Proprietary',
};

function readProvenanceEntries(payload: Record<string, unknown>): ProvenanceEntryDisplay[] {
  const raw = payload.provenance;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is ProvenanceEntryDisplay =>
      typeof entry === 'object' && entry !== null,
  );
}

function SourcesSection({ payload }: { payload: Record<string, unknown> }) {
  const entries = readProvenanceEntries(payload);
  if (entries.length === 0) return null;

  return (
    <section aria-label="Sources" className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide opacity-60">Sources</h3>
      <ul className="space-y-1.5">
        {entries.map((entry, index) => {
          const source        = SOURCES.find(s => s.key === entry.source_key);
          const label         = source?.label ?? entry.source_key ?? 'Unknown source';
          const licenceClass  = entry.licence_class ?? source?.licence.class;
          const licenceTerms  = entry.licence_terms ?? source?.licence.terms;
          const fetchedAt     = entry.fetched_at ? new Date(entry.fetched_at) : null;
          const confidencePct =
            typeof entry.confidence === 'number'
              ? `${Math.round(entry.confidence * 100)}%`
              : null;

          return (
            <li
              key={`${entry.source_key ?? 'source'}-${entry.property_path ?? index}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-[var(--card-border,#EAE2D2)]/10 bg-black/20 px-2 py-1.5 text-xs"
            >
              <span className="font-medium">{label}</span>
              {licenceClass && (
                <span
                  title={licenceTerms ?? undefined}
                  className="cursor-help rounded-full border border-[var(--gold,#E8A020)]/40 bg-[var(--gold,#E8A020)]/10 px-2 py-0.5 text-[11px] text-[var(--gold,#E8A020)]"
                >
                  {LICENCE_LABELS[licenceClass] ?? licenceClass}
                </span>
              )}
              {fetchedAt && !Number.isNaN(fetchedAt.getTime()) && (
                <span className="opacity-60">Fetched {fetchedAt.toLocaleString()}</span>
              )}
              {confidencePct && <span className="opacity-60">Confidence {confidencePct}</span>}
              {entry.property_path && (
                <span className="opacity-60">
                  Supports <code className="font-mono">{entry.property_path}</code>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

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
  // Reject flow: which proposal has its "reason" form open, and the draft text.
  const [rejectingId, setRejectingId]   = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

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
  async function callAction(edit: ProposedEditRow, action: 'approve' | 'reject', reason?: string) {
    if (!session) return;
    setActionState(s => ({ ...s, [edit.id]: 'pending' }));
    setActionError(s => ({ ...s, [edit.id]: '' }));

    try {
      const trimmedReason = reason?.trim();
      const res = await fetch(`/api/ontology/proposed-edit/${edit.id}/${action}`, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: action === 'reject'
          ? JSON.stringify(trimmedReason ? { reason: trimmedReason } : {})
          : undefined,
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
      if (rejectingId === edit.id) {
        setRejectingId(null);
        setRejectReason('');
      }
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

              <EvaluationSection evaluation={edit.evaluation} />

              <SourcesSection payload={edit.payload} />

              <details className="text-xs opacity-70">
                <summary className="cursor-pointer select-none opacity-80">
                  Show raw
                </summary>
                <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-2">
                  {JSON.stringify(edit.payload, null, 2)}
                </pre>
              </details>

              {actionError[edit.id] && (
                <p className="text-sm text-red-400">{actionError[edit.id]}</p>
              )}

              {rejectingId === edit.id ? (
                <form
                  className="space-y-2 rounded border border-red-400/30 bg-red-400/5 p-3"
                  onSubmit={e => {
                    e.preventDefault();
                    void callAction(edit, 'reject', rejectReason);
                  }}
                >
                  <label
                    htmlFor={`reject-reason-${edit.id}`}
                    className="block text-xs font-medium opacity-80"
                  >
                    Why are you turning this down? (optional — kept with the record)
                  </label>
                  <input
                    id={`reject-reason-${edit.id}`}
                    type="text"
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="e.g. duplicate of an existing company"
                    maxLength={500}
                    autoFocus
                    className="w-full rounded border border-[var(--card-border,#EAE2D2)]/30 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-red-400"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={actionState[edit.id] === 'pending'}
                      className="rounded bg-red-400/90 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
                    >
                      {actionState[edit.id] === 'pending' ? 'Rejecting\u2026' : 'Confirm reject'}
                    </button>
                    <button
                      type="button"
                      disabled={actionState[edit.id] === 'pending'}
                      onClick={() => {
                        setRejectingId(null);
                        setRejectReason('');
                      }}
                      className="rounded border border-[var(--card-border,#EAE2D2)]/30 px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
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
                    onClick={() => {
                      setRejectingId(edit.id);
                      setRejectReason('');
                    }}
                    className="rounded border border-red-400/60 px-3 py-1.5 text-sm font-medium text-red-300 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
