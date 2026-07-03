/**
 * KINTEL v2 — Signal/Impact engine types (PRD v2.0 §9.5–9.6)
 *
 * GOVERNANCE (mirrors src/lib/ontology/ingest.ts's boundary style):
 *   The signal engine classifies events against a tenant's watchlist
 *   DETERMINISTICALLY — no LLM ever emits a severity or a figure. Matched
 *   signals flow ONLY into public.intelligence_alerts (the contracted sink
 *   the main Kammandor app composes daily briefings from). The engine NEVER
 *   writes intel.entity / intel.link / intel.entity_provenance (sole-writer
 *   RPC law) and NEVER writes daily_briefings.
 */

/** A normalised external event submitted to the scan endpoint. */
export interface SignalEvent {
  id?: string;
  /** Short human-readable event headline. Required. */
  title: string;
  description?: string;
  url?: string;
  /** ISO-8601 timestamp of when the event occurred. Required. */
  occurredAt: string;
  /** Which connector/feed produced this event (e.g. 'gdelt', 'sec-edgar'). Required. */
  sourceKey: string;
  /** Structured tags extracted upstream (organisation names, places, tickers). */
  entities?: string[];
  geos?: string[];
  tickers?: string[];
  /** Optional upstream 0–1 impact magnitude (e.g. quake normalised magnitude). */
  magnitude?: number;
}

/** Allowed severities — must stay in lockstep with the CHECK constraint on public.intelligence_alerts. */
export type SignalSeverity = 'CRITICAL' | 'NOTABLE' | 'BACKGROUND';

/** An event that matched the tenant watchlist, with its deterministic classification. */
export interface MatchedSignal {
  event: SignalEvent;
  /** Distinct watchlist terms that matched, as written in the watchlist. */
  matchedTerms: string[];
  severity: SignalSeverity;
  /** Plain-language explanation of what matched and why it was rated as it was. */
  rationale: string;
}

/**
 * The tenant watchlist shape consumed by matchSignals — a strict SUBSET of
 * km_monitoring_config's non-sensitive columns. property_api_credentials
 * (secrets) must NEVER appear here or be selected when loading this.
 */
export interface SignalWatchlist {
  keywords?: string[];
  entities?: string[];
  tickers?: string[];
  geos?: string[];
}

/**
 * Exact insert shape for a public.intelligence_alerts row produced by this
 * engine. severity/status values must satisfy the table's CHECK constraints
 * ('CRITICAL'|'NOTABLE'|'BACKGROUND'; engine-created alerts are always 'open').
 */
export interface IntelligenceAlertRow {
  organization_id: string;
  headline: string;
  detail: string;
  severity: SignalSeverity;
  source_url: string | null;
  status: 'open';
}
