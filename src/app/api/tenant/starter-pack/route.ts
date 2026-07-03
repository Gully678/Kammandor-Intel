import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';
import { requireBearerToken } from '@/lib/ontology/authRpc';
import { getStarterPack } from '@/config/starter-packs';
import type { StarterPack } from '@/config/starter-packs';
import { getSource } from '@/config/sources';

export const dynamic = 'force-dynamic';

/**
 * KINTEL v2.4 — Vertical starter-pack provisioning (PRD §17.5)
 * POST /api/tenant/starter-pack
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE BOUNDARY — READ BEFORE MODIFYING                          ║
 * ║                                                                        ║
 * ║  This route's ONLY write is an idempotent UPSERT into                  ║
 * ║  intel.tenant_source_flags (tenant-scoped source enablement).          ║
 * ║  It MUST NEVER write intel.entity / intel.link /                       ║
 * ║  intel.entity_provenance (sole-writer RPC law), never the ontology     ║
 * ║  catalogues, and never km_monitoring_config — starter-packs only       ║
 * ║  switch sources on/off; they never fabricate tenant data.              ║
 * ║                                                                        ║
 * ║  ROLE GATE: provisioning is restricted to cp_role in                   ║
 * ║  {super_admin, owner, admin}, read from the caller's Supabase JWT      ║
 * ║  app_metadata (the same claim path the main Kammandor app uses).       ║
 * ║  Fail closed: an opaque/undecodable bearer or a missing/other role     ║
 * ║  is a 403. auth_mode values written here MUST satisfy the CHECK in     ║
 * ║  migrations/intel/0002 ('none' | 'platform-key' | 'tenant-key').       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Auth (strictest existing pattern, layered):
 *   1. Bearer token required (requireBearerToken — same guard as
 *      /api/signals/scan and /api/ontology/ingest)              -> 401
 *   2. Explicit role claim: JWT app_metadata.cp_role must be a
 *      provisioning role                                        -> 403
 *   3. Tenant identity ONLY from the signed handoff contract
 *      (resolveTenantFromRequest — same as /api/signals/scan)   -> 401
 *
 * Body:     { pack: 'finance' | 'marketing' | 'generic' }
 * Response: 200 { pack, applied, sources } | 400 | 401 | 403 | 502
 * Idempotent: PostgREST upsert with on_conflict=tenant_id,source_key and
 * Prefer: resolution=merge-duplicates — re-provisioning never duplicates.
 */

/** Roles allowed to provision a starter-pack (Role Model v2). */
const PROVISIONING_ROLES: ReadonlySet<string> = new Set(['super_admin', 'owner', 'admin']);

interface StarterPackBody {
  pack?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await handleProvision(req);
  } catch {
    // Absolute backstop — never throw unhandled, never fail silently.
    return NextResponse.json(
      { error: 'Unexpected error while provisioning the starter-pack. Nothing was changed.' },
      { status: 500 },
    );
  }
}

async function handleProvision(req: NextRequest): Promise<NextResponse> {
  // -------------------------------------------------------------- auth (401)
  const auth = requireBearerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  // ---------------------------------------------------------- role gate (403)
  const role = readCpRoleFromJwt(auth.token);
  if (role === null || !PROVISIONING_ROLES.has(role)) {
    return NextResponse.json(
      { error: 'Only workspace owners and administrators can set up a starter-pack.' },
      { status: 403 },
    );
  }

  // ----------------------------------------------------- body + pack (400)
  let body: StarterPackBody;
  try {
    body = (await req.json()) as StarterPackBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const packKey = typeof body.pack === 'string' ? body.pack.trim() : '';
  const pack = packKey ? getStarterPack(packKey) : undefined;
  if (!pack) {
    return NextResponse.json(
      { error: '"pack" must be one of the available starter-packs: finance, marketing, generic.' },
      { status: 400 },
    );
  }

  // ------------------------------------------------------------ tenant (401)
  const secret = await getSecret('INTEL_HANDOFF_SECRET');
  const tenant = resolveTenantFromRequest(req, secret);
  if (!tenant) {
    return NextResponse.json(
      { error: 'No valid tenant could be resolved for this request.' },
      { status: 401 },
    );
  }

  // ----------------------------------------------------------- upsert (502)
  const result = await upsertTenantSourceFlags(tenant, pack);
  if (!result.ok) {
    return NextResponse.json(
      { error: 'The starter-pack could not be saved. Nothing was changed — please retry.' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    pack: pack.key,
    applied: pack.sources.length,
    sources: pack.sources,
  });
}

// ---------------------------------------------------------------------------
// Role claim — fail-closed JWT payload decode
// ---------------------------------------------------------------------------

/**
 * Read app_metadata.cp_role from a Supabase access token (JWT). This is an
 * EXPLICIT role-claim gate layered on top of the signed handoff contract —
 * it never widens access (fail closed): anything that is not a decodable
 * three-part JWT carrying a string cp_role resolves to null.
 */
function readCpRoleFromJwt(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payloadPart = parts[1];
  if (!payloadPart) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const appMetadata = (parsed as Record<string, unknown>).app_metadata;
  if (typeof appMetadata !== 'object' || appMetadata === null) return null;
  const cpRole = (appMetadata as Record<string, unknown>).cp_role;
  return typeof cpRole === 'string' && cpRole ? cpRole : null;
}

// ---------------------------------------------------------------------------
// DB access — raw PostgREST with the service-role key, matching the existing
// pattern in src/app/api/signals/scan/route.ts and src/app/api/ontology/
// ingest/route.ts (Content-Profile: intel; no supabase-js in this layer).
// ---------------------------------------------------------------------------

interface DbConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
}

function getDbConfig(): DbConfig | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey };
}

/** Row shape for intel.tenant_source_flags (migrations/intel/0002). */
interface TenantSourceFlagRow {
  tenant_id: string;
  source_key: string;
  enabled: boolean;
  /** MUST satisfy the 0002 CHECK: 'none' | 'platform-key' | 'tenant-key'. */
  auth_mode: 'none' | 'platform-key' | 'tenant-key';
}

/**
 * Idempotent upsert of one row per pack source. auth_mode mirrors the
 * source's own auth model from the SOURCES registry (the same enum the
 * 0002 CHECK constraint allows) — never the invalid literal 'platform',
 * and never 'tenant-key'-as-'platform-key' for BYOK sources.
 */
async function upsertTenantSourceFlags(
  tenant: string,
  pack: StarterPack,
): Promise<{ ok: boolean }> {
  const db = getDbConfig();
  if (!db) return { ok: false };

  const rows: TenantSourceFlagRow[] = pack.sources.map((s) => ({
    tenant_id: tenant,
    source_key: s.key,
    enabled: s.enabled,
    auth_mode: getSource(s.key)?.auth ?? 'none',
  }));

  try {
    const url = new URL(`${db.supabaseUrl}/rest/v1/tenant_source_flags`);
    url.searchParams.set('on_conflict', 'tenant_id,source_key');

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        apikey: db.serviceRoleKey,
        Authorization: `Bearer ${db.serviceRoleKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Profile': 'intel', // PostgREST: target the `intel` schema, not `public`
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
      cache: 'no-store',
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
