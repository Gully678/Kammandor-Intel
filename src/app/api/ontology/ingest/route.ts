import { NextRequest, NextResponse } from 'next/server';
import { MAPPERS } from '@/lib/ontology/mappers';
import { buildProposedEditsFromRecords, type ProposedEditInsert } from '@/lib/ontology/ingest';
import { isSourceEnabled } from '@/config/featureFlags';
import { getSecret } from '@/lib/secrets';
import { requireBearerToken, verifySupabaseUserToken } from '@/lib/ontology/authRpc';
import { createOfacSdnConnector } from '@/lib/pipeline/connectors/ofac-sdn';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

// ---------------------------------------------------------------------------
// Auth gate (hardened) — see the POST handler's doc comment above for the
// full rationale. Two independent, mutually-exclusive-in-practice paths:
//   (a) x-automate-secret header, compared against env AUTOMATE_SECRET.
//   (b) Authorization: Bearer <token>, verified against Supabase's
//       /auth/v1/user endpoint via verifySupabaseUserToken().
// Returns a single 401-shaped error when neither path succeeds. Never
// throws — verifySupabaseUserToken() itself never throws, and the
// automate-secret comparison is a plain string comparison.
// ---------------------------------------------------------------------------

interface IngestAuthOk {
  ok: true;
}

interface IngestAuthErr {
  ok:    false;
  error: string;
}

