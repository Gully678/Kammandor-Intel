import { NextRequest, NextResponse } from 'next/server';
import { requireBearerToken, verifySupabaseUserToken } from '@/lib/ontology/authRpc';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Mission B — entity resolution, first-party leg.
 * POST /api/ontology/crosswalk/sync  { tenant: <org uuid> }
 *
 * Populates intel.entity_crosswalk (ontology entity -> Kammandor domain row)
 * for entities born from the 'kammandor-deals' source, whose ids ARE the
 * source rows' uuids by construction (see mappers/kammandor-deals.ts).
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE — WHY THIS MAY WRITE intel.entity_crosswalk DIRECTLY  ║
 * ║                                                                    ║
 * ║  The ONLY matching rule permitted here is UUID EQUALITY between   ║
 * ║  intel.entity.id and the tenant's own public.companies /          ║
 * ║  public.contacts / public.deals row id — a deterministic identity ║
 * ║  proof, not an inference. Anything fuzzier (name similarity,       ║
 * ║  LEI lookups, sanctions matches) is FORBIDDEN in this route and    ║
 * ║  must go through the governed proposal/review paths                ║
 * ║  (/api/ontology/resolve/*, /api/ontology/screen/*).                ║
 * ║  This route NEVER writes intel.entity / link / entity_provenance.  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth: automate secret (server-to-server) OR a verified Supabase user token.
  const secret = process.env.AUTOMATE_SECRET;
  const provided = req.headers.get('x-automate-secret');
  let authed = Boolean(secret && provided && provided === secret);
  if (!authed) {
    const bearer = requireBearerToken(req);
    if (bearer.ok) {
      const verified = await verifySupabaseUserToken(bearer.token);
      authed = verified.ok;
    }
  }
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  let body: { tenant?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const tenant = typeof body.tenant === 'string' ? body.tenant.trim() : '';
  if (!UUID_RE.test(tenant)) {
    return NextResponse.json({ error: '"tenant" must be an organisation uuid.' }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Supabase not configured.' }, { status: 500 });
  }
  const base: Record<string, string> = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
  const intelRead: Record<string, string> = { ...base, 'Accept-Profile': 'intel' };

  const get = async (path: string, headers: Record<string, string>): Promise<unknown[]> => {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`crosswalk read ${path.split('?')[0]}: HTTP ${res.status}`);
    const data: unknown = await res.json();
    return Array.isArray(data) ? data : [];
  };
  const idsOf = (rows: unknown[]): Set<string> => new Set(
    rows.map(r => (r as { id?: unknown }).id).filter((v): v is string => typeof v === 'string').map(v => v.toLowerCase()),
  );

  try {
    const [entities, existing, companies, contacts, deals] = await Promise.all([
      get(`entity?tenant_id=eq.${tenant}&select=id,type`, intelRead),
      get(`entity_crosswalk?select=entity_id`, intelRead),
      get(`companies?organization_id=eq.${tenant}&select=id`, base),
      get(`contacts?organization_id=eq.${tenant}&select=id`, base),
      get(`deals?organization_id=eq.${tenant}&select=id`, base),
    ]);

    const linked = new Set(
      existing.map(r => (r as { entity_id?: unknown }).entity_id)
        .filter((v): v is string => typeof v === 'string').map(v => v.toLowerCase()),
    );
    const companyIds = idsOf(companies);
    const contactIds = idsOf(contacts);
    const dealIds = idsOf(deals);

    const rows: Record<string, string>[] = [];
    let alreadyLinked = 0;
    const counts = { companies: 0, people: 0, deals: 0 };

    for (const e of entities as { id?: unknown }[]) {
      const id = typeof e.id === 'string' ? e.id.toLowerCase() : null;
      if (!id) continue;
      if (linked.has(id)) { alreadyLinked++; continue; }
      // UUID EQUALITY ONLY — the deterministic identity proof (see banner).
      if (companyIds.has(id))      { rows.push({ entity_id: id, company_id: id });  counts.companies++; }
      else if (contactIds.has(id)) { rows.push({ entity_id: id, contact_id: id });  counts.people++; }
      else if (dealIds.has(id))    { rows.push({ entity_id: id, km_deal_id: id });  counts.deals++; }
    }

    if (rows.length > 0) {
      const res = await fetch(`${supabaseUrl}/rest/v1/entity_crosswalk`, {
        method: 'POST',
        headers: {
          ...base,
          'Content-Type': 'application/json',
          'Content-Profile': 'intel',
          Prefer: 'return=minimal,resolution=ignore-duplicates',
        },
        body: JSON.stringify(rows),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return NextResponse.json(
          { error: `crosswalk insert failed: HTTP ${res.status} ${detail.slice(0, 200)}` },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({ linked: counts, total: rows.length, alreadyLinked, tenant });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'crosswalk sync failed' },
      { status: 502 },
    );
  }
}
