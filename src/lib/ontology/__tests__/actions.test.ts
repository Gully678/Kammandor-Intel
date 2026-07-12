/**
 * Mission C — action registry v1 draft: deterministic abstention router tests
 *
 * Exhaustive over the routeAction() matrix (all 3 risk tiers × representative
 * confidence bands + boundary values), plus initialStatusFor() mapping and
 * fail-closed behaviour for invalid confidence inputs.
 */

import { describe, it, expect } from 'vitest';
import { routeAction, initialStatusFor } from '../actions';
import type { ActionStatus, RiskTier } from '../actions';

describe('routeAction — risk_tier "ask_human"', () => {
  it('is always ask_human regardless of confidence', () => {
    expect(routeAction('ask_human', 1)).toBe('ask_human');
    expect(routeAction('ask_human', 0.95)).toBe('ask_human');
    expect(routeAction('ask_human', 0.5)).toBe('ask_human');
    expect(routeAction('ask_human', 0)).toBe('ask_human');
  });

  it('is ask_human even with invalid confidence (fail-closed, not that it matters for this tier)', () => {
    expect(routeAction('ask_human', NaN)).toBe('ask_human');
    expect(routeAction('ask_human', -1)).toBe('ask_human');
    expect(routeAction('ask_human', 2)).toBe('ask_human');
  });
});

describe('routeAction — risk_tier "draft"', () => {
  it('routes to draft when confidence >= 0.9', () => {
    expect(routeAction('draft', 1)).toBe('draft');
    expect(routeAction('draft', 0.95)).toBe('draft');
    expect(routeAction('draft', 0.9)).toBe('draft'); // boundary: inclusive
  });

  it('routes to ask_human when confidence < 0.9', () => {
    expect(routeAction('draft', 0.899999)).toBe('ask_human');
    expect(routeAction('draft', 0.6)).toBe('ask_human');
    expect(routeAction('draft', 0)).toBe('ask_human');
  });
});

describe('routeAction — risk_tier "act"', () => {
  it('routes to act when confidence >= 0.9', () => {
    expect(routeAction('act', 1)).toBe('act');
    expect(routeAction('act', 0.95)).toBe('act');
    expect(routeAction('act', 0.9)).toBe('act'); // boundary: inclusive
  });

  it('routes to draft when 0.6 <= confidence < 0.9', () => {
    expect(routeAction('act', 0.899999)).toBe('draft');
    expect(routeAction('act', 0.75)).toBe('draft');
    expect(routeAction('act', 0.6)).toBe('draft'); // boundary: inclusive
  });

  it('routes to ask_human when confidence < 0.6', () => {
    expect(routeAction('act', 0.599999)).toBe('ask_human');
    expect(routeAction('act', 0.3)).toBe('ask_human');
    expect(routeAction('act', 0)).toBe('ask_human');
  });
});

describe('routeAction — fail-closed on invalid confidence', () => {
  const tiers: RiskTier[] = ['act', 'draft', 'ask_human'];
  const invalidValues = [NaN, -1, 2, -0.0001, 1.0001, Infinity, -Infinity];

  for (const tier of tiers) {
    for (const value of invalidValues) {
      it(`routes ${tier} tier with confidence=${value} to ask_human`, () => {
        expect(routeAction(tier, value)).toBe('ask_human');
      });
    }
  }

  it('treats exact boundary values 0 and 1 as VALID (in-range), not fail-closed', () => {
    // 0 and 1 are valid confidences — only outside [0,1] (or NaN) fails closed.
    expect(routeAction('act', 0)).toBe('ask_human'); // valid but low confidence
    expect(routeAction('act', 1)).toBe('act'); // valid and high confidence
  });
});

describe('initialStatusFor', () => {
  const cases: Array<[RiskTier, ActionStatus]> = [
    ['act', 'queued'],
    ['draft', 'awaiting_approval'],
    ['ask_human', 'awaiting_approval'],
  ];

  for (const [route, expected] of cases) {
    it(`maps route "${route}" to status "${expected}"`, () => {
      expect(initialStatusFor(route)).toBe(expected);
    });
  }

  it('never returns "approved" — rows are only ever queued or awaiting_approval on insert', () => {
    for (const route of ['act', 'draft', 'ask_human'] as RiskTier[]) {
      expect(initialStatusFor(route)).not.toBe('approved');
    }
  });
});
