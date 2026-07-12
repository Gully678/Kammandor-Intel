-- tests/rls/cross_tenant_review.sql
-- Impersonation-proven authz test for migration intel_0031 (platform
-- super_admin cross-tenant review). Run the WHOLE file in ONE transaction
-- via the Supabase MCP execute_sql (or psql): it makes real writes and then
-- deliberately raises X_CROSS_TENANT_REVIEW_OK_ROLLED_BACK so EVERYTHING
-- rolls back. Success = that exact exception; any other error = a failure.
--
-- Requires: >=1 pending create_entity proposed_edit in two different tenant
-- orgs; substitute the four placeholders before running.
--   :PLATFORM_ORG  — organizations.id where is_platform = true
--   :TENANT_A_EDIT — pending create_entity proposed_edit.id in tenant A
--   :TENANT_B_EDIT — pending create_entity proposed_edit.id in tenant B
--   :ANY_USER_UUID — any auth.users.id (used as the sub claim)

-- [P] platform super_admin approves cross-tenant: must SUCCEED
select set_config('request.jwt.claims',
  '{"sub":":ANY_USER_UUID","role":"authenticated","app_metadata":{"cp_role":"super_admin","organization_id":":PLATFORM_ORG"}}',
  true);
select intel.approve_proposed_edit(':TENANT_A_EDIT');

-- [N1] tenant guest: must be DENIED (insufficient_privilege)
do $n1$ begin
  perform set_config('request.jwt.claims',
    '{"sub":":ANY_USER_UUID","role":"authenticated","app_metadata":{"cp_role":"guest","organization_id":":PLATFORM_ORG"}}',
    true);
  begin
    perform intel.approve_proposed_edit(':TENANT_B_EDIT');
    raise exception 'N1_FAILED_guest_was_allowed';
  exception when insufficient_privilege then null; -- expected deny
  end;
end $n1$;

-- [N2] super_admin of a NON-platform org cross-tenant: must be DENIED
do $n2$ begin
  perform set_config('request.jwt.claims',
    '{"sub":":ANY_USER_UUID","role":"authenticated","app_metadata":{"cp_role":"super_admin","organization_id":"<a NON-platform org id>"}}',
    true);
  begin
    perform intel.approve_proposed_edit(':TENANT_B_EDIT');
    raise exception 'N2_FAILED_nonplatform_super_admin_was_allowed';
  exception when insufficient_privilege then null; -- expected deny
  end;
end $n2$;

-- All proofs passed — roll back every write above.
do $fin$ begin raise exception 'X_CROSS_TENANT_REVIEW_OK_ROLLED_BACK'; end $fin$;
