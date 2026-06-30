-- Deliverable — apply with oversight; not applied by the build agent.
-- KINTEL Phase 2 — Ontology: intel.link
-- Directed edges between entities in the semantic graph.
-- Each link has a typed relationship (isDirectorOf, beneficialOwnerOf, etc.)
-- with optional validity window and arbitrary property bag.

create schema if not exists intel;

create table if not exists intel.link (
  id                uuid          primary key default gen_random_uuid(),
  tenant_id         uuid          not null references public.organizations(id) on delete cascade,

  -- Directed edge: source_entity → target_entity
  source_entity_id  uuid          not null references intel.entity(id) on delete cascade,
  target_entity_id  uuid          not null references intel.entity(id) on delete cascade,

  -- Relationship type
  type              text          not null check (type in (
    'isDirectorOf',
    'beneficialOwnerOf',
    'shareholderOf',
    'subsidiaryOf',
    'isNamedInDeal',
    'isSubjectOf',
    'registeredIn',
    'filedWith',
    'portCallAt',
    'linkedWallet',
    'mentionedInEvent',
    'connectedJurisdiction',
    'ownsAsset',
    'pricedBy'
  )),

  -- Additional relationship attributes (e.g. ownership %, share class, etc.)
  properties        jsonb         not null default '{}',

  -- Temporal validity window (null = open-ended / current)
  valid_from        timestamptz,
  valid_to          timestamptz,

  created_at        timestamptz   not null default now()
);

-- Enforce uniqueness of a directed typed relationship between two entities per tenant
create unique index if not exists link_unique_edge_uidx
  on intel.link (tenant_id, source_entity_id, target_entity_id, type);

-- Supporting indexes for graph traversal
create index if not exists link_source_idx on intel.link (tenant_id, source_entity_id);
create index if not exists link_target_idx on intel.link (tenant_id, target_entity_id);
create index if not exists link_type_idx   on intel.link (tenant_id, type);

-- Enable Row-Level Security
alter table intel.link enable row level security;

-- Policy comment: isolation mirrors intel.entity — tenant_id column enforces separation.
-- Example policy (adjust to your auth model):
--
--   create policy "tenant_isolation" on intel.link
--     using (tenant_id = (select org_id from public.org_members where user_id = auth.uid() limit 1));

comment on table intel.link is
  'Directed typed graph edges between intel.entity rows. '
  'Captures corporate control, ownership, filings, vessel calls, and other '
  'semantic relationships. Unique per (tenant, source, target, type).';
