import { NextRequest, NextResponse } from 'next/server';
import {
  requireBearerToken,
  callIntelRpcAsUser,
  statusForPostgrestError,
} from '@/lib/ontology/authRpc';

export const dynamic = 'force-dynamic';

/**
 * KINTEL Phase 2 — Ontology governed approve
 * POST /api/ontology/proposed-edit/[id]/approve
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE — this route is a thin, unprivileged pass-through.        ║
 * ║  It does NOT decide who may approve. It forwards the caller's own     ║
 * ║  bearer token to intel.approve_proposed_edit() via PostgREST, and     ║
 * ║  that SECURITY DEFINER function enforces tenant + role authz in SQL   ║
 * ║  (see migrations/intel/0012_approve_reject_proposed_edit.sql). This   ║
 * ║  route MUST NEVER call the RPC with the service-role key — doing so   ║
 * ║  would erase the caller's identity and defeat the authz check.        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Auth: REQUIRES `Authorization: Bearer <supabase access token>`. 401 if
 * missing/malformed — this is checked BEFORE the id is even validated.
 *
 * Response:
 *   200 { id: <uuid of the created/updated entity or link row> }
 *   400 { error } — bad id, or the RPC rejected the edit's own state (e.g.
 *                   not pending, unknown kind, malformed payload)
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

  const result = await callIntelRpcAsUser('approve_proposed_edit', { p_edit_id: id }, auth.token);

  if (!result.ok) {
    const status = result.status === 500 || result.status === 502
      ? result.status
      : statusForPostgrestError(result.body);
    return NextResponse.json(
      { error: extractErrorMessage(result.body) },
      { status },
    );
  }

  return NextResponse.json({ id: result.body });
}

function extractErrorMessage(body: unknown): string {
  if (typeof body === 'string') return body;
  if (typeof body === 'object' && body !== null) {
    const rec = body as Record<string, unknown>;
    if (typeof rec.message === 'string') return rec.message;
    if (typeof rec.error === 'string') return rec.error;
  }
  return 'approve_proposed_edit failed.';
}
