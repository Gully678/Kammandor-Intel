-- 0014_approve_rpc_licence_propagation.sql
-- PRD v2.0 §13.2: the approve RPC now writes licence_class / licence_terms /
-- property_path on every intel.entity_provenance insert — taken from the
-- proposal payload when present, else defaulted from intel.sources by source_key.
--
-- Supersedes the FUNCTION BODY of intel.approve_proposed_edit from 0012 only.
-- The GOVERNANCE BOUNDARY is unchanged and re-stated:
--   intel.approve_proposed_edit() remains the SOLE governed writer to
--   intel.entity, intel.link and intel.entity_provenance. SECURITY DEFINER;
--   ALL authorisation enforced in-body against the caller's JWT claims
--   (organization_id tenant match, unconditional; cp_role in the approver set).
--   Do NOT relax the authz block. intel.reject_proposed_edit is NOT touched.
-- Only the three entity_provenance INSERT statements differ from 0012.

create or replace function intel.approve_proposed_edit(p_edit_id uuid)
returns uuid
language plpgsql
security definer
set search_path = intel, public, pg_temp
as $$
declare
  v_edit            intel.proposed_edit%rowtype;
  v_caller_org      uuid;
  v_caller_role     text;
  v_result_id       uuid;
  v_target_id       uuid;  -- target row id for update_entity/update_link
  v_patch           jsonb;
  v_provenance      jsonb;
  v_strength        jsonb;
  v_properties      jsonb;
