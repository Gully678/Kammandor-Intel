'use client';

/**
 * KINTEL — Intelligence Dashboard (PRD §12)
 * /dashboard — the front page of the intelligence product.
 *
 * Dark, precise, institutional. A KPI band up top; live feeds below.
 * Every number links to the surface it came from, and every AI-derived
 * item shows where it came from (source link on signals, proposer +
 * automatic-check verdict on proposals) — that traceability IS the product.
 *
 * AUTH: identical mechanism to /review — a minimal magic-link sign-in via
 * the shared Supabase browser client (anon key only). Reads then go
 * straight to PostgREST under the user's own session token, exactly the
 * convention the review inbox established; RLS on the store is the real
 * boundary, this page is never it.
 *
 * FAILURE: each panel loads independently and independently shows a
 * "Couldn't load — retry" state. One broken feed never blanks the page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient';
import { getBrand, resolveBrandKey } from '@/config/brands';
import { buildBrandCss } from '@/components/BrandThemeScript';
import {
  aggregateAlertSeverities,
  countRunsSince,
  evaluationVerdict,
  parseTotalFromContentRange,
  prettifyAgentKey,
  proposalKindLabel,
  relativeTime,
  severityChip,
  type AgentRunRow,
  type AlertRow,
  type ProposalRow,
} from './lib';

// ---------------------------------------------------------------------------
// PostgREST reads — same direct-fetch convention as the review inbox
// (anon key + the signed-in user's bearer token; RLS scopes every row).
// Column lists are EXPLICIT — never select=*.
// ---------------------------------------------------------------------------

const ALERT_COLUMNS = 'id,headline,detail,severity,source_url,status,created_at';
const PROPOSAL_COLUMNS = 'id,kind,payload,proposed_by,created_at,evaluation';
const RUN_COLUMNS = 'agent_key,status,started_at';

interface RestOptions {
  /** intel-schema tables need Accept-Profile: intel; public tables do not. */
  intelSchema?: boolean;
  /** Ask PostgREST for the exact total via Prefer: count=exact. */
  exactCount?: boolean;
}

async function restGet<T>(
  path: string,
  token: string,
  options: RestOptions = {},
): Promise<{ rows: T[]; total: number | null }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase is not configured.');

  const headers: Record<string, string> = {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
  };
  if (options.intelSchema) headers['Accept-Profile'] = 'intel';
  if (options.exactCount) headers.Prefer = 'count=exact';

  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const rows = (await res.json()) as T[];
  const total = options.exactCount
    ? parseTotalFromContentRange(res.headers.get('content-range'))
    : null;
  return { rows: Array.isArray(rows) ? rows : [], total };
}

/** Latest 15 alerts for the live feed (public.intelligence_alerts). */
async function loadAlertFeed(token: string): Promise<AlertRow[]> {
  const { rows } = await restGet<AlertRow>(
    `intelligence_alerts?select=${ALERT_COLUMNS}&order=created_at.desc&limit=15`,
    token,
  );
  return rows;
}

/** Severities of currently-open alerts, for the KPI band. */
async function loadOpenAlertSeverities(token: string): Promise<{ severity: string | null }[]> {
  const { rows } = await restGet<{ severity: string | null }>(
    'intelligence_alerts?select=severity&status=eq.open&limit=500',
    token,
  );
  return rows;
}

/** Latest 10 pending proposals + the exact pending total (intel.proposed_edit). */
async function loadPendingProposals(
  token: string,
): Promise<{ rows: ProposalRow[]; total: number | null }> {
  return restGet<ProposalRow>(
    `proposed_edit?select=${PROPOSAL_COLUMNS}&status=eq.pending&order=created_at.desc&limit=10`,
    token,
    { intelSchema: true, exactCount: true },
  );
}

/** Exact count of watched records (intel.entity) — rows themselves unused. */
async function loadEntityCount(token: string): Promise<number | null> {
  const { total } = await restGet<{ id: string }>(
    'entity?select=id&limit=1',
    token,
    { intelSchema: true, exactCount: true },
  );
  return total;
}

