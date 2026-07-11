-- intel_0026_watchlist_item
-- Typed watchlist subjects for marketing (and finance): a client-side advisor
-- (via Kammandor or PULSE) adds/removes people, companies, products, creators,
-- commentators, keywords, hashtags, handles, tickers, geos, topics — per
-- watchlist (scope org|deal|campaign, ref = deal/campaign id). Complements
-- intel.tenant_watchlist. The signal matcher flattens these into its categories.
-- Engine-owned, RLS-isolated, handoff/DB accessible. Rolled-back-proven 2026-07-12.
create table if not exists intel.watchlist_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  scope text not null default 'org',
  ref text not null default '',
  kind text not null,
  value text not null,
  label text,
  active boolean not null default true,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint watchlist_item_scope_chk check (scope in ('org','deal','campaign')),
  constraint watchlist_item_kind_chk check (kind in
    ('keyword','hashtag','handle','person','company','product','creator','commentator','ticker','geo','topic'))
);
create unique index if not exists watchlist_item_uq on intel.watchlist_item (tenant_id, scope, ref, kind, lower(value));
create index if not exists watchlist_item_tenant_active_idx on intel.watchlist_item (tenant_id) where active;
alter table intel.watchlist_item enable row level security;
drop policy if exists watchlist_item_isolation on intel.watchlist_item;
create policy watchlist_item_isolation on intel.watchlist_item
  for all using ((tenant_id = cp_get_org()) or cp_is_super_admin())
  with check ((tenant_id = cp_get_org()) or cp_is_super_admin());
grant select on intel.watchlist_item to anon, authenticated;
grant select, insert, update, delete on intel.watchlist_item to service_role;
create or replace function intel.tg_watchlist_item_touch()
returns trigger language plpgsql security definer set search_path to 'intel','pg_temp' as $body$
begin new.updated_at := now(); return new; end $body$;
revoke all on function intel.tg_watchlist_item_touch() from public, anon, authenticated;
drop trigger if exists watchlist_item_touch on intel.watchlist_item;
create trigger watchlist_item_touch before update on intel.watchlist_item
  for each row execute function intel.tg_watchlist_item_touch();