begin
  -- ---- Authz: resolve caller org + role from the JWT (never trust input) ----
  v_caller_org  := nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
  v_caller_role := auth.jwt() -> 'app_metadata' ->> 'cp_role';

  -- ---- Load target row FIRST so we can check tenant match; not-found is a deny ----
  select * into v_edit from intel.proposed_edit where id = p_edit_id;

  if not found then
    raise exception 'approve_proposed_edit: proposed_edit % not found', p_edit_id
      using errcode = 'no_data_found';
  end if;

  -- ---- Hard authz gate: non-null caller org, exact tenant match, approver role ----
  if v_caller_org is null then
    raise exception 'approve_proposed_edit: denied — no authenticated organisation on caller JWT'
      using errcode = 'insufficient_privilege';
  end if;

  if v_caller_org <> v_edit.tenant_id then
    raise exception 'approve_proposed_edit: denied — caller organisation does not match proposed_edit tenant'
      using errcode = 'insufficient_privilege';
  end if;

  if v_caller_role is null or v_caller_role not in ('super_admin', 'owner', 'admin', 'executive') then
    raise exception 'approve_proposed_edit: denied — role % is not an approver', coalesce(v_caller_role, '<none>')
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- Idempotency / state guard: only pending edits can be approved ----
  if v_edit.status <> 'pending' then
    raise exception 'approve_proposed_edit: denied — proposed_edit % is not pending (status=%)', p_edit_id, v_edit.status
      using errcode = 'invalid_parameter_value';
  end if;

  if v_edit.kind = 'create_entity' then

    insert into intel.entity (
      tenant_id, type, canonical_name, properties, risk_score, risk_category,
      last_screened_at, lei, company_number, imo, mmsi, isin, wallet_address,
      jurisdiction_code
    )
    select
      v_edit.tenant_id,
      v_edit.payload ->> 'type',
      v_edit.payload ->> 'canonical_name',
      coalesce(v_edit.payload -> 'properties', '{}'::jsonb),
      nullif(v_edit.payload ->> 'risk_score', '')::numeric,
      v_edit.payload ->> 'risk_category',
      nullif(v_edit.payload ->> 'last_screened_at', '')::timestamptz,
      v_edit.payload ->> 'lei',
      v_edit.payload ->> 'company_number',
      v_edit.payload ->> 'imo',
      v_edit.payload ->> 'mmsi',
      v_edit.payload ->> 'isin',
      v_edit.payload ->> 'wallet_address',
      v_edit.payload ->> 'jurisdiction_code'
    returning id into v_result_id;

    -- Provenance (array shape) — licence fields from payload, else defaulted
    -- from intel.sources (0013). property_path is payload-only.
    if v_edit.payload ? 'provenance' and jsonb_typeof(v_edit.payload -> 'provenance') = 'array' then
      insert into intel.entity_provenance
        (entity_id, source_key, source_url, fetched_at, confidence, raw,
         licence_class, licence_terms, property_path)
      select
        v_result_id,
        prov ->> 'source_key',
        prov ->> 'source_url',
        coalesce(nullif(prov ->> 'fetched_at', '')::timestamptz, now()),
        nullif(prov ->> 'confidence', '')::numeric,
        prov -> 'raw',
        coalesce(prov ->> 'licence_class', s.licence_class),
        coalesce(prov ->> 'licence_terms', s.licence_terms),
        prov ->> 'property_path'
      from jsonb_array_elements(v_edit.payload -> 'provenance') as prov
      left join intel.sources s on s.key = prov ->> 'source_key'
      where prov ->> 'source_key' is not null;
    elsif v_edit.payload ? 'provenance' and jsonb_typeof(v_edit.payload -> 'provenance') = 'object' then
      -- Single provenance object rather than an array — accept both shapes.
      insert into intel.entity_provenance
        (entity_id, source_key, source_url, fetched_at, confidence, raw,
         licence_class, licence_terms, property_path)
      select
        v_result_id,
        x.p ->> 'source_key',
        x.p ->> 'source_url',
        coalesce(nullif(x.p ->> 'fetched_at', '')::timestamptz, now()),
        nullif(x.p ->> 'confidence', '')::numeric,
        x.p -> 'raw',
        coalesce(x.p ->> 'licence_class', s.licence_class),
        coalesce(x.p ->> 'licence_terms', s.licence_terms),
        x.p ->> 'property_path'
      from (select v_edit.payload -> 'provenance' as p) x
      left join intel.sources s on s.key = x.p ->> 'source_key'
      where x.p ->> 'source_key' is not null;
    end if;

  elsif v_edit.kind = 'create_link' then

    -- intel.link has NO 'strength' column (see migrations/intel/0006). If the
    -- payload carries a top-level `strength`, fold it into properties.strength
    -- instead of referencing a nonexistent column.
    v_properties := coalesce(v_edit.payload -> 'properties', '{}'::jsonb);
    if v_edit.payload ? 'strength' and v_edit.payload -> 'strength' is not null then
      v_properties := v_properties || jsonb_build_object('strength', v_edit.payload -> 'strength');
    end if;

    insert into intel.link (
      tenant_id, source_entity_id, target_entity_id, type, properties, valid_from, valid_to
    )
    values (
      v_edit.tenant_id,
      (v_edit.payload ->> 'source_entity_id')::uuid,
      (v_edit.payload ->> 'target_entity_id')::uuid,
      v_edit.payload ->> 'type',
      v_properties,
      nullif(v_edit.payload ->> 'valid_from', '')::timestamptz,
      nullif(v_edit.payload ->> 'valid_to', '')::timestamptz
    )
    returning id into v_result_id;

    -- Link provenance, attributed to the source entity — licence-aware as above.
    if v_edit.payload ? 'provenance' and jsonb_typeof(v_edit.payload -> 'provenance') = 'array' then
      insert into intel.entity_provenance
        (entity_id, source_key, source_url, fetched_at, confidence, raw,
         licence_class, licence_terms, property_path)
      select
        (v_edit.payload ->> 'source_entity_id')::uuid,
        prov ->> 'source_key',
        prov ->> 'source_url',
        coalesce(nullif(prov ->> 'fetched_at', '')::timestamptz, now()),
        nullif(prov ->> 'confidence', '')::numeric,
        prov -> 'raw',
        coalesce(prov ->> 'licence_class', s.licence_class),
        coalesce(prov ->> 'licence_terms', s.licence_terms),
        prov ->> 'property_path'
      from jsonb_array_elements(v_edit.payload -> 'provenance') as prov
      left join intel.sources s on s.key = prov ->> 'source_key'
      where prov ->> 'source_key' is not null;
    end if;

  elsif v_edit.kind = 'update_entity' then

    -- Payload shape from src/lib/ontology/propose.ts's proposeUpdate(): { id, patch }.
    v_target_id := (v_edit.payload ->> 'id')::uuid;
    v_patch     := coalesce(v_edit.payload -> 'patch', '{}'::jsonb);

    if v_target_id is null then
      raise exception 'approve_proposed_edit: update_entity payload missing "id"'
        using errcode = 'invalid_parameter_value';
    end if;

    update intel.entity set
      canonical_name    = coalesce(v_patch ->> 'canonical_name', canonical_name),
      properties        = case when v_patch ? 'properties'
                                then properties || (v_patch -> 'properties')
                                else properties end,
      risk_score        = case when v_patch ? 'risk_score'
                                then nullif(v_patch ->> 'risk_score', '')::numeric
                                else risk_score end,
      risk_category     = coalesce(v_patch ->> 'risk_category', risk_category),
      last_screened_at  = case when v_patch ? 'last_screened_at'
                                then nullif(v_patch ->> 'last_screened_at', '')::timestamptz
                                else last_screened_at end,
      lei               = coalesce(v_patch ->> 'lei', lei),
      company_number    = coalesce(v_patch ->> 'company_number', company_number),
      imo               = coalesce(v_patch ->> 'imo', imo),
      mmsi              = coalesce(v_patch ->> 'mmsi', mmsi),
      isin              = coalesce(v_patch ->> 'isin', isin),
      wallet_address    = coalesce(v_patch ->> 'wallet_address', wallet_address),
      jurisdiction_code = coalesce(v_patch ->> 'jurisdiction_code', jurisdiction_code),
      updated_at        = now()
    where id = v_target_id
      and tenant_id = v_edit.tenant_id  -- guard: never update a row outside the proposal's own tenant
    returning id into v_result_id;

    if v_result_id is null then
      raise exception 'approve_proposed_edit: update_entity target % not found in tenant %', v_target_id, v_edit.tenant_id
        using errcode = 'no_data_found';
    end if;

  elsif v_edit.kind = 'update_link' then

    -- Payload shape from src/lib/ontology/propose.ts's proposeUpdate(): { id, patch }.
    -- Here "id" is the target intel.link.id, not an entity id.
    v_target_id := (v_edit.payload ->> 'id')::uuid;
    v_patch     := coalesce(v_edit.payload -> 'patch', '{}'::jsonb);

    if v_target_id is null then
      raise exception 'approve_proposed_edit: update_link payload missing "id"'
        using errcode = 'invalid_parameter_value';
    end if;

    -- Same strength -> properties.strength folding as create_link, applied on top
    -- of any explicit properties patch.
    v_properties := case when v_patch ? 'properties' then v_patch -> 'properties' else null end;
    if v_patch ? 'strength' and v_patch -> 'strength' is not null then
      v_properties := coalesce(v_properties, '{}'::jsonb) || jsonb_build_object('strength', v_patch -> 'strength');
    end if;

    update intel.link set
      properties = case when v_properties is not null then properties || v_properties else properties end,
      valid_from = case when v_patch ? 'valid_from'
                         then nullif(v_patch ->> 'valid_from', '')::timestamptz
                         else valid_from end,
      valid_to   = case when v_patch ? 'valid_to'
                         then nullif(v_patch ->> 'valid_to', '')::timestamptz
                         else valid_to end
    where id = v_target_id
      and tenant_id = v_edit.tenant_id  -- guard: never update a row outside the proposal's own tenant
    returning id into v_result_id;

    if v_result_id is null then
      raise exception 'approve_proposed_edit: update_link target % not found in tenant %', v_target_id, v_edit.tenant_id
        using errcode = 'no_data_found';
    end if;

  else
    raise exception 'approve_proposed_edit: unknown proposed_edit kind "%"', v_edit.kind
      using errcode = 'invalid_parameter_value';
  end if;

  -- ---- Finalise: mark the proposal approved. Only reached if every write ----
  -- ---- above succeeded without raising. ----
  update intel.proposed_edit
  set status      = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_edit_id
    and status = 'pending';  -- belt-and-braces: re-check status hasn't moved concurrently

  if not found then
    raise exception 'approve_proposed_edit: proposed_edit % changed status concurrently — aborting', p_edit_id
      using errcode = 'serialization_failure';
  end if;

  return v_result_id;
end;
$$;

comment on function intel.approve_proposed_edit(uuid) is
  'GOVERNED WRITER: the sole path by which a pending intel.proposed_edit is '
  'materialised into intel.entity / intel.link / intel.entity_provenance. '
  'SECURITY DEFINER — authz is enforced in-body against auth.jwt() '
  'app_metadata.organization_id (must equal the edit''s tenant_id) and '
  'app_metadata.cp_role (must be one of super_admin/owner/admin/executive). '
  'Since 0014, every provenance write carries licence_class/licence_terms '
  '(payload value or intel.sources default) and optional property_path.';

-- Grants re-asserted (defence in depth; identical posture to 0012)
revoke all on function intel.approve_proposed_edit(uuid) from public;
revoke all on function intel.approve_proposed_edit(uuid) from anon;
grant execute on function intel.approve_proposed_edit(uuid) to authenticated;
