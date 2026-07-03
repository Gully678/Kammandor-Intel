/**
 * KINTEL v2 — gold suite: deterministic watchlist matching (PRD v2.0 §9.7)
 *
 * Capability under test: matchSignals (src/lib/signals/match.ts).
 * Every case is hand-authored from the severity contract documented in that
 * file's rules banner — CRITICAL / NOTABLE / BACKGROUND / omission — with a
 * single event per case so the expected outcome is unambiguous.
 *
 * Deterministic by construction: no network, no time, no randomness.
 * Bar is 1.0 — the gold cases define the contract, so any regression on any
 * case must fail the gate (the runner's 0.8 floor is the absolute minimum,
 * not the target).
 */

import { matchSignals } from '@/lib/signals/match';
import type { SignalEvent, SignalSeverity, SignalWatchlist } from '@/lib/signals/types';
import type { GoldSuite } from '../types';

/** One event scanned against one watchlist. */
export interface SignalsMatchInput {
  event: SignalEvent;
  watchlist: SignalWatchlist;
}

/**
 * Unambiguous projection of matchSignals' output for a single event:
 * either the event is omitted, or it matched with a severity and a sorted
 * list of the watchlist terms (as written in the watchlist) that hit.
 */
export type SignalsMatchOutcome =
  | { matched: false }
  | { matched: true; severity: SignalSeverity; terms: string[] };

function baseEvent(overrides: Partial<SignalEvent> & { title: string }): SignalEvent {
  return {
    occurredAt: '2026-07-01T09:00:00.000Z',
    sourceKey: 'gold-suite',
    ...overrides,
  };
}

function outcomesEqual(a: SignalsMatchOutcome, b: SignalsMatchOutcome): boolean {
  if (!a.matched || !b.matched) return a.matched === b.matched;
  return (
    a.severity === b.severity &&
    a.terms.length === b.terms.length &&
    a.terms.every((term, i) => term === b.terms[i])
  );
}

export const signalsMatchSuite: GoldSuite<SignalsMatchInput, SignalsMatchOutcome> = {
  suite: 'signals-match',
  capability: 'matchSignals',
  bar: 1,
  run: (input) => {
    const matched = matchSignals([input.event], input.watchlist);
    const signal = matched[0];
    if (!signal) return { matched: false };
    return {
      matched: true,
      severity: signal.severity,
      terms: [...signal.matchedTerms].sort(),
    };
  },
  score: outcomesEqual,
  cases: [
    {
      id: 'critical-two-categories',
      note: 'Matches spanning >=2 distinct watchlist categories (keyword + geography) rate CRITICAL',
      input: {
        event: baseEvent({
          title: 'New sanctions package announced against grain exporters',
          geos: ['Bulgaria'],
        }),
        watchlist: { keywords: ['sanctions'], geos: ['Bulgaria'] },
      },
      expected: { matched: true, severity: 'CRITICAL', terms: ['Bulgaria', 'sanctions'] },
    },
    {
      id: 'critical-entity-magnitude-at-threshold',
      note: 'A watched ENTITY match with event.magnitude >= 0.8 rates CRITICAL even with one category',
      input: {
        event: baseEvent({
          title: 'Acme Corp refinery fire halts production',
          magnitude: 0.8,
        }),
        watchlist: { entities: ['Acme Corp'] },
      },
      expected: { matched: true, severity: 'CRITICAL', terms: ['Acme Corp'] },
    },
    {
      id: 'entity-magnitude-below-threshold-stays-notable',
      note: 'The magnitude escalation is a hard >= 0.8 boundary: 0.79 does NOT escalate',
      input: {
        event: baseEvent({
          title: 'Acme Corp reports minor outage',
          magnitude: 0.79,
        }),
        watchlist: { entities: ['Acme Corp'] },
      },
      expected: { matched: true, severity: 'NOTABLE', terms: ['Acme Corp'] },
    },
    {
      id: 'notable-single-strong-title-match',
      note: 'Exactly one category with a strong (headline) match rates NOTABLE',
      input: {
        event: baseEvent({ title: 'Copper prices surge on supply fears' }),
        watchlist: { keywords: ['copper'] },
      },
      expected: { matched: true, severity: 'NOTABLE', terms: ['copper'] },
    },
    {
      id: 'background-description-only',
      note: 'One category where EVERY match is description-only (weak) rates BACKGROUND',
      input: {
        event: baseEvent({
          title: 'Weekly mining sector update',
          description: 'Producers flagged softer lithium demand into the third quarter.',
        }),
        watchlist: { keywords: ['lithium'] },
      },
      expected: { matched: true, severity: 'BACKGROUND', terms: ['lithium'] },
    },
    {
      id: 'no-match-event-omitted',
      note: 'An event matching no watchlist term is omitted from the result entirely',
      input: {
        event: baseEvent({
          title: 'Copper output steady in Chile',
          description: 'No disruption reported at major mines.',
        }),
        watchlist: { keywords: ['uranium'] },
      },
      expected: { matched: false },
    },
    {
      id: 'whole-word-negative-no-substring-hit',
      note: '"art" must never match inside "party" — whole-word matching only',
      input: {
        event: baseEvent({
          title: 'Reception party held in Sofia',
          description: 'The party drew a large crowd of delegates.',
        }),
        watchlist: { keywords: ['art'] },
      },
      expected: { matched: false },
    },
    {
      id: 'case-insensitive-term-match',
      note: 'Terms match case-insensitively; matchedTerms echo the watchlist spelling',
      input: {
        event: baseEvent({ title: 'opec+ ministers meet in vienna' }),
        watchlist: { keywords: ['OPEC'] },
      },
      expected: { matched: true, severity: 'NOTABLE', terms: ['OPEC'] },
    },
    {
      id: 'ticker-with-punctuation-matches-whole-token',
      note: 'Tickers containing symbols (BRK.B) still match whole tokens in the headline',
      input: {
        event: baseEvent({ title: 'BRK.B gains 3% after results' }),
        watchlist: { tickers: ['BRK.B'] },
      },
      expected: { matched: true, severity: 'NOTABLE', terms: ['BRK.B'] },
    },
  ],
};
