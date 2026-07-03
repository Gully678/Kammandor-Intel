-- 0019_agent_run_trace.sql
-- PRD v2.0 §13.1 / §9.7 "show raw": per-invocation lineage for every governed
-- agent run — input, every tool call, output/error, timing — the regulator-
-- facing evidence trail. Server-side writes only; tenant-scoped read.
-- Additive + idempotent.

create table if not exists intel.agent_run (
  id bigint generated always as identity primary key,
  agent_key text not null,
  tenant_id uuid,
  trigger_kind text not null check (trigger_kind in ('scheduled','event','manual')),
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  input jsonb,
  tool_calls jsonb not null default '[]',
  output jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table intel.agent_run is
  'Per-invocation agent lineage (PRD §13.1 show-raw): agent, trigger, input, every tool call, output/error. One row per governed agent run; never deleted.';

create index if not exists agent_run_agent_idx on intel.agent_run (agent_key, started_at desc);

alter table intel.agent_run enable row level security;
drop policy if exists agent_run_isolation on intel.agent_run;
create policy agent_run_isolation on intel.agent_run for select using ((tenant_id = cp_get_org()) or cp_is_super_admin());
