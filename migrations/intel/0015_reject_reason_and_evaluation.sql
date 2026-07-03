-- 0015_reject_reason_and_evaluation.sql
-- v2.0 review-inbox maturation (PRD §17.1): persist the reviewer's rejection
-- reason (0012 accepted but could not store it) and the evaluate() result on
-- every proposal so the inbox can surface eval + provenance before approval.
-- Additive + idempotent. Governance boundary unchanged; approve RPC untouched.

alter table intel.proposed_edit add column if not exists reason text;
alter table intel.proposed_edit add column if not exists evaluation jsonb;

comment on column intel.proposed_edit.reason is
  'Reviewer-supplied rejection reason, persisted by intel.reject_proposed_edit since 0015.';
comment on column intel.proposed_edit.evaluation is
  'evaluate() gate result (structure/type/grounding/risk-range/confidence) recorded at propose time; surfaced in the review inbox.';

create or replace function intel.reject_proposed_edit(p_edit_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = intel, public, pg_temp as $$
declare
  v_edit intel.proposed_edit%rowtype; v_caller_org uuid; v_caller_role text;
begin
  -- Same authz model as intel.approve_proposed_edit (see 0012/0014 header).
  v_caller_org  := nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
  v_caller_role := auth.jwt() -> 'app_metadata' ->> 'cp_role';
  select * into v_edit from intel.proposed_edit where id = p_edit_id;
  if not found then raise exception 'reject_proposed_edit: proposed_edit % not found', p_edit_id using errcode='no_data_found'; end if;
  if v_caller_org is null then raise exception 'reject_proposed_edit: denied — no authenticated organisation on caller JWT' using errcode='insufficient_privilege'; end if;
  if v_caller_org <> v_edit.tenant_id then raise exception 'reject_proposed_edit: denied — caller organisation does not match proposed_edit tenant' using errcode='insufficient_privilege'; end if;
  if v_caller_role is null or v_caller_role not in ('super_admin','owner','admin','executive') then raise exception 'reject_proposed_edit: denied — role % is not an approver', coalesce(v_caller_role,'<none>') using errcode='insufficient_privilege'; end if;
  if v_edit.status <> 'pending' then raise exception 'reject_proposed_edit: denied — proposed_edit % is not pending (status=%)', p_edit_id, v_edit.status using errcode='invalid_parameter_value'; end if;
  update intel.proposed_edit
  set status='rejected', reviewed_by=auth.uid(), reviewed_at=now(), reason=coalesce(p_reason, reason)
  where id = p_edit_id and status='pending';
  if not found then raise exception 'reject_proposed_edit: proposed_edit % changed status concurrently — aborting', p_edit_id using errcode='serialization_failure'; end if;
end $$;

comment on function intel.reject_proposed_edit(uuid, text) is
  'GOVERNED: rejects a pending intel.proposed_edit. Same authz model as approve. Since 0015, p_reason is persisted to intel.proposed_edit.reason.';

-- Grants re-asserted (identical posture to 0012)
revoke all on function intel.reject_proposed_edit(uuid, text) from public;
revoke all on function intel.reject_proposed_edit(uuid, text) from anon;
grant execute on function intel.reject_proposed_edit(uuid, text) to authenticated;
