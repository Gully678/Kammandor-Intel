import { describe, expect, it } from 'vitest';

import { ENTITY_TYPES, LINK_TYPE_CATALOGUE } from '@/lib/ontology/types';

const EXPECTED_ENTITY_TYPES = [
  // v1 (14)
  'company',
  'person',
  'fund',
  'deal',
  'vessel',
  'port',
  'wallet',
  'sanction',
  'filing',
  'event',
  'asset',
  'jurisdiction',
  'news_source',
  'instrument',
  // v2 additions (8) — migration intel_0016
  'document',
  'market_event',
  'trend',
  'mention',
  'campaign',
  'contact',
  'review',
  'competitor_signal',
] as const;

const EXPECTED_LINK_TYPE_KEYS = [
  'deal_company',
  'deal_person',
  'instrument_deal',
  'vessel_deal',
  'person_sanction',
  'event_company',
  'company_mention',
  'contact_campaign',
  'market_event_company',
] as const;

describe('ENTITY_TYPES catalogue (mirrors intel.entity type CHECK, migrations 0016)', () => {
  it('contains exactly the 22 entity types', () => {
    expect([...ENTITY_TYPES].sort()).toEqual([...EXPECTED_ENTITY_TYPES].sort());
    expect(ENTITY_TYPES).toHaveLength(22);
  });

  it('has no duplicate entries', () => {
    expect(new Set(ENTITY_TYPES).size).toBe(ENTITY_TYPES.length);
  });
});

describe('LINK_TYPE_CATALOGUE (mirrors intel.link_type seed, migration intel_0017)', () => {
  it('has exactly the 9 seeded link type keys', () => {
    expect(Object.keys(LINK_TYPE_CATALOGUE).sort()).toEqual(
      [...EXPECTED_LINK_TYPE_KEYS].sort(),
    );
  });

  it('every entry is fully populated with a valid shape', () => {
    for (const [key, def] of Object.entries(LINK_TYPE_CATALOGUE)) {
      expect(def.key).toBe(key);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.sourceType.length).toBeGreaterThan(0);
      expect(def.targetType.length).toBeGreaterThan(0);
      expect(['foreign-key', 'many-to-many']).toContain(def.shape);
    }
  });
});
