-- Deliverable — apply with oversight; not applied by the build agent.
-- KINTEL Phase 2 — Ontology: intel.entity
-- Core object table for the typed semantic layer (Foundry-style).
-- Each row represents one canonical real-world object (company, person, vessel, etc.)
-- scoped to a tenant. Identifiers are sparse: only populate what is known.

create schema if not exists intel;

create table if not exists intel.entity (
  id                uuid          primary key default gen_random_uuid(),
  tenant_id         uuid          not null references public.organizations(id) on delete cascade,

  -- Object type — drives downstream enrichment logic and UI rendering
  type              text          not null check (type in (
    'company','person','fund','deal','vessel','port','wallet',
    'sanction','filing','event','asset','jurisdiction','news_source',
    'instrument'
  )),

  -- Display name (canonical; deduplicated on ingest)
  canonical_name    text,

  -- Flexible property bag for type-specific fields not promoted to columns
  properties        jsonb         not null default '{}',

  -- Risk scoring (populated by screening jobs; null = not yet screened)
  risk_score        numeric,
  risk_category     text,
  last_screened_at  timestamptz,

  -- Promoted identifiers — sparse; partial-unique indexes below enforce uniqueness
  -- per tenant when non-null
  lei               text,           -- Legal Entity Identifier (ISO 17442)
  company_number    text,           -- Registrar company number (e.g. UK CH)
  imo               text,           -- IMO vessel number
  mmsi              text,           -- MMSI transponder ID
  isin              text,           -- ISIN securities identifier
  wallet_address    text,           -- Blockchain wallet address
  jurisdiction_code text,           -- ISO 3166-1 alpha-2 / alpha-3

  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);

-- Partial-unique indexes: enforce one entity per identifier per tenant (when non-null)
create unique index if not exists entity_tenant_lei_uidx
  on intel.entity (tenant_id, lei)
  where lei is not null;

create unique index if not exists entity_tenant_company_number_uidx
  on intel.entity (tenant_id, company_number)
  where company_number is not null;

create unique index if not exists entity_tenant_imo_uidx
  on intel.entity (tenant_id, imo)
  where imo is not null;

create unique index if not exists entity_tenant_isin_uidx
  on intel.entity (tenant_id, isin)
  where isin is not null;

create unique index if not exists entity_tenant_wallet_uidx
  on intel.entity (tenant_id, wallet_address)
  where wallet_address is not null;

create unique index if not exists entity_tenant_jurisdiction_uidx
  on intel.entity (tenant_id, jurisdiction_code, type)
  where jurisdiction_code is not null and type = 'jurisdiction';

-- Supporting indexes for common lookups
create index if not exists entity_tenant_type_idx on intel.entity (tenant_id, type);
create index if not exists entity_type_idx on intel.entity (type);

-- Enable Row-Level Security
alter table intel.entity enable row level security;

-- Policy comment: tenants may only SELECT/INSERT/UPDATE/DELETE their own rows.
-- Actual policy expression to be created per-project alongside the auth.uid()
-- mapping to organizations. Example (adjust to your org-member join):
--
--   create policy "tenant_isolation" on intel.entity
--     using (tenant_id = (select org_id from public.org_members where user_id = auth.uid() limit 1));

comment on table intel.entity is
  'Canonical object registry for the KINTEL ontology. '
  'Each row is a deduplicated real-world entity (company, person, vessel, etc.) '
  'scoped to a tenant. Identifiers (LEI, IMO, ISIN …) are promoted to columns '
  'for indexing; all other properties are in the properties JSONB bag.';
