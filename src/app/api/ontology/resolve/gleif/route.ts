import { NextRequest, NextResponse } from 'next/server';
import { requireBearerToken, verifySupabaseUserToken } from '@/lib/ontology/authRpc';
import { proposeUpdate } from '@/lib/ontology/propose';
import { normaliseCanonicalName } from '@/lib/ontology/resolve';
import { pickUniqueGleifMatch } from '@/lib/ontology/resolveExternal';
import { evaluate } from '@/lib/ai/analyze';
import type { ProposedEdit } from '@/lib/ontology/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * KINTEL Mission B — GLEIF LEI enrichment resolver
 * POST /api/ontology/resolve/gleif
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE BOUNDARY — READ BEFORE MODIFYING                     ║
 * ║                                                                  ║
 * ║  This route writes ONLY to intel.proposed_edit, and only rows    ║
 * ║  with status='pending' (kind='update_entity', payload {id,patch} ║
 * ║  = {lei}). It MUST NEVER write to intel.entity, intel.link,      ║
 * ║  intel.entity_provenance, or intel.crosswalk — those are written ║
 * ║  only by intel.approve_proposed_edit, after a human reviewer has ║
 * ║  approved the pending proposal this route creates.               ║
 * ║                                                                  ║
 * ║  Match rule is DETERMINISTIC, never fuzzy: an entity's canonical  ║
 * ║  name and a GLEIF record's legal name must be equal after        ║
 * ║  normaliseCanonicalName(), and exactly one GLEIF candidate must   ║
 * ║  satisfy that — see src/lib/ontology/resolveExternal.ts's         ║
 * ║  pickUniqueGleifMatch(). Zero or multiple candidates are both     ║
 * ║  first-class "do not guess" states (no-match / ambiguous), never  ║
 * ║  silently resolved to a best-effort pick.                         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Body: { tenant: string (org uuid), limit?: number (default 10, max 25) }
 * Flow: read up to `limit` intel.entity rows for the tenant with
 *       type='company' AND lei IS NULL -> query GLEIF per entity (exact
 *       legal-name filter) -> deterministic match -> proposeUpdate({lei}) ->
 *       evaluate() -> insert into intel.proposed_edit. Per-entity GLEIF
 *       failures are recorded and skipped; this route never throws for an
 *       upstream failure.
 *
 * Response: { proposed, skipped: { noMatch, ambiguous, alreadyPending, errors }, tenant }
 */

const DEFAULT_LIMIT     = 10;
const MAX_LIMIT          = 25;
const GLEIF_PROPOSED_BY  = 'gleif-resolver';
const UUID_RE            = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ResolveGleifBody {
  tenant?: unknown;
  limit?:  unknown;
}

// ---------------------------------------------------------------------------
// Auth gate — copied verbatim (dual-gate) from
// src/app/api/ontology/ingest/route.ts's authenticateIngestRequest, kept as
// an independent local copy (not a shared import) so this route's own
// governance boundary (intel.proposed_edit only) stays independently
// auditable and the ingest route itself is never touched by this work.
// Two independent, mutually-exclusive-in-practice paths:
//   (a) x-automate-secret header, compared against env AUTOMATE_SECRET.
//   (b) Authorization: Bearer <token>, verified against Supabase's own
//       /auth/v1/user endpoint via verifySupabaseUserToken().
// Never throws.
// ---------------------------------------------------------------------------

interface AuthOk  { ok: true }
interface AuthErr { ok: false; error: string }

async function authenticateResolveRequest(req: NextRequest): Promise<AuthOk | AuthErr> {
  const automateSecret = process.env.AUTOMATE_SECRET;
  const providedSecret  = req.headers.get('x-automate-secret');
  if (automateSecret && providedSecret && providedSecret === automateSecret) {
    return { ok: true };
  }

  const bearer = requireBearerToken(req);
  if (bearer.ok) {
    const verified = await verifySupabaseUserToken(bearer.token);
    if (verified.ok) return { ok: true };
    return { ok: false, error: verified.error };
  }

  return {
    ok:    false,
    error: providedSecret ? 'Invalid automate secret.' : bearer.error,
  };
}

// ---------------------------------------------------------------------------
// Service-role DB access (raw PostgREST fetch — mirrors
// src/app/api/ontology/ingest/route.ts; there is no supabase-js client in
// this server-side TS layer).
// ---------------------------------------------------------------------------

interface DbConfig {
  supabaseUrl:    string;
  serviceRoleKey: string;
}

function serviceConfig(): DbConfig | null {
  const supabaseUrl    = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey };
}

function intelHeaders(db: DbConfig): Record<string, string> {
  return {
    apikey:            db.serviceRoleKey,
    Authorization:      `Bearer ${db.serviceRoleKey}`,
    'Accept-Profile':  'intel',
  };
}

interface CandidateEntity {
  id:              string;
  canonical_name:  string | null;
}

