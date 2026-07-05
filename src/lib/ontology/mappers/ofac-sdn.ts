/**
 * KINTEL WS-1 — OFAC SDN sanctions mapper (clean-room)
 *
 * Source key: 'ofac-sdn' — US Treasury OFAC Specially Designated Nationals list.
 * Licence: US Government work, public domain (17 U.S.C. 105).
 *
 * Maps one normalised SDN record into a governed sanctions-risk Entity plus
 * licence-stamped Provenance. GOVERNANCE: emits ontology objects only; the
 * pipeline converts these into create_entity proposals (intel.proposed_edit).
 * A sanctions MATCH is HITL downstream — nothing here auto-actions or writes
 * truth, and no figure/severity is invented.
 */

import type { Entity, Link, Provenance } from '../types';
import type { MapperResult } from './gleif';

const OFAC_SOURCE_KEY = 'ofac-sdn';
const OFAC_SOURCE_URL =
  'https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists';
const OFAC_LICENCE_TERMS =
  'US Treasury OFAC SDN & Blocked Persons list — US Government work, public domain (17 U.S.C. 105).';

function now(): string {
  return new Date().toISOString();
}

/** Stable pseudo-UUID from a seed (mirrors the gleif mapper helper). */
function pseudoUuid(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  const hex = Math.abs(h).toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-000000000000`;
}

/** Map an OpenSanctions/OFAC schema token to an ontology ObjectType. */
function toObjectType(schema: unknown): Entity['type'] {
  const s = typeof schema === 'string' ? schema.toLowerCase() : '';
  if (s.includes('vessel') || s.includes('ship')) return 'vessel';
  if (s.includes('person') || s.includes('individual')) return 'person';
  if (s.includes('company') || s.includes('organization') || s.includes('organisation') || s.includes('entity')) {
    return 'company';
  }
  return 'sanction';
}

function firstString(...vals: unknown[]): string {
  for (const v of vals) if (typeof v === 'string' && v !== '') return v;
  return '';
}

/**
 * Map a single normalised OFAC SDN record to ontology objects.
 * Expected input keys (from targets.simple.csv): id, schema, name, countries,
 * aliases, sanctions, identifiers, birth_date. Unknown keys are ignored but
 * preserved in provenance.raw.
 */
export function mapOfacSdnRecord(input: unknown, tenantId: string): MapperResult {
  const item = (input ?? {}) as Record<string, unknown>;

  const sdnId = firstString(item.id, item.uid);
  const name = firstString(item.name, item.caption);
  const schema = item.schema ?? item.type ?? item.sdnType;
  const country = firstString(item.countries, item.country, item.jurisdiction) || undefined;

  const entities: Entity[] = [];
  const links: Link[] = [];
  const provenance: Provenance[] = [];

  // Defensive no-op: no usable identity. The connector's HARD expectation
  // already holds such batches back loudly ("better stale than wrong").
  if (name === '' && sdnId === '') return { entities, links, provenance };

  const entityId = pseudoUuid(`ofac:${sdnId || name}`);
  const entity: Entity = {
    tenant_id: tenantId,
    id: entityId,
    type: toObjectType(schema),
    canonical_name: name || undefined,
    risk_category: 'sanctions',
    // Presence on the SDN list is binary; screening/scoring is HITL downstream.
    risk_score: 1,
    last_screened_at: now(),
    jurisdiction_code: country,
    properties: {
      source: OFAC_SOURCE_KEY,
      list: 'OFAC SDN',
      sdn_id: sdnId || undefined,
      schema: typeof schema === 'string' ? schema : undefined,
      aliases: item.aliases ?? undefined,
      programs: item.sanctions ?? item.program ?? item.programs ?? undefined,
      identifiers: item.identifiers ?? undefined,
    },
    created_at: now(),
    updated_at: now(),
  };
  entities.push(entity);

  provenance.push({
    id: pseudoUuid(`ofac:prov:${entityId}`),
    entity_id: entityId,
    source_key: OFAC_SOURCE_KEY,
    source_url: OFAC_SOURCE_URL,
    fetched_at: now(),
    confidence: 1,
    raw: item,
    licence_class: 'public-open',
    licence_terms: OFAC_LICENCE_TERMS,
  });

  return { entities, links, provenance };
}
