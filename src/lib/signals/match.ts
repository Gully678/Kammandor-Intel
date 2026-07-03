/**
 * KINTEL v2 — deterministic watchlist matching (PRD v2.0 §9.5–9.6)
 *
 * PURE MODULE: no network, no DB, no LLM — unit-testable in isolation
 * (mirrors src/lib/ontology/ingest.ts's pure-builder pattern). The route
 * (src/app/api/signals/scan/route.ts) owns all I/O.
 *
 * ── SEVERITY RULES (deterministic; no model ever sets these) ────────────
 * A watchlist has up to four categories: keywords, entities, tickers, geos.
 * Each term is matched case-insensitively as a WHOLE WORD against the
 * event's title, description, and structured tags (entities/geos/tickers).
 * A match is "strong" when found in the title or in a structured tag, and
 * "weak" when found ONLY in the description text.
 *
 *   CRITICAL   — matches span ≥2 distinct watchlist categories, OR any
 *                watched ENTITY term matched AND the event carries a
 *                magnitude with event.magnitude >= 0.8.
 *   NOTABLE    — exactly one category matched (≥1 term) and at least one
 *                of its matches is strong (title or structured tag).
 *   BACKGROUND — exactly one category matched and EVERY match is weak
 *                (the term appears only in the description).
 *   (no match) — the event is omitted from the result entirely.
 */

import type { MatchedSignal, SignalEvent, SignalSeverity, SignalWatchlist } from './types';

type WatchCategory = keyof SignalWatchlist;

const CATEGORIES: readonly WatchCategory[] = ['keywords', 'entities', 'tickers', 'geos'];

/** Plain-language labels for rationale text — no schema jargon. */
const CATEGORY_LABEL: Record<WatchCategory, string> = {
  keywords: 'keyword',
  entities: 'entity',
  tickers: 'ticker',
  geos: 'geography',
};

/** Magnitude threshold above which a watched-entity match escalates to CRITICAL. */
export const CRITICAL_MAGNITUDE_THRESHOLD = 0.8;

interface TermHit {
  term: string;
  category: WatchCategory;
  /** Where the term was found (first location wins for rationale wording). */
  where: 'the headline' | 'the event tags' | 'the description';
  /** Strong = title or structured tag; weak = description-only. */
  strong: boolean;
}

/**
 * Match a batch of events against a tenant watchlist. Pure and
 * deterministic: identical inputs always produce identical outputs, in
 * input order. Events with no matches are omitted.
 */
export function matchSignals(
  events: SignalEvent[],
  watchlist: SignalWatchlist,
): MatchedSignal[] {
  const matched: MatchedSignal[] = [];
  for (const event of events) {
    const signal = matchOne(event, watchlist);
    if (signal) matched.push(signal);
  }
  return matched;
}

function matchOne(event: SignalEvent, watchlist: SignalWatchlist): MatchedSignal | null {
  const tags = [
    ...(event.entities ?? []),
    ...(event.geos ?? []),
    ...(event.tickers ?? []),
  ].filter((t): t is string => typeof t === 'string');

  const hits: TermHit[] = [];
  const seenTerms = new Set<string>();

  for (const category of CATEGORIES) {
    for (const rawTerm of watchlist[category] ?? []) {
      const term = typeof rawTerm === 'string' ? rawTerm.trim() : '';
      if (!term) continue;
      const dedupe = `${category}|${term.toLowerCase()}`;
      if (seenTerms.has(dedupe)) continue;

      const inTitle = containsWholeWord(event.title, term);
      const inTags = tags.some((tag) => containsWholeWord(tag, term));
      const inDescription =
        event.description !== undefined && containsWholeWord(event.description, term);

      if (!inTitle && !inTags && !inDescription) continue;

      seenTerms.add(dedupe);
      hits.push({
        term,
        category,
        where: inTitle ? 'the headline' : inTags ? 'the event tags' : 'the description',
        strong: inTitle || inTags,
      });
    }
  }

  if (hits.length === 0) return null;

  const severity = classify(hits, event);
  return {
    event,
    matchedTerms: distinctTerms(hits),
    severity,
    rationale: buildRationale(hits, severity, event),
  };
}

// ---------------------------------------------------------------------------
// Severity classification (see the rules banner at the top of this file)
// ---------------------------------------------------------------------------

function classify(hits: TermHit[], event: SignalEvent): SignalSeverity {
  const categories = new Set(hits.map((h) => h.category));
  const entityMatched = hits.some((h) => h.category === 'entities');
  const highMagnitude =
    event.magnitude !== undefined && event.magnitude >= CRITICAL_MAGNITUDE_THRESHOLD;

  if (categories.size >= 2 || (entityMatched && highMagnitude)) return 'CRITICAL';
  if (hits.some((h) => h.strong)) return 'NOTABLE';
  return 'BACKGROUND';
}

// ---------------------------------------------------------------------------
// Whole-word, case-insensitive containment
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `term` appears in `text` as a whole word (case-insensitive).
 * Explicit non-letter/digit boundaries are used instead of \b so terms
 * that start or end with symbols (e.g. tickers like "BRK.B") still match
 * whole tokens; "art" must never match inside "party".
 */
export function containsWholeWord(text: string, term: string): boolean {
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escapeRegExp(term)}([^\\p{L}\\p{N}_]|$)`,
    'iu',
  );
  return pattern.test(text);
}

// ---------------------------------------------------------------------------
// Rationale — plain language, names every matched term and category
// ---------------------------------------------------------------------------

function distinctTerms(hits: TermHit[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const key = hit.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit.term);
  }
  return out;
}

function buildRationale(hits: TermHit[], severity: SignalSeverity, event: SignalEvent): string {
  const parts = hits.map(
    (h) => `${CATEGORY_LABEL[h.category]} "${h.term}" in ${h.where}`,
  );
  const matchedText = `Matched ${parts.join('; ')}.`;

  const categories = [...new Set(hits.map((h) => h.category))];
  let reason: string;
  if (severity === 'CRITICAL') {
    if (categories.length >= 2) {
      reason = `Rated CRITICAL because the matches span ${categories.length} watchlist areas (${categories
        .map((c) => CATEGORY_LABEL[c])
        .join(', ')}).`;
    } else {
      reason = `Rated CRITICAL because a watched entity matched and the event's impact score is ${String(
        event.magnitude,
      )} (at or above ${String(CRITICAL_MAGNITUDE_THRESHOLD)}).`;
    }
  } else if (severity === 'NOTABLE') {
    reason = 'Rated NOTABLE: one watchlist area matched directly.';
  } else {
    reason = 'Rated BACKGROUND: the match appears only in the description text.';
  }

  return `${matchedText} ${reason}`;
}
