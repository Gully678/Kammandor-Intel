/**
 * KINTEL Phase 2 — Entity resolution helpers
 * Stable key derivation and deduplication logic.
 * No DB access — pure functions safe to use in any context.
 */

import type { Entity } from './types';

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------

/**
 * Pick the strongest stable identifier for an entity.
 * Priority: lei > company_number > imo > isin > wallet_address > jurisdiction_code
 * Returns null when no identifier is set.
 */
export function resolveEntityKey(entity: Entity): string | null {
  if (entity.lei)              return `lei:${entity.lei}`;
  if (entity.company_number)   return `cn:${entity.company_number}`;
  if (entity.imo)              return `imo:${entity.imo}`;
  if (entity.isin)             return `isin:${entity.isin}`;
  if (entity.wallet_address)   return `wallet:${entity.wallet_address}`;
  if (entity.jurisdiction_code) return `jur:${entity.jurisdiction_code}`;
  return null;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Merge a list of Entity objects by resolved key.
 * When two entities share the same key, the later one (higher array index) wins
 * for all scalar fields, while `properties` is deeply merged (later wins on conflict).
 * Entities with no resolvable key are kept as-is (no deduplication possible).
 */
export function dedupeEntities(entities: Entity[]): Entity[] {
  const keyed = new Map<string, Entity>();
  const unkeyed: Entity[] = [];

  for (const entity of entities) {
    const key = resolveEntityKey(entity);
    if (key === null) {
      unkeyed.push(entity);
      continue;
    }

    const existing = keyed.get(key);
    if (!existing) {
      keyed.set(key, entity);
    } else {
      // Merge: scalar fields from the newer entity win; properties deep-merge
      keyed.set(key, {
        ...existing,
        ...entity,
        properties: {
          ...existing.properties,
          ...entity.properties,
        },
      });
    }
  }

  return [...keyed.values(), ...unkeyed];
}
