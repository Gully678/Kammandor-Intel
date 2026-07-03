/**
 * KINTEL — Intelligence Dashboard logic (PRD §12)
 *
 * Pure, dependency-free helpers behind /dashboard: severity chips,
 * plain-language proposal kinds (incl. duplicate-merge detection),
 * relative time, KPI aggregation and agent-key prettifying.
 *
 * Everything here is deliberately framework-free so it runs under the
 * repo's node-environment vitest setup (see vitest.config.ts) and can be
 * reasoned about without touching the UI.
 */

// ---------------------------------------------------------------------------
// Row shapes — mirror the EXPLICIT column allowlists this dashboard reads.
// Alerts come from public.intelligence_alerts (same allowlist as
// /api/signals/alerts); proposals from intel.proposed_edit (same read the
// review inbox performs); runs from intel.agent_run (agent_key, status,
// started_at ONLY — never input/output/tool_calls).
// ---------------------------------------------------------------------------

export interface AlertRow {
  id: string;
  headline: string | null;
  detail: string | null;
  severity: string | null;
  source_url: string | null;
  status: string | null;
  created_at: string;
}

export interface ProposalRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  proposed_by: string;
  created_at: string;
  evaluation?: unknown;
}

export interface AgentRunRow {
  agent_key: string;
  status: string | null;
  started_at: string;
}

// ---------------------------------------------------------------------------
// Severity → chip (CRITICAL red / NOTABLE amber / BACKGROUND grey)
// ---------------------------------------------------------------------------

export interface SeverityChip {
  label: 'Critical' | 'Notable' | 'Background';
  /** Tailwind classes for the chip — same idiom as the review inbox. */
  className: string;
}

const SEVERITY_CHIPS: Record<'CRITICAL' | 'NOTABLE' | 'BACKGROUND', SeverityChip> = {
  CRITICAL: {
    label: 'Critical',
    className: 'border-red-400/50 bg-red-400/10 text-red-300',
  },
  NOTABLE: {
    label: 'Notable',
    className: 'border-amber-400/50 bg-amber-400/10 text-amber-300',
  },
  BACKGROUND: {
    label: 'Background',
    className: 'border-gray-400/40 bg-gray-400/10 text-gray-300',
  },
};

/** Maps a raw severity value to its display chip; unknown values read as Background. */
export function severityChip(severity: string | null | undefined): SeverityChip {
  const key = (severity ?? '').toUpperCase();
  if (key === 'CRITICAL' || key === 'NOTABLE' || key === 'BACKGROUND') {
    return SEVERITY_CHIPS[key];
  }
  return SEVERITY_CHIPS.BACKGROUND;
}

// ---------------------------------------------------------------------------
// Proposal kind → plain language
// ---------------------------------------------------------------------------

/**
 * True when an update_entity proposal records a possible duplicate merge —
 * i.e. the payload built by buildMergeProposal (src/lib/ontology/resolve.ts):
 * { id, patch: { properties: { merged_into: <primaryId>, ... } } }.
 */
export function isMergeProposal(payload: Record<string, unknown>): boolean {
  const patch = payload.patch;
  if (typeof patch !== 'object' || patch === null) return false;
  const properties = (patch as Record<string, unknown>).properties;
  if (typeof properties !== 'object' || properties === null) return false;
  const merged = (properties as Record<string, unknown>).merged_into;
  return typeof merged === 'string' && merged.length > 0;
}

/** Reads the proposed record's type (e.g. 'company') from a create_entity payload. */
function payloadEntityType(payload: Record<string, unknown>): string | null {
  const entity = payload.entity;
  if (typeof entity !== 'object' || entity === null) return null;
  const type = (entity as Record<string, unknown>).type;
  return typeof type === 'string' && type.length > 0 ? type : null;
}

/**
 * Plain-language label for a proposed edit — 'New company record', 'New
 * connection', 'Possible duplicate' — never the raw kind token.
 */
