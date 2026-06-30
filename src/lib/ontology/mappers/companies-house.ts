/**
 * KINTEL Phase 2 — Companies House (UK) mapper
 * Transforms a Companies House API response into ontology objects.
 *
 * Source key: 'companies-house'
 * API: https://api.company-information.service.gov.uk
 *
 * Handles:
 *   - Company profile → company entity
 *   - Officers array → person entities + isDirectorOf links
 *   - PSC (Persons with Significant Control) → person entities + beneficialOwnerOf links
 */

import type { Entity, Link, Provenance } from '../types';
import type { MapperResult } from './gleif';

// Re-export MapperResult so consumers can import from a single mapper file
export type { MapperResult };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function makeEntityBase(tenantId: string): Pick<Entity, 'tenant_id' | 'properties' | 'created_at' | 'updated_at'> {
  return { tenant_id: tenantId, properties: {}, created_at: now(), updated_at: now() };
}

function makeLinkBase(tenantId: string): Pick<Link, 'tenant_id' | 'properties' | 'created_at'> {
  return { tenant_id: tenantId, properties: {}, created_at: now() };
}

function pseudoUuid(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(h).toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-000000000000`;
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

/**
 * Map a Companies House API response to ontology objects.
 *
 * Expected input shape (from /api/companies-house route, view=officers|psc):
 * {
 *   company: { company_number, company_name, company_status, registered_office_address: { country } },
 *   officers?: [{ name, officer_role, appointed_on, resigned_on }],
 *   psc?:      [{ name, kind, ceased_on, natures_of_control, nationality, country_of_residence }]
 * }
 */
export function mapCompaniesHouseResponse(input: unknown, tenantId: string): MapperResult {
  const resp = (input as Record<string, unknown>) ?? {};
  const company = (resp.company ?? {}) as Record<string, unknown>;
  const officers = Array.isArray(resp.officers) ? (resp.officers as unknown[]) : [];
  const pscs     = Array.isArray(resp.psc)      ? (resp.psc      as unknown[]) : [];

  const entities:   Entity[]     = [];
  const links:      Link[]       = [];
  const provenance: Provenance[] = [];

  // --- Company entity
  const companyNumber: string = typeof company.company_number === 'string' ? company.company_number : '';
  const companyName:   string = typeof company.company_name   === 'string' ? company.company_name   : '';
  const companyStatus: string = typeof company.company_status === 'string' ? company.company_status : '';

  const companyId = pseudoUuid(`ch:company:${companyNumber || companyName}`);
  const companyEntity: Entity = {
    ...makeEntityBase(tenantId),
    id:             companyId,
    type:           'company',
    canonical_name: companyName || undefined,
    company_number: companyNumber || undefined,
    properties: {
      status: companyStatus,
      source: 'companies-house',
    },
  };
  entities.push(companyEntity);

  // --- Officers → person entities + isDirectorOf links
  for (const officer of officers) {
    const o = (officer as Record<string, unknown>);
    const name:        string = typeof o.name        === 'string' ? o.name        : '';
    const role:        string = typeof o.officer_role === 'string' ? o.officer_role : '';
    const appointedOn: string = typeof o.appointed_on === 'string' ? o.appointed_on : '';
    const resignedOn:  string | undefined = typeof o.resigned_on === 'string' ? o.resigned_on : undefined;

    if (!name) continue;

    const personId = pseudoUuid(`ch:person:${name}:${companyNumber}`);
    const personEntity: Entity = {
      ...makeEntityBase(tenantId),
      id:             personId,
      type:           'person',
      canonical_name: name,
      properties: {
        source:       'companies-house',
        officer_role: role,
      },
    };
    entities.push(personEntity);

    links.push({
      ...makeLinkBase(tenantId),
      id:               pseudoUuid(`ch:link:isDirectorOf:${personId}:${companyId}`),
      source_entity_id: personId,
      target_entity_id: companyId,
      type:             'isDirectorOf',
      properties: {
        officer_role: role,
        appointed_on: appointedOn,
        ...(resignedOn ? { resigned_on: resignedOn } : {}),
      },
    });
  }

  // --- PSC → person entities + beneficialOwnerOf links
  for (const psc of pscs) {
    const p = (psc as Record<string, unknown>);
    const name:               string = typeof p.name               === 'string' ? p.name               : '';
    const kind:               string = typeof p.kind               === 'string' ? p.kind               : '';
    const nationality:        string = typeof p.nationality        === 'string' ? p.nationality        : '';
    const countryOfResidence: string = typeof p.country_of_residence === 'string' ? p.country_of_residence : '';
    const ceasedOn:  string | undefined = typeof p.ceased_on === 'string' ? p.ceased_on : undefined;
    const natures:   string[] = Array.isArray(p.natures_of_control)
      ? (p.natures_of_control as unknown[]).filter((n): n is string => typeof n === 'string')
      : [];

    if (!name) continue;

    const pscId = pseudoUuid(`ch:psc:${name}:${companyNumber}`);
    const pscEntity: Entity = {
      ...makeEntityBase(tenantId),
      id:             pscId,
      type:           'person',
      canonical_name: name,
      properties: {
        source:              'companies-house',
        psc_kind:            kind,
        nationality,
        country_of_residence: countryOfResidence,
        natures_of_control:  natures,
      },
    };
    entities.push(pscEntity);

    links.push({
      ...makeLinkBase(tenantId),
      id:               pseudoUuid(`ch:link:beneficialOwnerOf:${pscId}:${companyId}`),
      source_entity_id: pscId,
      target_entity_id: companyId,
      type:             'beneficialOwnerOf',
      properties: {
        natures_of_control: natures,
        ...(ceasedOn ? { ceased_on: ceasedOn } : {}),
      },
    });
  }

  // --- Provenance
  provenance.push({
    id:         pseudoUuid(`ch:prov:${companyNumber || companyName}`),
    entity_id:  companyId,
    source_key: 'companies-house',
    source_url: companyNumber
      ? `https://api.company-information.service.gov.uk/company/${companyNumber}`
      : undefined,
    fetched_at: now(),
    confidence: 0.9,
    raw:        input,
  });

  return { entities, links, provenance };
}
