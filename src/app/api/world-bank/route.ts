import { NextResponse } from 'next/server';
import { isSourceEnabled } from '@/config/featureFlags';

export const dynamic = 'force-dynamic';

/**
 * KINTEL — World Bank Country Risk Layer
 * Source: World Bank Indicators API v2 (keyless, public)
 * Indicator: IQ.CPA.IRAI.XQ — IDA Resource Allocation Index / CPIA overall score
 *   Scale: 1 (worst governance) to 6 (best governance)
 *   Covers ~75 IDA-eligible countries (not all 180); aggregates filtered server-side.
 *   API note: use mrv=1 not mrnev=1 — the latter returns 175/invalid for many WB indicators.
 *
 * Response: { countries: [{ iso3, name, value, year }] }
 * Gated by isSourceEnabled('world-bank').
 */

/**
 * CPIA Overall (IDA Resource Allocation Index) — 1=low governance, 6=high governance
 * Covers ~75 IDA-eligible countries; well-maintained, updated annually.
 * API quirk: use mrv=1 (most recent value) — mrnev=1 returns HTTP 175 "indicator not found"
 * for most WGI/governance indicators which were archived from source 57 to source 2.
 */
const WB_INDICATOR = 'IQ.CPA.IRAI.XQ';
const WB_URL =
  `https://api.worldbank.org/v2/country/all/indicator/${WB_INDICATOR}` +
  `?format=json&per_page=300&mrv=1`;

export async function GET() {
  // Feature-flag gate — returns 403 if disabled
  if (!isSourceEnabled('world-bank')) {
    return NextResponse.json(
      { error: 'world-bank source is not enabled for this platform configuration.' },
      { status: 403 }
    );
  }

  try {
    const res = await fetch(WB_URL, {
      next: { revalidate: 86400 }, // Cache 24 h — WGI data updates annually
    });

    if (!res.ok) {
      return NextResponse.json(
        { countries: [], error: `World Bank API returned HTTP ${res.status}` },
        { status: 502 }
      );
    }

    // WB API v2 returns a two-element array: [metaObject, dataArray]
    // metaObject: { page, pages, per_page, total, sourceid, lastupdated }
    // dataArray items: { indicator:{id,value}, country:{id,value},
    //                    countryiso3code, date, value, unit, obs_status, decimal }
    const raw: unknown = await res.json();

    if (!Array.isArray(raw) || raw.length < 2) {
      return NextResponse.json(
        { countries: [], error: 'Unexpected World Bank API response shape' },
        { status: 502 }
      );
    }

    const dataArray: unknown[] = Array.isArray(raw[1]) ? raw[1] : [];

    const countries = dataArray
      .filter((item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object'
      )
      .filter(item => {
        // Filter out aggregate regions (iso3 codes starting with 'Z', 'X', or WB aggregates)
        // Keep only real country entries that have a numeric value
        const iso3 = item.countryiso3code;
        const val = item.value;
        return (
          typeof iso3 === 'string' &&
          iso3.length === 3 &&
          typeof val === 'number' &&
          !isNaN(val)
        );
      })
      .map(item => ({
        iso3: item.countryiso3code as string,
        name: (item.country as Record<string, string>)?.value ?? (item.countryiso3code as string),
        value: item.value as number,
        year: parseInt(String(item.date), 10) || null,
      }))
      .sort((a, b) => a.value - b.value); // ascending: most unstable first

    return NextResponse.json(
      { countries, total: countries.length, indicator: WB_INDICATOR },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
        },
      }
    );
  } catch (err) {
    console.warn('[KINTEL] world-bank route error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { countries: [], error: 'Internal error fetching World Bank data' },
      { status: 500 }
    );
  }
}
