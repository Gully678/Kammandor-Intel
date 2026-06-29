import { NextResponse } from 'next/server';
import { isSourceEnabled } from '@/config/featureFlags';

export const dynamic = 'force-dynamic';

/**
 * KINTEL — GLEIF LEI Legal Entity Lookup
 * Source: Global Legal Entity Identifier Foundation API v1 (gleif.org) — keyless, public
 *
 * Endpoint: GET /api/gleif?name=<legal name> OR ?lei=<LEI code>
 *   name — legal entity name (fuzzy match via filter[entity.legalName])
 *   lei  — exact LEI code (filter[lei])
 *
 * Response: { entities: [{ lei, name, jurisdiction, status, hq: {country,city}, parentLei? }] }
 * Gated by isSourceEnabled('gleif').
 *
 * API shape (JSON:API): { data: [{ id (=LEI), attributes: { lei,
 *   entity: { legalName: {name}, headquartersAddress: {country,city,...},
 *             jurisdiction, status },
 *   relationships: { directParent: { data: { id } } } } }] }
 *
 * Rate limit: ~60 req/min per IP; no auth required.
 */

const GLEIF_BASE = 'https://api.gleif.org/api/v1/lei-records';

export async function GET(request: Request) {
  // Feature-flag gate
  if (!isSourceEnabled('gleif')) {
    return NextResponse.json(
      { error: 'gleif source is not enabled for this platform configuration.' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const name = (searchParams.get('name') ?? '').trim();
  const lei = (searchParams.get('lei') ?? '').trim();

  if (!name && !lei) {
    return NextResponse.json(
      { entities: [], error: 'Provide either "name" or "lei" query parameter.' },
      { status: 400 }
    );
  }

  // Build GLEIF filter — JSON:API bracket notation requires URL encoding
  const gleifUrl = new URL(GLEIF_BASE);
  if (lei) {
    gleifUrl.searchParams.set('filter[lei]', lei);
  } else {
    gleifUrl.searchParams.set('filter[entity.legalName]', name);
  }
  gleifUrl.searchParams.set('page[size]', '10');

  try {
    const res = await fetch(gleifUrl.toString(), {
      next: { revalidate: 3600 }, // Cache 1 h — LEI records change infrequently
      headers: {
        'Accept': 'application/vnd.api+json',
        'User-Agent': 'Kammandor Intel research contact@kammandor.com',
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { entities: [], error: `GLEIF API returned HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const raw: unknown = await res.json();

    // Defensive parse: JSON:API envelope { data: [...] }
    if (
      raw === null ||
      typeof raw !== 'object' ||
      !('data' in (raw as object)) ||
      !Array.isArray((raw as Record<string, unknown>).data)
    ) {
      return NextResponse.json(
        { entities: [], error: 'Unexpected GLEIF API response shape' },
        { status: 502 }
      );
    }

    const dataArr = (raw as Record<string, unknown>).data as unknown[];

    const entities = dataArr
      .filter((item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object'
      )
      .map(item => {
        const leiCode = typeof item.id === 'string' ? item.id : '';
        const attrs =
          typeof item.attributes === 'object' && item.attributes !== null
            ? (item.attributes as Record<string, unknown>)
            : {};
        const entity =
          typeof attrs.entity === 'object' && attrs.entity !== null
            ? (attrs.entity as Record<string, unknown>)
            : {};

        // Legal name — GLEIF returns { name, language }
        const legalNameObj =
          typeof entity.legalName === 'object' && entity.legalName !== null
            ? (entity.legalName as Record<string, unknown>)
            : {};
        const entityName = typeof legalNameObj.name === 'string'
          ? legalNameObj.name
          : leiCode;

        // Headquarters address
        const hqAddr =
          typeof entity.headquartersAddress === 'object' && entity.headquartersAddress !== null
            ? (entity.headquartersAddress as Record<string, unknown>)
            : {};
        const hqCountry = typeof hqAddr.country === 'string' ? hqAddr.country : '';
        const hqCity = typeof hqAddr.city === 'string'
          ? hqAddr.city
          : Array.isArray(hqAddr.addressLines) && typeof hqAddr.addressLines[0] === 'string'
            ? hqAddr.addressLines[0]
            : '';

        const jurisdiction = typeof entity.jurisdiction === 'string'
          ? entity.jurisdiction
          : '';
        const status = typeof entity.status === 'string' ? entity.status : '';

        // Parent LEI via JSON:API relationships
        const rels =
          typeof item.relationships === 'object' && item.relationships !== null
            ? (item.relationships as Record<string, unknown>)
            : {};
        const directParent =
          typeof rels['direct-parent'] === 'object' && rels['direct-parent'] !== null
            ? (rels['direct-parent'] as Record<string, unknown>)
            : typeof rels.directParent === 'object' && rels.directParent !== null
              ? (rels.directParent as Record<string, unknown>)
              : {};
        const dpData =
          typeof directParent.data === 'object' && directParent.data !== null
            ? (directParent.data as Record<string, unknown>)
            : {};
        const parentLei = typeof dpData.id === 'string' ? dpData.id : undefined;

        return {
          lei: leiCode,
          name: entityName,
          jurisdiction,
          status,
          hq: { country: hqCountry, city: hqCity },
          ...(parentLei ? { parentLei } : {}),
        };
      })
      .filter(e => e.lei && e.name);

    return NextResponse.json(
      { entities, total: entities.length, query: name || lei },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
        },
      }
    );
  } catch (err) {
    console.warn('[KINTEL] gleif route error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { entities: [], error: 'Internal error fetching GLEIF data' },
      { status: 500 }
    );
  }
}
