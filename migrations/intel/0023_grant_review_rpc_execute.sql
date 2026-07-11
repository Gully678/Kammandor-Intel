-- intel_0023_grant_review_rpc_execute
-- Re-grant EXECUTE on the governed approve/reject RPCs to `authenticated` so the
-- /review analyst inbox can call them. SAFE BY DESIGN + IMPERSONATION-PROVEN
-- (rolled-back test 2026-07-12): both functions are SECURITY DEFINER and self-guard —
-- they resolve caller org+role from auth.jwt().app_metadata (never from input) and
-- hard-deny unless caller org EXACTLY matches the proposal's tenant AND cp_role in
-- (super_admin, owner, admin, executive), with pending-state + concurrency guards.
-- Proof result: unauthenticated / non-approver / wrong-tenant callers were all
-- denied (insufficient_privilege); a matching-tenant approver passed the gate.
--
-- ADVISOR NOTE (accepted, intentional — NOT a regression): this re-introduces two
-- `authenticated_security_definer_function_executable` WARNs for
-- intel.approve_proposed_edit / intel.reject_proposed_edit. That is the INTENDED
-- governed analyst approve path (identical accepted pattern to the main-app
-- public.km_provision_tenant / km_set_member_active RPCs). The sole ontology writer
-- remains the approve RPC; connectors/agents still write only intel.proposed_edit.
--
-- Only these two functions get authenticated EXECUTE; every other intel function
-- (e.g. intel_get_secret) stays service_role-only per intel_0022.
-- Applied to project ucbnnhfttahmqhvccvyw via Supabase MCP apply_migration.

grant execute on function intel.approve_proposed_edit(uuid) to authenticated;
grant execute on function intel.reject_proposed_edit(uuid, text) to authenticated;
