-- 0032_action_registry.sql
-- Mission C — the kinetic ACTION layer (Palantir "systems of action"
-- write-back column), v1 DRAFT. Platform action-type catalogue + tenant-
-- scoped action queue + governed approve/reject RPCs. Additive + idempotent.
-- Prototype in a ROLLED-BACK transaction before applying via the Supabase
-- MCP apply_migration (per docs/handoff/BUILD_GATE.md).
--
-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  GOVERNANCE BOUNDARY — READ BEFORE MODIFYING                          ║
-- ║                                                                        ║
-- ║  intel.approve_action() and intel.reject_action() are the ONLY        ║
-- ║  approval paths for an intel.action row. Agents/routes may INSERT     ║
-- ║  rows ONLY in status 'queued' or 'awaiting_approval' — never          ║
-- ║  'approved' directly (see src/app/api/ontology/actions/route.ts's      ║
-- ║  governance banner). Both RPCs are SECURITY DEFINER and therefore     ║
-- ║  bypass RLS on intel.action; authorisation is enforced EXPLICITLY, in ║
-- ║  SQL, inside the function body, against the CALLING user's JWT claims ║
-- ║  — mirrors intel.approve_proposed_edit (migrations/intel/0012,        ║
-- ║  restated in 0029). Do NOT relax the authz block below to make a      ║
-- ║  client easier to write.                                              ║
-- ║                                                                        ║
-- ║  NOTE — v1 DRAFT SCOPE: this migration creates the REGISTRY + QUEUE   ║
-- ║  only. It does NOT create an executor. Nothing here dequeues a        ║
-- ║  'queued'/'approved' row and performs the side effect (sending the    ║
-- ║  notification, creating the Kammandor task, drafting the PULSE asset, ║
-- ║  attaching to the deal, firing the webhook) — that is a LATER slice.  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

create schema if not exists intel;

-- ---------------------------------------------------------------------------
-- 1. intel.action_type — platform catalogue (NOT tenant-scoped: every tenant
--    reads the same rows).
--
-- Abstention tiers (risk_tier), mirroring the deterministic router in
-- src/lib/ontology/actions.ts's routeAction():
--   'act'        — auto-execute: low-risk actions the engine may perform
--                  without a human in the loop, subject to confidence.
--   'draft'      — prepare & recommend: the engine builds the artefact/
--                  payload, but a human must approve before it goes out.
--   'ask_human'  — explicit human approval required, always, regardless of
--                  confidence — the highest-risk / most consequential tier.
-- ---------------------------------------------------------------------------
create table if not exists intel.action_type (
  key                 text primary key,
  label               text not null,
  description         text not null,
  risk_tier           text not null,
  enabled_by_default  boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint action_type_risk_tier_chk check (risk_tier in ('act', 'draft', 'ask_human'))
);

comment on table intel.action_type is
  'Platform-wide catalogue of action kinds the engine can queue (Mission C — '
  'the kinetic ACTION layer, v1 draft). NOT tenant-scoped: every tenant sees '
  'the same catalogue. risk_tier sets the abstention tier: act = auto-execute '
  'low-risk actions; draft = prepare the artefact and recommend it, a human '
  'approves before dispatch; ask_human = explicit human approval required, '
  'always. See src/lib/ontology/actions.ts routeAction() for the '
  'deterministic, confidence-aware router that consumes this tier.';

insert into intel.action_type (key, label, description, risk_tier) values
  ('notify', 'Notify', 'Send a notification to the tenant about a signal or change.', 'draft'),
  ('create_kammandor_task', 'Create Kammandor task', 'Create a task in the Kammandor main app for a human to action.', 'ask_human'),
  ('draft_pulse_asset', 'Draft PULSE asset', 'Prepare a draft marketing/content asset in PULSE for human review.', 'draft'),
  ('attach_to_deal', 'Attach to deal', 'Attach a discovered entity, link or document to an existing deal record.', 'ask_human'),
  ('fire_webhook', 'Fire webhook', 'Call an external webhook URL with the approved action payload.', 'ask_human')
