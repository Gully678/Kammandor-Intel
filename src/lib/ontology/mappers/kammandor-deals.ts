/**
 * KINTEL Mission A — Kammandor deal-graph mapper (first-party source)
 *
 * Source key: 'kammandor-deals' (intel.sources, migration intel_0030)
 *
 * Maps the Kammandor main app's tenant deal graph (public.deals /
 * public.companies / public.contacts / public.km_counterparty_relationships —
 * same Supabase project, already tenant-scoped by organization_id) into
 * ontology entities and links.
 *
 * GOVERNANCE (unchanged): this mapper is PURE — it builds MapperResult only.
 * Proposals land in intel.proposed_edit via the ingest pipeline and are
 * materialised ONLY by intel.approve_proposed_edit after human review.
 *
 * Design notes:
 *  - Input is ONE composite record per tenant ({ record_type: 'deal_graph' }),
 *    so the eval gate's link-grounding check sees every sibling entity id and
 *    links bind correctly on approval (approve RPC honours payload id since
 *    migration intel_0029).
 *  - Entity ids ARE the source rows' uuids (preserveEntityIds: true) — this
 *    makes ingest idempotence checkable, gives a free crosswalk to the main
 *    app, and cannot collide across tenants (uuids are global).
 *  - NO financial figures are promoted into entity properties. Verbatim rows
 *    (including any figures) live only in provenance.raw — never asserted as
 *    ontology properties. ("Never fabricate a figure" — and never re-state
 *    one outside its source either.)
 *  - Link evidence: each link carries a provenance entry whose property_path
 *    is `link:{type}->{target_id}` and whose raw is the verbatim relationship
 *    row, attributed to the link's source entity (matches approve RPC shape).
 */

import type { Entity, Link, Provenance } from '../types';
import type { MapperResult } from './gleif';

export type { MapperResult };

// ---------------------------------------------------------------------------
// Input row shapes (verbatim column names from the public schema)
// ---------------------------------------------------------------------------

interface CompanyRow {
  id?: unknown; name?: unknown; jurisdiction?: unknown; website?: unknown;
  company_type?: unknown; [k: string]: unknown;
}
interface ContactRow {
  id?: unknown; company_id?: unknown; full_name?: unknown; role_title?: unknown;
  [k: string]: unknown;
}
interface DealRow {
  id?: unknown; deal_ref?: unknown; name?: unknown; status?: unknown;
  [k: string]: unknown;
}
interface RelationshipRow {
  id?: unknown; deal_id?: unknown; party_type?: unknown; contact_id?: unknown;
  company_id?: unknown; role?: unknown; [k: string]: unknown;
}

