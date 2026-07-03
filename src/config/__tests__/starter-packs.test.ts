/**
 * KINTEL v2.4 — Vertical starter-pack integrity tests (PRD §17.5, catalogue §7.9)
 *
 * Written FIRST (TDD). Guards the governance rules:
 *   - every pack objectType is a real ENTITY_TYPES member
 *   - every pack linkType is a real LINK_TYPE_CATALOGUE key
 *   - every pack source key is a real SOURCES key
 *   - licensed/non-free sources are NEVER enabled by default (founder decision)
 *   - packs never fabricate tenant-specific data (hints are illustrative only)
 */

import { describe, it, expect } from 'vitest';
import { STARTER_PACKS, getStarterPack } from '../starter-packs';
import type { StarterPack } from '../starter-packs';
import { ENTITY_TYPES, LINK_TYPE_CATALOGUE } from '@/lib/ontology/types';
import { SOURCES, getSource } from '@/config/sources';

const PACKS: StarterPack[] = Object.values(STARTER_PACKS);
const SOURCE_KEYS = new Set(SOURCES.map((s) => s.key));
const MARKETING_ONLY_TYPES = ['mention', 'campaign', 'contact', 'review', 'trend', 'competitor_signal'];

describe('STARTER_PACKS catalogue integrity', () => {
  it('exposes exactly the three verticals: finance, marketing, generic', () => {
    expect(Object.keys(STARTER_PACKS).sort()).toEqual(['finance', 'generic', 'marketing']);
    for (const [key, pack] of Object.entries(STARTER_PACKS)) {
      expect(pack.key).toBe(key);
      expect(pack.label.length).toBeGreaterThan(0);
      expect(pack.description.length).toBeGreaterThan(0);
    }
  });

  it('every objectType in every pack is a member of ENTITY_TYPES', () => {
    for (const pack of PACKS) {
      for (const t of pack.objectTypes) {
        expect(ENTITY_TYPES, `${pack.key}: unknown object type "${t}"`).toContain(t);
      }
    }
  });

  it('every linkType in every pack is a key of LINK_TYPE_CATALOGUE', () => {
    for (const pack of PACKS) {
      for (const lt of pack.linkTypes) {
        expect(
          Object.keys(LINK_TYPE_CATALOGUE),
          `${pack.key}: unknown link type "${lt}"`,
        ).toContain(lt);
      }
    }
  });

  it('every link type endpoint is covered by the pack objectTypes (coherent workspace)', () => {
    for (const pack of PACKS) {
      for (const lt of pack.linkTypes) {
        const def = LINK_TYPE_CATALOGUE[lt];
        expect(def).toBeDefined();
        expect(pack.objectTypes, `${pack.key}/${lt}: sourceType`).toContain(def!.sourceType);
        expect(pack.objectTypes, `${pack.key}/${lt}: targetType`).toContain(def!.targetType);
      }
    }
  });

  it('every source key in every pack exists in SOURCES, with no duplicates', () => {
    for (const pack of PACKS) {
      const keys = pack.sources.map((s) => s.key);
      expect(new Set(keys).size, `${pack.key}: duplicate source keys`).toBe(keys.length);
      for (const k of keys) {
        expect(SOURCE_KEYS.has(k), `${pack.key}: unknown source "${k}"`).toBe(true);
      }
    }
  });

  it('GOVERNANCE: licensed / non-free sources are never enabled:true by default', () => {
    for (const pack of PACKS) {
      for (const s of pack.sources) {
        if (!s.enabled) continue;
        const def = getSource(s.key);
        expect(def, `${pack.key}: source "${s.key}" missing from SOURCES`).toBeDefined();
        expect(def!.tier, `${pack.key}: non-free source "${s.key}" enabled by default`).toBe('free');
        expect(
          def!.licence.class,
          `${pack.key}: licensed source "${s.key}" enabled by default`,
        ).not.toBe('licensed');
      }
    }
  });

  it('finance pack has no marketing-only object types and no marketing link types', () => {
    const finance = STARTER_PACKS['finance']!;
    for (const t of MARKETING_ONLY_TYPES) {
      expect(finance.objectTypes).not.toContain(t);
    }
    for (const lt of finance.linkTypes) {
      expect(LINK_TYPE_CATALOGUE[lt]!.vertical).not.toBe('marketing');
    }
  });

  it('finance pack: the 7 free sources enabled, markets-fx listed but disabled', () => {
    const finance = STARTER_PACKS['finance']!;
    const enabled = finance.sources.filter((s) => s.enabled).map((s) => s.key).sort();
    expect(enabled).toEqual(
      ['companies-house', 'fred', 'gdelt', 'gleif', 'sec-edgar', 'un-comtrade', 'world-bank'].sort(),
    );
    expect(finance.sources.find((s) => s.key === 'markets-fx')).toEqual({
      key: 'markets-fx',
      enabled: false,
    });
  });

  it('marketing pack: gdelt enabled; reviews and social listed but disabled (BYOK)', () => {
    const marketing = STARTER_PACKS['marketing']!;
    expect(marketing.sources.find((s) => s.key === 'gdelt')).toEqual({ key: 'gdelt', enabled: true });
    expect(marketing.sources.find((s) => s.key === 'reviews')).toEqual({ key: 'reviews', enabled: false });
    expect(marketing.sources.find((s) => s.key === 'social')).toEqual({ key: 'social', enabled: false });
  });

  it('generic pack: world-bank + gdelt enabled and event_company is included', () => {
    const generic = STARTER_PACKS['generic']!;
    const enabled = generic.sources.filter((s) => s.enabled).map((s) => s.key).sort();
    expect(enabled).toEqual(['gdelt', 'world-bank']);
    expect(generic.linkTypes).toContain('event_company');
  });

  it('GOVERNANCE: watchlist hints are illustrative only — note points at km_monitoring_config', () => {
    for (const pack of PACKS) {
      expect(pack.defaultWatchlistHints.note).toContain('km_monitoring_config');
    }
    expect(STARTER_PACKS['finance']!.defaultWatchlistHints.keywords).toEqual([
      'sanctions', 'commodity', 'sukuk',
    ]);
    expect(STARTER_PACKS['marketing']!.defaultWatchlistHints.keywords).toEqual([
      'reviews', 'sentiment',
    ]);
    expect(STARTER_PACKS['generic']!.defaultWatchlistHints.keywords).toEqual([]);
  });

  it('getStarterPack returns packs by key and undefined for unknown keys', () => {
    expect(getStarterPack('finance')?.key).toBe('finance');
    expect(getStarterPack('nope')).toBeUndefined();
    expect(getStarterPack('')).toBeUndefined();
  });
});
