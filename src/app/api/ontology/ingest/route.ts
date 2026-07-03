import { NextRequest, NextResponse } from 'next/server';
import { MAPPERS } from '@/lib/ontology/mappers';
import { buildProposedEditsFromRecords, type ProposedEditInsert } from '@/lib/ontology/ingest';
import { isSourceEnabled } from '@/config/featureFlags';
import { getSecret } from '@/lib/secrets';
import { requireBearerToken } from '@/lib/ontology/authRpc';

export const dynamic = 'force-dynamic';

/**
 * KINTEL Phase 2 — Ontology ingest route
 * POST /api/ontology/ingest
 *
 * connector -> mapper -> propose -> intel.proposed_edit (status='pending')
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE BOUNDARY — READ BEFORE MODIFYING                    ║
 * ║                                                                  ║
 * ║  This route writes ONLY to intel.proposed_edit, and only rows    ║
 * ║  with status='pending'. It MUST NEVER write to intel.entity,     ║
 * ║  intel.link, or intel.entity_provenance. Those tables are        ║
 * ║  written only by the slice-3b human-approval application step,   ║
 * ║  after a reviewer has approved a pending proposal.                ║
 * ║                                                                  ║
 * ║  If you are tempted to add a write to entity/link/provenance      ║
 * ║  here — stop. That belongs in slice 3b, gated by human review.   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Body: { source: string, tenant: string, records?: unknown[] }
 *   source  — must be a known MAPPERS key (see src/lib/ontology/mappers/index.ts)
 *   tenant  — tenant/org id the proposals are scoped to
 *   records — optional raw source records. If omitted, the route attempts a
 *             minimal auto-fetch for a small set of known keyless/simple
 *             sources; if the source needs a key that's absent (or fetching
 *             fails for any reason), the route degrades gracefully and
 *             returns { proposed: 0, note: 'source not configured' } —
 *             it never throws for a missing/failed upstream fetch.
 *
 * Response: { proposed: number, source: string, tenant: string, note?: string }
 */

interface IngestBody {
  source?:  string;
  tenant?:  string;
  records?: unknown[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Slice 3b hardening: this route only ever writes to intel.proposed_edit
  // (status='pending') — see the governance banner above — but it is still
  // a write endpoint and must not be callable anonymously. Require a bearer
  // token from any authenticated caller (any tenant/role); the STRICTER
  // tenant+role authz lives in intel.approve_proposed_edit /
  // intel.reject_proposed_edit for the actual governed write path.
  const auth = requireBearerToken(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  let body: IngestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const source = typeof body.source === 'string' ? body.source.trim() : '';
  const tenant = typeof body.tenant === 'string' ? body.tenant.trim() : '';

  if (!source || !(source in MAPPERS)) {
    return NextResponse.json(
      {
        error: `Unknown or missing "source". Must be one of: ${Object.keys(MAPPERS).join(', ')}`,
      },
      { status: 400 },
    );
  }

  if (!tenant) {
    return NextResponse.json({ error: '"tenant" is required.' }, { status: 400 });
  }

  // ---------------------------------------------------------------------
  // Acquire records: caller-supplied, or a minimal auto-fetch per source.
  // Auto-fetch NEVER throws — any failure degrades to an empty record set
  // with an explanatory note, and the route still returns 200.
  // ---------------------------------------------------------------------
  let records: unknown[];
  let note: string | undefined;

  if (Array.isArray(body.records)) {
    records = body.records;
  } else {
    const fetched = await fetchRecordsForSource(source);
    records = fetched.records;
    note = fetched.note;
  }

  if (records.length === 0) {
    return NextResponse.json({
      proposed: 0,
      source,
      tenant,
      note: note ?? 'no records to ingest',
    });
  }

  // ---------------------------------------------------------------------
  // Pure build step: connector records -> mapper -> ProposedEdit rows.
  // No DB access happens inside buildProposedEditsFromRecords.
  // ---------------------------------------------------------------------
  let edits: ProposedEditInsert[];
  try {
    const result = buildProposedEditsFromRecords(source, tenant, records);
    edits = result.edits;
  } catch (err) {
    // Defensive backstop only — source is already validated against MAPPERS
    // above, so this should not normally trigger.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to build proposed edits.' },
      { status: 400 },
    );
  }

  if (edits.length === 0) {
    return NextResponse.json({
      proposed: 0,
      source,
      tenant,
      note: 'records were provided but none could be mapped',
    });
  }

  // ---------------------------------------------------------------------
  // Insert step — the ONLY DB write in this route, and it writes ONLY to
  // intel.proposed_edit. See governance banner above.
  // ---------------------------------------------------------------------
  const insertResult = await insertProposedEdits(edits);
  if (!insertResult.ok) {
    return NextResponse.json(
      { error: insertResult.error, proposed: 0, source, tenant },
      { status: 502 },
    );
  }

  return NextResponse.json({ proposed: edits.length, source, tenant });
}

// ---------------------------------------------------------------------------
// Auto-fetch — minimal, source-specific, keyless-friendly.
// Mirrors the same public API calls already made by the sibling connector
// routes (src/app/api/gleif, /world-bank, /un-comtrade), but returns RAW
// per-record shapes (the shape each mapper in src/lib/ontology/mappers
// actually expects), not those routes' own normalised response bodies.
// Never throws: any failure (disabled source, missing key, network error,
// unexpected shape) resolves to an empty record list + a note.
// ---------------------------------------------------------------------------

interface FetchRecordsResult {
  records: unknown[];
  note?:   string;
}

async function fetchRecordsForSource(source: string): Promise<FetchRecordsResult> {
  try {
    if (!isSourceEnabled(source)) {
      return { records: [], note: 'source not configured' };
    }

    switch (source) {
      case 'gleif':
        return await fetchGleifRecords();
      case 'world-bank':
        return await fetchWorldBankRecords();
      case 'un-comtrade':
        return await fetchUnComtradeRecords();
      default:
        // No auto-fetch wired up for this source yet — caller must supply
        // `records` explicitly. Degrade gracefully rather than throwing.
        return { records: [], note: 'source not configured' };
    }
  } catch {
    // Any unexpected error while auto-fetching degrades gracefully — the
    // route must never throw because an upstream connector is unavailable.
    return { records: [], note: 'source not configured' };
  }
}

/** GLEIF: keyless. Fetch a small page of active LEI records. */
async function fetchGleifRecords(): Promise<FetchRecordsResult> {
  const url = new URL('https://api.gleif.org/api/v1/lei-records');
  url.searchParams.set('filter[entity.status]', 'ACTIVE');
  url.searchParams.set('page[size]', '10');

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/vnd.api+json',
      'User-Agent': 'Kammandor Intel research contact@kammandor.com',
    },
  });
  if (!res.ok) return { records: [], note: 'source not configured' };

  const raw: unknown = await res.json();
  const data =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>).data)
      ? ((raw as Record<string, unknown>).data as unknown[])
      : [];

  return { records: data };
}

