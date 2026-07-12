-- 0030_seed_kammandor_deals_source.sql
-- Mission A: register the first-party 'kammandor-deals' ontology source.
-- The Kammandor main app's deal graph (public.deals / companies / contacts /
-- km_counterparty_relationships — same Supabase project) is proposed into the
-- ontology through the governed pipeline: connector -> mapper ->
-- intel.proposed_edit -> human approve (intel.approve_proposed_edit, the sole
-- writer). This row provides the licence default that the approve RPC (0013+)
-- stamps onto every entity_provenance write for this source.
-- Additive + idempotent: on conflict (key) do nothing.

insert into intel.sources
  (key, label, category, tier, auth, render_mode, enabled_by_default,
   licence_class, licence_terms)
values
  ('kammandor-deals',
   'Kammandor Deal Graph',
   'corporate',
   'free',
   'none',
   'enrichment',
   true,
   'proprietary',
   'First-party tenant data from the Kammandor platform (deals, companies, contacts, counterparty relationships). Strictly Private & Confidential; tenant-scoped; no external licence applies.')
on conflict (key) do nothing;
