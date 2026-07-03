-- Kammandor Intel — migration intel/0011
-- Reconcile intel.sources with the code registry (src/config/sources.ts):
-- add the two missing source rows ('reviews','social'). Additive + idempotent.
-- Applied to live DB as migration `intel_0011_seed_reviews_social_sources`.
insert into intel.sources (key, label, category, tier, auth, render_mode, enabled_by_default)
values
  ('reviews', 'Reviews & Sentiment', 'Reviews & Sentiment', 'byok', 'tenant-key', 'panel', false),
  ('social',  'Social & People',     'Social & People',     'byok', 'tenant-key', 'panel', false)
on conflict (key) do nothing;
