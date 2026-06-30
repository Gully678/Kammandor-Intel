import { NextResponse } from 'next/server';
import { isSourceEnabled } from '@/config/featureFlags';
import { getSecret } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

/**
 * KINTEL — UN Comtrade Trade Flows
 *
 * API: https://comtradeapi.un.org/data/v1/get/C/{freq}/{period}/{reporterCode}/{cmdCode}/{partnerCode}
 *   Auth: Ocp-Apim-Subscription-Key header (free-tier key required — no truly keyless public preview)
 *   Key stored as COMTRADE_KEY in env or Supabase Vault.
 *   When key absent, returns 422 gracefully.
 *
 * Response shape from API (data[] items):
 *   { reporterCode, reporterISO, refYear, flowCode, partnerCode, partnerISO, primaryValue, ... }
 *
 * Our response: { flows: [{ reporterIso, partnerIso, flow, value, period }] }
 *
 * Params (GET):
 *   reporter  — ISO numeric or M49 code for reporter country (default "USA" → 842)
 *   partner   — ISO numeric for partner, or "0" for World total
 *   flow      — "M" (imports) | "X" (exports) | "all" (both, default)
 *   period    — YYYY (default: most recent full year)
 *
 * Gated by isSourceEnabled('un-comtrade').
 */

const COMTRADE_BASE = 'https://comtradeapi.un.org/data/v1/get';

// Mapping of common 3-letter ISO to M49 numeric reporter codes
// (Comtrade uses M49; we accept either and pass through)
const ISO3_TO_M49: Record<string, string> = {
  USA: '842', GBR: '826', CHN: '156', DEU: '276', JPN: '392',
  FRA: '250', IND: '356', BRA: '076', CAN: '124', AUS: '036',
  SAU: '682', ARE: '784', RUS: '643', KOR: '410', NLD: '528',
};

export async function GET(request: Request) {
  if (!isSourceEnabled('un-comtrade')) {
    return NextResponse.json(
      { error: 'un-comtrade source is not enabled for this platform configuration.' },
      { status: 403 }
    );
  }

  const key = await getSecret('COMTRADE_KEY');
  if (!key) {
    return NextResponse.json(
      { flows: [], error: 'COMTRADE_KEY not configured (set env or Supabase Vault)' },
      { status: 422 }
    );
  }

  const { searchParams } = new URL(request.url);
  const reporterParam = searchParams.get('reporter') ?? 'USA';
  const partnerParam  = searchParams.get('partner')  ?? '0';
  const flowParam     = searchParams.get('flow')     ?? 'all';
  const periodParam   = searchParams.get('period')   ?? String(new Date().getFullYear() - 1);

  // Resolve reporter: accept ISO-3 or M49 numeric
  const reporterCode = ISO3_TO_M49[reporterParam.toUpperCase()] ?? reporterParam;

  // flow codes: M=imports, X=exports; API takes comma-separated
  const flowCode = flowParam === 'all' ? 'M,X' : flowParam.toUpperCase();

  // Commodity: TOTAL = aggregated total trade (cmd code TOTAL not available in v1; use 'AG6' or 'TOTAL' when supported)
  // For aggregate trade, use cmdCode=TOTAL; API supports this for the free tier
  const cmdCode = 'TOTAL';

  const url =
    `${COMTRADE_BASE}/C/A/${periodParam}/${reporterCode}/${cmdCode}/${partnerParam}` +
    `?flowCode=${encodeURIComponent(flowCode)}&includeDesc=true`;

  try {
    const res = await fetch(url, {
      headers: { 'Ocp-Apim-Subscription-Key': key },
      next: { revalidate: 86400 }, // Cache 24 h — annual data
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return NextResponse.json(
        { flows: [], error: `Comtrade API returned HTTP ${res.status}`, detail: body.slice(0, 200) },
        { status: 502 }
      );
    }

    const raw: unknown = await res.json();
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !Array.isArray((raw as Record<string, unknown>).data)
    ) {
      return NextResponse.json(
        { flows: [], error: 'Unexpected Comtrade API response shape' },
        { status: 502 }
      );
    }

    const dataArr = (raw as Record<string, unknown[]>).data;

    const flows = dataArr
      .filter((item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object'
      )
      .map(item => ({
        reporterIso:  String(item.reporterISO  ?? item.reporterCode ?? ''),
        reporterName: String(item.reporterDesc ?? item.reporterISO  ?? ''),
        partnerIso:   String(item.partnerISO   ?? item.partnerCode  ?? ''),
        partnerName:  String(item.partnerDesc  ?? item.partnerISO   ?? ''),
        flow:         String(item.flowCode     ?? ''),
        flowDesc:     String(item.flowDesc     ?? item.flowCode ?? ''),
        value:        typeof item.primaryValue === 'number' ? item.primaryValue : null,
        period:       String(item.refYear      ?? item.period       ?? ''),
      }))
      .filter(f => f.value !== null);

    return NextResponse.json(
      { flows, total: flows.length, reporter: reporterParam, period: periodParam },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
        },
      }
    );
  } catch (err) {
    console.warn('[KINTEL] un-comtrade route error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { flows: [], error: 'Internal error fetching Comtrade data' },
      { status: 500 }
    );
  }
}
