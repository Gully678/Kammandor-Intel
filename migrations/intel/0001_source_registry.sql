-- KINTEL Phase 1 — Source registry
-- Creates the intel schema and the canonical source catalogue table.
-- Mirrors src/config/sources.ts; seeded from that file via a sync script (future).

create schema if not exists intel;

create table if not exists intel.sources (
  key                text        primary key,
  label              text        not null,
  category           text        not null,
  tier               text        not null check (tier in ('free','premium','byok')),
  auth               text        not null check (auth in ('none','platform-key','tenant-key')),
  render_mode        text        not null check (render_mode in ('map-layer','panel','enrichment')),
  enabled_by_default boolean     not null default false,
  created_at         timestamptz not null default now()
);

comment on table intel.sources is
  'Canonical registry of all Phase-1 data sources. '
  'Mirrors src/config/sources.ts; this table is the authoritative copy for runtime '
  'and billing logic once the platform moves beyond env-var feature flags.';

comment on column intel.sources.tier is
  'Billing tier: free = no platform cost; premium = Kammandor absorbs API cost; '
  'byok = tenant must supply their own credential / quota.';

comment on column intel.sources.auth is
  'Auth model at the platform level: none = public keyless API; '
  'platform-key = key held by Kammandor; tenant-key = tenant supplies credential.';

-- Seed Phase-1 sources (idempotent on re-run)
insert into intel.sources (key, label, category, tier, auth, render_mode, enabled_by_default) values
  ('world-bank',      'World Bank Country Risk',           'risk',        'free', 'none',         'map-layer',  true),
  ('gdelt',           'GDELT Geopolitical Events',          'geopolitical','free', 'none',         'map-layer',  true),
  ('markets-fx',      'FX & Markets Data',                  'markets',     'free', 'platform-key', 'map-layer',  true),
  ('sec-edgar',       'SEC EDGAR Filings',                  'corporate',   'free', 'none',         'panel',      false),
  ('companies-house', 'Companies House (UK)',                'corporate',   'free', 'platform-key', 'panel',      false),
  ('gleif',           'GLEIF Legal Entity Identifiers',      'corporate',   'free', 'none',         'enrichment', true),
  ('fred',            'FRED Macro & Economic Data',          'macro',       'free', 'platform-key', 'panel',      false),
  ('un-comtrade',     'UN Comtrade Trade Flows',             'trade',       'free', 'platform-key', 'map-layer',  false)
on conflict (key) do update set
  label              = excluded.label,
  category           = excluded.category,
  tier               = excluded.tier,
  auth               = excluded.auth,
  render_mode        = excluded.render_mode,
  enabled_by_default = excluded.enabled_by_default;
