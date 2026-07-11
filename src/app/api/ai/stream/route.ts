import { NextRequest } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * KINTEL WS-3 — Agent change-feed (SSE). GET /api/ai/stream
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE — READ-ONLY, TENANT-SCOPED, HMAC-AUTHENTICATED        ║
 * ║  Authenticated ONLY by the signed handoff token (HMAC over        ║
 * ║  INTEL_HANDOFF_SECRET) — never a client-supplied org id. Zero      ║
 * ║  writes. Emits two governed event types for the caller's tenant:  ║
 * ║    • alert           — rows from public.intelligence_alerts        ║
 * ║    • object_changed  — governed ontology writes (approved          ║
 * ║                        intel.proposed_edit), i.e. HUMAN-approved    ║
 * ║                        facts only. Sanctions alerts remain HITL —  ║
 * ║                        this only surfaces them, never actions.     ║
 * ║  Explicit column allowlists; never select=*.                      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Serverless-friendly: the stream runs a bounded number of poll cycles
 * (~24s) then closes cleanly; EventSource clients auto-reconnect. The first
 * cycle emits a small snapshot; later cycles emit only rows newer than the
 * per-stream cursor. Also honours client disconnect via request.signal.
 *
 * SSE frames:
 *   event: ready          data: {"scope":"tenant","poll_ms":4000}
 *   event: alert          data: {AlertRecord-ish}
 *   event: object_changed data: {id,kind,status,reviewed_at}
 *   : keep-alive          (heartbeat comment)
 */

const POLL_MS = 4_000;
const MAX_CYCLES = 6; // ~24s, comfortably under maxDuration
const SNAPSHOT = 5;
const PAGE = 25;

const ALERT_SELECT = 'id,headline,detail,severity,source_url,status,created_at';
const EDIT_SELECT = 'id,kind,status,reviewed_at';

interface Row { [k: string]: unknown }

function iso(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

async function fetchRows(
  url: string,
  serviceRoleKey: string,
  intelSchema: boolean,
): Promise<Row[]> {
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: 'application/json',
  };
  if (intelSchema) headers['Accept-Profile'] = 'intel';
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  const json: unknown = await res.json();
  return Array.isArray(json) ? (json as Row[]) : [];
}

export async function GET(req: NextRequest): Promise<Response> {
  const secret = await getSecret('INTEL_HANDOFF_SECRET');
  const tenant = resolveTenantFromRequest(req, secret);
  if (!tenant) {
    return new Response(
      JSON.stringify({ error: 'No valid tenant could be resolved for this request.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'The change-feed store is not configured.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const enc = new TextEncoder();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown): void => {
        if (closed) return;
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const comment = (text: string): void => {
        if (closed) return;
        controller.enqueue(enc.encode(`: ${text}\n\n`));
      };

      const onAbort = (): void => { closed = true; };
      req.signal.addEventListener('abort', onAbort);

      send('ready', { scope: 'tenant', poll_ms: POLL_MS });

      // Per-stream cursors so we only emit rows newer than what we've sent.
      let alertCursor = '';
      let editCursor = '';

      try {
        for (let cycle = 0; cycle < MAX_CYCLES && !closed; cycle++) {
          // ── alerts (public schema) ─────────────────────────────────
          const aUrl = new URL(`${supabaseUrl}/rest/v1/intelligence_alerts`);
          aUrl.searchParams.set('select', ALERT_SELECT);
          aUrl.searchParams.set('organization_id', `eq.${tenant}`);
          aUrl.searchParams.set('order', 'created_at.desc');
          aUrl.searchParams.set('limit', String(PAGE));
          const alerts = await fetchRows(aUrl.toString(), serviceRoleKey, false);
          const freshAlerts = (cycle === 0 ? alerts.slice(0, SNAPSHOT) : alerts)
            .filter((r) => {
              const c = iso(r.created_at);
              return c !== null && c > alertCursor;
            })
            .reverse(); // oldest→newest so cursor advances monotonically
          for (const r of freshAlerts) {
            const c = iso(r.created_at);
            if (c && c > alertCursor) alertCursor = c;
            send('alert', r);
          }

          // ── governed object changes (intel schema, approved only) ──
          const eUrl = new URL(`${supabaseUrl}/rest/v1/proposed_edit`);
          eUrl.searchParams.set('select', EDIT_SELECT);
          eUrl.searchParams.set('tenant_id', `eq.${tenant}`);
          eUrl.searchParams.set('status', 'eq.approved');
          eUrl.searchParams.set('order', 'reviewed_at.desc');
          eUrl.searchParams.set('limit', String(PAGE));
          const edits = await fetchRows(eUrl.toString(), serviceRoleKey, true);
          const freshEdits = (cycle === 0 ? edits.slice(0, SNAPSHOT) : edits)
            .filter((r) => {
              const c = iso(r.reviewed_at);
              return c !== null && c > editCursor;
            })
            .reverse();
          for (const r of freshEdits) {
            const c = iso(r.reviewed_at);
            if (c && c > editCursor) editCursor = c;
            send('object_changed', r);
          }

          comment('keep-alive');
          if (cycle < MAX_CYCLES - 1) await sleep(POLL_MS);
        }
      } catch {
        // never surface internals — just end the stream
      } finally {
        req.signal.removeEventListener('abort', onAbort);
        if (!closed) {
          controller.enqueue(enc.encode(`event: bye\ndata: {"reconnect":true}\n\n`));
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
