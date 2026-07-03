/**
 * KINTEL Phase 2 — Ontology type definitions
 * Mirrors the intel schema SQL tables (0005–0009).
 * These are pure TypeScript value types — no runtime DB coupling.
 */

// ---------------------------------------------------------------------------
// Object types (mirrors intel.entity type CHECK constraint)
// ---------------------------------------------------------------------------

export type ObjectType =
  | 'company'
  | 'person'
  | 'fund'
  | 'deal'
  | 'vessel'
  | 'port'
  | 'wallet'
  | 'sanction'
  | 'filing'
  | 'event'
  | 'asset'
  | 'jurisdiction'
  | 'news_source'
  | 'instrument';

// ---------------------------------------------------------------------------
// Link types (mirrors intel.link type CHECK constraint)
// ---------------------------------------------------------------------------

export type LinkType =
  | 'isDirectorOf'
  | 'beneficialOwnerOf'
  | 'shareholderOf'
  | 'subsidiaryOf'
  | 'isNamedInDeal'
  | 'isSubjectOf'
  | 'registeredIn'
  | 'filedWith'
  | 'portCallAt'
  | 'linkedWallet'
  | 'mentionedInEvent'
  | 'connectedJurisdiction'
  | 'ownsAsset'
  | 'pricedBy';

// ---------------------------------------------------------------------------
// Value-type aliases — opaque string brands for strong typing at call sites
// ---------------------------------------------------------------------------

export type LEI             = string;  // ISO 17442 Legal Entity Identifier
export type IMO             = string;  // IMO vessel number
export type MMSI            = string;  // Maritime Mobile Service Identity
export type ISIN            = string;  // ISO 6166 securities identifier
export type WalletAddress   = string;  // Blockchain wallet address
export type CompanyNumber   = string;  // Registrar company number
export type JurisdictionCode = string; // ISO 3166-1 alpha-2 / alpha-3

// ---------------------------------------------------------------------------
// Semantic sub-interfaces (structural contracts for entity variants)
// ---------------------------------------------------------------------------

/** A registered legal entity (company, fund, SPV, etc.) */
export interface LegalEntity {
  lei?:            LEI;
  company_number?: CompanyNumber;
  jurisdiction?:   JurisdictionCode;
  status?:         string;  // e.g. 'ACTIVE', 'DISSOLVED'
}

/** A natural person (director, UBO, officer, etc.) */
export interface NaturalPerson {
  date_of_birth?:    string;  // ISO 8601
  nationality?:      JurisdictionCode;
  pep_status?:       boolean;
  sanctions_listed?: boolean;
}

/** A geographic reference point */
export interface GeographicPoint {
  latitude?:  number;
  longitude?: number;
  iso2?:      string;
  iso3?:      string;
  region?:    string;
}

/** Common fields for any subject under risk assessment */
export interface RiskSubject {
  risk_score?:       number;
  risk_category?:    string;
  last_screened_at?: string;  // ISO 8601
}

// ---------------------------------------------------------------------------
// Core ontology interfaces (mirror SQL columns)
// ---------------------------------------------------------------------------

/** Mirrors intel.entity */
export interface Entity {
  id:                string;
  tenant_id:         string;
  type:              ObjectType;
  canonical_name?:   string;
  properties:        Record<string, unknown>;
  risk_score?:       number;
  risk_category?:    string;
  last_screened_at?: string;  // ISO 8601
  lei?:              LEI;
  company_number?:   CompanyNumber;
  imo?:              IMO;
  mmsi?:             MMSI;
  isin?:             ISIN;
  wallet_address?:   WalletAddress;
  jurisdiction_code?: JurisdictionCode;
  created_at:        string;  // ISO 8601
  updated_at:        string;  // ISO 8601
}

/** Mirrors intel.link */
export interface Link {
  id:               string;
  tenant_id:        string;
  source_entity_id: string;
  target_entity_id: string;
  type:             LinkType;
  strength?:        number | null;   // relationship weight; persisted to intel.link.strength (see slice 2/3) or link.properties
  properties:       Record<string, unknown>;
  valid_from?:      string;   // ISO 8601
  valid_to?:        string;   // ISO 8601
  created_at:       string;   // ISO 8601
}

/** Mirrors intel.entity_provenance */
export interface Provenance {
  id:          string;
  entity_id:   string;
  source_key:  string;
  source_url?: string;
  fetched_at:  string;   // ISO 8601
  confidence?: number;   // 0–1
  raw?:        unknown;
}

/** Mirrors intel.proposed_edit */
export interface ProposedEdit {
  id:           string;
  tenant_id:    string;
  kind:         'create_entity' | 'update_entity' | 'create_link' | 'update_link';
  payload:      Record<string, unknown>;
  proposed_by:  string;
  rationale?:   string;
  status:       'pending' | 'approved' | 'rejected' | 'applied';
  reviewed_by?: string;
  reviewed_at?: string;  // ISO 8601
  created_at:   string;  // ISO 8601
}
