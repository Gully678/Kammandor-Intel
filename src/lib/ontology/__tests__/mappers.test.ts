/**
 * KINTEL Phase 2 — Ontology mapper unit tests
 * Tests the GLEIF, Companies House, and resolve/dedupe logic.
 */

import { describe, it, expect } from 'vitest';
import { mapGleifRecord }              from '../mappers/gleif';
import { mapCompaniesHouseResponse }   from '../mappers/companies-house';
import { mapGdeltEvent }               from '../mappers/gdelt';
import { mapUnComtradeFlow }           from '../mappers/un-comtrade';
import { mapMarketsInstrument }        from '../mappers/markets';
import { mapReview }                   from '../mappers/reviews';
import { mapSocialPost }               from '../mappers/social';
import { dedupeEntities }              from '../resolve';
import type { Entity, ObjectType, LinkType } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal GLEIF JSON:API data item */
const GLEIF_FIXTURE = {
  id: '5493001KJTIIGC8Y1R12',
  attributes: {
    lei: '5493001KJTIIGC8Y1R12',
    entity: {
      legalName: { name: 'Acme International Ltd' },
      status: 'ACTIVE',
      jurisdiction: 'GB',
      registeredAddress: { country: 'GB' },
    },
  },
  relationships: {},
};

/** GLEIF record with a parent LEI */
const GLEIF_WITH_PARENT_FIXTURE = {
  id: 'ABCDEF1234567890ABCD',
  attributes: {
    lei: 'ABCDEF1234567890ABCD',
    entity: {
      legalName: { name: 'Subsidiary Co Ltd' },
      status: 'ACTIVE',
      jurisdiction: 'DE',
    },
  },
  relationships: {
    'direct-parent': {
      data: { id: '5493001KJTIIGC8Y1R12' },
    },
  },
};

/** Companies House response with a PSC */
const CH_WITH_PSC_FIXTURE = {
  company: {
    company_number: '12345678',
    company_name:   'Example UK Ltd',
    company_status: 'active',
  },
  officers: [
    {
      name:         'Smith, John',
      officer_role: 'director',
      appointed_on: '2020-01-15',
    },
  ],
  psc: [
    {
      name:                  'Jane Doe',
      kind:                  'individual-person-with-significant-control',
      nationality:           'British',
      country_of_residence:  'England',
      natures_of_control:    ['ownership-of-shares-75-to-100-percent'],
    },
  ],
};

const TENANT_ID = 'test-tenant-uuid-0001';

// ---------------------------------------------------------------------------
// Test 1: GLEIF mapper — basic entity + registeredIn link
// ---------------------------------------------------------------------------

describe('mapGleifRecord', () => {
  it('maps a GLEIF record to a Company entity with the correct LEI', () => {
    const result = mapGleifRecord(GLEIF_FIXTURE, TENANT_ID);

    // Should produce at least one entity
    expect(result.entities.length).toBeGreaterThanOrEqual(1);

    // First entity should be the company
    const company = result.entities.find(e => e.type === 'company');
    expect(company).toBeDefined();
    expect(company!.lei).toBe('5493001KJTIIGC8Y1R12');
    expect(company!.type).toBe('company');
    expect(company!.tenant_id).toBe(TENANT_ID);
    expect(company!.canonical_name).toBe('Acme International Ltd');
  });

  it('creates a registeredIn link from Company to Jurisdiction', () => {
    const result = mapGleifRecord(GLEIF_FIXTURE, TENANT_ID);

    const registeredInLinks = result.links.filter(l => l.type === 'registeredIn');
    expect(registeredInLinks.length).toBeGreaterThanOrEqual(1);

    // Source should be the company, target should be the jurisdiction
    const company      = result.entities.find(e => e.type === 'company');
    const jurisdiction = result.entities.find(e => e.type === 'jurisdiction');
    expect(company).toBeDefined();
    expect(jurisdiction).toBeDefined();

    const link = registeredInLinks[0];
    expect(link.source_entity_id).toBe(company!.id);
    expect(link.target_entity_id).toBe(jurisdiction!.id);
  });

  it('creates a subsidiaryOf link when parentLei is present', () => {
    const result = mapGleifRecord(GLEIF_WITH_PARENT_FIXTURE, TENANT_ID);

    const subsidiaryLinks = result.links.filter(l => l.type === 'subsidiaryOf');
    expect(subsidiaryLinks.length).toBe(1);

    // There should be two company entities (child + parent)
    const companies = result.entities.filter(e => e.type === 'company');
    expect(companies.length).toBe(2);

    // One company should carry the parent LEI
    const parent = companies.find(c => c.lei === '5493001KJTIIGC8Y1R12');
    expect(parent).toBeDefined();
  });

  it('records provenance with source_key gleif', () => {
    const result = mapGleifRecord(GLEIF_FIXTURE, TENANT_ID);

    expect(result.provenance.length).toBeGreaterThanOrEqual(1);
    expect(result.provenance[0].source_key).toBe('gleif');
  });
});

