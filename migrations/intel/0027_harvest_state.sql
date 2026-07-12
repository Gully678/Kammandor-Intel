-- intel_0027_harvest_state  (see MCP apply; net-new + grounding heartbeat state)
create table if not exists intel.harvest_seen (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  subject text not null, platform text not null default '',
  external_id text not null, title text, url text,
  seen_at timestamptz not null default now()
);
create unique index if not exists harvest_seen_uq on intel.harvest_seen (tenant_id, subject, external_id);
create index if not exists harvest_seen_tenant_idx on intel.harvest_seen (tenant_id, subject);
alter table intel.harvest_seen enable row level security;
drop policy if exists harvest_seen_isolation on intel.harvest_seen;
create policy harvest_seen_isolation on intel.harvest_seen for all using ((tenant_id=cp_get_org()) or cp_is_super_admin()) with check ((tenant_id=cp_get_org()) or cp_is_super_admin());
grant select on intel.harvest_seen to anon, authenticated;
grant select, insert, update, delete on intel.harvest_seen to service_role;
create table if not exists intel.harvest_cursor (
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  subject text not null, platform text not null default '',
  grounded boolean not null default false, last_run_at timestamptz,
  primary key (tenant_id, subject)
);
alter table intel.harvest_cursor enable row level security;
drop policy if exists harvest_cursor_isolation on intel.harvest_cursor;
create policy harvest_cursor_isolation on intel.harvest_cursor for all using ((tenant_id=cp_get_org()) or cp_is_super_admin()) with check ((tenant_id=cp_get_org()) or cp_is_super_admin());
grant select on intel.harvest_cursor to anon, authenticated;
grant select, insert, update, delete on intel.harvest_cursor to service_role;
