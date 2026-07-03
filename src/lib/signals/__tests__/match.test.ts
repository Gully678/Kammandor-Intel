/**
 * KINTEL v2 — Signal/Impact engine: deterministic watchlist matching tests
 * (PRD v2.0 §9.5–9.6). Written FIRST (TDD) against src/lib/signals/match.ts.
 *
 * Severity contract under test (deterministic — no LLM ever sets these):
 *   CRITICAL   — ≥2 distinct watchlist categories match, OR a watched
 *                entity matches AND event.magnitude !== undefined && ≥ 0.8
 *   NOTABLE    — exactly one category matches with ≥1 term, and at least
 *                one match is "strong" (in the title or in the event's
 *                structured entities/geos/tickers tags)
 *   BACKGROUND — exactly one category matches and EVERY match is weak
 *                (found only in the description text)
 */

import { describe, it, expect } from 'vitest';
import { matchSignals } from '../match';
import type { SignalEvent } from '../types';

function event(overrides: Partial<SignalEvent> = {}): SignalEvent {
  return {
    title: 'Quiet day across regional markets',
    occurredAt: '2026-07-03T00:00:00Z',
    sourceKey: 'test-feed',
    ...overrides,
  };
}

describe('matchSignals — matching mechanics', () => {
  it('returns an empty array when no watchlist term matches', () => {
    const out = matchSignals([event()], { keywords: ['sukuk'], geos: ['UAE'] });
    expect(out).toEqual([]);
  });

  it('returns an empty array for an empty watchlist', () => {
    const out = matchSignals([event({ title: 'Sukuk issuance in UAE' })], {});
    expect(out).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const out = matchSignals(
      [event({ title: 'SUKUK issuance announced' })],
      { keywords: ['sukuk'] },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.matchedTerms).toContain('sukuk');
  });

  it('matches whole words only — "art" must NOT match "party"', () => {
    const out = matchSignals(
      [event({ title: 'Big party planned downtown' })],
      { keywords: ['art'] },
    );
    expect(out).toEqual([]);
  });

  it('matches whole words positively — "art" matches "Art exhibition opens"', () => {
    const out = matchSignals(
      [event({ title: 'Art exhibition opens' })],
      { keywords: ['art'] },
    );
    expect(out).toHaveLength(1);
  });

  it('matches terms inside the structured entity/geo/ticker tags', () => {
    const out = matchSignals(
      [event({ tickers: ['GOLD', 'SILV'] })],
      { tickers: ['gold'] },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.matchedTerms).toContain('gold');
  });

  it('deduplicates matchedTerms when a term appears in several places', () => {
    const out = matchSignals(
      [event({ title: 'Sukuk update', description: 'More on the sukuk deal.' })],
      { keywords: ['sukuk'] },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.matchedTerms.filter((t) => t === 'sukuk')).toHaveLength(1);
  });

  it('is deterministic — identical input yields identical output', () => {
    const events = [event({ title: 'Sukuk issuance in UAE', magnitude: 0.9 })];
    const watchlist = { keywords: ['sukuk'], geos: ['UAE'] };
    expect(matchSignals(events, watchlist)).toEqual(matchSignals(events, watchlist));
  });
});

describe('matchSignals — severity rules', () => {
  it('CRITICAL when two distinct watchlist categories match', () => {
    const out = matchSignals(
      [event({ title: 'Sukuk issuance in UAE expands' })],
      { keywords: ['sukuk'], geos: ['UAE'] },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('CRITICAL');
  });

  it('CRITICAL when a watched entity matches and magnitude >= 0.8', () => {
    const out = matchSignals(
      [event({ title: 'Lotus announces restructuring', magnitude: 0.8 })],
      { entities: ['Lotus'] },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('CRITICAL');
  });

  it('NOTABLE (not CRITICAL) for an entity match with magnitude just below 0.8', () => {
    const out = matchSignals(
      [event({ title: 'Lotus announces restructuring', magnitude: 0.79 })],
      { entities: ['Lotus'] },
    );
    expect(out[0]!.severity).toBe('NOTABLE');
  });

  it('NOTABLE (not CRITICAL) for an entity match with no magnitude at all', () => {
    const out = matchSignals(
      [event({ title: 'Lotus announces restructuring' })],
      { entities: ['Lotus'] },
    );
    expect(out[0]!.severity).toBe('NOTABLE');
  });

  it('NOTABLE when exactly one category matches in the title', () => {
    const out = matchSignals(
      [event({ title: 'New sukuk fund launched' })],
      { keywords: ['sukuk'] },
    );
    expect(out[0]!.severity).toBe('NOTABLE');
  });

  it('NOTABLE when exactly one category matches via structured tags', () => {
    const out = matchSignals(
      [event({ geos: ['UAE'] })],
      { geos: ['UAE'] },
    );
    expect(out[0]!.severity).toBe('NOTABLE');
  });

  it('BACKGROUND when the only match is a keyword in the description', () => {
    const out = matchSignals(
      [
        event({
          title: 'Regional finance roundup',
          description: 'Includes a short note on sukuk pricing trends.',
        }),
      ],
      { keywords: ['sukuk'] },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('BACKGROUND');
  });

  it('a high magnitude alone does NOT make a keyword-only match CRITICAL', () => {
    const out = matchSignals(
      [event({ title: 'New sukuk fund launched', magnitude: 0.99 })],
      { keywords: ['sukuk'] },
    );
    expect(out[0]!.severity).toBe('NOTABLE');
  });
});

describe('matchSignals — rationale', () => {
  it('is plain language naming the matched term and category', () => {
    const out = matchSignals(
      [event({ title: 'Sukuk issuance in UAE expands' })],
      { keywords: ['sukuk'], geos: ['UAE'] },
    );
    const rationale = out[0]!.rationale;
    expect(rationale).toContain('sukuk');
    expect(rationale).toContain('UAE');
    expect(rationale.toLowerCase()).toContain('keyword');
    expect(rationale.toLowerCase()).toContain('geograph');
  });
});
