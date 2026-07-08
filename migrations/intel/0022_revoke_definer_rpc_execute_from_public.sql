-- intel_0022_revoke_definer_rpc_execute_from_public
-- 0021 granted authenticated USAGE on schema intel, which surfaced the pre-existing
-- PUBLIC-default EXECUTE on the SECURITY DEFINER approve/reject RPCs (2 new advisor
-- WARNs). Governance Law: the approve path is not opened to signed-in users without
-- an impersonation-proven test. Revoke EXECUTE from public + authenticated on all
-- intel functions (service_role keeps its explicit grant for server-side calls);
-- prevent recurrence for future functions via default privileges. Analyst EXECUTE
-- for the /review flow will be re-granted in a dedicated, RLS-tested slice.
-- Applied to project ucbnnhfttahmqhvccvyw via Supabase MCP apply_migration.
-- Verified after apply: advisors back to baseline (4 main-app WARNs, 0 intel WARNs).

revoke execute on all functions in schema intel from public, authenticated;
alter default privileges in schema intel revoke execute on functions from public;

-- service_role retains execute (server-trusted path; bypasses RLS). Idempotent.
grant execute on all functions in schema intel to service_role;
alter default privileges in schema intel grant execute on functions to service_role;
