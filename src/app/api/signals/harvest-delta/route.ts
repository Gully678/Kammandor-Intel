import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';
import type { IntelligenceAlertRow, SignalSeverity } from '@/lib/signals/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * KINTEL — Net-new / net-changed / grounding harvest brain (the live heartbeat).
 * POST /api/signals/harvest-delta
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  Feeder-agnostic: the engine's Python harvest agent OR PULSE (which║
 * ║  already scrapes Bright Data) pushes the TYPED items it collected  ║
 * ║  for a watched subject. The engine does GROUNDING + delta:         ║
 * ║   • FIRST sight of a subject → record ALL items as a baseline;     ║
 * ║     signal NOTHING (grounding data to learn from).                 ║
 * ║   • LATER runs → an item signals if its external_id is NET-NEW, OR ║
 * ║     its content_hash CHANGED (e.g. a price change on the same id). ║
 * ║  Signals are TYPED (post/new_product/price_change/job_listing/     ║
 * ║  review/mention) with a DETERMINISTIC severity — no LLM, no figure ║
 * ║  invented (attributes come verbatim from the feeder).              ║
 * ║  Auth: signed handoff token, OR (server) x-automate-secret +       ║
 * ║  body.tenant. Only write is public.intelligence_alerts +           ║
 * ║  intel.harvest_seen/cursor.                                        ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Body: { subject, platform?, items: [{ external_id, kind?, title?, url?,
 *          content_hash?, occurredAt?, attributes? }] }
 *   kind ∈ post | new_product | price_change | job_listing | review | mention
 *   attributes: free-form structured detail (engagement, sentiment, price,
 *   old_price, new_price, role, rating…) — surfaced verbatim in the alert.
 */

const MAX_ITEMS = 500;
type Kind = 'post' | 'new_product' | 'price_change' | 'job_listing' | 'review' | 'mention';
const KINDS = new Set<Kind>(['post', 'new_product', 'price_change', 'job_listing', 'review', 'mention']);

