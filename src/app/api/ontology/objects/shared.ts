/**
 * KINTEL v2.3 — Shared server helpers for the headless ontology read surface
 * (PRD §10). Used by /api/ontology/objects, /api/ontology/objects/[id] and
 * /api/ontology/query. NOT a route file — Next.js only exports route.ts.
 *
 * GOVERNANCE (applies to every consumer):
 *   - READ-ONLY: nothing in this module writes. GET/select only.
 *   - Tenant identity comes ONLY from the signed handoff contract
 *     (resolveTenantFromRequest) — never from a client-supplied org id.
 *   - EXPLICIT column allowlists — never `select=*`, even on intel tables
 *     we fully control (response stability + no accidental leakage).
 *   - Raw PostgREST with the service-role key, matching
 *     src/app/api/intel/monitoring-config/route.ts and signals/scan —
 *     intel-schema reads set `Accept-Profile: intel`.
 */

import { ENTITY_TYPES, type ObjectType } from '@/lib/ontology/types';
import type { ObjectIdentifiers, ObjectSummary } from '@/lib/sdk/intel/types';

// ---------------------------------------------------------------------------
// DB config + headers (service-role PostgREST, intel schema reads)
// ---------------------------------------------------------------------------

export interface DbConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
}

export function getDbConfig(): DbConfig | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey };
}

/** Headers for a GET against a table in the `intel` schema. */
export function intelReadHeaders(db: DbConfig): Record<string, string> {
  return {
    apikey: db.serviceRoleKey,
    Authorization: `Bearer ${db.serviceRoleKey}`,
    Accept: 'application/json',
    // PostgREST: read from the `intel` schema, not `public` (the read-side
    // counterpart of ingest/route.ts's `Content-Profile: intel`).
    'Accept-Profile': 'intel',
  };
}

/** Tenant-scoped GET returning parsed rows, or null on any failure. */
export async function intelSelect(
  db: DbConfig,
  table: string,
  params: URLSearchParams,
): Promise<unknown[] | null> {
  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/${table}`);
    for (const [k, v] of params) url.searchParams.append(k, v);
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: intelReadHeaders(db),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const rows: unknown = await res.json();
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Entity allowlist + response mapper
// ---------------------------------------------------------------------------

/**
 * EXPLICIT column allowlist for intel.entity reads. tenant_id, raw screening
 * internals and anything not listed here are never selected or returned.
 */
export const ENTITY_SELECT_COLUMNS = [
  'id',
  'type',
  'canonical_name',
  'properties',
  'risk_score',
  'risk_category',
  'lei',
  'company_number',
  'imo',
  'mmsi',
  'isin',
  'wallet_address',
  'jurisdiction_code',
  'created_at',
  'updated_at',
] as const;

export const ENTITY_SELECT = ENTITY_SELECT_COLUMNS.join(',');

/** EXPLICIT column allowlist for intel.link reads (graph edges). */
export const LINK_SELECT_COLUMNS = [
  'id',
  'source_entity_id',
  'target_entity_id',
  'type',
  'properties',
  'created_at',
] as const;

export const LINK_SELECT = LINK_SELECT_COLUMNS.join(',');

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function isEntityType(v: unknown): v is ObjectType {
  return typeof v === 'string' && (ENTITY_TYPES as readonly string[]).includes(v);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * Map a raw intel.entity row onto the governed ObjectSummary shape using an
 * EXPLICIT allowlist (mirrors monitoring-config's normaliseRow discipline).
 * Returns null for rows that don't carry the minimum viable shape.
 */
export function toObjectSummary(row: unknown): ObjectSummary | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;

  const id = str(r.id);
  const createdAt = str(r.created_at);
  const updatedAt = str(r.updated_at);
  if (!id || !isEntityType(r.type) || !createdAt || !updatedAt) return null;

  const identifiers: ObjectIdentifiers = {};
  const lei = str(r.lei);
  if (lei) identifiers.lei = lei;
  const companyNumber = str(r.company_number);
  if (companyNumber) identifiers.company_number = companyNumber;
  const imo = str(r.imo);
  if (imo) identifiers.imo = imo;
  const mmsi = str(r.mmsi);
  if (mmsi) identifiers.mmsi = mmsi;
  const isin = str(r.isin);
  if (isin) identifiers.isin = isin;
  const wallet = str(r.wallet_address);
  if (wallet) identifiers.wallet_address = wallet;
  const jurisdiction = str(r.jurisdiction_code);
  if (jurisdiction) identifiers.jurisdiction_code = jurisdiction;

  return {
    id,
    type: r.type,
    canonical_name: str(r.canonical_name),
    properties:
      typeof r.properties === 'object' && r.properties !== null && !Array.isArray(r.properties)
        ? (r.properties as Record<string, unknown>)
        : {},
    risk_score: num(r.risk_score),
    risk_category: str(r.risk_category),
    identifiers,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}
