/**
 * KINTEL Phase 2 — Social / people data mapper
 *
 * *** GDPR NOTICE — READ BEFORE ENABLING IN PRODUCTION ***
 * The upstream connector (src/app/api/social/route.ts, src/lib/social/index.ts)
 * can return `type: 'person'` and `type: 'job'` profiles, which constitute
 * personal data / special-category-adjacent data under GDPR (names, locations,
 * employment history). This mapper deliberately maps ONLY the non-personal,
 * public-facing profile kinds — 'company' (a public organisation account page)
 * and 'post' (a public post) — into ontology objects. 'person' and 'job'
 * profile records are intentionally NOT mapped here and are dropped.
 * Enabling ingestion of person-level social data requires a documented lawful
 * basis under GDPR Art. 6, a Data Processing Agreement with the provider
 * (Bright Data Ltd), and operator compliance sign-off BEFORE this mapper (or
 * a successor) is extended to cover 'person'/'job' records.
 *
 * Source key: 'social'
 * API: Bright Data LinkedIn/Social Datasets (licensed) — see src/lib/social/index.ts
 *
 * Input shape (single SocialProfile item from the route's `profiles[]` array):
 * { name, type: 'company'|'person'|'job'|'post', url, headline?, location?,
 *   followers?, employees?, raw }
 *
 * Produces:
 *   - type='company' → a 'company' entity (public account; not personal data)
 *   - type='post'    → an 'event' entity representing the public post
 *     (closest existing ObjectType — 'post' is not a defined ObjectType value;
 *      see report for this approximation)
 *   - type='person' | 'job' → skipped (no entities/links/provenance emitted)
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
 * Map a single public social profile record to ontology objects.
 * Only 'company' (public account) and 'post' (public post) profile types are
 * mapped; 'person' and 'job' are skipped — see GDPR notice above.
 *
 * Expected input shape:
 * {
 *   name:       string,
 *   type:       'company' | 'person' | 'job' | 'post',
 *   url:        string,
 *   headline?:  string,
 *   location?:  string,
 *   followers?: number,
 *   employees?: number,
 *   raw:        Record<string, unknown>,
 * }
 */
export function mapSocialPost(input: unknown, tenantId: string): MapperResult {
  const row = (input as Record<string, unknown>) ?? {};

  const type: string = typeof row.type === 'string' ? row.type : '';

  // GDPR guardrail: never map personal-data profile kinds in this mapper.
  if (type === 'person' || type === 'job') {
    return { entities: [], links: [], provenance: [] };
  }

  const name:      string = typeof row.name      === 'string' ? row.name      : '';
  const url:       string = typeof row.url       === 'string' ? row.url       : '';
  const headline:  string | undefined = typeof row.headline === 'string' ? row.headline : undefined;
  const followers: number | undefined = typeof row.followers === 'number' && !isNaN(row.followers) ? row.followers : undefined;
  const employees: number | undefined = typeof row.employees === 'number' && !isNaN(row.employees) ? row.employees : undefined;

  // Defensive: no name and no url — nothing identifiable to map.
  if (!name && !url) {
    return { entities: [], links: [], provenance: [] };
  }

  const seed = url || name;
  const entities:   Entity[]     = [];
  const provenance: Provenance[] = [];

  if (type === 'company') {
    const entityId = pseudoUuid(`social:company:${seed}`);
    entities.push({
      ...makeEntityBase(tenantId),
      id:             entityId,
      type:           'company',
      canonical_name: name || undefined,
      properties: {
        social_profile_type: 'company',
        url,
        headline,
        employees,
        followers,
        source: 'social',
      },
    });

    provenance.push({
      id:         pseudoUuid(`social:prov:${seed}`),
      entity_id:  entityId,
      source_key: 'social',
      source_url: url || undefined,
      fetched_at: now(),
      confidence: 0.6,
      raw:        input,
    });
  } else if (type === 'post') {
    // No dedicated 'post' ObjectType is defined in types.ts; 'event' is the
    // closest existing type for a discrete, timestamped public occurrence.
    const entityId = pseudoUuid(`social:post:${seed}`);
    entities.push({
      ...makeEntityBase(tenantId),
      id:             entityId,
      type:           'event',
      canonical_name: name || headline || undefined,
      properties: {
        social_profile_type: 'post',
        url,
        headline,
        followers,
        source: 'social',
      },
    });

    provenance.push({
      id:         pseudoUuid(`social:prov:${seed}`),
      entity_id:  entityId,
      source_key: 'social',
      source_url: url || undefined,
      fetched_at: now(),
      confidence: 0.5,
      raw:        input,
    });
  }
  // Any other/unknown type value: fall through and return empty (defensive).

  return { entities, links: [], provenance };
}
