/**
 * KINTEL — Intelligence Dashboard logic tests (PRD §12)
 *
 * Pure-logic coverage for the /dashboard surface: severity chips,
 * plain-language proposal kinds (incl. merge detection), relative time,
 * KPI aggregation and agent-key prettifying. UI is exercised manually /
 * via tsc; vitest here runs in the repo's node environment.
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateAlertSeverities,
  countRunsSince,
  parseTotalFromContentRange,
  prettifyAgentKey,
  proposalKindLabel,
  relativeTime,
  severityChip,
  evaluationVerdict,
} from '../lib';

describe('severityChip', () => {
  it('maps CRITICAL to a red chip with a plain label', () => {
    const chip = severityChip('CRITICAL');
    expect(chip.label).toBe('Critical');
    expect(chip.className).toContain('red');
  });

  it('maps NOTABLE to amber and BACKGROUND to grey', () => {
    expect(severityChip('NOTABLE').label).toBe('Notable');
    expect(severityChip('NOTABLE').className).toContain('amber');
    expect(severityChip('BACKGROUND').label).toBe('Background');
    expect(severityChip('BACKGROUND').className).toContain('gray');
  });

  it('treats unknown or missing severities as Background (never crashes)', () => {
    expect(severityChip('weird-value').label).toBe('Background');
    expect(severityChip(null).label).toBe('Background');
  });
});

describe('proposalKindLabel', () => {
  it('describes a create_entity proposal in plain language, using the record type when present', () => {
    expect(
      proposalKindLabel('create_entity', { entity: { type: 'company' } }),
    ).toBe('New company record');
    expect(proposalKindLabel('create_entity', {})).toBe('New record');
  });

  it('describes link proposals as connections', () => {
    expect(proposalKindLabel('create_link', {})).toBe('New connection');
    expect(proposalKindLabel('update_link', {})).toBe('Updated connection');
  });

  it('detects a possible duplicate when payload.patch.properties.merged_into exists', () => {
    const payload = {
      id: 'ent-2',
      patch: { properties: { merged_into: 'ent-1', merge_confidence: 0.9 } },
    };
    expect(proposalKindLabel('update_entity', payload)).toBe('Possible duplicate');
    // A plain update without merged_into stays an update.
    expect(
      proposalKindLabel('update_entity', { id: 'ent-2', patch: { properties: {} } }),
    ).toBe('Updated record');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-07-03T12:00:00Z');

  it('renders minutes, hours and days ago', () => {
    expect(relativeTime('2026-07-03T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-07-03T11:45:00Z', now)).toBe('15m ago');
    expect(relativeTime('2026-07-03T09:00:00Z', now)).toBe('3h ago');
    expect(relativeTime('2026-06-30T12:00:00Z', now)).toBe('3d ago');
  });

  it('never crashes on bad input', () => {
    expect(relativeTime('not-a-date', now)).toBe('');
    expect(relativeTime(null, now)).toBe('');
  });
});

describe('aggregateAlertSeverities', () => {
  it('counts open alerts by severity from fixture rows', () => {
    const rows = [
      { severity: 'CRITICAL' },
      { severity: 'CRITICAL' },
      { severity: 'NOTABLE' },
      { severity: 'BACKGROUND' },
      { severity: 'something-else' },
      { severity: null },
    ];
    const agg = aggregateAlertSeverities(rows);
    expect(agg).toEqual({ total: 6, critical: 2, notable: 1, background: 3 });
  });

  it('returns zeros for an empty feed (empty-state input)', () => {
    expect(aggregateAlertSeverities([])).toEqual({
      total: 0,
      critical: 0,
      notable: 0,
      background: 0,
    });
  });
});

describe('countRunsSince', () => {
  const now = new Date('2026-07-03T12:00:00Z');

  it('counts only runs started within the window', () => {
    const runs = [
      { started_at: '2026-07-03T11:00:00Z' },  // 1h ago — in
      { started_at: '2026-07-02T13:00:00Z' },  // 23h ago — in
      { started_at: '2026-07-02T11:00:00Z' },  // 25h ago — out
      { started_at: 'garbage' },               // ignored
    ];
    expect(countRunsSince(runs, 24, now)).toBe(2);
  });
});

describe('parseTotalFromContentRange', () => {
  it('reads the exact total from a PostgREST Content-Range header', () => {
    expect(parseTotalFromContentRange('0-9/57')).toBe(57);
    expect(parseTotalFromContentRange('*/0')).toBe(0);
  });

  it('returns null when the header is missing or malformed', () => {
    expect(parseTotalFromContentRange(null)).toBeNull();
    expect(parseTotalFromContentRange('0-9/*')).toBeNull();
  });
});

describe('prettifyAgentKey', () => {
  it('prettifies known agent keys and title-cases unknown ones', () => {
    expect(prettifyAgentKey('watcher')).toBe('Watcher');
    expect(prettifyAgentKey('resolver')).toBe('Resolver');
    expect(prettifyAgentKey('analyst')).toBe('Analyst');
    expect(prettifyAgentKey('gdelt_sweeper')).toBe('Gdelt Sweeper');
  });
});

describe('evaluationVerdict', () => {
  it('maps a recorded evaluation to a plain verdict chip, and null when absent', () => {
    expect(evaluationVerdict({ passed: true, score: 0.92, checks: [] })).toEqual({
      label: 'Checks passed',
      passed: true,
    });
    expect(evaluationVerdict({ passed: false, score: 0.4, checks: [] })).toEqual({
      label: 'Needs attention',
      passed: false,
    });
    expect(evaluationVerdict(undefined)).toBeNull();
    expect(evaluationVerdict({ nope: 1 })).toBeNull();
  });
});