// ---------------------------------------------------------------------------
// Test 2: Companies House PSC → beneficialOwnerOf link
// ---------------------------------------------------------------------------

describe('mapCompaniesHouseResponse', () => {
  it('creates a beneficialOwnerOf link for a PSC entry', () => {
    const result = mapCompaniesHouseResponse(CH_WITH_PSC_FIXTURE, TENANT_ID);

    const beneficialLinks = result.links.filter(l => l.type === 'beneficialOwnerOf');
    expect(beneficialLinks.length).toBe(1);

    const pscEntity = result.entities.find(
      e => e.type === 'person' && e.canonical_name === 'Jane Doe'
    );
    expect(pscEntity).toBeDefined();

    const companyEntity = result.entities.find(e => e.type === 'company');
    expect(companyEntity).toBeDefined();

    const link = beneficialLinks[0];
    expect(link.source_entity_id).toBe(pscEntity!.id);
    expect(link.target_entity_id).toBe(companyEntity!.id);
    expect(link.tenant_id).toBe(TENANT_ID);
  });

  it('creates an isDirectorOf link for an officer', () => {
    const result = mapCompaniesHouseResponse(CH_WITH_PSC_FIXTURE, TENANT_ID);

    const directorLinks = result.links.filter(l => l.type === 'isDirectorOf');
    expect(directorLinks.length).toBe(1);

    const director = result.entities.find(
      e => e.type === 'person' && e.canonical_name === 'Smith, John'
    );
    expect(director).toBeDefined();
  });

  it('sets the correct company_number on the company entity', () => {
    const result = mapCompaniesHouseResponse(CH_WITH_PSC_FIXTURE, TENANT_ID);

    const company = result.entities.find(e => e.type === 'company');
    expect(company!.company_number).toBe('12345678');
  });
});

// ---------------------------------------------------------------------------
// Test 3: dedupeEntities — two entities with same LEI merged to one
// ---------------------------------------------------------------------------

