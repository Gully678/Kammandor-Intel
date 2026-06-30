/**
 * KINTEL Phase 2 — Ontology registry
 * Human-readable metadata for every ObjectType and LinkType.
 * Used by UI pickers, validation messages, and documentation generators.
 */

import type { ObjectType, LinkType } from './types';

// ---------------------------------------------------------------------------
// Object type registry
// ---------------------------------------------------------------------------

export interface ObjectTypeMeta {
  value:       ObjectType;
  label:       string;
  description: string;
}

export const OBJECT_TYPES: ObjectTypeMeta[] = [
  {
    value:       'company',
    label:       'Company',
    description: 'Incorporated legal entity (ltd, plc, LLC, GmbH, etc.)',
  },
  {
    value:       'person',
    label:       'Person',
    description: 'Natural person — director, officer, UBO, shareholder, or individual counterparty',
  },
  {
    value:       'fund',
    label:       'Fund',
    description: 'Investment fund, LP, or collective vehicle',
  },
  {
    value:       'deal',
    label:       'Deal',
    description: 'Transaction, financing, M&A, or trade deal tracked in the platform',
  },
  {
    value:       'vessel',
    label:       'Vessel',
    description: 'Ship or watercraft identified by IMO / MMSI',
  },
  {
    value:       'port',
    label:       'Port',
    description: 'Maritime port or terminal',
  },
  {
    value:       'wallet',
    label:       'Crypto Wallet',
    description: 'Blockchain wallet address (any chain)',
  },
  {
    value:       'sanction',
    label:       'Sanction Listing',
    description: 'OFAC, EU, UN, or other sanctions-list entry',
  },
  {
    value:       'filing',
    label:       'Filing',
    description: 'Regulatory or corporate filing (SEC 10-K, CH confirmation statement, etc.)',
  },
  {
    value:       'event',
    label:       'Event',
    description: 'Geopolitical or news event (GDELT, ACLED, etc.)',
  },
  {
    value:       'asset',
    label:       'Asset',
    description: 'Physical or financial asset (real estate, aircraft, securities holding)',
  },
  {
    value:       'jurisdiction',
    label:       'Jurisdiction',
    description: 'Country, territory, or regulatory zone (ISO 3166)',
  },
  {
    value:       'news_source',
    label:       'News Source',
    description: 'Media outlet or publication tracked for monitoring',
  },
  {
    value:       'instrument',
    label:       'Financial Instrument',
    description: 'Security, derivative, FX pair, or commodity contract (ISIN / ticker)',
  },
];

// ---------------------------------------------------------------------------
// Link type registry
// ---------------------------------------------------------------------------

export interface LinkTypeMeta {
  value:               LinkType;
  label:               string;
  allowedSourceTypes:  ObjectType[];
  allowedTargetTypes:  ObjectType[];
}

export const LINK_TYPES: LinkTypeMeta[] = [
  {
    value:              'isDirectorOf',
    label:              'Is Director Of',
    allowedSourceTypes: ['person'],
    allowedTargetTypes: ['company', 'fund'],
  },
  {
    value:              'beneficialOwnerOf',
    label:              'Beneficial Owner Of',
    allowedSourceTypes: ['person', 'company', 'fund'],
    allowedTargetTypes: ['company', 'fund', 'asset'],
  },
  {
    value:              'shareholderOf',
    label:              'Shareholder Of',
    allowedSourceTypes: ['person', 'company', 'fund'],
    allowedTargetTypes: ['company', 'fund'],
  },
  {
    value:              'subsidiaryOf',
    label:              'Subsidiary Of',
    allowedSourceTypes: ['company', 'fund'],
    allowedTargetTypes: ['company', 'fund'],
  },
  {
    value:              'isNamedInDeal',
    label:              'Is Named In Deal',
    allowedSourceTypes: ['company', 'person', 'fund'],
    allowedTargetTypes: ['deal'],
  },
  {
    value:              'isSubjectOf',
    label:              'Is Subject Of',
    allowedSourceTypes: ['company', 'person', 'vessel', 'fund'],
    allowedTargetTypes: ['sanction', 'filing', 'event'],
  },
  {
    value:              'registeredIn',
    label:              'Registered In',
    allowedSourceTypes: ['company', 'fund', 'vessel'],
    allowedTargetTypes: ['jurisdiction'],
  },
  {
    value:              'filedWith',
    label:              'Filed With',
    allowedSourceTypes: ['filing'],
    allowedTargetTypes: ['company'],
  },
  {
    value:              'portCallAt',
    label:              'Port Call At',
    allowedSourceTypes: ['vessel'],
    allowedTargetTypes: ['port'],
  },
  {
    value:              'linkedWallet',
    label:              'Linked Wallet',
    allowedSourceTypes: ['company', 'person'],
    allowedTargetTypes: ['wallet'],
  },
  {
    value:              'mentionedInEvent',
    label:              'Mentioned In Event',
    allowedSourceTypes: ['company', 'person', 'vessel'],
    allowedTargetTypes: ['event'],
  },
  {
    value:              'connectedJurisdiction',
    label:              'Connected Jurisdiction',
    allowedSourceTypes: ['company', 'person', 'fund', 'deal'],
    allowedTargetTypes: ['jurisdiction'],
  },
  {
    value:              'ownsAsset',
    label:              'Owns Asset',
    allowedSourceTypes: ['company', 'person', 'fund'],
    allowedTargetTypes: ['asset', 'vessel'],
  },
  {
    value:              'pricedBy',
    label:              'Priced By',
    allowedSourceTypes: ['asset', 'instrument'],
    allowedTargetTypes: ['instrument'],
  },
];
