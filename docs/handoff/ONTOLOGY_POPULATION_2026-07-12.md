# MISSION A — Ontology population slice 1: the Kammandor deal graph (2026-07-12)

**Strictly Private & Confidential — INVRT.** Engine repo `Gully678/Kammandor-Intel` (`master`), Supabase `ucbnnhfttahmqhvccvyw`.

## What this slice does
First-party ontology population: the Kammandor main app's tenant deal graph
(`public.deals` / `companies` / `contacts` / `km_counterparty_relationships`
— same Supabase, already tenant-scoped) now flows through the EXISTING
governed pipeline: `POST /api/ontology/ingest {source:'kammandor-deals',
tenant:<org uuid>}` → auto-fetch (reads only) → `mapKammandorDealGraph`
(pure) → `intel.proposed_edit` (status `pending`) → **human approve at
`/review`** → `intel.approve_proposed_edit` (sole writer) → `intel.entity` +
`intel.link` + `intel.entity_provenance`.

## Why two migrations were needed (root cause found + fixed)
The pipeline had never populated anything because links could NEVER bind:
`buildProposedEditsFromRecords` stripped the mapper's entity id, and the
approve RPC generated a fresh uuid on `create_entity` — while `create_link`
inserted payload entity ids verbatim into FK-constrained columns. Every
batch-proposed link was guaranteed a loud FK failure at approval.

- **`0029_approve_rpc_honour_payload_entity_id.sql`** — function-body
  supersede of 0014 (governance boundary unchanged, restated in the header):
  `create_entity` now honours an OPTIONAL payload `id` (uuid); absent =>
  `gen_random_uuid()` exactly as before; duplicate id fails loudly on the PK.
  Prototyped in a rolled-back transaction (`X0029_OK_ROLLED_BACK`) before
  applying via the Supabase MCP.
- **`0030_seed_kammandor_deals_source.sql`** — registers the
  `kammandor-deals` source (licence_class `proprietary`; the approve RPC
  stamps this onto every provenance row for the source). Idempotent.

## Code (additive; zero behaviour change for existing mappers)
- `src/lib/ontology/mappers/kammandor-deals.ts` — pure mapper. ONE composite
  `deal_graph` record per tenant so the eval gate grounds links against
  sibling entities. Entity ids = source-row uuids (`preserveEntityIds:
  true`). NO figures or PII promoted into properties — verbatim rows live in
  `provenance.raw` only. Links: `isNamedInDeal` (party → deal, from
  counterparty relationships) and `isDirectorOf` (only when `role_title`
  literally contains "director" — deterministic, never inferred).
- `src/lib/ontology/mappers/gleif.ts` — `MapperResult.preserveEntityIds?`
  (optional, documented: real uuids only, never pseudo/hashed ones).
- `src/lib/ontology/ingest.ts` — for opt-in mappers ONLY: keeps `payload.id`
  and folds mapper provenance into `payload.provenance` (RPC shape; link
  evidence keyed by `property_path = link:{type}->{target_id}`).
- `src/app/api/ontology/ingest/route.ts` — `kammandor-deals` auto-fetch:
  reads tenant rows (public) + idempotence guards (intel reads only: existing
  entities/links + pending proposals). Still writes ONLY
  `intel.proposed_edit`.
- `src/config/sources.ts` + mapper registry — source registered,
  `enabledByDefault: true`.
- `src/lib/ontology/__tests__/kammandor-deals.test.ts` — mapper + folding +
  no-regression tests (vitest).

## Known limitations / follow-ups (honest list)
1. **Incremental links:** FIXED (2026-07-13 slice): the connector passes the
   tenant's already-approved intel.entity ids as `anchor_entity_ids`; the
   mapper grounds links against fresh siblings OR anchors (never re-emitting
   anchors), and the eval gate's grounding set includes them. Remaining gap
   (documented in the route): already-approved director contacts with no
   fresh signal are not re-scanned for new isDirectorOf links.
2. **Ingest route auth is presence-only:** FIXED (2026-07-13 slice): the
   route now requires EITHER `x-automate-secret` matching `AUTOMATE_SECRET`
   OR a bearer token verified live against Supabase `/auth/v1/user`
   (`verifySupabaseUserToken` in src/lib/ontology/authRpc.ts).
3. **Approval order matters:** entities before links (FK). The /review flow
   should approve create_entity proposals first; a link approved too early
   fails loudly and stays pending — retry after its endpoints exist.
4. Re-running ingest is a clean no-op (`deal graph already proposed or
   materialised — nothing new`).

## How to verify (and what was verified live)
1. `POST https://intel.kammandor.com/api/ontology/ingest` with header
   `Authorization: Bearer <any authenticated session token>` and body
   `{"source":"kammandor-deals","tenant":"<org uuid>"}` → `{proposed: N}`.
2. `select count(*) from intel.proposed_edit;` leaves zero.
3. `/review` lists the proposals; approve entities, then links.
4. `select count(*) from intel.entity / intel.link / intel.entity_provenance;`
   leave zero. SDK `listObjects` returns real objects.
