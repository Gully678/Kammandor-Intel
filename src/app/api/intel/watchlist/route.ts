import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';

export const dynamic = 'force-dynamic';

/**
 * KINTEL — Tenant watchlist ingress (the cross-Supabase hub contract).
 * POST /api/intel/watchlist   — upsert a watchlist for the caller's tenant
 * GET  /api/intel/watchlist   — list the caller's watchlists
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE — this is how INVRT/PULSE (a DIFFERENT Supabase) and   ║
 * ║  Kammandor-main tell the hub WHAT TO WATCH over HTTP. Tenant       ║
 * ║  identity comes ONLY from the signed handoff token — NEVER from    ║
 * ║  the body. The ONLY write is an upsert into intel.tenant_watchlist ║
 * ║  (engine-owned; the boundary that forbids the engine writing km_*  ║
 * ║  tables is preserved). The signal matcher then reads the UNION of  ║
 * ║  km_monitoring_config + intel.tenant_watchlist. No LLM, no truth   ║
 * ║  write, no figure. Terms are validated + capped.                   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Body (all optional except that at least one term array should be non-empty):
 *   { scope?: 'org'|'deal'|'campaign' (default 'org'),
 *     ref?: string (deal code / campaign id; default ''),
 *     label?: string, source?: string, active?: boolean,
 *     keywords?: string[], entities?: string[], tickers?: string[],
 *     handles?: string[], geos?: string[] }
 * Upsert key: (tenant, scope, ref). Response: the stored row (allowlist).
 */

const SCOPES = new Set(['org', 'deal', 'campaign']);
const MAX_TERMS = 500;
const MAX_TERM_LEN = 200;
const RETURN_SELECT =
  'id,tenant_id,scope,ref,label,keywords,entities,tickers,handles,geos,active,source,updated_at';

interface Body {
  scope?: unknown; ref?: unknown; label?: unknown; source?: unknown; active?: unknown;
  keywords?: unknown; entities?: unknown; tickers?: unknown; handles?: unknown; geos?: unknown;
}

function cleanTerms(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const t = x.trim();
    if (t !== '' && t.length <= MAX_TERM_LEN) out.push(t);
    if (out.length >= MAX_TERMS) break;
  }
  return [...new Set(out)];
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length <= max ? t : t.slice(0, max);
}

function db() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return supabaseUrl && serviceRoleKey ? { supabaseUrl, serviceRoleKey } : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = await getSecret('INTEL_HANDOFF_SECRET');
  const tenant = resolveTenantFromRequest(req, secret);
  if (!tenant) {
    return NextResponse.json({ error: 'No valid tenant could be resolved for this request.' }, { status: 401 });
  }

  let body: Body;
  try { body = (await req.json()) as Body; } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const scope = typeof body.scope === 'string' && SCOPES.has(body.scope) ? body.scope : 'org';
  const ref = str(body.ref, 200) ?? '';
  const row = {
    tenant_id: tenant,             // from the verified token — never the body
    scope,
    ref,
    label: str(body.label, 200),
    source: str(body.source, 60),
    active: typeof body.active === 'boolean' ? body.active : true,
    keywords: cleanTerms(body.keywords),
    entities: cleanTerms(body.entities),
    tickers: cleanTerms(body.tickers),
    handles: cleanTerms(body.handles),
    geos: cleanTerms(body.geos),
  };

  const cfg = db();
  if (!cfg) return NextResponse.json({ error: 'The watchlist store is not configured.' }, { status: 502 });

  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/tenant_watchlist`);
    url.searchParams.set('on_conflict', 'tenant_id,scope,ref');
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        apikey: cfg.serviceRoleKey,
        Authorization: `Bearer ${cfg.serviceRoleKey}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'intel',
        Prefer: 'resolution=merge-duplicates,return=representation',
        Accept: 'application/json',
      },
      body: JSON.stringify(row),
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'The watchlist could not be saved.' }, { status: 502 });
    }
    const rows: unknown = await res.json();
    const saved = Array.isArray(rows) ? rows[0] : rows;
    return NextResponse.json({ ok: true, watchlist: saved });
  } catch {
    return NextResponse.json({ error: 'The watchlist could not be saved.' }, { status: 502 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = await getSecret('INTEL_HANDOFF_SECRET');
  const tenant = resolveTenantFromRequest(req, secret);
  if (!tenant) {
    return NextResponse.json({ error: 'No valid tenant could be resolved for this request.' }, { status: 401 });
  }
  const cfg = db();
  if (!cfg) return NextResponse.json({ error: 'The watchlist store is not configured.' }, { status: 502 });

  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/tenant_watchlist`);
    url.searchParams.set('tenant_id', `eq.${tenant}`);
    url.searchParams.set('select', RETURN_SELECT);
    url.searchParams.set('order', 'scope.asc,ref.asc');
    const res = await fetch(url.toString(), {
      headers: {
        apikey: cfg.serviceRoleKey,
        Authorization: `Bearer ${cfg.serviceRoleKey}`,
        Accept: 'application/json',
        'Accept-Profile': 'intel',
      },
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ error: 'The watchlist could not be loaded.' }, { status: 502 });
    const rows: unknown = await res.json();
    return NextResponse.json({ watchlists: Array.isArray(rows) ? rows : [] });
  } catch {
    return NextResponse.json({ error: 'The watchlist could not be loaded.' }, { status: 502 });
  }
}
