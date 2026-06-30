import { NextResponse } from 'next/server';
import { isSourceEnabled } from '@/config/featureFlags';
import { getSecretOrThrow } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

/**
 * KINTEL — FRED Macro & Economic Data
 *
 * API base: https://api.stlouisfed.org/fred
 *   GET /fred/series/observations?series_id=<ID>&api_key=<KEY>&file_type=json&sort_order=desc&limit=60
 *   GET /fred/series/search?search_text=<q>&api_key=<KEY>&file_type=json&limit=20
 *   Key stored as FRED_API_KEY in env or Supabase Vault.
 *
 * GET params:
 *   series_id — return recent observations for this series (e.g. DGS10, CPIAUCSL, UNRATE)
 *   q         — search for series by keyword
 *
 * Responses:
 *   observations: { series: { id, title }, observations: [{ date, value }] }
 *   search:       { results: [{ id, title, units, frequency, lastUpdated }] }
 *
 * Returns 422 when key is absent.
 * Gated by isSourceEnabled('fred').
 */

const FRED_BASE = 'https://api.stlouisfed.org/fred';

export async function GET(request: Request) {
  if (!isSourceEnabled('fred')) {
    return NextResponse.json(
      { error: 'fred source is not enabled for this platform configuration.' },
      { status: 403 }
    );
  }

  let apiKey: string;
  try {
    apiKey = await getSecretOrThrow('FRED_API_KEY');
  } catch {
    return NextResponse.json(
      { error: 'FRED_API_KEY not configured (set env or Supabase Vault)' },
      { status: 422 }
    );
  }

  const { searchParams } = new URL(request.url);
  const seriesId = searchParams.get('series_id');
  const q        = searchParams.get('q');

  // ── Observations mode ────────────────────────────────────────
  if (seriesId) {
    // Fetch series metadata + observations in parallel
    const [obsRes, metaRes] = await Promise.all([
      fetch(
        `${FRED_BASE}/series/observations` +
        `?series_id=${encodeURIComponent(seriesId)}` +
        `&api_key=${encodeURIComponent(apiKey)}` +
        `&file_type=json&sort_order=desc&limit=60`,
        { next: { revalidate: 3600 } }
      ).catch(() => null),
      fetch(
        `${FRED_BASE}/series` +
        `?series_id=${encodeURIComponent(seriesId)}` +
        `&api_key=${encodeURIComponent(apiKey)}` +
        `&file_type=json`,
        { next: { revalidate: 3600 } }
      ).catch(() => null),
    ]);

    if (!obsRes || !obsRes.ok) {
      return NextResponse.json(
        { observations: [], error: `FRED API returned HTTP ${obsRes?.status ?? 502}` },
        { status: 502 }
      );
    }

    const obsRaw: unknown = await obsRes.json();
    const rawObs = Array.isArray((obsRaw as Record<string, unknown>)?.observations)
      ? ((obsRaw as Record<string, unknown>).observations as unknown[])
      : [];

    const observations = rawObs
      .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
      .map(o => ({
        date:  String(o.date  ?? ''),
        value: o.value === '.' ? null : (parseFloat(String(o.value ?? '')) || null),
      }));

    // Extract series metadata
    let seriesMeta: Record<string, unknown> = { id: seriesId };
    if (metaRes?.ok) {
      const metaRaw: unknown = await metaRes.json();
      const sArr = (metaRaw as Record<string, unknown>)?.seriess;
      const s = Array.isArray(sArr) && sArr.length > 0
        ? (sArr[0] as Record<string, unknown>)
        : null;
      if (s) {
        seriesMeta = {
          id:          String(s.id    ?? seriesId),
          title:       String(s.title ?? seriesId),
          units:       String(s.units_short ?? s.units ?? ''),
          frequency:   String(s.frequency_short ?? s.frequency ?? ''),
          lastUpdated: String(s.last_updated ?? ''),
          notes:       String(s.notes ?? ''),
        };
      }
    }

    return NextResponse.json(
      { series: seriesMeta, observations, count: observations.length },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' } }
    );
  }

  // ── Search mode ──────────────────────────────────────────────
  if (q) {
    const res = await fetch(
      `${FRED_BASE}/series/search` +
      `?search_text=${encodeURIComponent(q)}` +
      `&api_key=${encodeURIComponent(apiKey)}` +
      `&file_type=json&limit=20&order_by=popularity&sort_order=desc`,
      { next: { revalidate: 3600 } }
    ).catch(() => null);

    if (!res || !res.ok) {
      return NextResponse.json(
        { results: [], error: `FRED search returned HTTP ${res?.status ?? 502}` },
        { status: 502 }
      );
    }

    const raw: unknown = await res.json();
    const sArr = Array.isArray((raw as Record<string, unknown>)?.seriess)
      ? ((raw as Record<string, unknown>).seriess as unknown[])
      : [];

    const results = sArr
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map(s => ({
        id:          String(s.id          ?? ''),
        title:       String(s.title       ?? ''),
        units:       String(s.units_short ?? s.units ?? ''),
        frequency:   String(s.frequency_short ?? s.frequency ?? ''),
        lastUpdated: String(s.last_updated ?? ''),
      }));

    return NextResponse.json(
      { results, total: (raw as Record<string, unknown>)?.count ?? results.length },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' } }
    );
  }

  return NextResponse.json(
    { error: 'Provide either series_id (observations) or q (search) parameter.' },
    { status: 400 }
  );
}
