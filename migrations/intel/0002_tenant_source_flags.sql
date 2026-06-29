-- KINTEL Phase 1 — Tenant source flags
-- Per-tenant overrides of source enablement, auth mode, and BYOK secret references.
-- Consumed by isSourceEnabled() once the platform upgrades from env-var flags to DB-backed flags.

create schema if not exists intel;

create table if not exists intel.tenant_source_flags (
  tenant_id      text    not null,
  source_key     text    not null references intel.sources (key) on delete cascade,
  enabled        boolean not null default true,
  -- auth_mode overrides the source-level auth for this tenant
  -- e.g. a tenant can supply their own key for a platform-key source (BYOK upgrade)
  auth_mode      text    not null check (auth_mode in ('none','platform-key','tenant-key')),
  -- Reference to the secret stored in Vault / Supabase Vault (never store raw keys here)
  byok_secret_ref text   null,
  updated_at     timestamptz not null default now(),

  primary key (tenant_id, source_key)
);

comment on table intel.tenant_source_flags is
  'Per-tenant overrides for source enablement and auth mode. '
  'Rows here take precedence over intel.sources.enabled_by_default. '
  'Designed for RLS: each tenant can only read/write their own rows.';

comment on column intel.tenant_source_flags.byok_secret_ref is
  'Reference handle to the tenant''s own API key stored in Supabase Vault. '
  'Null when auth_mode is not tenant-key. '
  'Never store raw secret values in this column.';

comment on column intel.tenant_source_flags.auth_mode is
  'Effective auth mode for this tenant+source combination. '
  'Setting this to tenant-key and populating byok_secret_ref enables BYOK, '
  'shifting API cost from Kammandor (platform) to the tenant.';

-- Enable RLS so tenants cannot read each other's flags
alter table intel.tenant_source_flags enable row level security;
