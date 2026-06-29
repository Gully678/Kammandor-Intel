-- KINTEL Phase 1 — Source usage & billing tracking
-- Records per-tenant, per-source API call counts and estimated USD cost per period.
-- This table is the data foundation for the bear-cost-vs-BYOK billing model:
--
--   BILLING MODEL INTENT
--   ────────────────────
--   Kammandor operates two bearer modes for API cost:
--
--   'platform'  — Kammandor's own API key is used. Cost accumulates against the
--                 platform account. Used for free-tier sources and premium sources
--                 where Kammandor absorbs the cost as part of the subscription.
--
--   'tenant'    — The tenant's own BYOK key is used (byok_secret_ref in
--                 tenant_source_flags). Cost accrues against the tenant's own
--                 API quota. est_cost_usd is still recorded for reporting and
--                 audit, but Kammandor does not charge for it.
--
--   At the end of each billing period, aggregate rows where bearer='platform'
--   to compute Kammandor's gross API cost per tenant. Rows where bearer='tenant'
--   are informational / audit only.
--
--   Future: a threshold rule (e.g. est_cost_usd > $X/month) can auto-suggest
--   that a tenant switches to BYOK to reduce their subscription tier price.

create schema if not exists intel;

create table if not exists intel.source_usage (
  id              bigserial   primary key,
  tenant_id       text        not null,
  source_key      text        not null references intel.sources (key) on delete restrict,
  -- Billing period — truncated to month start (date('now', 'start of month') equivalent)
  period          date        not null,
  call_count      integer     not null default 0 check (call_count >= 0),
  -- Estimated USD cost for this tenant+source+period. May be 0.00 for keyless sources.
  est_cost_usd    numeric(12,6) not null default 0.000000,
  -- Which party bore the API cost for these calls (see BILLING MODEL INTENT above)
  bearer          text        not null check (bearer in ('platform','tenant')),
  updated_at      timestamptz not null default now()
);

comment on table intel.source_usage is
  'Per-tenant, per-source, per-period API usage and estimated cost. '
  'Powers the bear-cost-vs-BYOK billing model. '
  'bearer=platform means Kammandor paid; bearer=tenant means the tenant''s own BYOK key was used.';

comment on column intel.source_usage.period is
  'First day of the billing period (month granularity). '
  'E.g. 2026-06-01 covers all calls in June 2026. '
  'Use date_trunc(''month'', now()) when upserting.';

comment on column intel.source_usage.est_cost_usd is
  'Estimated USD cost calculated from the source''s per-call rate at time of recording. '
  'Precision to 6 decimal places to handle sub-cent API costs (e.g. World Bank = $0). '
  'Informational for free-tier sources; billable for premium sources.';

comment on column intel.source_usage.bearer is
  'platform = Kammandor''s API key was used (cost borne by platform). '
  'tenant   = Tenant''s BYOK key was used (cost borne by tenant, informational only).';

-- Unique constraint: one row per tenant+source+period+bearer
create unique index if not exists uidx_source_usage_period
  on intel.source_usage (tenant_id, source_key, period, bearer);

-- Partial index: fast roll-up of platform-borne costs for billing
create index if not exists idx_source_usage_platform_billing
  on intel.source_usage (tenant_id, period)
  where bearer = 'platform';

-- Enable RLS
alter table intel.source_usage enable row level security;
