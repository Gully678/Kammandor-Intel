/**
 * KINTEL Phase 2 — Ontology mapper unit tests
 * Tests the GLEIF, Companies House, and resolve/dedupe logic.
 */

import { describe, it, expect } from 'vitest';
import { mapGleifRecord }              from '../mappers/gleif';
import { mapCompaniesHouseResponse }   from '../mappers/companies-house';
import { dedupeEntities }              from '../resolve';
import type { Entity }                 from '../types';

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