/** World Bank: keyless. Fetch raw country rows (mapper expects the raw WB row shape). */
async function fetchWorldBankRecords(): Promise<FetchRecordsResult> {
  const url = 'https://api.worldbank.org/v2/country?format=json&per_page=20';
  const res = await fetch(url);
  if (!res.ok) return { records: [], note: 'source not configured' };

  const raw: unknown = await res.json();
  const data = Array.isArray(raw) && Array.isArray(raw[1]) ? (raw[1] as unknown[]) : [];

  return { records: data };
}

/** UN Comtrade: requires COMTRADE_KEY. Degrades gracefully when absent. */
async function fetchUnComtradeRecords(): Promise<FetchRecordsResult> {
  const key = await getSecret('COMTRADE_KEY');
  if (!key) return { records: [], note: 'source not configured' };

  const period = String(new Date().getFullYear() - 1);
  const url =
    `https://comtradeapi.un.org/data/v1/get/C/A/${period}/842/TOTAL/0` +
    `?flowCode=M,X&includeDesc=true`;

  const res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key } });
  if (!res.ok) return { records: [], note: 'source not configured' };

  const raw: unknown = await res.json();
  const dataArr =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>).data)
      ? ((raw as Record<string, unknown>).data as Record<string, unknown>[])
      : [];

  // Normalise into the exact shape mapUnComtradeFlow expects (mirrors
  // src/app/api/un-comtrade/route.ts's own normalisation).
  const records = dataArr.map(item => ({
    reporterIso:  String(item.reporterISO  ?? item.reporterCode ?? ''),
    reporterName: String(item.reporterDesc ?? item.reporterISO  ?? ''),
    partnerIso:   String(item.partnerISO   ?? item.partnerCode  ?? ''),
    partnerName:  String(item.partnerDesc  ?? item.partnerISO   ?? ''),
    flow:         String(item.flowCode     ?? ''),
    flowDesc:     String(item.flowDesc     ?? item.flowCode ?? ''),
    value:        typeof item.primaryValue === 'number' ? item.primaryValue : null,
    period:       String(item.refYear      ?? item.period       ?? ''),
  }));

  return { records };
}

// ---------------------------------------------------------------------------
// Insert — writes ONLY to intel.proposed_edit via PostgREST.
//
// There is no @supabase/supabase-js client in this codebase's TS layer (it
// is only used by the Python workers service); the existing TS-side pattern
// for talking to Supabase with the service role is a raw PostgREST fetch
// (see src/lib/secrets.ts's fetchFromVault). This mirrors that pattern,
// using the `intel` schema via the Content-Profile header, exactly as
// workers/app/graph.py's persist node does via
// client.schema("intel").table("proposed_edit").insert(...).
// ---------------------------------------------------------------------------

interface InsertResult {
  ok:     boolean;
  error?: string;
}

async function insertProposedEdits(edits: ProposedEditInsert[]): Promise<InsertResult> {
  const supabaseUrl    = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false, error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured' };
  }

  try {
    // Governance: this is the ONLY fetch target in this route's insert path —
    // intel.proposed_edit. Do not add any other table/schema target here.
    const res = await fetch(`${supabaseUrl}/rest/v1/proposed_edit`, {
      method: 'POST',
      headers: {
        apikey:            serviceRoleKey,
        Authorization:     `Bearer ${serviceRoleKey}`,
        'Content-Type':    'application/json',
        'Content-Profile': 'intel', // PostgREST: target the `intel` schema, not `public`
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
