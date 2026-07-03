/**
 * KINTEL Phase 2 — Ontology type definitions
 * Mirrors the intel schema SQL tables (0005–0009).
 * These are pure TypeScript value types — no runtime DB coupling.
 */

// ---------------------------------------------------------------------------
// Object types (mirrors intel.entity type CHECK constraint)
// ---------------------------------------------------------------------------

/**
 * All entity object types — mirrors the intel.entity type CHECK constraint
 * (14 v1 types + 8 v2 types added in migration intel_0016) and the
 * intel.object_type catalogue table.
 */
export const ENTITY_TYPES = [
  // v1
  'company',
  'person',
  'fund',
  'deal',
  'vessel',
  'port',
  'wallet',
  'sanction',
  'filing',
  'event',
  'asset',
  'jurisdiction',
  'news_source',
  'instrument',
  // v2 (migration intel_0016)
  'document',
  'market_event',
  'trend',
  'mention',
  'campaign',
  'contact',
  'review',
  'competitor_signal',
] as const;

export type ObjectType = (typeof ENTITY_TYPES)[number];

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

export type LicenceClass = 'licensed' | 'public-attribution' | 'public-open' | 'proprietary';

/** Mirrors intel.entity_provenance */
export interface Provenance {
  id:             string;
  entity_id:      string;
  source_key:     string;
  source_url?:    string;
  fetched_at:     string;   // ISO 8601
  confidence?:    number;   // 0–1
  raw?:           unknown;
  licence_class?: LicenceClass;
  licence_terms?: string;
  property_path?: string;
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
  /** Why the edit was proposed — mirrors intel.proposed_edit.reason (intel_0015) */
  reason?:      string;
  /** Structured evaluation output — mirrors intel.proposed_edit.evaluation jsonb (intel_0015) */
  evaluation?:  unknown;
}

// ---------------------------------------------------------------------------
// Link-type catalogue (mirrors intel.link_type seed rows, migration intel_0017)
// ---------------------------------------------------------------------------

/** A catalogued relationship class between two entity types. */
export interface LinkTypeDef {
  key: string;
  label: string;
  description: string;
  sourceType: string;
  targetType: string;
  shape: 'foreign-key' | 'many-to-many';
  vertical: 'finance' | 'marketing' | 'generic';
}

/**
 * The 9 v2 link types seeded in intel.link_type (migration intel_0017).
 * Keys and fields mirror the DB rows exactly — do not invent entries here.
 */
export const LINK_TYPE_CATALOGUE: Record<string, LinkTypeDef> = {
  deal_company: {
    key: 'deal_company',
    label: 'Deal ↔ Company',
    description: 'Which counterparty a deal is with',
    sourceType: 'deal',
    targetType: 'company',
    shape: 'foreign-key',
    vertical: 'finance',
  },
  deal_person: {
    key: 'deal_person',
    label: 'Deal ↔ Person',
    description: 'Signatories/principals on a deal',
    sourceType: 'deal',
    targetType: 'person',
    shape: 'foreign-key',
    vertical: 'finance',
  },
  instrument_deal: {
    key: 'instrument_deal',
    label: 'Instrument ↔ Deal',
    description: 'Which instrument funds which deal',
    sourceType: 'instrument',
    targetType: 'deal',
    shape: 'foreign-key',
    vertical: 'finance',
  },
  vessel_deal: {
    key: 'vessel_deal',
    label: 'Vessel ↔ Deal',
    description: 'Which cargo/vessel a physical-commodity deal moves',
    sourceType: 'vessel',
    targetType: 'deal',
    shape: 'foreign-key',
    vertical: 'finance',
  },
  person_sanction: {
    key: 'person_sanction',
    label: 'Person ↔ Sanction',
    description: 'A person appearing on one or more sanctions lists',
    sourceType: 'person',
    targetType: 'sanction',
    shape: 'many-to-many',
    vertical: 'finance',
  },
  event_company: {
    key: 'event_company',
    label: 'Event ↔ Company',
    description: 'An event affecting one or more companies, and vice versa',
    sourceType: 'event',
    targetType: 'company',
    shape: 'many-to-many',
    vertical: 'generic',
  },
  company_mention: {
    key: 'company_mention',
    label: 'Company ↔ Mention',
    description: 'Which brand a public mention refers to',
    sourceType: 'company',
    targetType: 'mention',
    shape: 'foreign-key',
    vertical: 'marketing',
  },
  contact_campaign: {
    key: 'contact_campaign',
    label: 'Contact ↔ Campaign',
    description: 'Which contacts were touched by which campaigns',
    sourceType: 'contact',
    targetType: 'campaign',
    shape: 'many-to-many',
    vertical: 'marketing',
  },
  market_event_company: {
    key: 'market_event_company',
    label: 'Market Event ↔ Company',
    description: 'Cascading impact of one macro event across tenant-relevant entities',
    sourceType: 'market_event',
    targetType: 'company',
    shape: 'many-to-many',
    vertical: 'generic',
  },
};
