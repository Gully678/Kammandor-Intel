-- intel_0025_tenant_watchlist
-- Engine-owned, multi-watchlist-per-tenant store so ANY consuming system —
-- including INVRT/PULSE on a DIFFERENT Supabase — can set what the hub watches
-- over HTTP (POST /api/intel/watchlist), then pull via the SDK. Complements
-- public.km_monitoring_config (main-app, same-Supabase); the signal matcher
-- reads the UNION of both. Lives in intel.* so the engine never writes km_*.
-- scope+ref: an org has an 'org' watchlist AND one per 'deal'/'campaign'.
-- RLS mirrors the intel isolation pattern; write path is service-role + tenant
-- from the verified handoff token. Rolled-back-proven 2026-07-12.
-- Applied via Supabase MCP apply_migration.

create table if not exists intel.tenant_watchlist (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organizations(id) on delete cascade,
  scope       text not null default 'org',
  ref         text not null default '',
  label       text,
  keywords    text[] not null default '{}',
  entities    text[] not null default '{}',
  tickers     text[] not null default '{}',
  handles     text[] not null default '{}',
  geos        text[] not null default '{}',
  active      boolean not null default true,
  source      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tenant_watchlist_scope_chk check (scope in ('org','deal','campaign'))
);
create unique index if not exists tenant_watchlist_uq on intel.tenant_watchlist (tenant_id, scope, ref);
create index if not exists tenant_watchlist_tenant_active_idx on intel.tenant_watchlist (tenant_id) where active;
alter table intel.tenant_watchlist enable row level security;
drop policy if exists tenant_watchlist_isolation on intel.tenant_watchlist;
create policy tenant_watchlist_isolation on intel.tenant_watchlist
  for all using ((tenant_id = cp_get_org()) or cp_is_super_admin())
  with check ((tenant_id = cp_get_org()) or cp_is_super_admin());
grant select on intel.tenant_watchlist to anon, authenticated;
grant select, insert, update, delete on intel.tenant_watchlist to service_role;
create or replace function intel.tg_tenant_watchlist_touch()
returns trigger language plpgsql security definer set search_path to 'intel','pg_temp' as $body$
begin new.updated_at := now(); return new; end $body$;
revoke all on function intel.tg_tenant_watchlist_touch() from public, anon, authenticated;
drop trigger if exists tenant_watchlist_touch on intel.tenant_watchlist;
create trigger tenant_watchlist_touch before update on intel.tenant_watchlist
  for each row execute function intel.tg_tenant_watchlist_touch();
