import { NextResponse } from 'next/server';

/**
 * KINTEL WS-3 — Agent tool catalog (machine-readable).
 * GET /api/ai/tools
 *
 * Publishes the tools an external agent (Kammandor / INVRT / third-party) can
 * drive on top of the GOVERNED API — the Shadowbroker `/api/ai/tools` pattern,
 * clean-room. Read-only catalog (safe to expose): it advertises capability,
 * it does not perform writes. Action tools are marked with their auth + the
 * governance rule (proposals only; approve RPC is the sole ontology writer;
 * sanctions are HITL). The live source list is appended from intel.sources.
 */

export const dynamic = 'force-dynamic';

type ToolAuth = 'public' | 'hmac' | 'service';

interface ToolDef {
  name: string;
  description: string;
  method: 'GET' | 'POST';
  path: string;
  auth: ToolAuth;
  writes: 'none' | 'proposal';
}

const TOOLS: ToolDef[] = [
  { name: 'list_sources',      description: 'List governed + map-visual data sources with licence and render mode.', method: 'GET',  path: '/api/ai/tools',                  auth: 'public',  writes: 'none' },
  { name: 'get_capabilities',  description: 'Engine capabilities manifest + routing hints.',                        method: 'GET',  path: '/api/ai/capabilities',           auth: 'public',  writes: 'none' },
  { name: 'query_ontology',    description: 'Query governed entities/links (RLS-bounded by tenant).',               method: 'GET',  path: '/api/ontology/query',            auth: 'hmac',    writes: 'none' },
  { name: 'get_objects',       description: 'Fetch governed ontology objects by type/id.',                          method: 'GET',  path: '/api/ontology/objects',          auth: 'hmac',    writes: 'none' },
  { name: 'entity_expand',     description: 'Expand an entity graph (Wikidata + OFAC + governed store).',           method: 'GET',  path: '/api/entity/expand',             auth: 'hmac',    writes: 'none' },
  { name: 'propose_edit',      description: 'Propose a governed edit (create_entity/create_link). HUMAN approval required before it becomes truth.', method: 'POST', path: '/api/ontology/proposed-edit', auth: 'hmac', writes: 'proposal' },
  { name: 'list_proposals',    description: 'List pending proposed edits awaiting review.',                         method: 'GET',  path: '/api/ontology/proposed-edit',    auth: 'hmac',    writes: 'none' },
  { name: 'region_dossier',    description: 'Governed + live-visual dossier for a region.',                         method: 'GET',  path: '/api/region-dossier',            auth: 'hmac',    writes: 'none' },
  { name: 'screen_sanctions',  description: 'Screen a counterparty against the OFAC SDN governed source. Matches are HITL, never auto-actioned.', method: 'GET', path: '/api/entity/expand', auth: 'hmac', writes: 'none' },
];

interface SourceRow {
  key: string;
  category: string;
  render_mode: string;
  tier: string;
}

async function liveSources(): Promise<SourceRow[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return [];
  try {
    const url = new URL(`${supabaseUrl}/rest/v1/sources`);
    url.searchParams.set('select', 'key,category,render_mode,tier');
    const res = await fetch(url.toString(), {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: 'application/json',
        'Accept-Profile': 'intel',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return [];
    return (await res.json()) as SourceRow[];
  } catch {
    return [];
  }
}

export async function GET(): Promise<NextResponse> {
  const sources = await liveSources();
  return NextResponse.json({
    schema_version: '1.0',
    engine: 'kammandor-intel',
    generated_at: new Date().toISOString(),
    governance: {
      sole_writer: 'intel.approve_proposed_edit (RPC)',
      proposals_only: true,
      sanctions_matches: 'HITL — never auto-actioned',
      rls: 'tenant-scoped by organization_id',
    },
    tools: TOOLS,
    sources,
  });
}
