/**
 * KINTEL — Source Registry
 * Central catalogue of all planned Phase-1 data sources.
 * Extend here; isSourceEnabled() in featureFlags.ts gates runtime activation.
 */

export type SourceTier = 'free' | 'premium' | 'byok';
export type SourceAuth = 'none' | 'platform-key' | 'tenant-key';
export type SourceRenderMode = 'map-layer' | 'panel' | 'enrichment';
export type LicenceClass = 'licensed' | 'public-attribution' | 'public-open' | 'proprietary';

export interface SourceDef {
  /** Stable machine key — used as feature-flag key and FK in intel schema */
  key: string;
  /** Human label shown in UI */
  label: string;
  /** Logical category for grouping */
  category: string;
  /** Billing tier: free = no cost; premium = platform pays; byok = tenant supplies key */
  tier: SourceTier;
  /**
   * Auth model:
   *  none          = public/keyless API
   *  platform-key  = key held by Kammandor platform (BYOK optional later)
   *  tenant-key    = tenant must supply their own credential
   */
  auth: SourceAuth;
  /** Primary presentation mode for this source */
  renderMode: SourceRenderMode;
  /** Whether this source is on by default (overridable by tenant flags) */
  enabledByDefault: boolean;
  /** Licence metadata per PRD v2.0 §13.2 — terms are verbatim from PRD §8.7, never invented */
  licence: { class: LicenceClass; terms: string; url?: string };
}

export const SOURCES: SourceDef[] = [
  {
    key: 'world-bank',
    label: 'World Bank Country Risk',
    category: 'risk',
    tier: 'free',
    auth: 'none',
    renderMode: 'map-layer',
    enabledByDefault: true,
    licence: { class: 'public-attribution', terms: 'CC-BY 4.0 (World Bank Open Data licence)' },
  },
  {
    key: 'gdelt',
    label: 'GDELT Geopolitical Events',
    category: 'geopolitical',
    tier: 'free',
    auth: 'none',
    renderMode: 'map-layer',
    enabledByDefault: true,
    licence: { class: 'public-open', terms: 'GDELT open-data terms (broadly permissive; verify commercial-redistribution nuance)' },
  },
  {
    key: 'markets-fx',
    label: 'FX & Markets Data',
    category: 'markets',
    // tier: 'premium' for paid providers (twelvedata/finnhub/alphavantage);
    // free ECB FX fallback available when MARKET_DATA_PROVIDER=ecb (default).
    tier: 'premium',
    // platform-key: key managed by Kammandor platform on paid plans;
    // tenant-key upgrade path available for BYOK providers.
    auth: 'platform-key',
    renderMode: 'panel',
    enabledByDefault: true,
    licence: { class: 'licensed', terms: 'Commercial licence — redistribution terms vary by vendor; verify before client-facing display' },
  },
  {
    key: 'reviews',
    label: 'Reviews & Sentiment',
    category: 'Reviews & Sentiment',
    // byok: tenant supplies their own platform key (Trustpilot, G2, Google, Yelp,
    //       or aggregator credentials); keyless App Store RSS available for dev.
    tier: 'byok',
    auth: 'tenant-key',
    renderMode: 'panel',
    enabledByDefault: false,
    licence: { class: 'licensed', terms: 'Aggregation layer — inherits the licence terms of each underlying review connector; verify per platform' },
  },
  {
    key: 'sec-edgar',
    label: 'SEC EDGAR Filings',
    category: 'corporate',
    tier: 'free',
    auth: 'none',
    renderMode: 'panel',
    enabledByDefault: false,
    licence: { class: 'public-open', terms: 'US public-domain / SEC terms of use' },
  },
  {
    key: 'companies-house',
    label: 'Companies House (UK)',
    category: 'corporate',
    tier: 'free',
    auth: 'platform-key',
    renderMode: 'panel',
    enabledByDefault: false,
    licence: { class: 'public-attribution', terms: 'UK Open Government Licence' },
  },
  {
    key: 'gleif',
    label: 'GLEIF Legal Entity Identifiers',
    category: 'corporate',
    tier: 'free',
    auth: 'none',
    renderMode: 'enrichment',
    enabledByDefault: true,
    licence: { class: 'public-open', terms: 'Open, CC0-equivalent (GLEIF terms)' },
  },
  {
    key: 'fred',
    label: 'FRED Macro & Economic Data',
    category: 'macro',
    tier: 'free',
    auth: 'platform-key',
    renderMode: 'panel',
    enabledByDefault: false,
    licence: { class: 'public-open', terms: 'US public-domain (FRED terms)' },
  },
  {
    key: 'un-comtrade',
    label: 'UN Comtrade Trade Flows',
    category: 'trade',
    tier: 'free',
    auth: 'platform-key',
    renderMode: 'map-layer',
    enabledByDefault: false,
    licence: { class: 'public-attribution', terms: 'UN Comtrade terms of use' },
  },
  {
    key: 'social',
    label: 'Social & People',
    category: 'Social & People',
    // byok: tenant supplies Bright Data API token + LinkedIn dataset IDs.
    // Returns raw LinkedIn/social profile data; personal data — GDPR sign-off required.
    tier: 'byok',
    auth: 'tenant-key',
    renderMode: 'panel',
    enabledByDefault: false,
    licence: { class: 'licensed', terms: 'Varies by platform — most restrict bulk redistribution; verify per-platform terms' },
  },
];

/** Lookup a source by its key. Returns undefined if not found. */
export function getSource(key: string): SourceDef | undefined {
  return SOURCES.find(s => s.key === key);
}