interface Db { supabaseUrl: string; serviceRoleKey: string; }
function db(): Db | null {
  const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return u && k ? { supabaseUrl: u, serviceRoleKey: k } : null;
}
function h(cfg: Db, write = false, prefer?: string): Record<string, string> {
  const x: Record<string, string> = { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}`, Accept: 'application/json' };
  if (write) { x['Content-Type'] = 'application/json'; x['Content-Profile'] = 'intel'; } else x['Accept-Profile'] = 'intel';
  if (prefer) x.Prefer = prefer;
  return x;
}
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}
function attrStr(attrs: Record<string, unknown> | null): string {
  if (!attrs) return '';
  return Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

interface CleanItem {
  external_id: string; kind: Kind; title: string; url: string | null;
  content_hash: string | null; attributes: Record<string, unknown> | null;
}

/** Deterministic, typed alert (no LLM). Severity is a rule per event kind + a few attribute escalations. */
function buildAlert(tenant: string, subject: string, it: CleanItem, changed: boolean): IntelligenceAlertRow {
  const a = it.attributes ?? {};
  const sentiment = typeof a.sentiment === 'string' ? a.sentiment.toLowerCase() : '';
  const rating = typeof a.rating === 'number' ? a.rating : undefined;
  let severity: SignalSeverity = 'BACKGROUND';
  let headline: string;

  switch (it.kind) {
    case 'price_change':
      severity = 'NOTABLE';
      headline = `Price change — ${it.title}`;
      break;
    case 'new_product':
      severity = 'NOTABLE';
      headline = `New product — ${it.title}`;
      break;
    case 'job_listing':
      severity = 'BACKGROUND';
      headline = `New job listing — ${it.title}`;
      break;
    case 'review':
      severity = rating !== undefined && rating <= 2 ? 'NOTABLE' : 'BACKGROUND';
      headline = `New review${rating !== undefined ? ` (${rating}★)` : ''} — ${it.title}`;
      break;
    case 'post':
      severity = sentiment === 'negative' ? 'NOTABLE' : 'BACKGROUND';
      headline = `New post — ${it.title}`;
      break;
    default:
      severity = 'BACKGROUND';
      headline = it.title;
  }
  const detail = [
    `Subject: ${subject}`,
    changed ? 'Change detected (value updated)' : 'Net-new since grounding baseline',
    attrStr(a),
  ].filter(Boolean).join('\n\n');
  return {
    organization_id: tenant,
    headline: headline.slice(0, 240),
    detail,
    severity,
    source_url: it.url,
    status: 'open',
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { subject?: unknown; platform?: unknown; items?: unknown; tenant?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }

  let tenant: string | null = null;
  const automate = process.env.AUTOMATE_SECRET;
  const provided = req.headers.get('x-automate-secret') ?? '';
  if (automate && provided && timingSafeEq(provided, automate) && typeof body.tenant === 'string' && body.tenant) {
    tenant = body.tenant;
  } else {
    tenant = resolveTenantFromRequest(req, await getSecret('INTEL_HANDOFF_SECRET'));
  }
  if (!tenant) return NextResponse.json({ error: 'No valid tenant could be resolved for this request.' }, { status: 401 });

  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const platform = typeof body.platform === 'string' ? body.platform.trim().slice(0, 40) : '';
  if (!subject) return NextResponse.json({ error: '"subject" is required.' }, { status: 400 });
  if (!Array.isArray(body.items)) return NextResponse.json({ error: '"items" (array) is required.' }, { status: 400 });

  interface InItem { external_id?: unknown; kind?: unknown; title?: unknown; url?: unknown; content_hash?: unknown; attributes?: unknown; }
  const dedupe = new Set<string>();
  const items: CleanItem[] = (body.items as InItem[]).map((it): CleanItem | null => {
    if (!it || typeof it !== 'object') return null;
    const ext = typeof it.external_id === 'string' ? it.external_id.trim() : '';
    if (!ext || dedupe.has(ext)) return null;
    dedupe.add(ext);
    const kind: Kind = typeof it.kind === 'string' && KINDS.has(it.kind as Kind) ? (it.kind as Kind) : 'mention';
    return {
      external_id: ext, kind,
      title: typeof it.title === 'string' && it.title ? it.title.slice(0, 300) : `Item ${ext}`,
      url: typeof it.url === 'string' ? it.url : null,
      content_hash: typeof it.content_hash === 'string' ? it.content_hash.slice(0, 200) : null,
      attributes: it.attributes && typeof it.attributes === 'object' ? (it.attributes as Record<string, unknown>) : null,
    };
  }).filter((x): x is CleanItem => x !== null).slice(0, MAX_ITEMS);

  if (items.length === 0) return NextResponse.json({ subject, grounded: false, baselined: 0, net_new: 0, net_changed: 0, signalled: 0 });

  const cfg = db();
  if (!cfg) return NextResponse.json({ error: 'The store is not configured.' }, { status: 502 });

  try {
    // grounded?
    const cUrl = new URL(`${cfg.supabaseUrl}/rest/v1/harvest_cursor`);
    cUrl.searchParams.set('tenant_id', `eq.${tenant}`); cUrl.searchParams.set('subject', `eq.${subject}`); cUrl.searchParams.set('select', 'grounded');
    const cRes = await fetch(cUrl.toString(), { headers: h(cfg), cache: 'no-store' });
    const cRows: unknown = cRes.ok ? await cRes.json() : [];
    const grounded = Array.isArray(cRows) && cRows.length > 0 && (cRows[0] as Record<string, unknown>).grounded === true;

    // existing external_id → content_hash (to classify net-new vs net-changed)
    const prev = new Map<string, string | null>();
    const ids = items.map((i) => `"${i.external_id.replace(/"/g, '')}"`).join(',');
    const eUrl = new URL(`${cfg.supabaseUrl}/rest/v1/harvest_seen`);
    eUrl.searchParams.set('tenant_id', `eq.${tenant}`); eUrl.searchParams.set('subject', `eq.${subject}`);
    eUrl.searchParams.set('external_id', `in.(${ids})`); eUrl.searchParams.set('select', 'external_id,content_hash');
    const eRes = await fetch(eUrl.toString(), { headers: h(cfg), cache: 'no-store' });
    if (eRes.ok) {
      const rows: unknown = await eRes.json();
      if (Array.isArray(rows)) for (const r of rows) {
        const rr = r as Record<string, unknown>;
        if (typeof rr.external_id === 'string') prev.set(rr.external_id, typeof rr.content_hash === 'string' ? rr.content_hash : null);
      }
    }

    const isNew = (i: CleanItem) => !prev.has(i.external_id);
    const isChanged = (i: CleanItem) => prev.has(i.external_id) && (prev.get(i.external_id) ?? null) !== (i.content_hash ?? null) && i.content_hash !== null;

    // upsert all seen rows (records baseline + updates content_hash on change)
    const seenRows = items.map((i) => ({
      tenant_id: tenant, subject, platform, external_id: i.external_id,
      title: i.title, url: i.url, content_hash: i.content_hash, kind: i.kind, attributes: i.attributes, seen_at: new Date().toISOString(),
    }));
    const upRes = await fetch(`${cfg.supabaseUrl}/rest/v1/harvest_seen?on_conflict=tenant_id,subject,external_id`, {
      method: 'POST', headers: h(cfg, true, 'resolution=merge-duplicates,return=minimal'), body: JSON.stringify(seenRows), cache: 'no-store',
    });
    if (!upRes.ok) return NextResponse.json({ error: 'harvest_seen write failed.' }, { status: 502 });

    await fetch(`${cfg.supabaseUrl}/rest/v1/harvest_cursor?on_conflict=tenant_id,subject`, {
      method: 'POST', headers: h(cfg, true, 'resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify({ tenant_id: tenant, subject, platform, grounded: true, last_run_at: new Date().toISOString() }), cache: 'no-store',
    });

    if (!grounded) {
      return NextResponse.json({ subject, grounded: true, baselined: items.length, net_new: 0, net_changed: 0, signalled: 0 });
    }

    const deltas = items.filter((i) => isNew(i) || isChanged(i));
    const netNew = deltas.filter(isNew).length;
    const netChanged = deltas.length - netNew;
    if (deltas.length === 0) return NextResponse.json({ subject, grounded: true, net_new: 0, net_changed: 0, signalled: 0 });

    const rows: IntelligenceAlertRow[] = deltas.map((i) => buildAlert(tenant, subject, i, isChanged(i)));
    const aRes = await fetch(`${cfg.supabaseUrl}/rest/v1/intelligence_alerts`, {
      method: 'POST', headers: { ...h(cfg, true), Prefer: 'return=minimal' }, body: JSON.stringify(rows), cache: 'no-store',
    });
    if (!aRes.ok) return NextResponse.json({ subject, grounded: true, net_new: netNew, net_changed: netChanged, signalled: 0, error: 'alert insert failed' }, { status: 502 });
    return NextResponse.json({ subject, grounded: true, net_new: netNew, net_changed: netChanged, signalled: rows.length });
  } catch {
    return NextResponse.json({ error: 'harvest-delta failed.' }, { status: 502 });
  }
}
