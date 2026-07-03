-- 0017_ontology_type_catalogue.sql
-- PRD v2.0 §7.9: the governed object/link-type catalogue (finance beachhead +
-- marketing per founder decision §20.3), with human-readable descriptions as
-- single-source-of-truth semantics (§7.2 property metadata principle).
-- Extends intel.entity's type check to the v2 superset (additive — every
-- existing type remains valid). Read-only to clients; seeds evolve by migration.

create table if not exists intel.object_type (
  key text primary key, label text not null, description text,
  vertical text not null check (vertical in ('finance','marketing','generic')),
  created_at timestamptz not null default now());
comment on table intel.object_type is
  'Governed catalogue of ontology object types (PRD §7.9). Descriptions are the human/AI-readable semantics surfaced via InfoHint; grows additively by migration.';

create table if not exists intel.link_type (
  key text primary key, label text not null, description text,
  source_type text not null, target_type text not null,
  shape text not null check (shape in ('foreign-key','many-to-many')),
  vertical text not null check (vertical in ('finance','marketing','generic')),
  created_at timestamptz not null default now());
comment on table intel.link_type is
  'Governed catalogue of ontology link types (PRD §7.9) — typed relationships, not ad hoc joins.';

alter table intel.object_type enable row level security;
alter table intel.link_type enable row level security;
drop policy if exists object_type_read_authenticated on intel.object_type;
create policy object_type_read_authenticated on intel.object_type for select to authenticated using (true);
drop policy if exists link_type_read_authenticated on intel.link_type;
create policy link_type_read_authenticated on intel.link_type for select to authenticated using (true);

-- entity.type superset (all 14 v1 types retained + 8 v2 types per §7.9)
alter table intel.entity drop constraint if exists entity_type_check;
alter table intel.entity add constraint entity_type_check check (type in (
 'company','person','fund','deal','vessel','port','wallet','sanction','filing','event','asset','jurisdiction','news_source','instrument',
 'document','market_event','trend','mention','campaign','contact','review','competitor_signal'));

insert into intel.object_type (key,label,description,vertical) values
 ('company','Company','A corporate entity — counterparty, issuer, portfolio company, brand or competitor','generic'),
 ('person','Person','An individual — principal, beneficial owner, signatory','generic'),
 ('fund','Fund','An investment fund or vehicle','finance'),
 ('deal','Deal','A transaction or facility under consideration or live','finance'),
 ('instrument','Instrument','A financial instrument — Sukuk tranche, SBLC, credit line, rate series','finance'),
 ('vessel','Vessel','A physical asset in a commodity trade (ship, cargo)','finance'),
 ('port','Port','A port or terminal relevant to physical-commodity movements','finance'),
 ('wallet','Wallet','A blockchain wallet address','finance'),
 ('sanction','Sanction','A sanctions-list entry','finance'),
 ('filing','Filing','A regulatory or registry filing','finance'),
 ('event','Event','A discrete occurrence with market or counterparty relevance','generic'),
 ('market_event','Market Event','A macro or sector event with downstream relevance','generic'),
 ('asset','Asset','A physical or financial asset','generic'),
 ('jurisdiction','Jurisdiction','A regulatory or legal territory','generic'),
 ('news_source','News Source','A publisher or feed of public reporting','generic'),
 ('document','Document','A source document (contract, SDS, filing) with page-level provenance','generic'),
 ('mention','Mention','A public reference to a brand, product, or competitor','marketing'),
 ('campaign','Campaign','A marketing or sales initiative','marketing'),
 ('contact','Contact','An individual within a company (marketing/sales context)','marketing'),
 ('review','Review','A customer or product review','marketing'),
 ('trend','Trend','A detected shift in a tracked metric over time (derived)','marketing'),
 ('competitor_signal','Competitor Signal','A detected competitor action — price change, launch, hire','marketing')
on conflict (key) do nothing;

insert into intel.link_type (key,label,description,source_type,target_type,shape,vertical) values
 ('deal_company','Deal ↔ Company','Which counterparty a deal is with','deal','company','foreign-key','finance'),
 ('deal_person','Deal ↔ Person','Signatories/principals on a deal','deal','person','foreign-key','finance'),
 ('instrument_deal','Instrument ↔ Deal','Which instrument funds which deal','instrument','deal','foreign-key','finance'),
 ('vessel_deal','Vessel ↔ Deal','Which cargo/vessel a physical-commodity deal moves','vessel','deal','foreign-key','finance'),
 ('person_sanction','Person ↔ Sanction','A person appearing on one or more sanctions lists','person','sanction','many-to-many','finance'),
 ('event_company','Event ↔ Company','An event affecting one or more companies, and vice versa','event','company','many-to-many','generic'),
 ('company_mention','Company ↔ Mention','Which brand a public mention refers to','company','mention','foreign-key','marketing'),
 ('contact_campaign','Contact ↔ Campaign','Which contacts were touched by which campaigns','contact','campaign','many-to-many','marketing'),
 ('market_event_company','Market Event ↔ Company','Cascading impact of one macro event across tenant-relevant entities','market_event','company','many-to-many','generic')
on conflict (key) do nothing;
