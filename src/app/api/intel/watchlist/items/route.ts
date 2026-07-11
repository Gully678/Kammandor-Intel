import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';

export const dynamic = 'force-dynamic';

/**
 * KINTEL — Typed watchlist items (the marketing subject list).
 * GET    /api/intel/watchlist/items?scope=&ref=   — list items
 * POST   /api/intel/watchlist/items               — set/add typed subjects
 * DELETE /api/intel/watchlist/items               — remove subjects
 *
 * A client-side advisor (via Kammandor or PULSE) manages people / companies /
 * products / creators / commentators / keywords / hashtags / handles / tickers /
 * geos / topics per watchlist (scope org|deal|campaign, ref = deal/campaign id).
 * Tenant identity comes ONLY from the signed handoff token — never the body.
 * Writes only intel.watchlist_item (engine-owned). The matcher flattens these
 * into its categories (see lib/signals/engineWatchlist.ts). No LLM, no truth.
 */

const SCOPES = new Set(['org', 'deal', 'campaign']);
const KINDS = new Set([
  'keyword', 'hashtag', 'handle', 'person', 'company', 'product',
  'creator', 'commentator', 'ticker', 'geo', 'topic',
]);
const MAX_ITEMS = 1000;
const RETURN_SELECT = 'id,tenant_id,scope,ref,kind,value,label,active,source,updated_at';

interface InItem { kind?: unknown; value?: unknown; label?: unknown; source?: unknown; }

