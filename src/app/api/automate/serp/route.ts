import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';
import { resolveSerpAdapter } from '@/lib/serp';
import type { SerpItem, SerpKind } from '@/lib/serp';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * KINTEL — SERP harvest (DataForSEO Google News + Organic → grounding/delta brain).
 * POST /api/automate/serp
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  For the caller's tenant, reads NAME-based watchlist subjects       ║
 * ║  (keyword / company / product), pulls Google News + Organic SERP    ║
 * ║  for each via the licensed DataForSEO Live/Advanced API, maps to    ║
 * ║  TYPED items (kind 'mention'), and PUSHES them per-subject to the   ║
 * ║  shipped net-new/grounding brain (POST /api/signals/harvest-delta). ║
 * ║  First sight baselines (0 signals); later runs signal only net-new  ║
 * ║  results (new URL) or net-changed (title/snippet hash moved).       ║
 * ║  Auth: handoff token OR (server) x-automate-secret + body.tenant.   ║
 * ║  Fully GATED: clean no-op + notes when DataForSEO keys / subjects   ║
 * ║  are absent; never throws.                                          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const MAX_SUBJECTS = 12;
const PER_KIND = 15;
const KINDS: SerpKind[] = ['news', 'organic'];

interface Db { supabaseUrl: string; serviceRoleKey: string; }
function db(): Db | null {
  const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return u && k ? { supabaseUrl: u, serviceRoleKey: k } : null;
}
function svc(cfg: Db): Record<string, string> {
  return { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}`, Accept: 'application/json', 'Accept-Profile': 'intel' };
}
function isUrl(v: string): boolean { return /^https?:\/\//i.test(v); }
function hash(s: string): string { return createHash('sha1').update(s).digest('hex'); }

/** Name-based subjects: keyword / company / product (skip anything that is a URL). */
async function loadSubjects(cfg: Db, tenant: string): Promise<string[]> {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/watchlist_item`);
  url.searchParams.set('tenant_id', `eq.${tenant}`);
  url.searchParams.set('active', 'eq.true');
  url.searchParams.set('select', 'value');
  url.searchParams.set('kind', 'in.(keyword,company,product)');
  const out: string[] = [];
  try {
    const res = await fetch(url.toString(), { headers: svc(cfg), cache: 'no-store' });
    if (!res.ok) return out;
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return out;
    for (const row of rows) {
      const v = typeof (row as Record<string, unknown>).value === 'string' ? ((row as Record<string, unknown>).value as string).trim() : '';
      if (v && !isUrl(v)) out.push(v);
    }
  } catch { /* degrade */ }
  return [...new Set(out)].slice(0, MAX_SUBJECTS);
}

interface DeltaItem { external_id: string; kind: 'mention'; title: string; url: string | null; content_hash: string; attributes: Record<string, unknown>; }
function toDeltaItem(it: SerpItem): DeltaItem {
  const ext = it.url ?? hash(`${it.kind}:${it.title}`);
  return {
    external_id: ext,
    kind: 'mention',
    title: it.title.slice(0, 300),
    url: it.url,
    content_hash: hash(`${it.title}|${it.snippet ?? ''}|${it.rank ?? ''}`),
    attributes: {
      serp: it.kind, domain: it.domain, source: it.source, rank: it.rank,
      snippet: it.snippet, timestamp: it.timestamp,
    },
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth mirrors /api/signals/harvest-delta.
  let tenant: string | null = null;
  let body: { tenant?: unknown } = {};
  try { body = await req.json(); } catch { /* optional body */ }
  const automate = process.env.AUTOMATE_SECRET;
  const provided = req.headers.get('x-automate-secret') ?? '';
  if (automate && provided && provided === automate && typeof body.tenant === 'string' && body.tenant) {
    tenant = body.tenant;
  } else {
    tenant = resolveTenantFromRequest(req, await getSecret('INTEL_HANDOFF_SECRET'));
  }
  if (!tenant) return NextResponse.json({ error: 'No valid tenant could be resolved for this request.' }, { status: 401 });

  const cfg = db();
  if (!cfg) return NextResponse.json({ error: 'The store is not configured.' }, { status: 502 });

  // Gate on DataForSEO credentials — clean no-op if absent.
  const login = await getSecret('DATAFORSEO_LOGIN');
  const key = await getSecret('DATAFORSEO_API_KEY');
  if (!login || !key) return NextResponse.json({ harvested: 0, subjects: 0, notes: ['DataForSEO keys not configured (DATAFORSEO_LOGIN + DATAFORSEO_API_KEY)'] });

  const subjects = await loadSubjects(cfg, tenant);
  if (subjects.length === 0) return NextResponse.json({ harvested: 0, subjects: 0, notes: ['no name-based subjects (add keyword/company/product items)'] });

  const adapter = resolveSerpAdapter();
  const secret = await getSecret('AUTOMATE_SECRET');
  const deltaUrl = new URL('/api/signals/harvest-delta', req.nextUrl.origin).toString();
  const notes: string[] = [];
  const results: Array<Record<string, unknown>> = [];

  for (const subject of subjects) {
    for (const kind of KINDS) {
      let items: SerpItem[] = [];
      try {
        const r = await adapter.getSerp({ keyword: subject, type: kind, limit: PER_KIND });
        items = r.items;
      } catch (err) {
        notes.push(`serp:${kind}:${subject} — ${err instanceof Error ? err.message : 'unavailable'}`);
        continue;
      }
      if (items.length === 0) continue;
      const deltaItems = items.map(toDeltaItem);
      if (!secret) { notes.push('AUTOMATE_SECRET not configured — cannot push to delta brain'); continue; }
      try {
        const res = await fetch(deltaUrl, {
          method: 'POST',
          headers: { 'x-automate-secret': secret, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant, subject, platform: `serp-${kind}`, items: deltaItems }),
          cache: 'no-store',
        });
        const out: unknown = res.ok ? await res.json() : { error: `delta HTTP ${res.status}` };
        results.push({ subject, kind, collected: deltaItems.length, delta: out });
      } catch (err) {
        notes.push(`delta:${kind}:${subject} — ${err instanceof Error ? err.message : 'push failed'}`);
      }
    }
  }

  return NextResponse.json({ subjects: subjects.length, harvested: results.length, results, notes });
}
