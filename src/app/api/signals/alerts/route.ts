import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';
import type { AlertRecord, ListAlertsResponse } from '@/lib/sdk/intel/types';

export const dynamic = 'force-dynamic';

/**
 * KINTEL v2.3 — Headless read surface: the tenant alert feed (PRD §10.1)
 * GET /api/signals/alerts
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE — READ-ONLY SURFACE                                  ║
 * ║  Zero writes (alerts are WRITTEN only by /api/signals/scan's     ║
 * ║  governed insert). Tenant identity comes ONLY from the signed    ║
 * ║  handoff contract — never a client-supplied org id. The select   ║
 * ║  is an EXPLICIT column allowlist on public.intelligence_alerts   ║
 * ║  (id, headline, detail, severity, source_url, status,            ║
 * ║  created_at) — never select=*.                                   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * This is the dashboard feed any tenant / third-party front end consumes.
 *
 * Query params:
 *   status   — optional exact-match filter (e.g. 'open')
 *   severity — optional exact-match filter (e.g. 'high')
 *   limit    — default 50, max 200
 *
 * Response: { alerts: AlertRecord[] } (newest first)
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** EXPLICIT column allowlist for public.intelligence_alerts reads. */
const ALERT_SELECT = 'id,headline,detail,severity,source_url,status,created_at';

/** Filter values must look like plain status/severity tokens. */
const FILTER_RE = /^[A-Za-z0-9_-]{1,40}$/;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = await getSecret('INTEL_HANDOFF_SECRET');
  const tenant = resolveTenantFromRequest(req, secret);
  if (!tenant) {
    return NextResponse.json(
      { error: 'No valid tenant could be resolved for this request.' },
      { status: 401 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const severity = sp.get('severity');
  for (const [name, value] of [['status', status], ['severity', severity]] as const) {
    if (value !== null && !FILTER_RE.test(value)) {
      return NextResponse.json(
        { error: `"${name}" contains characters that are not allowed.` },
        { status: 400 },
      );
    }
  }
  const limit = clampLimit(sp.get('limit'));

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: 'The alert store is not configured.' },
      { status: 502 },
    );
  }

  try {
    // public schema — no Accept-Profile header (same convention as
    // monitoring-config's km_monitoring_config read).
    const url = new URL(`${supabaseUrl}/rest/v1/intelligence_alerts`);
    url.searchParams.set('select', ALERT_SELECT);
    url.searchParams.set('organization_id', `eq.${tenant}`);
    if (status !== null) url.searchParams.set('status', `eq.${status}`);
    if (severity !== null) url.searchParams.set('severity', `eq.${severity}`);
    url.searchParams.set('order', 'created_at.desc');
    url.searchParams.set('limit', String(limit));

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return storeUnreachable();

    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return storeUnreachable();

    const body: ListAlertsResponse = {
      alerts: rows
        .map(toAlertRecord)
        .filter((a): a is AlertRecord => a !== null),
    };
    return NextResponse.json(body);
  } catch {
    return storeUnreachable();
  }
}

function storeUnreachable(): NextResponse {
  return NextResponse.json(
    { error: 'The alert feed could not be loaded. Please retry.' },
    { status: 502 },
  );
}

function clampLimit(raw: string | null): number {
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

/** Explicit allowlist mapper — response stability, no blanket pass-through. */
function toAlertRecord(row: unknown): AlertRecord | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const id = str(r.id);
  const createdAt = str(r.created_at);
  if (!id || !createdAt) return null;
  return {
    id,
    headline: str(r.headline),
    detail: str(r.detail),
    severity: str(r.severity),
    source_url: str(r.source_url),
    status: str(r.status),
    created_at: createdAt,
  };
}
