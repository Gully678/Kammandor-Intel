/**
 * KINTEL Phase 2 — World Bank country data mapper
 * Transforms a World Bank country/indicator row into an ontology Jurisdiction entity.
 *
 * Source key: 'world-bank'
 * API: https://api.worldbank.org/v2/country
 *
 * Input shape (single item from World Bank country array):
 * { id, iso2Code, name, capitalCity, region: { id, value }, incomeLevel: { id, value }, ... }
 */

import type { Entity, Provenance } from '../types';
import type { MapperResult } from './gleif';

export type { MapperResult };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function makeEntityBase(tenantId: string): Pick<Entity, 'tenant_id' | 'properties' | 'created_at' | 'updated_at'> {
  return { tenant_id: tenantId, properties: {}, created_at: now(), updated_at: now() };
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
 * Map a World Bank country data row to a Jurisdiction entity.
 */
export function mapWorldBankCountry(input: unknown, tenantId: string): MapperResult {
  const row = (input as Record<string, unknown>) ?? {};

  const iso2Code:    string = typeof row.iso2Code   === 'string' ? row.iso2Code   : '';
  const iso3Code:    string = typeof row.id         === 'string' ? row.id         : '';
  const name:        string = typeof row.name       === 'string' ? row.name       : '';
  const capitalCity: string = typeof row.capitalCity === 'string' ? row.capitalCity : '';

  const regionObj      = (row.region      ?? {}) as Record<string, unknown>;
  const incomeLevelObj = (row.incomeLevel ?? {}) as Record<string, unknown>;

  const region      = typeof regionObj.value      === 'string' ? regionObj.value      : '';
  const incomeLevel = typeof incomeLevelObj.value === 'string' ? incomeLevelObj.value : '';

  const jurisdictionCode = iso2Code || iso3Code;
  const entityId = pseudoUuid(`wb:jurisdiction:${jurisdictionCode || name}`);

  const entity: Entity = {
    ...makeEntityBase(tenantId),
    id:               entityId,
    type:             'jurisdiction',
    canonical_name:   name || undefined,
    jurisdiction_code: jurisdictionCode || undefined,
    properties: {
      iso2:          iso2Code,
      iso3:          iso3Code,
      capital_city:  capitalCity,
      region,
      income_level:  incomeLevel,
      source:        'world-bank',
    },
  };

  const provenance: Provenance[] = [
    {
      id:         pseudoUuid(`wb:prov:${jurisdictionCode || name}`),
      entity_id:  entityId,
      source_key: 'world-bank',
      source_url: iso2Code
        ? `https://api.worldbank.org/v2/country/${iso2Code}?format=json`
        : undefined,
      fetched_at: now(),
      confidence: 0.85,
      raw:        input,
    },
  ];

  return { entities: [entity], links: [], provenance };
}