on conflict (key) do nothing;

-- action_type is a read-only platform catalogue: RLS enabled per house law
-- ("RLS mandatory on new tables") but the policy is a plain read-for-all —
-- there is no tenant column to isolate on, and no client write path exists
-- (writes are seed-only, above, applied via migration).
alter table intel.action_type enable row level security;
drop policy if exists action_type_read_all on intel.action_type;
create policy action_type_read_all on intel.action_type for select using (true);
grant select on intel.action_type to authenticated;
grant select, insert, update, delete on intel.action_type to service_role;

-- ---------------------------------------------------------------------------
-- 2. intel.action — tenant-scoped write-back queue.
-- ---------------------------------------------------------------------------
create table if not exists intel.action (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organizations(id) on delete cascade,
  action_type_key    text not null references intel.action_type(key),
  subject_entity_id  uuid references intel.entity(id) on delete set null,
  payload            jsonb not null default '{}',
  status             text not null default 'awaiting_approval',
  requested_by       text not null,
  rationale          text,
  approved_by        uuid,
  approved_at        timestamptz,
  executed_at        timestamptz,
  error              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint action_status_chk check (status in
    ('queued', 'awaiting_approval', 'approved', 'rejected', 'executed', 'failed', 'cancelled'))
);

comment on table intel.action is
  'Tenant-scoped queue of write-back actions (Mission C — the kinetic ACTION '
  'layer, v1 draft). Rows are proposed in status ''queued'' (act tier, '
  'auto-execute) or ''awaiting_approval'' (draft/ask_human tiers) — see '
  'src/lib/ontology/actions.ts routeAction()/initialStatusFor(). '
  'intel.approve_action() / intel.reject_action() are the ONLY paths that '
  'move a row out of ''awaiting_approval''. This migration does NOT create '
  'an executor — nothing yet dequeues ''queued''/''approved'' rows to '
  'perform the side effect; that is a later slice.';

create index if not exists action_tenant_status_idx on intel.action (tenant_id, status);
create index if not exists action_type_key_idx on intel.action (action_type_key);

alter table intel.action enable row level security;
drop policy if exists action_isolation on intel.action;
create policy action_isolation on intel.action
  for all using ((tenant_id = cp_get_org()) or cp_is_super_admin())
  with check ((tenant_id = cp_get_org()) or cp_is_super_admin());

-- Grant posture mirrors intel.tenant_watchlist / intel.watchlist_item
-- (migrations/intel/0025, 0026): `authenticated` gets read-only (RLS-scoped);
-- all writes go through service_role from server-side route code (the
-- action insert path — src/app/api/ontology/actions/route.ts) or through the
-- SECURITY DEFINER approve/reject RPCs below, which run as their owner and
-- enforce authz explicitly in-body regardless of table-level grants.
grant select on intel.action to authenticated;
grant select, insert, update, delete on intel.action to service_role;

create or replace function intel.tg_action_touch()
returns trigger language plpgsql security definer set search_path to 'intel','pg_temp' as $body$
begin new.updated_at := now(); return new; end $body$;
revoke all on function intel.tg_action_touch() from public, anon, authenticated;
drop trigger if exists action_touch on intel.action;
create trigger action_touch before update on intel.action
  for each row execute function intel.tg_action_touch();

