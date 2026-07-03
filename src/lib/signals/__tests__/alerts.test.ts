/**
 * KINTEL v2 — Signal/Impact engine: intelligence_alerts row mapping tests
 * (PRD v2.0 §9.5–9.6). Written FIRST (TDD) against src/lib/signals/alerts.ts.
 */

import { describe, it, expect } from 'vitest';
import { toAlertRows, dedupeKey } from '../alerts';
import type { MatchedSignal, SignalEvent } from '../types';

const TENANT = 'org-1234';

function signal(overrides: Partial<MatchedSignal> = {}): MatchedSignal {
  const event: SignalEvent = {
    title: 'Sukuk issuance in UAE expands',
    description: 'A detailed description of the issuance and its context.',
    url: 'https://news.example/sukuk-uae',
    occurredAt: '2026-07-03T00:00:00Z',
    sourceKey: 'test-feed',
  };
  return {
    event,
    matchedTerms: ['sukuk', 'UAE'],
    severity: 'CRITICAL',
    rationale: 'Matched keyword "sukuk" and geography "UAE".',
    ...overrides,
  };
}

describe('toAlertRows', () => {
  it('produces a correctly shaped intelligence_alerts row', () => {
    const rows = toAlertRows(TENANT, [signal()]);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.organization_id).toBe(TENANT);
    expect(row.headline).toBe('Sukuk issuance in UAE expands');
    expect(row.severity).toBe('CRITICAL');
    expect(row.source_url).toBe('https://news.example/sukuk-uae');
    expect(row.status).toBe('open');
    expect(row.detail).toContain('Matched keyword "sukuk" and geography "UAE".');
    expect(row.detail).toContain('A detailed description of the issuance');
    expect(row.detail).toContain('Source: test-feed');
  });

  it('passes each severity through unchanged', () => {
    for (const severity of ['CRITICAL', 'NOTABLE', 'BACKGROUND'] as const) {
      const rows = toAlertRows(TENANT, [signal({ severity })]);
      expect(rows[0]!.severity).toBe(severity);
    }
  });

  it('truncates headlines to at most 200 characters', () => {
    const longTitle = 'A'.repeat(500);
    const s = signal();
    const rows = toAlertRows(TENANT, [{ ...s, event: { ...s.event, title: longTitle } }]);
    expect(rows[0]!.headline.length).toBeLessThanOrEqual(200);
    expect(rows[0]!.headline.startsWith('AAAA')).toBe(true);
  });

  it('sets source_url to null when the event has no url', () => {
    const s = signal();
    const { url: _url, ...eventWithoutUrl } = s.event;
    const rows = toAlertRows(TENANT, [{ ...s, event: eventWithoutUrl }]);
    expect(rows[0]!.source_url).toBeNull();
  });

  it('omits the description excerpt cleanly when there is no description', () => {
    const s = signal();
    const { description: _d, ...eventNoDesc } = s.event;
    const rows = toAlertRows(TENANT, [{ ...s, event: eventNoDesc }]);
    expect(rows[0]!.detail).toContain('Source: test-feed');
    expect(rows[0]!.detail).toContain(s.rationale);
  });

  it('always sets status to open', () => {
    const rows = toAlertRows(TENANT, [signal({ severity: 'BACKGROUND' })]);
    expect(rows[0]!.status).toBe('open');
  });
});

describe('dedupeKey', () => {
  const base: SignalEvent = {
    title: 'Sukuk issuance in UAE expands',
    occurredAt: '2026-07-03T00:00:00Z',
    sourceKey: 'test-feed',
  };

  it('uses tenant + url when the event has a url', () => {
    expect(dedupeKey(TENANT, { ...base, url: 'https://news.example/a' })).toBe(
      `${TENANT}|https://news.example/a`,
    );
  });

  it('falls back to tenant + title when the event has no url', () => {
    expect(dedupeKey(TENANT, base)).toBe(`${TENANT}|Sukuk issuance in UAE expands`);
  });

  it('is deterministic', () => {
    expect(dedupeKey(TENANT, base)).toBe(dedupeKey(TENANT, base));
  });
});
