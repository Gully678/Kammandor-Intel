import { NextRequest, NextResponse } from 'next/server';
import {
  requireBearerToken,
  callIntelRpcAsUser,
  statusForPostgrestError,
} from '@/lib/ontology/authRpc';

export const dynamic = 'force-dynamic';

/**
 * KINTEL Phase 2 — Ontology governed reject
 * POST /api/ontology/proposed-edit/[id]/reject
 *
 * Same governance model as ../approve/route.ts: this route is a thin,
 * unprivileged pass-through. It forwards the caller's own bearer token to
 * intel.reject_proposed_edit() via PostgREST; that SECURITY DEFINER
 * function enforces tenant + role authz in SQL (see
 * migrations/intel/0012_approve_reject_proposed_edit.sql). NEVER call the
 * RPC with the service-role key here.
 *
 * Auth: REQUIRES `Authorization: Bearer <supabase access token>`. 401 if
 * missing/malformed.
 *
 * Body (optional): { reason?: string } — forwarded as p_reason. Note: as of
 * migration 0009, intel.proposed_edit has no reason/notes column, so the
 * reason is currently accepted but not persisted (see 0012's comment).
 *
 * Response:
 *   200 {}
 *   400 { error } — bad id, or the RPC rejected the edit's own state
 *   401 { error } — missing/malformed Authorization header
 *   403 { error } — RPC denied: anon-shaped JWT, cross-tenant, non-approver role
 *   404 { error } — proposed_edit id does not exist
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = requireBearerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: '"id" path parameter is required.' }, { status: 400 });
  }

  let reason: string | null = null;
  try {
    const body: unknown = await req.json();
    if (typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).reason === 'string') {
      reason = (body as Record<string, unknown>).reason as string;
    }
  } catch {
    // No body / invalid JSON is fine — reason is optional.
  }

  const result = await callIntelRpcAsUser(
    'reject_proposed_edit',
    { p_edit_id: id, p_reason: reason },
    auth.token,
  );

  if (!result.ok) {
    const status = result.status === 500 || result.status === 502
      ? result.status
      : statusForPostgrestError(result.body);
    return NextResponse.json(
      { error: extractErrorMessage(result.body) },
      { status },
    );
  }

  return NextResponse.json({});
}

function extractErrorMessage(body: unknown): string {
  if (typeof body === 'string') return body;
  if (typeof body === 'object' && body !== null) {
    const rec = body as Record<string, unknown>;
    if (typeof rec.message === 'string') return rec.message;
    if (typeof rec.error === 'string') return rec.error;
  }
  return 'reject_proposed_edit failed.';
}
