-- 0013_source_licence_provenance.sql
-- PRD v2.0 §13.2 / §8.7: source/licence-level provenance — the Foundry gap.
-- Additive + idempotent. No RLS change. No grant change.

-- 1) Licence metadata on the source registry
alter table intel.sources add column if not exists licence_class text
  check (licence_class in ('licensed','public-attribution','public-open','proprietary'));
alter table intel.sources add column if not exists licence_terms text;
alter table intel.sources add column if not exists licence_url   text;

comment on column intel.sources.licence_class is
  'Licence class per PRD v2.0 §13.2: licensed | public-attribution | public-open | proprietary.';
comment on column intel.sources.licence_terms is
  'Verbatim licence description from PRD §8.7 source matrix; never invented.';

-- 2) Seed licence data for the 10 live sources (verbatim from PRD §8.7)
update intel.sources set licence_class='public-open',
  licence_terms='US public-domain / SEC terms of use' where key='sec-edgar';
update intel.sources set licence_class='public-attribution',
  licence_terms='UK Open Government Licence' where key='companies-house';
update intel.sources set licence_class='public-open',
  licence_terms='Open, CC0-equivalent (GLEIF terms)' where key='gleif';
update intel.sources set licence_class='public-open',
  licence_terms='US public-domain (FRED terms)' where key='fred';
update intel.sources set licence_class='public-attribution',
  licence_terms='CC-BY 4.0 (World Bank Open Data licence)' where key='world-bank';
update intel.sources set licence_class='public-attribution',
  licence_terms='UN Comtrade terms of use' where key='un-comtrade';
update intel.sources set licence_class='licensed',
  licence_terms='Commercial licence — redistribution terms vary by vendor; verify before client-facing display' where key='markets-fx';
update intel.sources set licence_class='public-open',
  licence_terms='GDELT open-data terms (broadly permissive; verify commercial-redistribution nuance)' where key='gdelt';
update intel.sources set licence_class='licensed',
  licence_terms='Aggregation layer — inherits the licence terms of each underlying review connector; verify per platform' where key='reviews';
update intel.sources set licence_class='licensed',
  licence_terms='Varies by platform — most restrict bulk redistribution; verify per-platform terms' where key='social';

-- 3) Per-fact licence + property attribution on provenance
alter table intel.entity_provenance add column if not exists licence_class text
  check (licence_class in ('licensed','public-attribution','public-open','proprietary'));
alter table intel.entity_provenance add column if not exists licence_terms text;
alter table intel.entity_provenance add column if not exists property_path text;

comment on column intel.entity_provenance.property_path is
  'Which property/properties of the entity this provenance row supports (JSON path or column name); per-fact attribution per PRD §7.4.';
