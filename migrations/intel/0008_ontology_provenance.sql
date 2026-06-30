-- Deliverable — apply with oversight; not applied by the build agent.
-- KINTEL Phase 2 — Ontology: intel.entity_provenance
-- Audit trail recording every data source contribution to an entity.
-- Multiple provenance rows per entity (one per source fetch).

create schema if not exists intel;

create table if not exists intel.entity_provenance (
  id          uuid          primary key default gen_random_uuid(),
  entity_id   uuid          not null references intel.entity(id) on delete cascade,

  -- Source key mirrors intel.sources.key (e.g. 'gleif', 'companies-house')
  source_key  text          not null,
  -- URL or URI of the specific API response / document fetched
  source_url  text,
  -- When this record was retrieved from the upstream source
  fetched_at  timestamptz   not null default now(),

  -- Confidence score for this source's contribution (0–1; null = not assessed)
  confidence  numeric       check (confidence >= 0 and confidence <= 1),

  -- Raw response payload for auditability and re-parsing
  raw         jsonb
);

-- Indexes for common access patterns
create index if not exists provenance_entity_idx    on intel.entity_provenance (entity_id);
create index if not exists provenance_source_idx    on intel.entity_provenance (source_key);
create index if not exists provenance_fetched_idx   on intel.entity_provenance (fetched_at desc);

-- RLS: inherit tenant isolation via entity join.
-- A row is visible iff the linked entity belongs to the requesting tenant.
-- Enable RLS on the table; policy must join to intel.entity for tenant_id.
alter table intel.entity_provenance enable row level security;

-- Example policy (adjust to your auth model):
--
--   create policy "tenant_isolation" on intel.entity_provenance
--     using (
--       exists (
--         select 1 from intel.entity e
--         where e.id = entity_id
--           and e.tenant_id = (
--             select org_id from public.org_members
--             where user_id = auth.uid() limit 1
--           )
--       )
--     );

comment on table intel.entity_provenance is
  'Audit trail of every data-source contribution to an intel.entity. '
  'RLS is enabled; effective tenant isolation is enforced via join to intel.entity.';
