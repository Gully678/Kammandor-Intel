-- intel_0024_sanctions_entity_alert
-- WS-1 "governed entity + sanctions signal": when a sanctions-category entity is
-- HUMAN-APPROVED into the governed ontology (intel.entity is written ONLY by
-- intel.approve_proposed_edit), surface an informational CRITICAL alert on the
-- tenant's dashboard feed (public.intelligence_alerts) + the /api/ai/stream SSE.
--
-- GOVERNANCE: HITL by construction (fires only on the human-approved entity
-- insert). severity is a DETERMINISTIC rule ('CRITICAL' for sanctions) — never
-- LLM-emitted. It is an informational SIGNAL with status 'open' for analyst
-- triage — it NEVER auto-actions, blocks, or reports. Tenant-scoped
-- (organization_id = entity.tenant_id). Proven in a rolled-back transaction
-- (2026-07-12): sanctions approve -> 1 CRITICAL alert; non-sanctions approve -> 0.
-- Applied via Supabase MCP apply_migration.

create or replace function intel.tg_sanctions_entity_alert()
returns trigger
language plpgsql
security definer
set search_path to 'intel', 'public', 'pg_temp'
as $body$
begin
  insert into public.intelligence_alerts
    (id, organization_id, severity, headline, detail, source_url, status, created_at, updated_at)
  values (
    gen_random_uuid(),
    new.tenant_id,
    'CRITICAL',
    'Sanctions entity added: ' || coalesce(new.canonical_name, new.id::text),
    'Sanctions-category entity approved into the governed ontology (HITL). '
      || 'Informational signal — screening/matching is analyst-driven; never an auto-action.',
    null,
    'open',
    now(), now()
  );
  return new;
end
$body$;

revoke all on function intel.tg_sanctions_entity_alert() from public, anon, authenticated;

drop trigger if exists sanctions_entity_alert on intel.entity;
create trigger sanctions_entity_alert
  after insert on intel.entity
  for each row
  when (new.risk_category = 'sanctions')
  execute function intel.tg_sanctions_entity_alert();