export function proposalKindLabel(
  kind: string,
  payload: Record<string, unknown>,
): string {
  switch (kind) {
    case 'create_entity': {
      const type = payloadEntityType(payload);
      return type ? `New ${type.replace(/_/g, ' ')} record` : 'New record';
    }
    case 'create_link':
      return 'New connection';
    case 'update_link':
      return 'Updated connection';
    case 'update_entity':
      return isMergeProposal(payload) ? 'Possible duplicate' : 'Updated record';
    default:
      return 'Proposed change';
  }
}

// ---------------------------------------------------------------------------
// Evaluation verdict — the automatic checks recorded with a proposal
// (same stored shape the review inbox renders in full).
// ---------------------------------------------------------------------------

export interface EvaluationVerdict {
  label: 'Checks passed' | 'Needs attention';
  passed: boolean;
}

/** Distils a stored evaluation into a one-word verdict chip; null when absent/unreadable. */
export function evaluationVerdict(evaluation: unknown): EvaluationVerdict | null {
  if (typeof evaluation !== 'object' || evaluation === null) return null;
  const rec = evaluation as Record<string, unknown>;
  if (typeof rec.passed !== 'boolean') return null;
  return rec.passed
    ? { label: 'Checks passed', passed: true }
    : { label: 'Needs attention', passed: false };
}

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

/**
 * Compact relative timestamp: 'just now', '15m ago', '3h ago', '3d ago'.
 * Returns '' for unparseable input — the UI simply omits the timestamp.
 */
export function relativeTime(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// KPI aggregation
// ---------------------------------------------------------------------------

export interface AlertSeverityAggregate {
  total: number;
  critical: number;
  notable: number;
  background: number;
}

/**
 * Counts alert rows by severity. Unknown/missing severities are counted as
 * background — every row is represented somewhere; nothing is silently dropped.
 */
export function aggregateAlertSeverities(
  rows: ReadonlyArray<{ severity: string | null | undefined }>,
): AlertSeverityAggregate {
  const agg: AlertSeverityAggregate = { total: 0, critical: 0, notable: 0, background: 0 };
  for (const row of rows) {
    agg.total += 1;
    const { label } = severityChip(row.severity);
    if (label === 'Critical') agg.critical += 1;
    else if (label === 'Notable') agg.notable += 1;
    else agg.background += 1;
  }
  return agg;
}

/** Counts runs whose started_at falls within the last `hours` (bad dates ignored). */
export function countRunsSince(
  runs: ReadonlyArray<{ started_at: string }>,
  hours: number,
  now: Date = new Date(),
): number {
  const cutoff = now.getTime() - hours * 3_600_000;
  let count = 0;
  for (const run of runs) {
    const at = Date.parse(run.started_at);
    if (!Number.isNaN(at) && at >= cutoff && at <= now.getTime()) count += 1;
  }
  return count;
}

/**
 * Reads the exact total from a PostgREST Content-Range header
 * (e.g. '0-9/57' → 57) produced by a `Prefer: count=exact` request.
 * Returns null when unavailable so callers can fall back gracefully.
 */
export function parseTotalFromContentRange(header: string | null): number | null {
  if (!header) return null;
  const match = /\/(\d+)\s*$/.exec(header);
  if (!match) return null;
  const total = Number.parseInt(match[1], 10);
  return Number.isNaN(total) ? null : total;
}

// ---------------------------------------------------------------------------
// Agent keys → plain names
// ---------------------------------------------------------------------------

const AGENT_NAMES: Record<string, string> = {
  watcher: 'Watcher',
  resolver: 'Resolver',
  analyst: 'Analyst',
};

/** 'watcher' → 'Watcher'; unknown keys are title-cased ('gdelt_sweeper' → 'Gdelt Sweeper'). */
export function prettifyAgentKey(key: string): string {
  const known = AGENT_NAMES[key];
  if (known) return known;
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
