-- KINTEL — Security hardening (applied to live Kammandor Supabase 2026-07-01)
-- 0001/0007 omitted RLS on these two tables; enable to match the rest (deny-by-default; service role bypasses).
alter table intel.sources enable row level security;
alter table intel.entity_crosswalk enable row level security;

-- intel.sources is a global, non-sensitive catalogue; allow authenticated SELECT, writes stay service-role only.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='intel' and tablename='sources' and policyname='sources_read_authenticated') then
    create policy "sources_read_authenticated" on intel.sources for select to authenticated using (true);
  end if;
end$$;
