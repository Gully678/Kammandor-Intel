import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';
import {
  ENTITY_SELECT,
  getDbConfig,
  isEntityType,
  intelSelect,
  toObjectSummary,
} from './shared';
import type { ListObjectsResponse, ObjectSummary } from '@/lib/sdk/intel/types';

export const dynamic = 'force-dynamic';

/**
 * KINTEL v2.3 — Headless read surface: object list (PRD §10.1)
 * GET /api/ontology/objects
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE — READ-ONLY SURFACE                                  ║
 * ║  This route performs zero writes. Tenant identity comes ONLY     ║
 * ║  from the signed handoff contract (resolveTenantFromRequest),    ║
 * ║  never from a client-supplied org id. Every select is scoped     ║
 * ║  eq.tenant_id and uses the EXPLICIT intel.entity column          ║
 * ║  allowlist in ./shared.ts — never select=*.                      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Query params:
 *   type   — optional, validated against ENTITY_TYPES (400 otherwise)
 *   q      — optional case-insensitive canonical_name search
 *   limit  — default 50, max 200
 *   cursor — created_at keyset cursor (the previous page's nextCursor)
 *
 * Response: { objects: ObjectSummary[], nextCursor: string | null }
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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

  const type = sp.get('type');
  if (type !== null && !isEntityType(type)) {
    return NextResponse.json(
      { error: `Unknown object type "${type}".` },
      { status: 400 },
    );
  }

  const q = sanitiseSearchTerm(sp.get('q'));

  const limit = clampLimit(sp.get('limit'));

  const cursor = sp.get('cursor');
  if (cursor !== null && Number.isNaN(Date.parse(cursor))) {
    return NextResponse.json(
      { error: '"cursor" must be the nextCursor value from a previous page.' },
      { status: 400 },
    );
  }

  const db = getDbConfig();
  if (!db) {
    return NextResponse.json(
      { error: 'The object store is not configured.' },
      { status: 502 },
    );
  }

  const params = new URLSearchParams();
  params.set('select', ENTITY_SELECT);
  params.set('tenant_id', `eq.${tenant}`);
  if (type !== null) params.set('type', `eq.${type}`);
  if (q) params.set('canonical_name', `ilike.*${q}*`);
  if (cursor !== null) params.set('created_at', `lt.${cursor}`);
  params.set('order', 'created_at.desc,id.desc');
  params.set('limit', String(limit));

  const rows = await intelSelect(db, 'entity', params);
  if (rows === null) {
    return NextResponse.json(
      { error: 'The object store could not be reached. Please retry.' },
      { status: 502 },
    );
  }

  const objects = rows
    .map(toObjectSummary)
    .filter((o): o is ObjectSummary => o !== null);

  // created_at keyset: a full page means there may be more.
  const last = objects[objects.length - 1];
  const body: ListObjectsResponse = {
    objects,
    nextCursor: rows.length === limit && last ? last.created_at : null,
  };

  return NextResponse.json(body);
}

function clampLimit(raw: string | null): number {
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

/**
 * Keep the search term safe inside a PostgREST `ilike.*…*` filter: strip
 * PostgREST/SQL pattern metacharacters and cap the length. Returns null
 * when nothing searchable remains.
 */
function sanitiseSearchTerm(raw: string | null): string | null {
  if (raw === null) return null;
  const cleaned = raw.replace(/[%_*,()."\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  return cleaned.length > 0 ? cleaned : null;
}
