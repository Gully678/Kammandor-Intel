/**
 * KINTEL v2.4 — Vertical starter-packs (PRD §17.5; catalogue per PRD §7.9)
 *
 * A starter-pack lets a new tenant stand up a vertical workspace in minutes:
 * it names the ontology object/link types the vertical cares about and the
 * data sources to switch on. Provisioning (POST /api/tenant/starter-pack)
 * writes ONLY intel.tenant_source_flags — packs never touch the ontology
 * tables and never fabricate tenant data.
 *
 * GOVERNANCE
 * - objectTypes are a subset of ENTITY_TYPES (src/lib/ontology/types.ts).
 * - linkTypes are a subset of LINK_TYPE_CATALOGUE keys (same file).
 * - source keys are a subset of SOURCES keys (src/config/sources.ts).
 * - FOUNDER DECISION: only free-tier sources are enabled by default.
 *   Licensed / premium / BYOK sources are listed for visibility but always
 *   `enabled: false` until the tenant explicitly opts in (and, for BYOK,
 *   supplies their own credential).
 * - defaultWatchlistHints are ILLUSTRATIVE ONLY. The live watchlist lives
 *   per tenant in public.km_monitoring_config — never seed or invent
 *   tenant-specific terms here.
 *
 * Integrity is regression-tested in __tests__/starter-packs.test.ts.
 */

import type { ObjectType } from '@/lib/ontology/types';

export type StarterPackKey = 'finance' | 'marketing' | 'generic';

export interface StarterPackSource {
  /** Key into SOURCES (src/config/sources.ts) / intel.sources. */
  key: string;
  /** Default enablement written to intel.tenant_source_flags.enabled. */
  enabled: boolean;
}

export interface StarterPack {
  key: StarterPackKey;
  label: string;
  description: string;
  /** Subset of ENTITY_TYPES — the object types this vertical works with. */
  objectTypes: ObjectType[];
  /** Subset of LINK_TYPE_CATALOGUE keys — the relationship classes. */
  linkTypes: string[];
  /** Subset of SOURCES keys — free-tier only enabled by default. */
  sources: StarterPackSource[];
  /** Illustrative keywords only — real watchlists live in km_monitoring_config. */
  defaultWatchlistHints: { keywords: string[]; note: string };
}

const WATCHLIST_NOTE =
  'Illustrative examples only. The live watchlist is configured per tenant in ' +
  'km_monitoring_config (via the monitoring settings screen) — starter-packs ' +
  'never seed or fabricate tenant-specific watchlist data.';

export const STARTER_PACKS: Record<string, StarterPack> = {
  finance: {
    key: 'finance',
    label: 'Finance & Deals',
    description:
      'Counterparty, deal and instrument intelligence for family offices and ' +
      'physical-commodity brokerage: filings, sanctions exposure, vessels, ' +
      'macro and trade-flow context.',
    objectTypes: [
      'company',
      'person',
      'fund',
      'deal',
      'instrument',
      'vessel',
      'sanction',
      'filing',
      'event',
      'jurisdiction',
      'document',
    ],
    linkTypes: [
      'deal_company',
      'deal_person',
      'instrument_deal',
      'vessel_deal',
      'person_sanction',
      'event_company',
    ],
    sources: [
      { key: 'sec-edgar', enabled: true },
      { key: 'companies-house', enabled: true },
      { key: 'gleif', enabled: true },
      { key: 'fred', enabled: true },
      { key: 'world-bank', enabled: true },
      { key: 'un-comtrade', enabled: true },
      { key: 'gdelt', enabled: true },
      // Licensed market data — listed so the tenant can see the upgrade
      // path, but never enabled by default (founder decision).
      { key: 'markets-fx', enabled: false },
    ],
    defaultWatchlistHints: {
      keywords: ['sanctions', 'commodity', 'sukuk'],
      note: WATCHLIST_NOTE,
    },
  },
  marketing: {
    key: 'marketing',
    label: 'Marketing & Brand',
    description:
      'Brand, campaign and competitor intelligence: public mentions, review ' +
      'sentiment, market events and emerging trends around the tenant and ' +
      'its competitors.',
    objectTypes: [
      'company',
      'contact',
      'campaign',
      'mention',
      'review',
      'trend',
      'competitor_signal',
      'market_event',
    ],
    linkTypes: ['company_mention', 'contact_campaign', 'market_event_company'],
    sources: [
      { key: 'gdelt', enabled: true },
      // BYOK connectors — listed for visibility, disabled until the tenant
      // supplies their own credentials (tier: byok, auth: tenant-key).
      { key: 'reviews', enabled: false },
      { key: 'social', enabled: false },
    ],
    defaultWatchlistHints: {
      keywords: ['reviews', 'sentiment'],
      note: WATCHLIST_NOTE,
    },
  },
  generic: {
    key: 'generic',
    label: 'General Intelligence',
    description:
      'A neutral starting point: companies, people, documents and events with ' +
      'country-risk and geopolitical context. Grow into a vertical later.',
    objectTypes: ['company', 'person', 'event', 'document', 'jurisdiction', 'market_event'],
    linkTypes: ['event_company'],
    sources: [
      { key: 'world-bank', enabled: true },
      { key: 'gdelt', enabled: true },
    ],
    defaultWatchlistHints: {
      keywords: [],
      note: WATCHLIST_NOTE,
    },
  },
};

/** Lookup a starter-pack by its key. Returns undefined if not found. */
export function getStarterPack(key: string): StarterPack | undefined {
  return Object.prototype.hasOwnProperty.call(STARTER_PACKS, key)
    ? STARTER_PACKS[key]
    : undefined;
}
