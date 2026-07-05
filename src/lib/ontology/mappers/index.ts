/**
 * KINTEL Phase 2 — Mapper registry
 * Maps source keys (matching intel.sources.key) to their mapper functions.
 * Import from here to get a unified dispatch table.
 */

import type { MapperResult } from './gleif';

import { mapGleifRecord }           from './gleif';
import { mapCompaniesHouseResponse } from './companies-house';
import { mapWorldBankCountry }      from './world-bank';
import { mapSecEdgarFiling }        from './sec-edgar';
import { mapGdeltEvent }            from './gdelt';
import { mapUnComtradeFlow }        from './un-comtrade';
import { mapMarketsInstrument }     from './markets';
import { mapReview }                from './reviews';
import { mapSocialPost }            from './social';
import { mapOfacSdnRecord }         from './ofac-sdn';

export type { MapperResult };

// Re-export individual mappers for direct use
export {
  mapGleifRecord,
  mapCompaniesHouseResponse,
  mapWorldBankCountry,
  mapSecEdgarFiling,
  mapGdeltEvent,
  mapUnComtradeFlow,
  mapMarketsInstrument,
  mapReview,
  mapSocialPost,
  mapOfacSdnRecord,
};

/** Unified mapper function signature */
export type MapperFn = (input: unknown, tenantId: string) => MapperResult;

/**
 * MAPPERS registry — keyed by source key (matches intel.sources.key).
 * Use for dynamic dispatch: MAPPERS['gleif'](rawData, tenantId)
 */
export const MAPPERS: Record<string, MapperFn> = {
  'gleif':           mapGleifRecord,
  'companies-house': mapCompaniesHouseResponse,
  'world-bank':      mapWorldBankCountry,
  'sec-edgar':       mapSecEdgarFiling,
  'gdelt':           mapGdeltEvent,
  'un-comtrade':     mapUnComtradeFlow,
  'markets-fx':      mapMarketsInstrument,
  'reviews':         mapReview,
  'social':          mapSocialPost,
  mapOfacSdnRecord,
};
