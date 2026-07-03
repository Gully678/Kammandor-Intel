/**
 * KINTEL Phase 2 — GDELT / GDACS event mapper
 * Transforms a geocoded geopolitical/disaster event row into an ontology object.
 *
 * Source key: 'gdelt'
 * API: GDACS RSS (see src/app/api/gdelt/route.ts) — keyless public feed.
 *
 * Input shape (single item from the route's `events[]` array):
 * { id, lat, lng, name, url, type, tone?, date? }
 *
 * Produces:
 *   - Event entity (type='event') carrying geocoordinates, event type, tone, date
 *   - No links — the GDACS feed carries no named actors to link against;
 *     'mentionedInEvent' links are added by downstream enrichment once actor
 *     extraction (e.g. GDELT GKG/DOC API) is wired up.
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
 * Map a single GDACS/GDELT event row to an ontology Event entity.
 *
 * Expected input shape:
 * {
 *   id:    string,    // e.g. 'gdacs-0'
 *   lat:   number,
 *   lng:   number,
 *   name:  string,    // event title
 *   url:   string,
 *   type:  string,    // e.g. 'earthquake' | 'flood' | 'conflict' | ...
 *   tone?: number,    // normalised sentiment proxy (-100..0)
 *   date?: string,    // RFC 2822 pubDate string
 * }
 */
export function mapGdeltEvent(input: unknown, tenantId: string): MapperResult {
  const row = (input as Record<string, unknown>) ?? {};

  const eventId: string = typeof row.id   === 'string' ? row.id   : '';
  const name:    string = typeof row.name === 'string' ? row.name : '';
  const lat:     number | undefined = typeof row.lat === 'number' && !isNaN(row.lat) ? row.lat : undefined;
  const lng:     number | undefined = typeof row.lng === 'number' && !isNaN(row.lng) ? row.lng : undefined;
  const url:     string = typeof row.url  === 'string' ? row.url  : '';
  const type:    string = typeof row.type === 'string' ? row.type : '';
  const tone:    number | undefined = typeof row.tone === 'number' && !isNaN(row.tone) ? row.tone : undefined;
  const date:    string | undefined = typeof row.date === 'string' ? row.date : undefined;

  // Defensive: an event with no name and no coordinates is not a usable record.
  if (!name && lat === undefined && lng === undefined) {
    return { entities: [], links: [], provenance: [] };
  }

  const entities:   Entity[]     = [];
  const links:      never[]      = [];
  const provenance: Provenance[] = [];

  const seed = eventId || `${name}:${lat}:${lng}`;
  const entityId = pseudoUuid(`gdelt:event:${seed}`);

  const eventEntity: Entity = {
    ...makeEntityBase(tenantId),
    id:             entityId,
    type:           'event',
    canonical_name: name || undefined,
    properties: {
      event_type: type,
      lat,
      lng,
      url,
      tone,
      date,
      source: 'gdelt',
    },
  };
  entities.push(eventEntity);

  provenance.push({
    id:         pseudoUuid(`gdelt:prov:${seed}`),
    entity_id:  entityId,
    source_key: 'gdelt',
    source_url: url || undefined,
    fetched_at: now(),
    confidence: 0.7,
    raw:        input,
  });

  return { entities, links, provenance };
}