/** Up to `limit` intel.entity rows for the tenant: type='company' AND lei IS NULL. */
async function fetchCandidateEntities(
  db:     DbConfig,
  tenant: string,
  limit:  number,
): Promise<CandidateEntity[]> {
  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/entity`);
    url.searchParams.set('tenant_id', `eq.${tenant}`);
    url.searchParams.set('type', 'eq.company');
    url.searchParams.set('lei', 'is.null');
    url.searchParams.set('select', 'id,canonical_name');
    url.searchParams.set('limit', String(limit));

    const res = await fetch(url.toString(), { headers: intelHeaders(db), cache: 'no-store' });
    if (!res.ok) return [];

    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return [];

    return rows
      .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
      .map((r) => ({
        id:             typeof r.id === 'string' ? r.id : '',
        canonical_name: typeof r.canonical_name === 'string' ? r.canonical_name : null,
      }))
      .filter((e) => e.id !== '');
  } catch {
    return [];
  }
}

/** Entity ids already targeted by a PENDING update_entity proposal for this tenant (idempotent re-runs). */
async function fetchAlreadyPendingIds(db: DbConfig, tenant: string): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/proposed_edit`);
    url.searchParams.set('tenant_id', `eq.${tenant}`);
    url.searchParams.set('status', 'eq.pending');
    url.searchParams.set('kind', 'eq.update_entity');
    url.searchParams.set('select', 'payload');

    const res = await fetch(url.toString(), { headers: intelHeaders(db), cache: 'no-store' });
    if (!res.ok) return ids;

    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return ids;

    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const payload = (row as Record<string, unknown>).payload;
      if (payload && typeof payload === 'object') {
        const id = (payload as Record<string, unknown>).id;
        if (typeof id === 'string' && id.length > 0) ids.add(id);
      }
    }
    return ids;
  } catch {
    return ids;
  }
}

interface GleifQueryOk  { ok: true;  records: unknown[] }
interface GleifQueryErr { ok: false }

/** GLEIF lookup by exact legal name. Never throws — network/parse failures resolve to ok:false. */
async function queryGleif(legalName: string): Promise<GleifQueryOk | GleifQueryErr> {
  try {
    const url = new URL('https://api.gleif.org/api/v1/lei-records');
    url.searchParams.set('filter[entity.legalName]', legalName);
    url.searchParams.set('page[size]', '5');

    const res = await fetch(url.toString(), {
      headers: {
        Accept:        'application/vnd.api+json',
        'User-Agent':  'Kammandor Intel research contact@kammandor.com',
      },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false };

    const raw: unknown = await res.json();
    const data =
      typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>).data)
        ? ((raw as Record<string, unknown>).data as unknown[])
        : [];

    return { ok: true, records: data };
  } catch {
    return { ok: false };
  }
}

/** The route's ONLY write: INSERT rows into intel.proposed_edit (status='pending'). */
async function insertProposedEdits(
  db:    DbConfig,
  edits: ProposedEdit[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${db.supabaseUrl}/rest/v1/proposed_edit`, {
      method: 'POST',
      headers: {
        apikey:            db.serviceRoleKey,
        Authorization:     `Bearer ${db.serviceRoleKey}`,
        'Content-Type':    'application/json',
        'Content-Profile': 'intel',
        Prefer:            'return=minimal',
      },
      body: JSON.stringify(edits),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `insert failed: HTTP ${res.status} ${detail.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'insert failed' };
  }
}

interface SkippedCounts {
  noMatch:        number;
  ambiguous:      number;
  alreadyPending: number;
  errors:         number;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateResolveRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  let body: ResolveGleifBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const tenant = typeof body.tenant === 'string' ? body.tenant.trim() : '';
  if (!tenant || !UUID_RE.test(tenant)) {
    return NextResponse.json({ error: '"tenant" must be an organisation uuid.' }, { status: 400 });
  }

  let limit = DEFAULT_LIMIT;
  if (typeof body.limit === 'number' && Number.isFinite(body.limit)) {
    limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(body.limit)));
  }

  const skipped: SkippedCounts = { noMatch: 0, ambiguous: 0, alreadyPending: 0, errors: 0 };

  const db = serviceConfig();
  if (!db) {
    return NextResponse.json({
      proposed: 0,
      skipped,
      tenant,
      note: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured',
    });
  }

  const [candidates, alreadyPendingIds] = await Promise.all([
    fetchCandidateEntities(db, tenant, limit),
    fetchAlreadyPendingIds(db, tenant),
  ]);

  const edits: ProposedEdit[] = [];

  for (const candidate of candidates) {
    if (alreadyPendingIds.has(candidate.id)) {
      skipped.alreadyPending += 1;
      continue;
    }

    const name = candidate.canonical_name ?? '';
    if (normaliseCanonicalName(name).length === 0) {
      skipped.noMatch += 1;
      continue;
    }

    const gleifResult = await queryGleif(name);
    if (!gleifResult.ok) {
      skipped.errors += 1;
      continue;
    }

    const outcome = pickUniqueGleifMatch(name, gleifResult.records);
    if (outcome.status === 'no-match') {
      skipped.noMatch += 1;
      continue;
    }
    if (outcome.status === 'ambiguous') {
      skipped.ambiguous += 1;
      continue;
    }

    const { lei, legalName } = outcome.match;
    const apiUrl =
      `https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=` +
      `${encodeURIComponent(name)}&page[size]=5`;
    const rationale =
      `GLEIF record match: legal name "${legalName}", LEI ${lei} (source: ${apiUrl}). ` +
      `Matched by the deterministic rule: normaliseCanonicalName(entity.canonical_name) === ` +
      `normaliseCanonicalName(gleif attributes.entity.legalName.name), with exactly one ` +
      `GLEIF candidate record satisfying it.`;

    const edit = proposeUpdate(tenant, 'update_entity', candidate.id, { lei }, GLEIF_PROPOSED_BY, rationale);
    edits.push({ ...edit, evaluation: evaluate(edit) });
  }

  if (edits.length === 0) {
    return NextResponse.json({ proposed: 0, skipped, tenant });
  }

  const insertResult = await insertProposedEdits(db, edits);
  if (!insertResult.ok) {
    return NextResponse.json(
      { error: insertResult.error, proposed: 0, skipped, tenant },
      { status: 502 },
    );
  }

  return NextResponse.json({ proposed: edits.length, skipped, tenant });
}
