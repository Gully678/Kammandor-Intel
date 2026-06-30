-- Deliverable — apply with oversight; not applied by the build agent.
-- KINTEL Phase 2 — Ontology: intel.entity_crosswalk
-- Maps an intel.entity to existing Kammandor (km_*) domain objects.
-- One row per entity; nullable FKs allow partial cross-referencing.

create schema if not exists intel;

create table if not exists intel.entity_crosswalk (
  entity_id          uuid  primary key references intel.entity(id) on delete cascade,

  -- Optional links to existing Kammandor domain tables
  km_deal_id         uuid  references public.deals(id)             on delete set null,
  company_id         uuid  references public.companies(id)         on delete set null,
  contact_id         uuid  references public.contacts(id)          on delete set null,
  party_profile_id   uuid  references public.km_party_profiles(id) on delete set null
);

-- Indexes for reverse-lookup (find entity from a km_ object)
create index if not exists crosswalk_deal_idx          on intel.entity_crosswalk (km_deal_id)        where km_deal_id        is not null;
create index if not exists crosswalk_company_idx       on intel.entity_crosswalk (company_id)        where company_id        is not null;
create index if not exists crosswalk_contact_idx       on intel.entity_crosswalk (contact_id)        where contact_id        is not null;
create index if not exists crosswalk_party_profile_idx on intel.entity_crosswalk (party_profile_id)  where party_profile_id  is not null;

comment on table intel.entity_crosswalk is
  'Cross-reference from the semantic ontology layer (intel.entity) to existing '
  'Kammandor domain objects (deals, companies, contacts, party profiles). '
  'One-to-one: each entity_id appears at most once. All FK columns are nullable '
  'because most ontology entities will not yet have a matching km_ record.';
