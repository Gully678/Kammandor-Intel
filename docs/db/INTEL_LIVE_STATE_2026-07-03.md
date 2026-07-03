# INTEL LIVE STATE — DDL parity snapshot (2026-07-03)

Strictly Private & Confidential — INVRT / Pitt Family Office.
Read-only snapshot of the live `intel` schema on Supabase `ucbnnhfttahmqhvccvyw`, taken by the v2 orchestrator before migration `0013`. Closes audit finding F-1 (AUDIT_REPORT_v2.md): the early intel work was applied as *named* migrations that do not map 1:1 to repo files `0001–0010`. From `0013` onward, committed file == applied SQL, no exceptions.

## Live migration names → repo files

| Applied migration (live) | Version | Repo file(s) |
|---|---|---|
| `intel_phase1_2_schema` | 20260630011643 | `0001_source_registry.sql`, `0002_tenant_source_flags.sql`, `0003_source_usage.sql`, `0005_ontology_entity.sql`, `0006_ontology_link.sql`, `0007_ontology_crosswalk.sql`, `0008_ontology_provenance.sql`, `0009_ontology_proposed_edit.sql` (bundled) |
| `intel_vault_get_secret_rpc` | 20260630011712 | `0004_vault_get_secret_rpc.sql` |
| `intel_enable_rls_sources_crosswalk` | 20260630011833 | `0010_enable_rls_sources_crosswalk.sql` |
| `kammandor_intel_watchlist_alerts_briefings` | 20260630031438 | (public-schema objects: `km_monitoring_config`, `intelligence_alerts`, `daily_briefings` — shared with main app) |
| `intel_rls_tenant_policies` | 20260630031612 | **no repo file** — policies captured verbatim below |
| `intel_0011_seed_reviews_social_sources` | 20260703015250 | `0011_seed_reviews_social_sources.sql` |
| `intel_0012_approve_reject_proposed_edit` | 20260703022441 | `0012_approve_reject_proposed_edit.sql` |

## Live RLS policies (pg_policies, schema `intel`)

| Table | Policy | Cmd | Roles |
|---|---|---|---|
| entity | entity_isolation | ALL | {public} |
| entity_crosswalk | entity_crosswalk_isolation | ALL | {public} |
| entity_provenance | entity_provenance_isolation | ALL | {public} |
| link | link_isolation | ALL | {public} |
| proposed_edit | proposed_edit_isolation | ALL | {public} |
| source_usage | source_usage_isolation | ALL | {public} |
| sources | sources_read_authenticated | SELECT | {authenticated} |
| tenant_source_flags | tenant_source_flags_isolation | ALL | {public} |

All 8 tables have RLS enabled. No table-level grants to anon/authenticated/public exist on any intel table; writes to entity/link/entity_provenance are possible only via `intel.approve_proposed_edit` (SECURITY DEFINER, EXECUTE = {authenticated, postgres}).

## Live columns (information_schema, pre-0013)

- **entity**: id uuid NN; tenant_id uuid NN; type text NN; canonical_name text; properties jsonb NN; risk_score numeric; risk_category text; last_screened_at tz; lei text; company_number text; imo text; mmsi text; isin text; wallet_address text; jurisdiction_code text; created_at tz NN; updated_at tz NN
- **entity_crosswalk**: entity_id uuid NN; km_deal_id uuid; company_id uuid; contact_id uuid; party_profile_id uuid
- **entity_provenance**: id uuid NN; entity_id uuid NN; source_key text NN; source_url text; fetched_at tz NN; confidence numeric; raw jsonb
- **link**: id uuid NN; tenant_id uuid NN; source_entity_id uuid NN; target_entity_id uuid NN; type text NN; properties jsonb NN; valid_from tz; valid_to tz; created_at tz NN
- **proposed_edit**: id uuid NN; tenant_id uuid NN; kind text NN; payload jsonb NN; proposed_by text NN; rationale text; status text NN; reviewed_by uuid; reviewed_at tz; created_at tz NN
- **source_usage**: id bigint NN; tenant_id text NN; source_key text NN; period date NN; call_count int NN; est_cost_usd numeric NN; bearer text NN; updated_at tz NN
- **sources**: key text NN; label text NN; category text NN; tier text NN; auth text NN; render_mode text NN; enabled_by_default bool NN; created_at tz NN
- **tenant_source_flags**: tenant_id text NN; source_key text NN; enabled bool NN; auth_mode text NN; byok_secret_ref text; updated_at tz NN

Row counts at snapshot: sources=10; all other intel tables 0. Advisors: 6 WARN, all main-app track; intel clean.