/** Latest 50 agent runs (intel.agent_run — agent_key,status,started_at ONLY). */
async function loadAgentRuns(token: string): Promise<AgentRunRow[]> {
  const { rows } = await restGet<AgentRunRow>(
    `agent_run?select=${RUN_COLUMNS}&order=started_at.desc&limit=50`,
    token,
    { intelSchema: true },
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Independent panel loading — one failed feed never blanks the page.
// ---------------------------------------------------------------------------

type PanelState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: T };

function usePanel<T>(
  session: Session | null,
  load: (token: string) => Promise<T>,
): { state: PanelState<T>; retry: () => void } {
  const [state, setState] = useState<PanelState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setState({ status: 'loading' });
    load(session.access_token)
      .then(data => {
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [session, load, attempt]);

  const retry = useCallback(() => setAttempt(a => a + 1), []);
  return { state, retry };
}

function PanelError({ retry }: { retry: () => void }) {
  return (
    <p className="text-sm text-red-300">
      Couldn&rsquo;t load{' — '}
      <button
        type="button"
        onClick={retry}
        className="underline underline-offset-2 hover:text-red-200"
      >
        retry
      </button>
    </p>
  );
}

// ---------------------------------------------------------------------------
// KPI cards
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  context,
  href,
  loading,
  error,
  retry,
}: {
  label: string;
  value: string;
  context: React.ReactNode;
  href: string;
  loading: boolean;
  error: boolean;
  retry: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--card-border,#EAE2D2)]/15 bg-[var(--bg-panel-solid,#0C0E1A)] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide opacity-50">{label}</p>
      {error ? (
        <div className="mt-2">
          <PanelError retry={retry} />
        </div>
      ) : (
        <>
          <a
            href={href}
            className="mt-1 block text-3xl font-semibold tabular-nums text-[var(--on-ink,#FAF6EE)] hover:text-[var(--gold,#E8A020)]"
            aria-label={`${label} — open`}
          >
            {loading ? '…' : value}
          </a>
          <p className="mt-1 text-xs opacity-60">{loading ? 'Checking…' : context}</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------

export default function DashboardClient({
  initialBrandKey,
}: {
  initialBrandKey: string;
}) {
  const supabase = getSupabaseBrowserClient();

  // Brand: server-resolved (INTEL_BRAND) by default; ?theme= overrides
  // client-side exactly like the map page does.
  const [brandKey, setBrandKey] = useState(initialBrandKey);
  useEffect(() => {
    const theme = new URLSearchParams(window.location.search).get('theme');
    if (!theme) return;
    const resolved = resolveBrandKey(theme);
    setBrandKey(resolved);
    const css = buildBrandCss(resolved);
    if (css) {
      const styleId = 'kintel-brand-override';
      let el = document.getElementById(styleId) as HTMLStyleElement | null;
      if (!el) {
        el = document.createElement('style');
        el.id = styleId;
        document.head.appendChild(el);
      }
      el.textContent = css;
    }
  }, []);
  const brand = getBrand(brandKey);

  // Auth — identical pattern to /review.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

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

  async function handleSendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    if (!supabase) {
      setAuthError('Sign-in is not configured on this deployment.');
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
  }

  // Panels — each independent.
  const liveSession = session ?? null;
  const alertFeed = usePanel(liveSession, loadAlertFeed);
  const openAlerts = usePanel(liveSession, loadOpenAlertSeverities);
  const proposals = usePanel(liveSession, loadPendingProposals);
  const entityCount = usePanel(liveSession, loadEntityCount);
  const agentRuns = usePanel(liveSession, loadAgentRuns);

  const openAgg = useMemo(
    () =>
      openAlerts.state.status === 'ready'
        ? aggregateAlertSeverities(openAlerts.state.data)
        : null,
    [openAlerts.state],
  );

  const runsLast24h = useMemo(
    () =>
      agentRuns.state.status === 'ready'
        ? countRunsSince(agentRuns.state.data, 24)
        : null,
    [agentRuns.state],
  );

  // -------------------------------------------------------------------
  // Signed-out / unconfigured / booting states
  // -------------------------------------------------------------------

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
          <h1 className="text-lg font-semibold">{brand.name} dashboard unavailable</h1>
          <p className="text-sm opacity-70">
            Sign-in is not configured on this deployment. Set
            NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable it.
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
          <div>
            <h1 className="text-lg font-semibold">{brand.name}</h1>
            <p className="text-sm opacity-60">Ahead of the pulse</p>
          </div>
          <p className="text-sm opacity-80">Sign in to open your dashboard.</p>
          {magicLinkSent ? (
            <p className="text-sm text-[var(--live,#0E9F6E)]">
              Magic link sent to {email}. Check your inbox.
            </p>
          ) : (
            <>
              <label className="block text-sm opacity-80" htmlFor="dashboard-email">
                Work email
              </label>
              <input
                id="dashboard-email"
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

  // -------------------------------------------------------------------
  // Signed-in dashboard
  // -------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-[var(--bg-void,#04040A)] text-[var(--on-ink,#FAF6EE)] p-6">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* ── Header ── */}
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--card-border,#EAE2D2)]/10 pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{brand.name}</h1>
            <p className="text-sm text-[var(--gold,#E8A020)]">Ahead of the pulse</p>
          </div>
          <nav aria-label="Primary" className="flex items-center gap-4 text-sm">
            <span aria-current="page" className="font-medium text-[var(--gold,#E8A020)]">
              Dashboard
            </span>
            <a href="/" className="opacity-70 hover:opacity-100 hover:text-[var(--gold,#E8A020)]">
              Map
            </a>
            <a href="/review" className="opacity-70 hover:opacity-100 hover:text-[var(--gold,#E8A020)]">
              Review
            </a>
            <span className="hidden opacity-40 sm:inline">·</span>
            <span className="hidden text-xs opacity-50 sm:inline">{session.user.email}</span>
            <button
              onClick={() => void handleSignOut()}
              className="rounded border border-[var(--card-border,#EAE2D2)]/30 px-3 py-1.5 text-sm hover:border-red-400"
            >
              Sign out
            </button>
          </nav>
        </header>

        {/* ── KPI band ── */}
        <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Alerts open"
            value={openAgg ? String(openAgg.total) : ''}
            context={
              openAgg ? (
                <>
                  <span className="text-red-300">{openAgg.critical} critical</span>
                  {' · '}
                  <span className="text-amber-300">{openAgg.notable} notable</span>
                  {' · '}
                  <span className="text-gray-300">{openAgg.background} background</span>
                </>
              ) : null
            }
            href="#live-signals"
            loading={openAlerts.state.status === 'loading'}
            error={openAlerts.state.status === 'error'}
            retry={openAlerts.retry}
          />
          <KpiCard
            label="Waiting for your review"
            value={
              proposals.state.status === 'ready'
                ? String(proposals.state.data.total ?? proposals.state.data.rows.length)
                : ''
            }
            context="Proposed changes needing a decision"
            href="/review"
            loading={proposals.state.status === 'loading'}
            error={proposals.state.status === 'error'}
            retry={proposals.retry}
          />
          <KpiCard
            label="Watched entities"
            value={
              entityCount.state.status === 'ready'
                ? String(entityCount.state.data ?? 0)
                : ''
            }
            context="Companies, people and assets on file"
            href="/"
            loading={entityCount.state.status === 'loading'}
            error={entityCount.state.status === 'error'}
            retry={entityCount.retry}
          />
          <KpiCard
            label="Agent activity"
            value={runsLast24h === null ? '' : String(runsLast24h)}
            context="Runs in the last 24 hours"
            href="#agent-activity"
            loading={agentRuns.state.status === 'loading'}
            error={agentRuns.state.status === 'error'}
            retry={agentRuns.retry}
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* ── Live signals ── */}
          <section
            id="live-signals"
            aria-label="Live signals"
            className="space-y-3 lg:col-span-2"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
              Live signals
            </h2>
            {alertFeed.state.status === 'loading' && (
              <p className="text-sm opacity-60">Loading signals…</p>
            )}
            {alertFeed.state.status === 'error' && <PanelError retry={alertFeed.retry} />}
            {alertFeed.state.status === 'ready' && alertFeed.state.data.length === 0 && (
              <div className="rounded-lg border border-[var(--card-border,#EAE2D2)]/15 bg-[var(--bg-panel-solid,#0C0E1A)] p-6 text-center">
                <p className="text-sm opacity-80">No signals yet — your watchlist is quiet.</p>
                <p className="mt-1 text-xs opacity-50">
                  The automated sweep runs every 30 minutes; new signals appear here as
                  soon as something on your watchlist moves.
                </p>
              </div>
            )}
            {alertFeed.state.status === 'ready' && alertFeed.state.data.length > 0 && (
              <ul className="space-y-2">
                {alertFeed.state.data.map(alert => {
                  const chip = severityChip(alert.severity);
                  return (
                    <li
                      key={alert.id}
                      className="rounded-lg border border-[var(--card-border,#EAE2D2)]/15 bg-[var(--bg-panel-solid,#0C0E1A)] px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm leading-snug">
                          {alert.headline ?? alert.detail ?? 'Untitled signal'}
                        </p>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-4 ${chip.className}`}
                        >
                          {chip.label}
                        </span>
                      </div>
                      <p className="mt-1 flex items-center gap-3 text-xs opacity-60">
                        <span>{relativeTime(alert.created_at)}</span>
                        {alert.source_url && (
                          <a
                            href={alert.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--gold,#E8A020)] underline-offset-2 hover:underline"
                          >
                            Source ↗
                          </a>
                        )}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── Awaiting your decision ── */}
          <section aria-label="Awaiting your decision" className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
                Awaiting your decision
              </h2>
              <a
                href="/review"
                className="text-sm text-[var(--gold,#E8A020)] underline-offset-2 hover:underline"
              >
                Review →
              </a>
            </div>
            {proposals.state.status === 'loading' && (
              <p className="text-sm opacity-60">Loading…</p>
            )}
            {proposals.state.status === 'error' && <PanelError retry={proposals.retry} />}
            {proposals.state.status === 'ready' && proposals.state.data.rows.length === 0 && (
              <div className="rounded-lg border border-[var(--card-border,#EAE2D2)]/15 bg-[var(--bg-panel-solid,#0C0E1A)] p-6 text-center">
                <p className="text-sm opacity-80">Nothing waiting — you&rsquo;re all caught up.</p>
              </div>
            )}
            {proposals.state.status === 'ready' && proposals.state.data.rows.length > 0 && (
              <ul className="space-y-2">
                {proposals.state.data.rows.map(proposal => {
                  const verdict = evaluationVerdict(proposal.evaluation);
                  return (
                    <li
                      key={proposal.id}
                      className="rounded-lg border border-[var(--card-border,#EAE2D2)]/15 bg-[var(--bg-panel-solid,#0C0E1A)] px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">
                          {proposalKindLabel(proposal.kind, proposal.payload)}
                        </p>
                        {verdict && (
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-4 ${
                              verdict.passed
                                ? 'border-[var(--live,#0E9F6E)]/40 bg-[var(--live,#0E9F6E)]/10 text-[var(--live,#0E9F6E)]'
                                : 'border-amber-400/50 bg-amber-400/10 text-amber-300'
                            }`}
                          >
                            {verdict.label}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs opacity-60">
                        From {proposal.proposed_by} · {relativeTime(proposal.created_at)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* ── Agent activity ── */}
        <section id="agent-activity" aria-label="Agent activity" className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
            Agent activity
          </h2>
          {agentRuns.state.status === 'loading' && (
            <p className="text-sm opacity-60">Loading…</p>
          )}
          {agentRuns.state.status === 'error' && <PanelError retry={agentRuns.retry} />}
          {agentRuns.state.status === 'ready' && agentRuns.state.data.length === 0 && (
            <p className="text-sm opacity-60">
              No agent runs yet — activity appears here once the automated sweep starts.
            </p>
          )}
          {agentRuns.state.status === 'ready' && agentRuns.state.data.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {agentRuns.state.data.slice(0, 10).map((run, index) => (
                <li
                  key={`${run.agent_key}-${run.started_at}-${index}`}
                  className="flex items-center gap-2 rounded-full border border-[var(--card-border,#EAE2D2)]/15 bg-[var(--bg-panel-solid,#0C0E1A)] px-3 py-1.5 text-xs"
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${
                      run.status === 'succeeded'
                        ? 'bg-[var(--live,#0E9F6E)]'
                        : run.status === 'failed'
                          ? 'bg-red-400'
                          : 'bg-amber-400'
                    }`}
                  />
                  <span className="sr-only">
                    {run.status === 'succeeded'
                      ? 'Completed'
                      : run.status === 'failed'
                        ? 'Failed'
                        : 'Running'}
                    :
                  </span>
                  <span className="font-medium">{prettifyAgentKey(run.agent_key)}</span>
                  <span className="opacity-50">{relativeTime(run.started_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
