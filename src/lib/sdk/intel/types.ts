/**
 * KINTEL v2.3 — Intel SDK shared types (PRD §10.1, API-first/headless)
 *
 * SINGLE SOURCE OF TRUTH for the headless read surface. These types are
 * imported by BOTH sides of the contract:
 *   - the API routes (src/app/api/ontology/objects, src/app/api/ontology/query,
 *     src/app/api/signals/alerts) use them to shape responses, and
 *   - the typed client (src/lib/sdk/intel/client.ts) uses them to type
 *     requests/responses for tenant / third-party front ends.
 *
 * Ontology value types come from '@/lib/ontology/types' — never duplicate
 * them here. This module is intentionally separate from the legacy Osiris
 * SDK files (src/lib/sdk/types.ts, PolybolosClient.ts, LatticeAdapter.ts),
 * which are untouched.
 */

import type { LicenceClass, LinkType, ObjectType } from '@/lib/ontology/types';

export type { LicenceClass, LinkType, ObjectType };

// ---------------------------------------------------------------------------
// Object summaries (GET /api/ontology/objects, graph query nodes)
// ---------------------------------------------------------------------------

/** Promoted identifiers of an entity, grouped for API consumers. */
export interface ObjectIdentifiers {
  lei?: string;
  company_number?: string;
  imo?: string;
  mmsi?: string;
  isin?: string;
  wallet_address?: string;
  jurisdiction_code?: string;
}

/**
 * Governed summary of an intel.entity row. tenant_id is NEVER exposed —
 * every read is already scoped to the caller's resolved tenant.
 */
export interface ObjectSummary {
  id: string;
  type: ObjectType;
  canonical_name: string | null;
  properties: Record<string, unknown>;
  risk_score: number | null;
  risk_category: string | null;
  identifiers: ObjectIdentifiers;
  created_at: string;
  updated_at: string;
}

export interface ListObjectsParams {
  /** Filter by object type (validated against ENTITY_TYPES). */
  type?: ObjectType;
  /** Case-insensitive name search on canonical_name. */
  q?: string;
  /** Page size — default 50, max 200. */
  limit?: number;
  /** Keyset cursor — the `nextCursor` from the previous page. */
  cursor?: string;
}

export interface ListObjectsResponse {
  objects: ObjectSummary[];
  /** created_at keyset cursor for the next page, or null when exhausted. */
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Object detail (GET /api/ontology/objects/[id])
// ---------------------------------------------------------------------------

/** A link touching the requested object, in either direction. */
export interface ObjectLink {
  id: string;
  source: string;
  target: string;
  type: string;
  /** 'out' = object is the link source; 'in' = object is the link target. */
  direction: 'out' | 'in';
  /** Human label from LINK_TYPE_CATALOGUE when the type is catalogued. */
  label?: string;
  properties: Record<string, unknown>;
  created_at: string;
}

/**
 * A provenance row for the object — a fact without its source is not a
 * governed answer, so licence class/terms travel with every read.
 */
export interface ProvenanceRecord {
  source_key: string;
  source_url: string | null;
  fetched_at: string;
  confidence: number | null;
  licence_class: LicenceClass | null;
  licence_terms: string | null;
  property_path: string | null;
}

/** One governed version from intel.change_log (PRD §7.8). */
export interface VersionRecord {
  op: 'INSERT' | 'UPDATE';
  actor: string | null;
  changed_at: string;
  before: unknown;
  after: unknown;
}

export interface ObjectDetailResponse {
  object: ObjectSummary;
  links: ObjectLink[];
  provenance: ProvenanceRecord[];
  /** Latest versions first, capped at 20. */
  versions: VersionRecord[];
}

// ---------------------------------------------------------------------------
// Graph query (POST /api/ontology/query — the §10.2 graph surface)
// ---------------------------------------------------------------------------

export type TraverseDirection = 'out' | 'in' | 'both';

export interface GraphTraverseStep {
  /** Restrict this hop to one link type (e.g. 'isDirectorOf', 'deal_company'). */
  linkType?: string;
  direction: TraverseDirection;
  /** Restrict the far end of this hop to one object type. */
  targetType?: ObjectType;
}

export interface GraphQueryStart {
  type?: ObjectType;
  ids?: string[];
}

export interface GraphQuery {
  start: GraphQueryStart;
  /** Traversal steps — max depth 3. */
  traverse?: GraphTraverseStep[];
  /** Max nodes returned — default 50, max 100. */
  limit?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphQueryResponse {
  nodes: ObjectSummary[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Alerts feed (GET /api/signals/alerts)
// ---------------------------------------------------------------------------

/** One row of the tenant's alert feed (public.intelligence_alerts). */
export interface AlertRecord {
  id: string;
  headline: string | null;
  detail: string | null;
  severity: string | null;
  source_url: string | null;
  status: string | null;
  created_at: string;
}

export interface ListAlertsParams {
  status?: string;
  severity?: string;
  /** Page size — default 50, max 200. */
  limit?: number;
}

export interface ListAlertsResponse {
  alerts: AlertRecord[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Error body every route returns on non-2xx. */
export interface ApiErrorBody {
  error: string;
}
