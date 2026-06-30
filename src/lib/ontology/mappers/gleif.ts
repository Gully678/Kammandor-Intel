/**
 * KINTEL Phase 2 — GLEIF LEI mapper
 * Transforms a raw GLEIF API record (JSON:API format) into ontology objects.
 *
 * Source key: 'gleif'
 * API: https://api.gleif.org/api/v1/lei-records
 */

import type { Entity, Link, Provenance } from '../types';

export interface MapperResult {
  entities:   Entity[];
  links:      Link[];
  provenance: Provenance[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function makeEntityBase(tenantId: string): Pick<Entity, 'tenant_id' | 'properties' | 'created_at' | 'updated_at'> {
  return {
    tenant_id:  tenantId,
    properties: {},
    created_at: now(),
    updated_at: now(),
  };
}

function makeLinkBase(tenantId: string): Pick<Link, 'tenant_id' | 'properties' | 'created_at'> {
  return {
    tenant_id:  tenantId,
    properties: {},
    created_at: now(),
  };
}

/** Generate a deterministic-looking UUID v4 from a string seed (for stable IDs in tests). */
function pseudoUuid(seed: string): string {
  // Simple hash to hex — not cryptographic, just for stable test fixtures.
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
 * Map a single GLEIF JSON:API data item to ontology objects.
 *
 * @param input - A single item from GLEIF data[] array (type: unknown; cast internally)
 * @param tenantId - Owning tenant UUID
 * @returns MapperResult with entity, optional jurisdiction + parent entities, links, and provenance
 */
export function mapGleifRecord(input: unknown, tenantId: string): MapperResult {
  const item = input as Record<string, unknown>;
  const attrs = (item.attributes ?? {}) as Record<string, unknown>;

  // --- LEI
  const leiCode: string =
    typeof attrs.lei === 'string'
      ? attrs.lei
      : typeof item.id === 'string'
        ? item.id
        : '';

  // --- Entity name
  const entityObj = (attrs.entity ?? {}) as Record<string, unknown>;
  const legalNameObj = (entityObj.legalName ?? {}) as Record<string, unknown>;
  const entityName: string =
    typeof legalNameObj.name === 'string'
      ? legalNameObj.name
      : typeof entityObj.legalName === 'string'
        ? (entityObj.legalName as string)
        : '';

  // --- Jurisdiction (registration address country)
  const registrationAddr = (entityObj.registeredAddress ?? entityObj.headquartersAddress ?? {}) as Record<string, unknown>;
  const jurisdictionCode: string =
    typeof entityObj.jurisdiction === 'string'
      ? entityObj.jurisdiction
      : typeof registrationAddr.country === 'string'
        ? (registrationAddr.country as string)
        : '';

  // --- Status
  const entityStatus: string = typeof entityObj.status === 'string' ? entityObj.status : '';

  // --- Parent LEI (JSON:API relationships)
  const rels = (item.relationships ?? {}) as Record<string, unknown>;
  const directParentRel = (rels['direct-parent'] ?? rels.directParent ?? {}) as Record<string, unknown>;
  const dpData = (directParentRel.data ?? {}) as Record<string, unknown>;
  const parentLei: string | undefined = typeof dpData.id === 'string' ? dpData.id : undefined;

  const entities: Entity[] = [];
  const links: Link[] = [];
  const provenance: Provenance[] = [];

  // --- Primary company entity
  const companyId = pseudoUuid(`gleif:company:${leiCode || entityName}`);
  const company: Entity = {
    ...makeEntityBase(tenantId),
    id:             companyId,
    type:           'company',
    canonical_name: entityName || undefined,
    lei:            leiCode || undefined,
    properties: {
      status:     entityStatus,
      source:     'gleif',
    },
  };
  entities.push(company);

  // --- Jurisdiction entity
  let jurisdictionId: string | undefined;
  if (jurisdictionCode) {
    jurisdictionId = pseudoUuid(`gleif:jurisdiction:${jurisdictionCode}`);
    const jurisdictionEntity: Entity = {
      ...makeEntityBase(tenantId),
      id:               jurisdictionId,
      type:             'jurisdiction',
      canonical_name:   jurisdictionCode,
      jurisdiction_code: jurisdictionCode,
      properties:       {},
    };
    entities.push(jurisdictionEntity);

    // registeredIn link: company → jurisdiction
    links.push({
      ...makeLinkBase(tenantId),
      id:               pseudoUuid(`gleif:link:registeredIn:${companyId}:${jurisdictionId}`),
      source_entity_id: companyId,
      target_entity_id: jurisdictionId,
      type:             'registeredIn',
    });
  }

  // --- Parent company entity + subsidiaryOf link
  if (parentLei) {
    const parentId = pseudoUuid(`gleif:company:${parentLei}`);
    const parentEntity: Entity = {
      ...makeEntityBase(tenantId),
      id:   parentId,
      type: 'company',
      lei:  parentLei,
      properties: { source: 'gleif', inferred: true },
    };
    entities.push(parentEntity);

    // subsidiaryOf link: child → parent
    links.push({
      ...makeLinkBase(tenantId),
      id:               pseudoUuid(`gleif:link:subsidiaryOf:${companyId}:${parentId}`),
      source_entity_id: companyId,
      target_entity_id: parentId,
      type:             'subsidiaryOf',
    });
  }

  // --- Provenance
  provenance.push({
    id:         pseudoUuid(`gleif:prov:${leiCode || entityName}`),
    entity_id:  companyId,
    source_key: 'gleif',
    source_url: leiCode ? `https://api.gleif.org/api/v1/lei-records?filter[lei]=${leiCode}` : undefined,
    fetched_at: now(),
    confidence: 0.95,
    raw:        input,
  });

  return { entities, links, provenance };
}