describe('dedupeEntities', () => {
  it('merges two entities sharing the same LEI into one', () => {
    const base: Omit<Entity, 'lei' | 'canonical_name' | 'properties'> = {
      id:         'id-a',
      tenant_id:  TENANT_ID,
      type:       'company',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const entityA: Entity = {
      ...base,
      id:             'id-a',
      lei:            '5493001KJTIIGC8Y1R12',
      canonical_name: 'Acme International Ltd',
      properties:     { source: 'gleif' },
    };

    const entityB: Entity = {
      ...base,
      id:             'id-b',
      lei:            '5493001KJTIIGC8Y1R12',
      canonical_name: 'Acme International Limited', // slightly different name
      properties:     { source: 'companies-house', extra: true },
    };

    const deduped = dedupeEntities([entityA, entityB]);

    // Should collapse to one entity
    expect(deduped.length).toBe(1);

    // Last-write wins on scalars — entityB's canonical_name should win
    expect(deduped[0].canonical_name).toBe('Acme International Limited');

    // Properties should be deep-merged
    expect(deduped[0].properties.source).toBe('companies-house');
    expect(deduped[0].properties.extra).toBe(true);
  });

  it('preserves unkeyed entities (no stable identifier)', () => {
    const unkeyed: Entity = {
      id:         'id-unkeyed',
      tenant_id:  TENANT_ID,
      type:       'event',
      properties: { title: 'Mystery Event' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const deduped = dedupeEntities([unkeyed]);
    expect(deduped.length).toBe(1);
    expect(deduped[0].id).toBe('id-unkeyed');
  });

  it('keeps distinct entities with different LEIs separate', () => {
    const makeEntity = (id: string, lei: string): Entity => ({
      id,
      tenant_id:  TENANT_ID,
      type:       'company',
      lei,
      properties: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const entities = [
      makeEntity('id-1', '5493001KJTIIGC8Y1R12'),
      makeEntity('id-2', 'ABCDEF1234567890ABCD'),
    ];

    const deduped = dedupeEntities(entities);
    expect(deduped.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Test 4: mapGdeltEvent — GDACS/GDELT geocoded event
// ---------------------------------------------------------------------------

const GDELT_FIXTURE = {
  id:   'gdacs-0',
  lat:  34.05,
  lng:  -118.25,
  name: 'M 6.1 earthquake near Los Angeles',
  url:  'https://www.gdacs.org/report.aspx?eventid=1',
  type: 'earthquake',
  tone: -33.3,
  date: 'Fri, 03 Jul 2026 05:00:00 GMT',
};

describe('mapGdeltEvent', () => {
  it('maps a GDACS event row to an Event entity', () => {
    const result = mapGdeltEvent(GDELT_FIXTURE, TENANT_ID);

    expect(result.entities.length).toBeGreaterThanOrEqual(1);

    const event = result.entities.find(e => e.type === 'event');
    expect(event).toBeDefined();
    expect(event!.tenant_id).toBe(TENANT_ID);
    expect(event!.canonical_name).toBe('M 6.1 earthquake near Los Angeles');
    expect(event!.properties.event_type).toBe('earthquake');
    expect(event!.properties.lat).toBe(34.05);
    expect(event!.properties.lng).toBe(-118.25);

    const validTypes: ObjectType[] = ['event'];
    expect(validTypes).toContain(event!.type);
  });

  it('records provenance with source_key gdelt', () => {
    const result = mapGdeltEvent(GDELT_FIXTURE, TENANT_ID);

    expect(result.provenance.length).toBeGreaterThanOrEqual(1);
    expect(result.provenance[0].source_key).toBe('gdelt');
    expect(result.provenance[0].source_url).toBe(GDELT_FIXTURE.url);
  });

  it('returns empty arrays for unusable/empty input', () => {
    const result = mapGdeltEvent({}, TENANT_ID);
    expect(result.entities).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.provenance).toEqual([]);
  });

  it('never throws on malformed input', () => {
    expect(() => mapGdeltEvent(null, TENANT_ID)).not.toThrow();
    expect(() => mapGdeltEvent('not-an-object', TENANT_ID)).not.toThrow();
    expect(() => mapGdeltEvent(undefined, TENANT_ID)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test 5: mapUnComtradeFlow — bilateral trade flow
// ---------------------------------------------------------------------------

const COMTRADE_FIXTURE = {
  reporterIso:  'USA',
  reporterName: 'United States of America',
  partnerIso:   'GBR',
  partnerName:  'United Kingdom',
  flow:         'X',
  flowDesc:     'Export',
  value:        12345678,
  period:       '2024',
};

const COMTRADE_WORLD_FIXTURE = {
  reporterIso:  'USA',
  reporterName: 'United States of America',
  partnerIso:   '0',
  partnerName:  'World',
  flow:         'M',
  flowDesc:     'Import',
  value:        98765432,
  period:       '2024',
};

describe('mapUnComtradeFlow', () => {
  it('maps a bilateral flow to reporter + partner Jurisdiction entities with a connectedJurisdiction link', () => {
    const result = mapUnComtradeFlow(COMTRADE_FIXTURE, TENANT_ID);

    expect(result.entities.length).toBeGreaterThanOrEqual(2);

    const jurisdictions = result.entities.filter(e => e.type === 'jurisdiction');
    expect(jurisdictions.length).toBe(2);

    const reporter = jurisdictions.find(j => j.jurisdiction_code === 'USA');
    const partner  = jurisdictions.find(j => j.jurisdiction_code === 'GBR');
    expect(reporter).toBeDefined();
    expect(partner).toBeDefined();

    const links = result.links.filter(l => l.type === 'connectedJurisdiction');
    expect(links.length).toBe(1);
    expect(links[0].source_entity_id).toBe(reporter!.id);
    expect(links[0].target_entity_id).toBe(partner!.id);
    expect(links[0].tenant_id).toBe(TENANT_ID);

    const validLinkTypes: LinkType[] = ['connectedJurisdiction'];
    expect(validLinkTypes).toContain(links[0].type);
  });

  it('records provenance with source_key un-comtrade', () => {
    const result = mapUnComtradeFlow(COMTRADE_FIXTURE, TENANT_ID);

    expect(result.provenance.length).toBeGreaterThanOrEqual(1);
    expect(result.provenance[0].source_key).toBe('un-comtrade');
  });

  it('skips the partner entity/link for the World aggregate partner code', () => {
    const result = mapUnComtradeFlow(COMTRADE_WORLD_FIXTURE, TENANT_ID);

    const jurisdictions = result.entities.filter(e => e.type === 'jurisdiction');
    expect(jurisdictions.length).toBe(1);
    expect(result.links.length).toBe(0);
  });

  it('returns empty arrays for unusable/empty input', () => {
    const result = mapUnComtradeFlow({}, TENANT_ID);
    expect(result.entities).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.provenance).toEqual([]);
  });

  it('never throws on malformed input', () => {
    expect(() => mapUnComtradeFlow(null, TENANT_ID)).not.toThrow();
    expect(() => mapUnComtradeFlow(42, TENANT_ID)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test 6: mapMarketsInstrument — quote and FX record shapes
// ---------------------------------------------------------------------------

const QUOTE_FIXTURE = {
  symbol:    'RTX',
  price:     118.42,
  changePct: 1.25,
  currency:  'USD',
  asOf:      '2026-07-03T05:00:00.000Z',
  source:    'twelvedata',
};

const FX_FIXTURE = {
  pair:   'USD/EUR',
  rate:   0.92,
  asOf:   '2026-07-03T05:00:00.000Z',
  source: 'ecb',
};

describe('mapMarketsInstrument', () => {
  it('maps a quote record to an Instrument entity', () => {
    const result = mapMarketsInstrument(QUOTE_FIXTURE, TENANT_ID);

    expect(result.entities.length).toBeGreaterThanOrEqual(1);

    const instrument = result.entities.find(e => e.type === 'instrument');
    expect(instrument).toBeDefined();
    expect(instrument!.canonical_name).toBe('RTX');
    expect(instrument!.properties.price).toBe(118.42);
    expect(instrument!.properties.currency).toBe('USD');
    expect(instrument!.tenant_id).toBe(TENANT_ID);

    const validTypes: ObjectType[] = ['instrument'];
    expect(validTypes).toContain(instrument!.type);
  });

  it('maps an FX pair record to an Instrument entity', () => {
    const result = mapMarketsInstrument(FX_FIXTURE, TENANT_ID);

    const instrument = result.entities.find(e => e.type === 'instrument');
    expect(instrument).toBeDefined();
    expect(instrument!.canonical_name).toBe('USD/EUR');
    expect(instrument!.properties.rate).toBe(0.92);
    expect(instrument!.properties.instrument_kind).toBe('fx');
  });

  it('records provenance with source_key markets-fx', () => {
    const result = mapMarketsInstrument(QUOTE_FIXTURE, TENANT_ID);

    expect(result.provenance.length).toBeGreaterThanOrEqual(1);
    expect(result.provenance[0].source_key).toBe('markets-fx');
  });

  it('returns empty arrays for unusable/empty input', () => {
    const result = mapMarketsInstrument({}, TENANT_ID);
    expect(result.entities).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.provenance).toEqual([]);
  });

  it('never throws on malformed input', () => {
    expect(() => mapMarketsInstrument(null, TENANT_ID)).not.toThrow();
    expect(() => mapMarketsInstrument([], TENANT_ID)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test 7: mapReview — review/sentiment record
// ---------------------------------------------------------------------------

const REVIEW_FIXTURE = {
  author:   'A. User',
  rating:   4,
  text:     'Solid app, occasional sync issues.',
  date:     '2026-06-30T12:00:00.000Z',
  platform: 'appstore',
  url:      'https://apps.apple.com/review/12345',
};

describe('mapReview', () => {
  it('maps a review record to an Event entity', () => {
    const result = mapReview(REVIEW_FIXTURE, TENANT_ID);

    expect(result.entities.length).toBeGreaterThanOrEqual(1);

    const event = result.entities.find(e => e.type === 'event');
    expect(event).toBeDefined();
    expect(event!.tenant_id).toBe(TENANT_ID);
    expect(event!.properties.author).toBe('A. User');
    expect(event!.properties.rating).toBe(4);
    expect(event!.properties.platform).toBe('appstore');

    const validTypes: ObjectType[] = ['event'];
    expect(validTypes).toContain(event!.type);
  });

  it('records provenance with source_key reviews', () => {
    const result = mapReview(REVIEW_FIXTURE, TENANT_ID);

    expect(result.provenance.length).toBeGreaterThanOrEqual(1);
    expect(result.provenance[0].source_key).toBe('reviews');
    expect(result.provenance[0].source_url).toBe(REVIEW_FIXTURE.url);
  });

  it('returns empty arrays for unusable/empty input', () => {
    const result = mapReview({}, TENANT_ID);
    expect(result.entities).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.provenance).toEqual([]);
  });

  it('never throws on malformed input', () => {
    expect(() => mapReview(null, TENANT_ID)).not.toThrow();
    expect(() => mapReview(123, TENANT_ID)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test 8: mapSocialPost — public company/post profiles only (GDPR guardrail)
// ---------------------------------------------------------------------------

const SOCIAL_COMPANY_FIXTURE = {
  name:      'Acme International Ltd',
  type:      'company',
  url:       'https://www.linkedin.com/company/acme-international',
  headline:  'Global trading & logistics',
  employees: 500,
  followers: 12000,
  raw:       {},
};

const SOCIAL_POST_FIXTURE = {
  name:      'Acme launches new facility',
  type:      'post',
  url:       'https://www.linkedin.com/posts/acme_launch-activity-1234',
  headline:  'Acme launches new facility in Rotterdam',
  followers: 340,
  raw:       {},
};

const SOCIAL_PERSON_FIXTURE = {
  name:     'Jane Doe',
  type:     'person',
  url:      'https://www.linkedin.com/in/janedoe',
  headline: 'CFO at Acme',
  location: 'London, UK',
  raw:      {},
};

const SOCIAL_JOB_FIXTURE = {
  name: 'Senior Trader',
  type: 'job',
  url:  'https://www.linkedin.com/jobs/view/12345',
  raw:  {},
};

describe('mapSocialPost', () => {
  it('maps a company profile to a company entity', () => {
    const result = mapSocialPost(SOCIAL_COMPANY_FIXTURE, TENANT_ID);

    expect(result.entities.length).toBeGreaterThanOrEqual(1);

    const company = result.entities.find(e => e.type === 'company');
    expect(company).toBeDefined();
    expect(company!.tenant_id).toBe(TENANT_ID);
    expect(company!.canonical_name).toBe('Acme International Ltd');
    expect(company!.properties.social_profile_type).toBe('company');

    const validTypes: ObjectType[] = ['company'];
    expect(validTypes).toContain(company!.type);
  });

  it('maps a post profile to an event entity', () => {
    const result = mapSocialPost(SOCIAL_POST_FIXTURE, TENANT_ID);

    expect(result.entities.length).toBeGreaterThanOrEqual(1);

    const post = result.entities.find(e => e.type === 'event');
    expect(post).toBeDefined();
    expect(post!.properties.social_profile_type).toBe('post');

    const validTypes: ObjectType[] = ['event'];
    expect(validTypes).toContain(post!.type);
  });

  it('records provenance with source_key social for mapped profile kinds', () => {
    const result = mapSocialPost(SOCIAL_COMPANY_FIXTURE, TENANT_ID);

    expect(result.provenance.length).toBeGreaterThanOrEqual(1);
    expect(result.provenance[0].source_key).toBe('social');
  });

  it('NEVER maps a person profile (GDPR guardrail — personal data excluded)', () => {
    const result = mapSocialPost(SOCIAL_PERSON_FIXTURE, TENANT_ID);

    expect(result.entities).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.provenance).toEqual([]);
  });

  it('NEVER maps a job profile (personal-data-adjacent, excluded)', () => {
    const result = mapSocialPost(SOCIAL_JOB_FIXTURE, TENANT_ID);

    expect(result.entities).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.provenance).toEqual([]);
  });

  it('returns empty arrays for unusable/empty input', () => {
    const result = mapSocialPost({}, TENANT_ID);
    expect(result.entities).toEqual([]);
    expect(result.links).toEqual([]);
    expect(result.provenance).toEqual([]);
  });

  it('never throws on malformed input', () => {
    expect(() => mapSocialPost(null, TENANT_ID)).not.toThrow();
    expect(() => mapSocialPost('bad', TENANT_ID)).not.toThrow();
  });
});
