/**
 * KINTEL Mission B — External entity resolution: pure matcher unit tests
 * (GLEIF LEI enrichment + OFAC SDN name screening)
 *
 * GOVERNANCE ASSERTION: every function under test here is pure — no
 * network, no DB. The routes that consume them (resolve/gleif,
 * screen/ofac) own all I/O; these tests only prove the DETERMINISTIC
 * matching rule itself: exact equality after normaliseCanonicalName(),
 * never fuzzy scoring, with ambiguity as a first-class outcome rather
 * than a silent guess.
 */

import { describe, it, expect } from 'vitest';
import {
  pickUniqueGleifMatch,
  ofacNameMatches,
  splitSdnAliases,
  sdnRecordNames,
  sdnRecordId,
  extractGleifLei,
  extractGleifLegalName,
} from '../resolveExternal';

function gleifRecord(id: string, legalName: string, lei?: string): unknown {
  return {
    id,
    attributes: {
      lei: lei ?? id,
      entity: { legalName: { name: legalName } },
    },
  };
}

// ---------------------------------------------------------------------------
// pickUniqueGleifMatch
// ---------------------------------------------------------------------------

describe('pickUniqueGleifMatch', () => {
  it('matches exactly one record with an identical legal name', () => {
    const records = [gleifRecord('LEI001', 'Alpha Trading Ltd')];
    const outcome = pickUniqueGleifMatch('Alpha Trading Ltd', records);
    expect(outcome).toEqual({
      status: 'matched',
      match: { lei: 'LEI001', legalName: 'Alpha Trading Ltd' },
    });
  });

  it('matches case- and punctuation-insensitively (and across legal-suffix variants) via normaliseCanonicalName', () => {
    const records = [gleifRecord('LEI002', 'ALPHA, TRADING LIMITED.')];
    const outcome = pickUniqueGleifMatch('alpha trading ltd', records);
    expect(outcome).toEqual({
      status: 'matched',
      match: { lei: 'LEI002', legalName: 'ALPHA, TRADING LIMITED.' },
    });
  });

  it('returns "ambiguous" when two distinct records both match the normalised name', () => {
    const records = [
      gleifRecord('LEI003', 'Beta Holdings Ltd'),
      gleifRecord('LEI004', 'Beta Holdings Ltd'),
    ];
    const outcome = pickUniqueGleifMatch('Beta Holdings Ltd', records);
    expect(outcome).toEqual({ status: 'ambiguous' });
  });

  it('collapses duplicate records sharing the SAME lei to a single match (not a false ambiguity)', () => {
    const records = [
      gleifRecord('LEI005', 'Gamma Shipping Ltd', 'LEI005'),
      gleifRecord('LEI005', 'Gamma Shipping Ltd', 'LEI005'),
    ];
    const outcome = pickUniqueGleifMatch('Gamma Shipping Ltd', records);
    expect(outcome).toEqual({
      status: 'matched',
      match: { lei: 'LEI005', legalName: 'Gamma Shipping Ltd' },
    });
  });

  it('returns "no-match" when no candidate record has a matching normalised legal name', () => {
    const records = [gleifRecord('LEI006', 'Totally Different Co')];
    const outcome = pickUniqueGleifMatch('Alpha Trading Ltd', records);
    expect(outcome).toEqual({ status: 'no-match' });
  });

  it('returns "no-match" for an empty candidate list', () => {
    expect(pickUniqueGleifMatch('Alpha Trading Ltd', [])).toEqual({ status: 'no-match' });
  });

  it('returns "no-match" for a blank/empty entity name without inspecting records', () => {
    const records = [gleifRecord('LEI007', 'Alpha Trading Ltd')];
    expect(pickUniqueGleifMatch('', records)).toEqual({ status: 'no-match' });
    expect(pickUniqueGleifMatch('   ', records)).toEqual({ status: 'no-match' });
  });

  it('ignores malformed/incomplete GLEIF records rather than throwing', () => {
    const records = [
      { id: 'LEI008' }, // no attributes.entity.legalName.name
      { attributes: { entity: { legalName: { name: 'Alpha Trading Ltd' } } } }, // no id, no attributes.lei
      null,
      'not-an-object',
    ];
    expect(pickUniqueGleifMatch('Alpha Trading Ltd', records)).toEqual({ status: 'no-match' });
  });
});