/** Composite per-tenant record accepted by this mapper. */
export interface KammandorDealGraphRecord {
  record_type: 'deal_graph';
  companies?: unknown[];
  contacts?: unknown[];
  deals?: unknown[];
  relationships?: unknown[];
  fetched_at?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_KEY = 'kammandor-deals';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(v: unknown): string | null {
  return typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null;
}

function asText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function now(): string {
  return new Date().toISOString();
}

/** Only promote jurisdiction to the typed column when it is an ISO-like code. */
function asJurisdictionCode(v: unknown): string | null {
  const t = asText(v);
  return t && /^[A-Za-z]{2,3}$/.test(t) ? t.toUpperCase() : null;
}

function makeProvenance(
  entityId:     string,
  raw:          unknown,
  fetchedAt:    string,
  propertyPath?: string,
): Provenance {
  return {
    id:            entityId + ':' + (propertyPath ?? 'row'),
    entity_id:     entityId,
    source_key:    SOURCE_KEY,
    fetched_at:    fetchedAt,
    confidence:    1,
    raw,
    ...(propertyPath ? { property_path: propertyPath } : {}),
  };
}

/** Deterministic marker so ingest can pair link payloads with their evidence. */
export function linkEvidencePath(type: string, targetId: string): string {
  return `link:${type}->${targetId}`;
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

export function mapKammandorDealGraph(input: unknown, tenantId: string): MapperResult {
  const rec = (input as KammandorDealGraphRecord) ?? ({} as KammandorDealGraphRecord);

  const entities:   Entity[]     = [];
  const links:      Link[]       = [];
  const provenance: Provenance[] = [];

  const fetchedAt = asText(rec.fetched_at) ?? now();
  const ts = now();

  const base = { tenant_id: tenantId, created_at: ts, updated_at: ts };
  const emitted = new Set<string>();

  // ---- Companies -> entity type 'company' --------------------------------
  for (const rowU of Array.isArray(rec.companies) ? rec.companies : []) {
    const row = rowU as CompanyRow;
    const id = asUuid(row.id);
    const name = asText(row.name);
    if (!id || !name || emitted.has(id)) continue;

    const properties: Record<string, unknown> = {};
    const website     = asText(row.website);
    const companyType = asText(row.company_type);
    const jurText     = asText(row.jurisdiction);
    const jurCode     = asJurisdictionCode(row.jurisdiction);
    if (website)               properties.website      = website;
    if (companyType)           properties.company_type = companyType;
    if (jurText && !jurCode)   properties.jurisdiction = jurText;

    entities.push({
      ...base,
      id,
      type: 'company',
      canonical_name: name,
      properties,
      ...(jurCode ? { jurisdiction_code: jurCode } : {}),
    } as Entity);
    provenance.push(makeProvenance(id, row, fetchedAt));
    emitted.add(id);
  }

  // ---- Contacts -> entity type 'person' ----------------------------------
  for (const rowU of Array.isArray(rec.contacts) ? rec.contacts : []) {
    const row = rowU as ContactRow;
    const id = asUuid(row.id);
    const name = asText(row.full_name);
    if (!id || !name || emitted.has(id)) continue;

    const properties: Record<string, unknown> = {};
    const roleTitle = asText(row.role_title);
    if (roleTitle) properties.role_title = roleTitle;
    // Deliberately NOT promoted: email / phone (PII stays verbatim in
    // provenance.raw only, never as asserted ontology properties).

    entities.push({ ...base, id, type: 'person', canonical_name: name, properties } as Entity);
    provenance.push(makeProvenance(id, row, fetchedAt));
    emitted.add(id);
  }

  // ---- Deals -> entity type 'deal' ----------------------------------------
  for (const rowU of Array.isArray(rec.deals) ? rec.deals : []) {
    const row = rowU as DealRow;
    const id = asUuid(row.id);
    const name = asText(row.name) ?? asText(row.deal_ref);
    if (!id || !name || emitted.has(id)) continue;

    const properties: Record<string, unknown> = {};
    const dealRef = asText(row.deal_ref);
    const status  = asText(row.status);
    if (dealRef) properties.deal_ref = dealRef;
    if (status)  properties.status   = status;
    // Deliberately NOT promoted: any monetary/metadata figures — those remain
    // verbatim in provenance.raw only.

    entities.push({ ...base, id, type: 'deal', canonical_name: name, properties } as Entity);
    provenance.push(makeProvenance(id, row, fetchedAt));
    emitted.add(id);
  }

  // ---- Counterparty relationships -> 'isNamedInDeal' links ----------------
  const linkSeen = new Set<string>();
  for (const rowU of Array.isArray(rec.relationships) ? rec.relationships : []) {
    const row = rowU as RelationshipRow;
    const dealId    = asUuid(row.deal_id);
    const partyType = asText(row.party_type);
    const partyId   = partyType === 'contact' ? asUuid(row.contact_id) : asUuid(row.company_id);
    if (!dealId || !partyId) continue;
    // Ground strictly against sibling entities from THIS record — guarantees
    // the eval gate's dangling-endpoint check and the DB FKs both hold.
    if (!emitted.has(dealId) || !emitted.has(partyId)) continue;

    const key = `${partyId}->isNamedInDeal->${dealId}`;
    if (linkSeen.has(key)) continue;
    linkSeen.add(key);

    const properties: Record<string, unknown> = {};
    const role = asText(row.role);
    if (role)      properties.role       = role;
    if (partyType) properties.party_type = partyType;

    links.push({
      id: key,
      tenant_id: tenantId,
      source_entity_id: partyId,
      target_entity_id: dealId,
      type: 'isNamedInDeal',
      properties,
      created_at: ts,
    } as Link);
    provenance.push(
      makeProvenance(partyId, row, fetchedAt, linkEvidencePath('isNamedInDeal', dealId)),
    );
  }

  // ---- Contact -> company 'isDirectorOf' (only when the title says so) ----
  for (const rowU of Array.isArray(rec.contacts) ? rec.contacts : []) {
    const row = rowU as ContactRow;
    const personId  = asUuid(row.id);
    const companyId = asUuid(row.company_id);
    const roleTitle = asText(row.role_title);
    if (!personId || !companyId || !roleTitle) continue;
    if (!/director/i.test(roleTitle)) continue; // deterministic — never inferred
    if (!emitted.has(personId) || !emitted.has(companyId)) continue;

    const key = `${personId}->isDirectorOf->${companyId}`;
    if (linkSeen.has(key)) continue;
    linkSeen.add(key);

    links.push({
      id: key,
      tenant_id: tenantId,
      source_entity_id: personId,
      target_entity_id: companyId,
      type: 'isDirectorOf',
      properties: { role_title: roleTitle },
      created_at: ts,
    } as Link);
    provenance.push(
      makeProvenance(personId, row, fetchedAt, linkEvidencePath('isDirectorOf', companyId)),
    );
  }

  return { entities, links, provenance, preserveEntityIds: true };
}
