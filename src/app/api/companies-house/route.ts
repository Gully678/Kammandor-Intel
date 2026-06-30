import { NextResponse } from 'next/server';
import { isSourceEnabled } from '@/config/featureFlags';
import { getSecretOrThrow } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

/**
 * KINTEL — Companies House (UK) UBO / Officers / Company Search
 *
 * Base: https://api.company-information.service.gov.uk
 * Auth: HTTP Basic — API key as username, empty password
 *   Authorization: Basic base64(KEY:)
 *   Key stored as COMPANIES_HOUSE_KEY in env or Supabase Vault.
 *
 * GET params:
 *   q       — search query (returns list of matching companies)
 *   number  — company number for detail lookup
 *   view    — "officers" | "psc" | omit for company profile only
 *
 * Responses:
 *   search: { results: [{ name, companyNumber, status, type, address }] }
 *   detail: { company, officers?, psc? }
 *
 * Returns 422 when key is absent.
 * Gated by isSourceEnabled('companies-house').
 */

const CH_BASE = 'https://api.company-information.service.gov.uk';

function makeAuthHeader(key: string): string {
  // Basic auth: key as username, empty password
  const encoded = Buffer.from(`${key}:`).toString('base64');
  return `Basic ${encoded}`;
}

async function chFetch(path: string, key: string): Promise<Response> {
  return fetch(`${CH_BASE}${path}`, {
    headers: {
      Authorization: makeAuthHeader(key),
      Accept: 'application/json',
    },
    next: { revalidate: 3600 }, // Cache 1 h
  });
}

export async function GET(request: Request) {
  if (!isSourceEnabled('companies-house')) {
    return NextResponse.json(
      { error: 'companies-house source is not enabled for this platform configuration.' },
      { status: 403 }
    );
  }

  let key: string;
  try {
    key = await getSecretOrThrow('COMPANIES_HOUSE_KEY');
  } catch {
    return NextResponse.json(
      { error: 'COMPANIES_HOUSE_KEY not configured (set env or Supabase Vault)' },
      { status: 422 }
    );
  }

  const { searchParams } = new URL(request.url);
  const q      = searchParams.get('q');
  const number = searchParams.get('number');
  const view   = searchParams.get('view'); // "officers" | "psc" | null

  // ── Search mode ──────────────────────────────────────────────
  if (q) {
    const res = await chFetch(
      `/search/companies?q=${encodeURIComponent(q)}&items_per_page=20`,
      key
    ).catch(err => {
      console.warn('[KINTEL] companies-house search error:', err instanceof Error ? err.message : err);
      return null;
    });

    if (!res || !res.ok) {
      const status = res?.status ?? 502;
      return NextResponse.json(
        { results: [], error: `Companies House API returned HTTP ${status}` },
        { status: 502 }
      );
    }

    const raw: unknown = await res.json();
    const items: unknown[] = Array.isArray(
      (raw as Record<string, unknown>)?.items
    )
      ? ((raw as Record<string, unknown>).items as unknown[])
      : [];

    const results = items
      .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
      .map(i => ({
        name:          String(i.title ?? i.company_name ?? ''),
        companyNumber: String(i.company_number ?? ''),
        status:        String(i.company_status ?? ''),
        type:          String(i.company_type ?? ''),
        address:       formatAddress(i.address as Record<string, unknown> | undefined),
        dateIncorp:    i.date_of_creation ? String(i.date_of_creation) : undefined,
      }));

    return NextResponse.json(
      { results, total: (raw as Record<string, unknown>)?.total_results ?? results.length },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' } }
    );
  }

  // ── Detail mode ───────────────────────────────────────────────
  if (number) {
    const companyRes = await chFetch(`/company/${encodeURIComponent(number)}`, key).catch(() => null);
    if (!companyRes || !companyRes.ok) {
      return NextResponse.json(
        { error: `Companies House API returned HTTP ${companyRes?.status ?? 502} for company ${number}` },
        { status: 502 }
      );
    }
    const company = await companyRes.json();

    const response: Record<string, unknown> = { company };

    if (!view || view === 'officers') {
      const offRes = await chFetch(`/company/${encodeURIComponent(number)}/officers?items_per_page=50`, key).catch(() => null);
      if (offRes?.ok) {
        const offData: unknown = await offRes.json();
        const items = Array.isArray((offData as Record<string, unknown>)?.items)
          ? ((offData as Record<string, unknown>).items as unknown[])
          : [];
        response.officers = items
          .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
          .map(o => ({
            name:          String(o.name ?? ''),
            role:          String(o.officer_role ?? ''),
            appointed:     o.appointed_on ? String(o.appointed_on) : undefined,
            resigned:      o.resigned_on  ? String(o.resigned_on)  : undefined,
            nationality:   o.nationality  ? String(o.nationality)  : undefined,
            countryOfRes:  o.country_of_residence ? String(o.country_of_residence) : undefined,
          }));
      }
    }

    if (!view || view === 'psc') {
      const pscRes = await chFetch(
        `/company/${encodeURIComponent(number)}/persons-with-significant-control?items_per_page=50`,
        key
      ).catch(() => null);
      if (pscRes?.ok) {
        const pscData: unknown = await pscRes.json();
        const items = Array.isArray((pscData as Record<string, unknown>)?.items)
          ? ((pscData as Record<string, unknown>).items as unknown[])
          : [];
        response.psc = items
          .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
          .map(p => ({
            name:          String(p.name ?? ''),
            kind:          String(p.kind ?? ''),
            naturesOfControl: Array.isArray(p.natures_of_control)
              ? (p.natures_of_control as string[]).join(', ')
              : String(p.natures_of_control ?? ''),
            nationality:   p.nationality ? String(p.nationality) : undefined,
            countryOfRes:  p.country_of_residence ? String(p.country_of_residence) : undefined,
            notifiedOn:    p.notified_on ? String(p.notified_on) : undefined,
            ceasedOn:      p.ceased_on   ? String(p.ceased_on)   : undefined,
          }));
      }
    }

    return NextResponse.json(
      response,
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' } }
    );
  }

  // Neither q nor number supplied
  return NextResponse.json(
    { error: 'Provide either q (search) or number (company detail) parameter.' },
    { status: 400 }
  );
}

function formatAddress(addr: Record<string, unknown> | undefined): string {
  if (!addr) return '';
  return [addr.premises, addr.address_line_1, addr.address_line_2, addr.locality, addr.postal_code, addr.country]
    .filter(Boolean)
    .join(', ');
}