describe('extractGleifLei / extractGleifLegalName', () => {
  it('prefers attributes.lei over the record id', () => {
    const record = { id: 'record-id', attributes: { lei: 'REAL-LEI', entity: { legalName: { name: 'X' } } } };
    expect(extractGleifLei(record)).toBe('REAL-LEI');
  });

  it('falls back to the record id when attributes.lei is absent', () => {
    const record = { id: 'FALLBACK-LEI' };
    expect(extractGleifLei(record)).toBe('FALLBACK-LEI');
  });

  it('returns null for non-object input', () => {
    expect(extractGleifLei(null)).toBeNull();
    expect(extractGleifLei(undefined)).toBeNull();
    expect(extractGleifLegalName('a string')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ofacNameMatches
// ---------------------------------------------------------------------------

describe('ofacNameMatches', () => {
  it('matches an exact name', () => {
    expect(ofacNameMatches('Acme Corp', ['Acme Corp'])).toBe(true);
  });

  it('matches case/punctuation-insensitively and across legal-suffix variants via normaliseCanonicalName', () => {
    expect(ofacNameMatches('acme corp.', ['ACME, CORP'])).toBe(true);
    expect(ofacNameMatches('Acme Trading Ltd', ['ACME TRADING LIMITED'])).toBe(true);
  });

  it('matches against any one of several candidate names (e.g. an alias)', () => {
    expect(ofacNameMatches('Acme Corp', ['Some Other Name', 'Acme Corp', 'Another Alias'])).toBe(true);
  });

  it('returns false when no candidate name matches', () => {
    expect(ofacNameMatches('Acme Corp', ['Totally Different Co'])).toBe(false);
  });

  it('returns false for an empty candidate list', () => {
    expect(ofacNameMatches('Acme Corp', [])).toBe(false);
  });

  it('returns false for a blank/empty entity name, even against an empty-string candidate', () => {
    expect(ofacNameMatches('', ['Acme Corp'])).toBe(false);
    expect(ofacNameMatches('', [''])).toBe(false);
    expect(ofacNameMatches('   ', ['Acme Corp'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// splitSdnAliases / sdnRecordNames / sdnRecordId
// ---------------------------------------------------------------------------

describe('splitSdnAliases', () => {
  it('splits a semicolon-separated aliases cell and trims whitespace', () => {
    expect(splitSdnAliases('Alias One; Alias Two ;Alias Three')).toEqual([
      'Alias One',
      'Alias Two',
      'Alias Three',
    ]);
  });

  it('returns an empty list for empty/undefined/null input', () => {
    expect(splitSdnAliases('')).toEqual([]);
    expect(splitSdnAliases(undefined)).toEqual([]);
    expect(splitSdnAliases(null)).toEqual([]);
  });

  it('drops empty segments produced by stray separators', () => {
    expect(splitSdnAliases('Alias One;;  ;Alias Two')).toEqual(['Alias One', 'Alias Two']);
  });
});

describe('sdnRecordNames', () => {
  it('combines the record name with its split aliases', () => {
    const record = { name: 'Primary Name', aliases: 'Alias One; Alias Two' };
    expect(sdnRecordNames(record)).toEqual(['Primary Name', 'Alias One', 'Alias Two']);
  });

  it('omits the name when absent but still returns aliases', () => {
    const record = { aliases: 'Alias One' };
    expect(sdnRecordNames(record)).toEqual(['Alias One']);
  });

  it('returns an empty list for a malformed/non-object record', () => {
    expect(sdnRecordNames(null)).toEqual([]);
    expect(sdnRecordNames('not-an-object')).toEqual([]);
    expect(sdnRecordNames({})).toEqual([]);
  });
});

describe('sdnRecordId', () => {
  it('prefers id over uid', () => {
    expect(sdnRecordId({ id: 'SDN-1', uid: 'UID-1' })).toBe('SDN-1');
  });

  it('falls back to uid when id is absent', () => {
    expect(sdnRecordId({ uid: 'UID-1' })).toBe('UID-1');
  });

  it('returns an empty string when neither is present', () => {
    expect(sdnRecordId({})).toBe('');
    expect(sdnRecordId(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// End-to-end sanity: an SDN record's own names feed straight into
// ofacNameMatches exactly as the /api/ontology/screen/ofac route uses them.
// ---------------------------------------------------------------------------

describe('sdnRecordNames + ofacNameMatches integration (pure, no network)', () => {
  it('matches an entity against an SDN record via its alias, not just its primary name', () => {
    const sdnRecord = { id: 'SDN-42', name: 'Official Sanctioned Name', aliases: 'Shell Trading Co' };
    const names = sdnRecordNames(sdnRecord);
    expect(ofacNameMatches('Shell Trading Co', names)).toBe(true);
    expect(ofacNameMatches('Unrelated Company', names)).toBe(false);
  });
});