function db() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return supabaseUrl && serviceRoleKey ? { supabaseUrl, serviceRoleKey } : null;
}
function headers(cfg: { serviceRoleKey: string }, write: boolean): Record<string, string> {
  const h: Record<string, string> = {
    apikey: cfg.serviceRoleKey,
    Authorization: `Bearer ${cfg.serviceRoleKey}`,
    Accept: 'application/json',
  };
  if (write) { h['Content-Type'] = 'application/json'; h['Content-Profile'] = 'intel'; }
  else h['Accept-Profile'] = 'intel';
  return h;
}
function scopeRef(v: unknown, fallback: string, max = 200): string {
  return typeof v === 'string' && v.trim().length <= max ? v.trim() : fallback;
}
async function tenantOf(req: NextRequest): Promise<string | null> {
  const secret = await getSecret('INTEL_HANDOFF_SECRET');
  return resolveTenantFromRequest(req, secret);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenant = await tenantOf(req);
  if (!tenant) return NextResponse.json({ error: 'No valid tenant could be resolved for this request.' }, { status: 401 });
  const cfg = db();
  if (!cfg) return NextResponse.json({ error: 'The watchlist store is not configured.' }, { status: 502 });

  const sp = req.nextUrl.searchParams;
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/watchlist_item`);
  url.searchParams.set('tenant_id', `eq.${tenant}`);
  if (sp.get('scope') && SCOPES.has(sp.get('scope')!)) url.searchParams.set('scope', `eq.${sp.get('scope')}`);
  if (sp.get('ref') !== null) url.searchParams.set('ref', `eq.${sp.get('ref')}`);
  url.searchParams.set('active', 'eq.true');
  url.searchParams.set('select', RETURN_SELECT);
  url.searchParams.set('order', 'kind.asc,value.asc');
  try {
    const res = await fetch(url.toString(), { headers: headers(cfg, false), cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ error: 'The watchlist items could not be loaded.' }, { status: 502 });
    const rows: unknown = await res.json();
    return NextResponse.json({ items: Array.isArray(rows) ? rows : [] });
  } catch {
    return NextResponse.json({ error: 'The watchlist items could not be loaded.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenant = await tenantOf(req);
  if (!tenant) return NextResponse.json({ error: 'No valid tenant could be resolved for this request.' }, { status: 401 });
  const cfg = db();
  if (!cfg) return NextResponse.json({ error: 'The watchlist store is not configured.' }, { status: 502 });

  let body: { scope?: unknown; ref?: unknown; mode?: unknown; items?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }

  const scope = typeof body.scope === 'string' && SCOPES.has(body.scope) ? body.scope : 'org';
  const ref = scopeRef(body.ref, '');
  const mode = body.mode === 'add' ? 'add' : 'replace';

  if (!Array.isArray(body.items)) return NextResponse.json({ error: '"items" (array) is required.' }, { status: 400 });
  // validate + dedupe (kind + lower(value))
  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  for (const raw of body.items as InItem[]) {
    if (!raw || typeof raw !== 'object') continue;
    const kind = typeof raw.kind === 'string' ? raw.kind : '';
    const value = typeof raw.value === 'string' ? raw.value.trim() : '';
    if (!KINDS.has(kind) || value === '' || value.length > 200) continue;
    const dk = `${kind}::${value.toLowerCase()}`;
    if (seen.has(dk)) continue;
    seen.add(dk);
    rows.push({
      tenant_id: tenant, scope, ref, kind, value,
      label: typeof raw.label === 'string' ? raw.label.slice(0, 200) : null,
      source: typeof raw.source === 'string' ? raw.source.slice(0, 60) : null,
      active: true,
    });
    if (rows.length >= MAX_ITEMS) break;
  }
  if (rows.length === 0) return NextResponse.json({ error: 'No valid items (need {kind, value}).' }, { status: 400 });

  try {
    // 'replace' clears the existing set for this (tenant, scope, ref) first.
    if (mode === 'replace') {
      const del = new URL(`${cfg.supabaseUrl}/rest/v1/watchlist_item`);
      del.searchParams.set('tenant_id', `eq.${tenant}`);
      del.searchParams.set('scope', `eq.${scope}`);
      del.searchParams.set('ref', `eq.${ref}`);
      const dr = await fetch(del.toString(), { method: 'DELETE', headers: headers(cfg, true), cache: 'no-store' });
      if (!dr.ok) return NextResponse.json({ error: 'Could not reset the item set.' }, { status: 502 });
    }
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/watchlist_item`);
    // ignore exact dupes (add mode re-posting existing) — the unique index guards it
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { ...headers(cfg, true), Prefer: 'return=representation,resolution=ignore-duplicates' },
      body: JSON.stringify(rows),
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ error: 'The watchlist items could not be saved.' }, { status: 502 });
    const saved: unknown = await res.json();
    return NextResponse.json({ ok: true, scope, ref, mode, count: Array.isArray(saved) ? saved.length : 0, items: saved });
  } catch {
    return NextResponse.json({ error: 'The watchlist items could not be saved.' }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const tenant = await tenantOf(req);
  if (!tenant) return NextResponse.json({ error: 'No valid tenant could be resolved for this request.' }, { status: 401 });
  const cfg = db();
  if (!cfg) return NextResponse.json({ error: 'The watchlist store is not configured.' }, { status: 502 });

  let body: { scope?: unknown; ref?: unknown; ids?: unknown; kinds?: unknown; values?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  const url = new URL(`${cfg.supabaseUrl}/rest/v1/watchlist_item`);
  url.searchParams.set('tenant_id', `eq.${tenant}`);
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
  if (ids.length > 0) {
    url.searchParams.set('id', `in.(${ids.join(',')})`);
  } else {
    const scope = typeof body.scope === 'string' && SCOPES.has(body.scope) ? body.scope : 'org';
    url.searchParams.set('scope', `eq.${scope}`);
    url.searchParams.set('ref', `eq.${scopeRef(body.ref, '')}`);
    const kinds = Array.isArray(body.kinds) ? body.kinds.filter((x): x is string => typeof x === 'string' && KINDS.has(x)) : [];
    const values = Array.isArray(body.values) ? body.values.filter((x): x is string => typeof x === 'string') : [];
    if (kinds.length > 0) url.searchParams.set('kind', `in.(${kinds.join(',')})`);
    if (values.length > 0) url.searchParams.set('value', `in.(${values.map((v) => `"${v.replace(/"/g, '')}"`).join(',')})`);
  }

  try {
    const res = await fetch(url.toString(), {
      method: 'DELETE',
      headers: { ...headers(cfg, true), Prefer: 'return=representation' },
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ error: 'The watchlist items could not be removed.' }, { status: 502 });
    const removed: unknown = await res.json();
    return NextResponse.json({ ok: true, removed: Array.isArray(removed) ? removed.length : 0 });
  } catch {
    return NextResponse.json({ error: 'The watchlist items could not be removed.' }, { status: 502 });
  }
}
