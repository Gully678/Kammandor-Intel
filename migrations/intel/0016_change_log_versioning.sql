-- 0016_change_log_versioning.sql
-- PRD v2.0 §7.8 (versioning): every approved change to a governed object or
-- link is a retained version with a full before/after diff. Implemented as
-- AFTER INSERT/UPDATE triggers on intel.entity / intel.link writing to
-- intel.change_log. Because intel.approve_proposed_edit is the sole writer to
-- those tables, every change_log row corresponds to a governed, audited write.
-- Additive + idempotent. Read access tenant-isolated; no client write path.

create table if not exists intel.change_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  table_name text not null check (table_name in ('entity','link')),
  row_id uuid not null,
  op text not null check (op in ('INSERT','UPDATE')),
  actor uuid,
  before jsonb,
  after jsonb,
  changed_at timestamptz not null default now()
);

comment on table intel.change_log is
  'Version history of every governed write to intel.entity / intel.link (PRD §7.8). '
  'Populated exclusively by triggers fired from the sole-writer approve RPC path; '
  'before/after retained indefinitely.';

create index if not exists change_log_row_idx on intel.change_log (table_name, row_id, changed_at desc);

alter table intel.change_log enable row level security;
drop policy if exists change_log_isolation on intel.change_log;
create policy change_log_isolation on intel.change_log for select using ((tenant_id = cp_get_org()) or cp_is_super_admin());

create or replace function intel.fn_change_log() returns trigger
language plpgsql set search_path = intel, public, pg_temp as $$
begin
  insert into intel.change_log (tenant_id, table_name, row_id, op, actor, before, after)
  values (coalesce(new.tenant_id, old.tenant_id), tg_table_name, coalesce(new.id, old.id), tg_op, auth.uid(),
          case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end $$;

drop trigger if exists trg_entity_change_log on intel.entity;
create trigger trg_entity_change_log after insert or update on intel.entity for each row execute function intel.fn_change_log();
drop trigger if exists trg_link_change_log on intel.link;
create trigger trg_link_change_log after insert or update on intel.link for each row execute function intel.fn_change_log();
