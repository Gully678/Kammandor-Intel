/**
 * KINTEL Phase 2 — Reviews / sentiment mapper
 * Transforms a single review record (Trustpilot, G2, App Store, Yelp, Google, etc.)
 * into an ontology Event entity.
 *
 * Source key: 'reviews'
 * API: provider-pluggable (see src/lib/reviews/index.ts)
 *
 * Input shape (single item from the route's `reviews[]` array):
 * { author, rating, text, date, platform, url }
 *
 * Raw sentiment is NOT computed here (contract boundary — Kammandor scores
 * from the `properties.rating`/`properties.text` raw fields); this mapper only
 * carries the provider's own numeric rating through as a property.
 *
 * No links are produced: a single review record carries no separate subject
 * entity (the reviewed brand/app) in this connector's per-item shape.
 */

import type { Entity, Provenance } from '../types';
import type { MapperResult } from './gleif';

export type { MapperResult };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function makeEntityBase(tenantId: string): Pick<Entity, 'tenant_id' | 'properties' | 'created_at' | 'updated_at'> {
  return { tenant_id: tenantId, properties: {}, created_at: now(), updated_at: now() };
}

function pseudoUuid(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(h).toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-000000000000`;
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

/**
 * Map a single review record to an ontology Event entity.
 *
 * Expected input shape:
 * {
 *   author:   string,
 *   rating:   number,   // 1–5 numeric scale
 *   text:     string,
 *   date:     string,   // ISO-8601
 *   platform: string,   // e.g. 'appstore', 'trustpilot', 'google', 'yelp', 'g2'
 *   url:      string,
 * }
 */
export function mapReview(input: unknown, tenantId: string): MapperResult {
  const row = (input as Record<string, unknown>) ?? {};

  const author:   string = typeof row.author   === 'string' ? row.author   : '';
  const rating:   number | undefined = typeof row.rating === 'number' && !isNaN(row.rating) ? row.rating : undefined;
  const text:     string = typeof row.text     === 'string' ? row.text     : '';
  const date:     string | undefined = typeof row.date === 'string' ? row.date : undefined;
  const platform: string = typeof row.platform === 'string' ? row.platform : '';
  const url:      string = typeof row.url      === 'string' ? row.url      : '';

  // Defensive: nothing identifiable to map (no author, no text, no url).
  if (!author && !text && !url) {
    return { entities: [], links: [], provenance: [] };
  }

  const seed = url || `${platform}:${author}:${date ?? ''}`;
  const entityId = pseudoUuid(`reviews:event:${seed}`);

  const title = author ? `Review by ${author}` : platform ? `${platform} review` : 'Review';

  const entity: Entity = {
    ...makeEntityBase(tenantId),
    id:             entityId,
    type:           'event',
    canonical_name: title,
    properties: {
      event_kind: 'review',
      author,
      rating,
      text,
      date,
      platform,
      url,
      source: 'reviews',
    },
  };

  const provenance: Provenance[] = [
    {
      id:         pseudoUuid(`reviews:prov:${seed}`),
      entity_id:  entityId,
      source_key: 'reviews',
      source_url: url || undefined,
      fetched_at: now(),
      confidence: 0.6,
      raw:        input,
    },
  ];

  return { entities: [entity], links: [], provenance };
}