async function authenticateIngestRequest(req: NextRequest): Promise<IngestAuthOk | IngestAuthErr> {
  const automateSecret = process.env.AUTOMATE_SECRET;
  const providedSecret  = req.headers.get('x-automate-secret');
  if (automateSecret && providedSecret && providedSecret === automateSecret) {
    return { ok: true };
  }

  const bearer = requireBearerToken(req);
  if (bearer.ok) {
    const verified = await verifySupabaseUserToken(bearer.token);
    if (verified.ok) {
      return { ok: true };
    }
    return { ok: false, error: verified.error };
  }

  // Neither auth path succeeded. If the caller attempted the automate-secret
  // path (header present but wrong/unconfigured), say so; otherwise surface
  // the bearer-extraction error (e.g. "Missing Authorization header.").
  return {
    ok:    false,
    error: providedSecret ? 'Invalid automate secret.' : bearer.error,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Slice 3b hardening (superseded below): this route only ever writes to
  // intel.proposed_edit (status='pending') — see the governance banner
  // above — but it is still a write endpoint and must not be callable
  // anonymously or by a forged caller.
  //
  // Auth model: accept EITHER
  //   (a) header `x-automate-secret` exactly matching env AUTOMATE_SECRET
  //       (server-to-server automation — same convention as
  //       src/app/api/signals/harvest-delta/route.ts) — if AUTOMATE_SECRET
  //       is not configured this path can never succeed; OR
  //   (b) `Authorization: Bearer <token>` where <token> is verified against
  //       Supabase's own /auth/v1/user endpoint (verifySupabaseUserToken in
  //       src/lib/ontology/authRpc.ts) — i.e. a REAL, currently-valid user
  //       session, not merely a non-empty string.
  // This replaces the old presence-only bearer check (requireBearerToken()
  // alone), which let ANY non-empty "Authorization: Bearer x" header pass —
  // nothing downstream ever validated that token because this route's DB
  // write always uses the service-role key, never the caller's token. The
  // STRICTER tenant+role authz still lives in intel.approve_proposed_edit /
  // intel.reject_proposed_edit for the actual governed write path; this
  // gate only decides whether the caller may PROPOSE anything at all.
  const auth = await authenticateIngestRequest(req);
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
    const fetched = await fetchRecordsForSource(source, tenant);
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

async function fetchRecordsForSource(source: string, tenant: string): Promise<FetchRecordsResult> {
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
      case 'ofac-sdn':
        return await fetchOfacRecords();
      case 'kammandor-deals':
        return await fetchKammandorDealsRecords(tenant);
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

/**
 * OFAC SDN: keyless (US public-domain data via OpenSanctions CSV projection).
 * Runs the governed connector (fetch -> parse), keeps only records with a
 * usable identity (the connector's HARD expectation), and caps to a bounded
 * sample so the /review queue stays sane. Never throws (caller degrades).
 */
async function fetchOfacRecords(): Promise<FetchRecordsResult> {
  const LIMIT = 25;
  const connector = createOfacSdnConnector((url: string) => fetch(url, { cache: 'no-store' }));
  const batch = await connector.fetch();
  const usable = batch.records.filter((r) => {
    const x = r as Record<string, unknown>;
    const has = (v: unknown) => typeof v === 'string' && v !== '';
    return has(x.name) || has(x.id);
  });
  if (usable.length === 0) return { records: [], note: 'source not configured' };
  return { records: usable.slice(0, LIMIT) };
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

// ---------------------------------------------------------------------------
// Kammandor deal graph (first-party, Mission A) — reads the main app's
// tenant-scoped rows from THIS Supabase project and emits ONE composite
// 'deal_graph' record for the kammandor-deals mapper.
//
// GOVERNANCE: reads only. public.* rows are read verbatim; intel.* is read
// ONLY to make ingest idempotent (skip rows already materialised as entities
// or already sitting in a pending proposal). The ONLY write in this route
// remains insertProposedEdits -> intel.proposed_edit.
//
// Incremental link grounding (v2): links no longer require BOTH endpoints to
// be part of the same fresh batch. This route now also fetches the tenant's
// ALREADY-APPROVED intel.entity ids and passes them through on the composite
// record as `anchor_entity_ids` (see mapKammandorDealGraph /
// buildProposedEditsFromRecords). The mapper grounds a link when either
// endpoint is a fresh sibling entity OR a known anchor, so a relationship
// row whose deal/company/contact was approved in an earlier ingest run can
// now produce a link proposal instead of being silently skipped.
//
// v1 limitation still remaining (documented, deliberate): isDirectorOf links
// are derived from the `contacts` array itself (role_title matching
// /director/i), and this route only ever includes FRESH contacts in that
// array — an already-approved director contact with no other fresh signal
// this run is therefore never re-examined for isDirectorOf, even though it
// would now be eligible as an anchor if it appeared. Re-scanning already-
// approved contacts purely to look for new isDirectorOf links is a future
// slice (it would require re-fetching + re-diffing links for non-fresh
// contacts, which this route does not currently do).
// ---------------------------------------------------------------------------

const UUID_RE_INGEST = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchKammandorDealsRecords(tenant: string): Promise<FetchRecordsResult> {
  const supabaseUrl    = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { records: [], note: 'source not configured' };
  }
  if (!UUID_RE_INGEST.test(tenant)) {
    return { records: [], note: 'tenant must be an organisation uuid' };
  }

  const baseHeaders: Record<string, string> = {
    apikey:        serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
  const intelHeaders: Record<string, string> = { ...baseHeaders, 'Accept-Profile': 'intel' };

  const get = async (path: string, headers: Record<string, string>): Promise<unknown[]> => {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
    if (!res.ok) {
      throw new Error(`kammandor-deals fetch ${path.split('?')[0]}: HTTP ${res.status}`);
    }
    const data: unknown = await res.json();
    return Array.isArray(data) ? data : [];
  };

  // First-party rows, tenant-scoped, verbatim.
  const [companies, contacts, deals, relationships] = await Promise.all([
    get(`companies?organization_id=eq.${tenant}&select=*`, baseHeaders),
    get(`contacts?organization_id=eq.${tenant}&select=*`, baseHeaders),
    get(`deals?organization_id=eq.${tenant}&select=*`, baseHeaders),
    get(`km_counterparty_relationships?organization_id=eq.${tenant}&select=*`, baseHeaders),
  ]);

  // Idempotence guards (reads only).
  const [existingEntities, pendingEdits, existingLinks] = await Promise.all([
    get(`entity?tenant_id=eq.${tenant}&select=id`, intelHeaders),
    get(`proposed_edit?tenant_id=eq.${tenant}&status=eq.pending&select=kind,payload`, intelHeaders),
    get(`link?tenant_id=eq.${tenant}&select=source_entity_id,target_entity_id,type`, intelHeaders),
  ]);

  const knownEntityIds = new Set<string>();
  for (const row of existingEntities as { id?: unknown }[]) {
    if (typeof row.id === 'string') knownEntityIds.add(row.id.toLowerCase());
  }

  // Anchors = ALREADY-APPROVED intel.entity ids only (captured here, BEFORE
  // pending-proposal ids are folded into knownEntityIds below). Pending
  // create_entity proposals are not yet real entities, so they are not
  // valid link-grounding anchors — they remain in knownEntityIds purely to
  // keep this route's own "fresh" dedup idempotent.
  const anchorEntityIds = new Set<string>(knownEntityIds);

  const knownLinkKeys = new Set<string>();
  for (const row of existingLinks as Record<string, unknown>[]) {
    knownLinkKeys.add(
      `${row.source_entity_id}->${row.type}->${row.target_entity_id}`.toLowerCase(),
    );
  }

  for (const row of pendingEdits as { kind?: unknown; payload?: unknown }[]) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    if (row.kind === 'create_entity' && typeof payload.id === 'string') {
      knownEntityIds.add(payload.id.toLowerCase());
    }
    if (row.kind === 'create_link') {
      knownLinkKeys.add(
        `${payload.source_entity_id}->${payload.type}->${payload.target_entity_id}`.toLowerCase(),
      );
    }
  }

  const fresh = (rows: unknown[]): unknown[] =>
    rows.filter(r => {
      const id = (r as { id?: unknown }).id;
      return typeof id === 'string' && !knownEntityIds.has(id.toLowerCase());
    });

  const freshCompanies = fresh(companies);
  const freshContacts  = fresh(contacts);
  const freshDeals     = fresh(deals);

  const freshRelationships = relationships.filter(r => {
    const row = r as Record<string, unknown>;
    const party = row.party_type === 'contact' ? row.contact_id : row.company_id;
    return !knownLinkKeys.has(`${party}->isNamedInDeal->${row.deal_id}`.toLowerCase());
  });

  // Only "nothing new" when there is neither a fresh entity NOR a fresh
  // relationship — a relationship can now be worth proposing on its own
  // (as a link) even when both its endpoints are already-approved anchors
  // and therefore contribute zero fresh entities.
  if (
    freshCompanies.length === 0 &&
    freshContacts.length === 0 &&
    freshDeals.length === 0 &&
    freshRelationships.length === 0
  ) {
    return { records: [], note: 'deal graph already proposed or materialised — nothing new' };
  }

  return {
    records: [
      {
        record_type:       'deal_graph',
        companies:         freshCompanies,
        contacts:          freshContacts,
        deals:             freshDeals,
        relationships:     freshRelationships,
        anchor_entity_ids: [...anchorEntityIds],
        fetched_at:        new Date().toISOString(),
      },
    ],
  };
}
