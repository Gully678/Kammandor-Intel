import { describe, expect, it } from 'vitest';
import { SOURCES } from '@/config/sources';

describe('source registry licence metadata (PRD §13.2)', () => {
  it('every source declares a licence class and verbatim terms', () => {
    for (const s of SOURCES) {
      expect(['licensed', 'public-attribution', 'public-open', 'proprietary'],
        `licence.class missing/invalid for ${s.key}`).toContain(s.licence.class);
      expect(s.licence.terms.length, `licence.terms empty for ${s.key}`).toBeGreaterThan(0);
    }
  });
  it('still registers exactly the 10 v1 sources', () => {
    expect(SOURCES.map(s => s.key).sort()).toEqual([
      'companies-house','fred','gdelt','gleif','markets-fx',
      'reviews','sec-edgar','social','un-comtrade','world-bank',
    ]);
  });
});
