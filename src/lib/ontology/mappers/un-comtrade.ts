/**
 * KINTEL Phase 2 — UN Comtrade trade flow mapper
 * Transforms a bilateral trade flow record into reporter/partner Jurisdiction
 * entities and a connectedJurisdiction link.
 *
 * Source key: 'un-comtrade'
 * API: https://comtradeapi.un.org/data/v1/get (see src/app/api/un-comtrade/route.ts)
 *
 * Input shape (single item from the route's `flows[]` array):
 * { reporterIso, reporterName, partnerIso, partnerName, flow, flowDesc, value, period }
 *
 * Produces:
 *   - Reporter Jurisdiction entity
 *   - Partner Jurisdiction entity (skipped when partner is aggregate 'World', iso '0')
 *   - connectedJurisdiction link: reporter → partner, carrying flow/value/period
 */

import type { Entity, Link, Provenance } from '../types';
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

function jurisdictionEntity(tenantId: string, iso: string, name: string, source: string): Entity {
  const id = pseudoUuid(`comtrade:jurisdiction:${iso || name}`);
  return {
    ...makeEntityBase(tenantId),
    id,
    type:              'jurisdiction',
    canonical_name:    name || iso || undefined,
    jurisdiction_code: iso || undefined,
    properties: { source },
  };
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

/**
 * Map a single UN Comtrade trade flow record to ontology objects.
 *
 * Expected input shape:
 * {
 *   reporterIso:  string,   // e.g. 'USA'
 *   reporterName: string,
 *   partnerIso:   string,   // e.g. 'GBR'; '0' or 'WLD' for World aggregate
 *   partnerName:  string,
 *   flow:         string,   // 'M' (imports) | 'X' (exports)
 *   flowDesc:     string,
 *   value:        number | null,
 *   period:       string,   // e.g. '2023'
 * }
 */
export function mapUnComtradeFlow(input: unknown, tenantId: string): MapperResult {
  const row = (input as Record<string, unknown>) ?? {};

  const reporterIso:  string = typeof row.reporterIso  === 'string' ? row.reporterIso  : '';
  const reporterName: string = typeof row.reporterName === 'string' ? row.reporterName : '';
  const partnerIso:   string = typeof row.partnerIso   === 'string' ? row.partnerIso   : '';
  const partnerName:  string = typeof row.partnerName  === 'string' ? row.partnerName  : '';
  const flow:         string = typeof row.flow         === 'string' ? row.flow         : '';
  const flowDesc:     string = typeof row.flowDesc     === 'string' ? row.flowDesc     : '';
  const value:        number | null = typeof row.value === 'number' && !isNaN(row.value) ? row.value : null;
  const period:       string = typeof row.period       === 'string' ? row.period       : '';

  // Defensive: need at least a reporter to produce anything meaningful.
  if (!reporterIso && !reporterName) {
    return { entities: [], links: [], provenance: [] };
  }

  const entities:   Entity[]     = [];
  const links:      Link[]       = [];
  const provenance: Provenance[] = [];

  const reporter = jurisdictionEntity(tenantId, reporterIso, reporterName, 'un-comtrade');
  entities.push(reporter);

  // World aggregate partner ('0' / 'WLD') carries no distinct jurisdiction to link to.
  const isWorldAggregate = !partnerIso || partnerIso === '0' || partnerIso.toUpperCase() === 'WLD';

  if (!isWorldAggregate) {
    const partner = jurisdictionEntity(tenantId, partnerIso, partnerName, 'un-comtrade');
    entities.push(partner);

    links.push({
      ...makeLinkBase(tenantId),
      id:               pseudoUuid(`comtrade:link:connectedJurisdiction:${reporter.id}:${partner.id}:${flow}:${period}`),
      source_entity_id: reporter.id,
      target_entity_id: partner.id,
      type:             'connectedJurisdiction',
      properties: {
        flow,
        flow_desc: flowDesc,
        value,
        period,
        source: 'un-comtrade',
      },
    });
  }

  provenance.push({
    id:         pseudoUuid(`comtrade:prov:${reporterIso}:${partnerIso}:${flow}:${period}`),
    entity_id:  reporter.id,
    source_key: 'un-comtrade',
    source_url: reporterIso
      ? `https://comtradeapi.un.org/data/v1/get/C/A/${period}/${reporterIso}/TOTAL/${partnerIso || '0'}`
      : undefined,
    fetched_at: now(),
    confidence: 0.85,
    raw:        input,
  });

  return { entities, links, provenance };
}
