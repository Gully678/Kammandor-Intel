import { NextResponse } from 'next/server';

/**
 * KINTEL WS-3 — Agent capabilities manifest + routing hints.
 * GET /api/ai/capabilities
 *
 * Clean-room reimplementation of the Shadowbroker `/api/ai/capabilities`
 * pattern on top of our GOVERNED API: tells an agent what the engine can do,
 * how to authenticate, the governance guarantees, and deterministic
 * intent -> tool routing hints. Read-only; advertises capability only.
 */

export const dynamic = 'force-dynamic';

interface RouteHint {
  intent: string;
  tool: string;
}

const ROUTING: RouteHint[] = [
  { intent: 'screen a counterparty for sanctions', tool: 'screen_sanctions' },
  { intent: 'resolve / expand an entity',          tool: 'entity_expand' },
  { intent: 'find governed facts about X',         tool: 'query_ontology' },
  { intent: 'add a new fact (needs approval)',     tool: 'propose_edit' },
  { intent: 'brief me on a region',                tool: 'region_dossier' },
  { intent: 'what sources exist',                  tool: 'list_sources' },
];

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    schema_version: '1.0',
    engine: 'kammandor-intel',
    generated_at: new Date().toISOString(),
    auth: {
      tools_catalog: 'public read',
      governed_reads_writes: 'HMAC-signed (INTEL_HANDOFF_SECRET), tenant-scoped',
      transport: 'HTTPS; SSE change-feed at /api/ai/stream',
    },
    governance: {
      sole_writer: 'intel.approve_proposed_edit (RPC)',
      proposals_only: true,
      sanctions_matches: 'HITL',
      map_visual_layers: 'ephemeral live telemetry — labelled non-governed, never asserted as fact',
      eval_floor: 0.8,
    },
    catalogs: {
      tools: '/api/ai/tools',
      change_feed: '/api/ai/stream',
    },
    routing: ROUTING,
  });
}