-- ---------------------------------------------------------------------------
-- Authorisation model for the RPCs below (mirrors Kammandor platform Role
-- Model v2 — see CLAUDE.md "Facts": super_admin / owner / admin / executive /
-- accountant / user), copied verbatim in structure from
-- migrations/intel/0012_approve_reject_proposed_edit.sql:
--   - Caller must be authenticated (auth.uid() is not null; anon has no
--     JWT app_metadata and is rejected by the null checks below).
--   - Caller's organisation (auth.jwt()->'app_metadata'->>'organization_id')
--     must be non-null AND exactly equal the target action.tenant_id,
--     with ONE exception (mirrors migrations/intel/0031): a super_admin
--     whose organisation has is_platform = true may review cross-tenant.
--     Every other cross-tenant caller is hard-denied.
--   - Caller's role (auth.jwt()->'app_metadata'->>'cp_role') must be one of
--     the approver set: super_admin, owner, admin, executive.
--     (accountant / user are excluded — read-only / non-approving roles.)
-- Any failure raises an exception (hard deny) rather than silently
-- returning — callers see a clear Postgres error, and no row changes.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- intel.approve_action
-- ---------------------------------------------------------------------------
create or replace function intel.approve_action(p_action_id uuid)
returns intel.action
language plpgsql
security definer
set search_path = intel, public, pg_temp
as $$
declare
  v_action      intel.action%rowtype;
  v_caller_org  uuid;
  v_caller_role text;
begin
  -- ---- Authz: resolve caller org + role from the JWT (never trust input) ----
  v_caller_org  := nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
  v_caller_role := auth.jwt() -> 'app_metadata' ->> 'cp_role';

  -- ---- Load target row FIRST so we can check tenant match; not-found is a deny ----
  select * into v_action from intel.action where id = p_action_id;

  if not found then
    raise exception 'approve_action: action % not found', p_action_id
      using errcode = 'no_data_found';
  end if;

  -- ---- Hard authz gate: non-null caller org, exact tenant match, approver role ----
  if v_caller_org is null then
    raise exception 'approve_action: denied — no authenticated organisation on caller JWT'
      using errcode = 'insufficient_privilege';
  end if;

  if v_caller_org <> v_action.tenant_id then
    -- Same cross-tenant rule as intel_0031: ONLY a super_admin of the
    -- platform organisation may review cross-tenant.
    if not (
      v_caller_role = 'super_admin'
      and exists (
        select 1 from public.organizations o
        where o.id = v_caller_org and o.is_platform = true
      )
    ) then
      raise exception 'approve_action: denied — caller organisation does not match action tenant'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if v_caller_role is null or v_caller_role not in ('super_admin', 'owner', 'admin', 'executive') then
    raise exception 'approve_action: denied — role % is not an approver', coalesce(v_caller_role, '<none>')
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- State guard: only rows awaiting approval can be approved ----
  if v_action.status <> 'awaiting_approval' then
    raise exception 'approve_action: denied — action % is not awaiting_approval (status=%)', p_action_id, v_action.status
      using errcode = 'invalid_parameter_value';
  end if;

  -- ---- Apply the write. Belt-and-braces status re-check guards against a ----
  -- ---- concurrent transition between the SELECT above and this UPDATE. ----
  update intel.action
  set status      = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at  = now()
  where id = p_action_id
    and status = 'awaiting_approval'
  returning * into v_action;

  if not found then
    raise exception 'approve_action: action % changed status concurrently — aborting', p_action_id
      using errcode = 'serialization_failure';
  end if;

  -- ---- intel.change_log (migrations/intel/0016) is deliberately NOT written ----
  -- ---- here. Its table_name column has a hard CHECK constraint restricted  ----
  -- ---- to ('entity','link'), and its row shape (before/after via           ----
  -- ---- to_jsonb(OLD)/(NEW) on intel.entity/intel.link triggers) is built   ----
  -- ---- for ontology-row versioning, not workflow-state transitions. An     ----
  -- ---- action approval doesn't fit that shape without widening the CHECK  ----
  -- ---- constraint — that is a decision for a further additive migration,  ----
  -- ---- not a guess made here. See _agent_reports/agent2_action_registry.md ----
  -- ---- for the full reasoning.                                            ----

  return v_action;
end;
$$;

