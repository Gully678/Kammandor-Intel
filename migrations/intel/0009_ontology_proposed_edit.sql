-- Deliverable — apply with oversight; not applied by the build agent.
-- KINTEL Phase 2 — Ontology: intel.proposed_edit
--
-- AIP-style governed write queue.
-- LLM/agent proposes; human approves; only then applied — no direct model writes.
--
-- Governance boundary:
--   1. An LLM or automated agent constructs a ProposedEdit payload and inserts a row
--      with status='pending'. The agent NEVER writes directly to intel.entity or
--      intel.link.
--   2. A human reviewer approves (status→'approved') or rejects (status→'rejected').
--   3. An application-layer job reads approved rows and applies them transactionally,
--      then sets status→'applied'.
--
-- This table is intentionally append-heavy; rows are never deleted (audit trail).

create schema if not exists intel;

create table if not exists intel.proposed_edit (
  id            uuid    primary key default gen_random_uuid(),
  tenant_id     uuid    not null references public.organizations(id) on delete cascade,

  -- What kind of write is being proposed
  kind          text    not null check (kind in (
    'create_entity',
    'update_entity',
    'create_link',
    'update_link'
  )),

  -- Full payload required to execute the edit (entity/link fields as JSON)
  payload       jsonb   not null,

  -- Identity of the proposer (e.g. 'gleif-enrichment-job', 'gpt-4o', user email)
  proposed_by   text    not null,

  -- Human-readable justification for the proposed change
  rationale     text,

  -- Workflow status
  status        text    not null default 'pending' check (status in (
    'pending',
    'approved',
    'rejected',
    'applied'
  )),

  -- Reviewer identity and timestamp (populated when status changes from pending)
  reviewed_by   uuid,
  reviewed_at   timestamptz,

  created_at    timestamptz not null default now()
);

-- Indexes for the review workflow
create index if not exists proposed_edit_tenant_status_idx
  on intel.proposed_edit (tenant_id, status);
create index if not exists proposed_edit_created_idx
  on intel.proposed_edit (created_at desc);

-- Enable Row-Level Security
alter table intel.proposed_edit enable row level security;

-- Example policy (adjust to your auth model):
--
--   create policy "tenant_isolation" on intel.proposed_edit
--     using (tenant_id = (select org_id from public.org_members where user_id = auth.uid() limit 1));

comment on table intel.proposed_edit is
  'AIP-style governed write queue. '
  'LLM/agent proposes edits; human approves; only then applied — '
  'no direct model writes to intel.entity or intel.link. '
  'Append-only: rows are never deleted (full audit trail).';
