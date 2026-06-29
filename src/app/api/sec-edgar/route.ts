import { NextResponse } from 'next/server';
import { isSourceEnabled } from '@/config/featureFlags';

export const dynamic = 'force-dynamic';

/**
 * KINTEL — SEC EDGAR Filings Search
 * Source: SEC EDGAR Full-Text Search API (efts.sec.gov) — keyless, public
 * Requires a descriptive User-Agent per SEC policy.
 *
 * Endpoint: GET /api/sec-edgar?q=<term>&forms=<type>
 *   q      — company name or keyword (required)
 *   forms  — comma-separated form types e.g. "10-K,8-K" (optional, default all)
 *
 * Response: { filings: [{ company, cik, form, filedDate, title, url }] }
 * Gated by isSourceEnabled('sec-edgar').
 *
 * API shape: efts.sec.gov/LATEST/search-index returns:
 *   { hits: { total: { value }, hits: [{ _id, _source: { entity_name,
 *     display_names, file_date, form_type, period_of_report, file_num } }] } }
 * The _id encodes accession number; filing URL:
 *   https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=<cik>&type=<form>
 * Direct filing URL from _id: https://www.sec.gov/Archives/edgar/data/<cik>/<accession>
 *
 * Rate limit: no hard limit; SEC asks < 10 req/s with a descriptive User-Agent.
 */

const EDGAR_UA = 'Kammandor Intel research contact@kammandor.com';
const EDGAR_SEARCH = 'https://efts.sec.gov/LATEST/search-index';

export async function GET(request: Request) {
  // Feature-flag gate
  if (!isSourceEnabled('sec-edgar')) {
    return NextResponse.json(
      { error: 'sec-edgar source is not enabled for this platform configuration.' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();
  if (!q) {
    return NextResponse.json(
      { filings: [], error: 'Query parameter "q" is required.' },
      { status: 400 }
    );
  }
  const forms = (searchParams.get('forms') ?? '').trim();

  const url = new URL(EDGAR_SEARCH);
  url.searchParams.set('q', `"${q}"`);
  if (forms) url.searchParams.set('forms', forms);

  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 300 }, // Cache 5 min — filings indexed ~15 min after submission
      headers: {
        'User-Agent': EDGAR_UA,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { filings: [], error: `EDGAR API returned HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const raw: unknown = await res.json();

    // Defensive parse: expect { hits: { hits: [...] } }
    if (
      raw === null ||
      typeof raw !== 'object' ||
      !('hits' in (raw as object))
    ) {
      return NextResponse.json(
        { filings: [], error: 'Unexpected EDGAR API response shape' },
        { status: 502 }
      );
    }

    const outer = (raw as Record<string, unknown>).hits;
    const hitsArr: unknown[] =
      outer !== null &&
      typeof outer === 'object' &&
      'hits' in (outer as object) &&
      Array.isArray((outer as Record<string, unknown>).hits)
        ? ((outer as Record<string, unknown>).hits as unknown[])
        : [];

    const totalValue: number =
      outer !== null &&
      typeof outer === 'object' &&
      'total' in (outer as object) &&
      typeof ((outer as Record<string, unknown>).total as Record<string, unknown>)?.value === 'number'
        ? (((outer as Record<string, unknown>).total as Record<string, unknown>).value as number)
        : hitsArr.length;

    const filings = hitsArr
      .filter((h): h is Record<string, unknown> => h !== null && typeof h === 'object')
      .map(h => {
        const src =
          typeof h._source === 'object' && h._source !== null
            ? (h._source as Record<string, unknown>)
            : {};

        // entity_name is the primary filer name; display_names is an array
        const company =
          typeof src.entity_name === 'string' && src.entity_name
            ? src.entity_name
            : Array.isArray(src.display_names) && src.display_names.length > 0
              ? String(src.display_names[0])
              : 'Unknown';

        const cik = typeof src.file_num === 'string'
          ? src.file_num
          : typeof h._id === 'string'
            ? h._id.split('-')[0]
            : '';

        const form = typeof src.form_type === 'string' ? src.form_type : '';
        const filedDate = typeof src.file_date === 'string' ? src.file_date : '';
        const title =
          typeof src.period_of_report === 'string' && src.period_of_report
            ? `${form} — period ${src.period_of_report}`
            : form;

        // Construct EDGAR filing URL from accession number (_id format: xxxxxxxxxx-yy-nnnnnn)
        const accession = typeof h._id === 'string' ? h._id : '';
        const accessionClean = accession.replace(/-/g, '');
        // Extract CIK from entity_id if available, otherwise derive from file_num
        const entityCik = typeof src.entity_id === 'string'
          ? src.entity_id.replace(/^CIK/, '').padStart(10, '0')
          : '';
        const url_ = entityCik && accessionClean
          ? `https://www.sec.gov/Archives/edgar/data/${parseInt(entityCik, 10)}/${accessionClean}/`
          : accession
            ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=${encodeURIComponent(cik)}&type=${encodeURIComponent(form)}&dateb=&owner=include&count=40`
            : '';

        return { company, cik, form, filedDate, title, url: url_ };
      })
      .filter(f => f.company && f.form);

    return NextResponse.json(
      { filings, total: totalValue, query: q },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (err) {
    console.warn('[KINTEL] sec-edgar route error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { filings: [], error: 'Internal error fetching SEC EDGAR data' },
      { status: 500 }
    );
  }
}
