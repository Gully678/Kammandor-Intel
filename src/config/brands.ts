// ═══════════════════════════════════════════════════════════════
// Kammandor Intel — Multi-Brand Registry
// Engine: Kammandor Intel  |  White-label: INVRT Intel
//
// NOTE: INVRT tokens are placeholders — refine with INVRT brand assets.
// ═══════════════════════════════════════════════════════════════

export interface BrandColors {
  ink: string;
  page: string;
  card: string;
  cardBorder: string;
  gold: string;        // primary accent (named 'gold' for CSS-var compatibility)
  goldDeep: string;
  goldText: string;
  onInk: string;
  muted: string;
  live: string;
}

export interface Brand {
  key: string;
  name: string;
  short: string;
  domain: string;
  url: string;
  tagline: string;
  description: string;
  twitter: string | null;
  colors: BrandColors;
  fonts: { serif: string; sans: string; mono: string };
}

export const BRANDS: Record<'kammandor' | 'invrt', Brand> = {
  // ── Default: Kammandor Intel (exact originals — do not alter tokens) ──
  kammandor: {
    key: 'kammandor',
    name: 'Kammandor Intel',
    short: 'Kammandor',
    domain: 'intel.kammandor.com',
    url: 'https://intel.kammandor.com',
    tagline: 'Live investment intelligence',
    description:
      'Real-time open-source intelligence for private capital — deals, counterparties, sanctions, markets and risk.',
    twitter: null,
    colors: {
      ink: '#16141C',
      page: '#ECE5D7',
      card: '#FFFDF8',
      cardBorder: '#EAE2D2',
      gold: '#E8A020',
      goldDeep: '#C47D0E',
      goldText: '#9A7B1C',
      onInk: '#FAF6EE',
      muted: '#6F665D',
      live: '#0E9F6E',
    },
    fonts: { serif: 'Instrument Serif', sans: 'DM Sans', mono: 'DM Mono' },
  },

  // ── White-label: INVRT Intel ──
  // NOTE: INVRT tokens are placeholders — refine with INVRT brand assets.
  invrt: {
    key: 'invrt',
    name: 'INVRT Intel',
    short: 'INVRT',
    domain: 'intel.invrt.com',
    url: 'https://intel.invrt.com',
    tagline: 'Precision intelligence for marketing capital',
    description:
      'Institutional-grade market and counterparty intelligence for the modern investment professional.',
    twitter: null,
    colors: {
      ink: '#16141C',       // same neutral base for consistency
      page: '#ECE5D7',      // same neutral base
      card: '#FFFDF8',
      cardBorder: '#E2E8EA',
      gold: '#0E7C86',      // INVRT accent: deep teal (replaces gold)
      goldDeep: '#0A5E66',
      goldText: '#0D6B74',
      onInk: '#F0F8F9',
      muted: '#5E6B6D',
      live: '#0E9F6E',
    },
    fonts: { serif: 'Instrument Serif', sans: 'DM Sans', mono: 'DM Mono' },
  },
};

/**
 * Returns the Brand for the given key, falling back to kammandor.
 */
export function getBrand(key?: string): Brand {
  if (key && key in BRANDS) return BRANDS[key as 'kammandor' | 'invrt'];
  return BRANDS.kammandor;
}

/**
 * Maps a raw ?theme= / tenant / INTEL_BRAND value to a known brand key.
 * Defaults to 'kammandor'.
 */
export function resolveBrandKey(input?: string): 'kammandor' | 'invrt' {
  if (!input) return 'kammandor';
  const normalised = input.trim().toLowerCase();
  if (normalised in BRANDS) return normalised as 'kammandor' | 'invrt';
  return 'kammandor';
}
