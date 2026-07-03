-- 0018_eval_run_persistence.sql
-- PRD v2.0 §9.7 / §15.8: persisted evaluation runs — gold-standard suites with
-- run history, pass rates, and the founder-set floor (80%, per
-- FOUNDER_DECISIONS_v2_2026-07-03: per-capability bars with a hard 0.8 floor).
-- Server-side writes only (service role); authenticated read for dashboards.
-- Additive + idempotent.

create table if not exists intel.eval_run (
  id bigint generated always as identity primary key,
  suite text not null,
  capability text not null,
  git_sha text,
  total int not null,
  passed int not null,
  pass_rate numeric not null check (pass_rate >= 0 and pass_rate <= 1),
  floor_met boolean not null,
  results jsonb not null default '[]',
  ran_at timestamptz not null default now()
);

comment on table intel.eval_run is
  'Persisted gold-suite evaluation runs (PRD §9.7): no AI capability ships without a passing run; floor_met records whether the per-capability bar (>= 0.8 floor) was met.';

create index if not exists eval_run_suite_idx on intel.eval_run (suite, ran_at desc);

alter table intel.eval_run enable row level security;
drop policy if exists eval_run_read_authenticated on intel.eval_run;
create policy eval_run_read_authenticated on intel.eval_run for select to authenticated using (true);