comment on function intel.approve_action(uuid) is
  'GOVERNED: the sole path by which an intel.action row in ''awaiting_approval'' '
  'moves to ''approved''. SECURITY DEFINER — authz is enforced in-body against '
  'auth.jwt() app_metadata.organization_id (must equal the action''s tenant_id) '
  'and app_metadata.cp_role (must be one of super_admin/owner/admin/executive). '
  'Anonymous or cross-tenant callers, and non-approver roles, are rejected with '
  'an exception before any write occurs. Does NOT execute the action — see the '
  'migration header for executor scope (a later slice).';

-- ---------------------------------------------------------------------------
-- intel.reject_action
-- ---------------------------------------------------------------------------
create or replace function intel.reject_action(p_action_id uuid, p_reason text default null)
returns intel.action
language plpgsql
security definer
set search_path = intel, public, pg_temp
as $$
declare
  v_action      intel.action%rowtype;
  v_caller_org  uuid;
  v_caller_role text;
begin
  -- ---- Same authz model as approve_action — see its header comment. ----
  v_caller_org  := nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
  v_caller_role := auth.jwt() -> 'app_metadata' ->> 'cp_role';

  select * into v_action from intel.action where id = p_action_id;

  if not found then
    raise exception 'reject_action: action % not found', p_action_id
      using errcode = 'no_data_found';
  end if;

  if v_caller_org is null then
    raise exception 'reject_action: denied — no authenticated organisation on caller JWT'
      using errcode = 'insufficient_privilege';
  end if;

  if v_caller_org <> v_action.tenant_id then
    -- Same cross-tenant rule as intel_0031: ONLY a super_admin of the
    -- platform organisation may review cross-tenant.
    if not (
      v_caller_role = 'super_admin'
      and exists (
        select 1 from public.organizations o
        where o.id = v_caller_org and o.is_platform = true
      )
    ) then
      raise exception 'reject_action: denied — caller organisation does not match action tenant'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if v_caller_role is null or v_caller_role not in ('super_admin', 'owner', 'admin', 'executive') then
    raise exception 'reject_action: denied — role % is not an approver', coalesce(v_caller_role, '<none>')
      using errcode = 'insufficient_privilege';
  end if;

  if v_action.status <> 'awaiting_approval' then
    raise exception 'reject_action: denied — action % is not awaiting_approval (status=%)', p_action_id, v_action.status
      using errcode = 'invalid_parameter_value';
  end if;

  update intel.action
  set status     = 'rejected',
      error      = p_reason,
      updated_at = now()
  where id = p_action_id
    and status = 'awaiting_approval'
  returning * into v_action;

  if not found then
    raise exception 'reject_action: action % changed status concurrently — aborting', p_action_id
      using errcode = 'serialization_failure';
  end if;

  return v_action;
end;
$$;

comment on function intel.reject_action(uuid, text) is
  'GOVERNED: rejects an intel.action row in ''awaiting_approval''. Same authz '
  'model as intel.approve_action (tenant match + approver role, enforced '
  'in-body). p_reason is persisted to the action''s error column.';

-- ---------------------------------------------------------------------------
-- Grants — authz is enforced INSIDE the functions (SECURITY DEFINER body
-- above), so PostgreSQL-level EXECUTE grants are intentionally broad to
-- `authenticated`; anon gets nothing (mirrors migrations/intel/0012). Agents/
-- routes may only INSERT intel.action rows in status 'queued'/'awaiting_approval'
-- (via service_role from src/app/api/ontology/actions/route.ts) — these RPCs
-- are the ONLY approval paths.
-- ---------------------------------------------------------------------------
revoke all on function intel.approve_action(uuid) from public;
revoke all on function intel.approve_action(uuid) from anon;
grant execute on function intel.approve_action(uuid) to authenticated;

revoke all on function intel.reject_action(uuid, text) from public;
revoke all on function intel.reject_action(uuid, text) from anon;
grant execute on function intel.reject_action(uuid, text) to authenticated;
