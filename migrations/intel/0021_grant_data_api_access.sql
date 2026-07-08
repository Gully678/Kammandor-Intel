-- intel_0021_grant_data_api_access
-- Fixes PostgREST 403 on intel.* : exposing the schema in the Data API made it
-- visible, but the API roles were never granted access to a non-public schema.
-- Additive + idempotent (GRANT is a no-op if already held). RLS remains the gate:
-- all 13 intel tables have RLS enabled + a policy, so anon/authenticated SELECT is
-- row-filtered. service_role is server-only and bypasses RLS (the trusted server
-- identity used by /api/health, /api/metrics/public, /api/ai/tools, ingest, etc.).
-- Function EXECUTE is granted to service_role only — NOT authenticated — to avoid
-- introducing new "authenticated-executable SECURITY DEFINER" advisor warnings;
-- the /review approve/reject RPC grant will be a separate, impersonation-tested change.
-- Applied to project ucbnnhfttahmqhvccvyw via Supabase MCP apply_migration.

grant usage on schema intel to service_role, anon, authenticated;

-- service_role: full DML (server-only, bypasses RLS)
grant select, insert, update, delete on all tables in schema intel to service_role;
grant usage, select on all sequences in schema intel to service_role;
grant execute on all functions in schema intel to service_role;

-- anon + authenticated: RLS-gated reads (every intel table has RLS enabled)
grant select on all tables in schema intel to anon, authenticated;
grant usage, select on all sequences in schema intel to anon, authenticated;

-- future objects created in intel inherit the same access
alter default privileges in schema intel grant select on tables to anon, authenticated;
alter default privileges in schema intel grant select, insert, update, delete on tables to service_role;
alter default privileges in schema intel grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema intel grant execute on functions to service_role;
