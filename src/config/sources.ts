/**
 * KINTEL — Source Registry
 * Central catalogue of all planned Phase-1 data sources.
 * Extend here; isSourceEnabled() in featureFlags.ts gates runtime activation.
 */

export type SourceTier = 'free' | 'premium' | 'byok';
export type SourceAuth = 'none' | 'platform-key' | 'tenant-key';
export type SourceRenderMode = 'map-layer' | 'panel' | 'enrichment';

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
  },
  {
    key: 'gdelt',
    label: 'GDELT Geopolitical Events',
    category: 'geopolitical',
    tier: 'free',
    auth: 'none',
    renderMode: 'map-layer',
    enabledByDefault: true,
  },
  {
    key: 'markets-fx',
    label: 'FX & Markets Data',
    category: 'markets',
    tier: 'free',
    auth: 'platform-key',
    renderMode: 'map-layer',
    enabledByDefault: true,
  },
  {
    key: 'sec-edgar',
    label: 'SEC EDGAR Filings',
    category: 'corporate',
    tier: 'free',
    auth: 'none',
    renderMode: 'panel',
    enabledByDefault: false,
  },
  {
    key: 'companies-house',
    label: 'Companies House (UK)',
    category: 'corporate',
    tier: 'free',
    auth: 'platform-key',
    renderMode: 'panel',
    enabledByDefault: false,
  },
  {
    key: 'gleif',
    label: 'GLEIF Legal Entity Identifiers',
    category: 'corporate',
    tier: 'free',
    auth: 'none',
    renderMode: 'enrichment',
    enabledByDefault: true,
  },
  {
    key: 'fred',
    label: 'FRED Macro & Economic Data',
    category: 'macro',
    tier: 'free',
    auth: 'platform-key',
    renderMode: 'panel',
    enabledByDefault: false,
  },
  {
    key: 'un-comtrade',
    label: 'UN Comtrade Trade Flows',
    category: 'trade',
    tier: 'free',
    auth: 'platform-key',
    renderMode: 'map-layer',
    enabledByDefault: false,
  },
];

/** Lookup a source by its key. Returns undefined if not found. */
export function getSource(key: string): SourceDef | undefined {
  return SOURCES.find(s => s.key === key);
}
