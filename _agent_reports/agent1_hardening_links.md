# Agent 1 — Ingest auth hardening + incremental link grounding

## Scope note (unrelated pre-existing dirty state)

`git status` in this clone also shows modifications to `src/lib/sdk/intel/{client,index,types}.ts`
and untracked files (`migrations/intel/0032_action_registry.sql`,
`src/app/api/ontology/actions/`, `src/lib/ontology/actions.ts`,
`src/lib/ontology/__tests__/actions.test.ts`). **None of these were touched by
this agent** — they belong to a concurrent "action registry" slice already
present in the clone before this task started. All diff stats below are
scoped explicitly to the 7 files this task touched.

## TASK 1 — Harden ingest auth

### `src/lib/ontology/authRpc.ts`
Added `verifySupabaseUserToken(token): Promise<{ ok: true; userId: string } | { ok: false; status: 401; error: string }>`.
- Calls `${process.env.SUPABASE_URL}/auth/v1/user` with `Authorization: Bearer <token>` and
  `apikey: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY` (falls back to `''` if both unset).
- `ok: true` only on HTTP 200 with a JSON body whose `id` is a non-empty string.
- Wrapped in try/catch — network errors, non-200s, and unparsable/missing-`id` bodies all resolve to `ok: false`, never throw.
- Full doc comment explains WHY: `requireBearerToken()` only checks the header is syntactically
  `"Bearer <non-empty>"`; that's safe for routes that hand the token straight to a PostgREST RPC
  (approve/reject/scan/starter-pack — PostgREST itself rejects a bad token downstream) but was NOT
  safe for the ingest route, which writes with the **service-role key** and never forwards the
  caller's token anywhere — so presence-only checking let any non-empty string through.

### `src/app/api/ontology/ingest/route.ts`
- Imports `verifySupabaseUserToken` alongside the existing `requireBearerToken`.
- New `authenticateIngestRequest(req)` helper (private to the route) implements the OR-gate:
  - (a) `x-automate-secret` header exactly equal to `process.env.AUTOMATE_SECRET` (both must be
    truthy — an unset `AUTOMATE_SECRET` makes this path permanently unreachable), mirroring the
    existing pattern in `src/app/api/signals/harvest-delta/route.ts`.
  - (b) else, `requireBearerToken` extraction followed by `verifySupabaseUserToken` — only passes
    if Supabase's own `/auth/v1/user` resolves the token to a real user.
  - Otherwise 401, with the automate-secret-specific error ("Invalid automate secret.") if a secret
    header was attempted, else the bearer-extraction error.
- `POST` now calls `await authenticateIngestRequest(req)` in place of the old presence-only gate.
- The route's doc comment (both the POST handler's inline comment and the auth-gate helper's own
  comment) was rewritten to describe the new model honestly, including why the old model was unsafe.
- All other response shapes (400/502/200 bodies) are untouched.

### `src/app/api/ontology/ingest/__tests__/route.test.ts`
Rewrote the auth-hardening describe block:
- No auth at all -> 401 (`/Authorization/i`).
- Empty / malformed Authorization header -> 401 (unchanged cases).
- New: syntactically valid but junk bearer -> mocks `fetch` to return 401 from `/auth/v1/user` -> route returns 401; asserts exactly one fetch call to a URL containing `/auth/v1/user`.
- New: valid `x-automate-secret` matching `AUTOMATE_SECRET` -> passes the gate (proceeds to 400 body validation) and asserts `fetch` was never called (no unnecessary Supabase round-trip).
- New: wrong `x-automate-secret` even with `AUTOMATE_SECRET` configured -> 401.
- New: valid bearer token -> mocks `fetch` to return `{ id: 'real-user-uuid' }` at 200 -> passes the gate.
- Case-insensitive header/scheme test updated to mock the now-required Supabase verification call.
- The pre-existing "persists evaluation on inserted rows" describe block was switched from a bearer
  header to `x-automate-secret` (with `AUTOMATE_SECRET` set in `beforeEach`) specifically so its
  `expect(fetchMock).toHaveBeenCalledTimes(1)` governance assertion (exactly one write, to
  `/rest/v1/proposed_edit`) still holds — a bearer token would otherwise add a second fetch for the
  auth verification call and break that count.

## TASK 2 — Incremental link grounding for kammandor-deals

### `src/lib/ontology/mappers/gleif.ts`
Added optional `anchorEntityIds?: string[]` to `MapperResult`, with a doc comment explaining it holds
ids of entities that already exist in `intel.entity` for the tenant (approved in a prior run), that a
mapper may ground links against without re-emitting them as entities, and that
`buildProposedEditsFromRecords` folds them into the eval-gate's grounding set.

### `src/lib/ontology/mappers/kammandor-deals.ts`
- `KammandorDealGraphRecord` gains `anchor_entity_ids?: unknown[]`.
- `mapKammandorDealGraph` builds `const anchors = new Set<string>(... .map(asUuid).filter(non-null) ...)`
  from `rec.anchor_entity_ids` right after the `emitted` set is declared.
- Both link-grounding checks changed from `emitted.has(x)` to `emitted.has(x) || anchors.has(x)`,
  per-endpoint, for both `isNamedInDeal` (deal + party) and `isDirectorOf` (person + company).
- Entity emission loops (companies/contacts/deals) are byte-for-byte unchanged — anchors are never
  emitted as entities, only referenced by links.
- Return value now includes `anchorEntityIds: [...anchors]` only when `anchors.size > 0`.
- Updated the file's top-of-file "Design notes" doc comment and added an inline comment at the
  `anchors` declaration explaining the new grounding rule and its still-remaining v1 limitation
  (see below).

### `src/lib/ontology/ingest.ts`
`buildProposedEditsFromRecords`'s `knownEntityIds` (the eval-gate grounding set passed to `evaluate()`
via `withEvaluation`) is now the union of this record's own mapped entity ids and
`mapped.anchorEntityIds` (when present, iterated and added to the same `Set`). Everything else in the
function is unchanged.

### `src/app/api/ontology/ingest/route.ts` — `fetchKammandorDealsRecords`
- Introduced `anchorEntityIds` as a separate `Set<string>`, seeded from `existingEntities` only
  (i.e. rows already materialised in `intel.entity`) — captured before pending `create_entity`
  proposal ids are folded into the pre-existing `knownEntityIds` set used for "fresh" dedup. This
  distinction is deliberate: a pending (not-yet-approved) proposal is not a real row a link can
  legitimately ground against yet, so it is excluded from anchors but still included in the
  dedup/freshness set as before.
- The composite record now carries `anchor_entity_ids: [...anchorEntityIds]` (always included,
  even if empty — the mapper handles an empty array as an empty anchor set).
- Early-return condition relaxed: was "no fresh companies/contacts/deals -> nothing new"; now also
  requires `freshRelationships.length === 0` — i.e. a relationship whose entity endpoints are both
  already-approved anchors (contributing zero fresh entities) can still produce a fresh link proposal
  and is no longer silently dropped by the early return.
- The `freshRelationships` filter itself (kept when its `isNamedInDeal` link key is not already
  known) was not changed — that behaviour was already correct for the new model; only the
  early-return gate needed relaxing.
- Rewrote the governance/limitation comment block above `fetchKammandorDealsRecords` honestly:
  states the new incremental-grounding behaviour for relationship-driven `isNamedInDeal` links, and
  explicitly flags the one still-remaining gap — `isDirectorOf` links are derived by scanning the
  `contacts` array for `role_title` matching `/director/i`, and this route only ever includes
  fresh contacts in that array. An already-approved director contact with no other fresh signal
  this run is therefore never re-examined for a new `isDirectorOf` link this cycle, even though it
  would now be link-eligible as an anchor if it were present. Re-scanning non-fresh contacts for new
  `isDirectorOf` links was out of scope for this task and is called out as a genuine, deliberate v1
  gap rather than silently left undocumented.

### `src/lib/ontology/__tests__/kammandor-deals.test.ts`
Added a new describe block, `mapKammandorDealGraph — anchor_entity_ids (incremental link grounding)`,
with three tests:
1. A relationship whose deal endpoint is present only in `anchor_entity_ids` (the `deals` array
   is empty) still produces a single `isNamedInDeal` link with the correct source/target, and
   `anchorEntityIds` on the `MapperResult` contains the anchored id.
2. The same scenario never produces a `create_entity` edit for the anchor id (checked both on the
   raw mapper `entities` array and on `buildProposedEditsFromRecords`'s `create_entity` edits), and
   its `create_link` edit's `evaluation.passed === true` (proving `ingest.ts`'s knownEntityIds union
   actually grounds the link through the eval gate, not just structurally).
3. A relationship whose endpoint is in neither `emitted` nor `anchor_entity_ids` (an unrelated id is
   anchored instead) is still silently skipped — the existing "no fabricated grounding" guarantee
   holds.

## Verification

Command run:
cd /tmp/kx1783883103 && npx -y esbuild@0.24.0 src/lib/ontology/authRpc.ts src/app/api/ontology/ingest/route.ts src/lib/ontology/mappers/kammandor-deals.ts src/lib/ontology/mappers/gleif.ts src/lib/ontology/ingest.ts src/lib/ontology/__tests__/kammandor-deals.test.ts src/app/api/ontology/ingest/__tests__/route.test.ts --loader:.ts=ts --outdir=/tmp/chk_a1

Exit code: 0. Output (all 7 files transpiled cleanly):
../chk_a1/app/api/ontology/ingest/route.js                 10.8kb
../chk_a1/lib/ontology/__tests__/kammandor-deals.test.js    8.6kb
../chk_a1/app/api/ontology/ingest/__tests__/route.test.js   7.1kb
../chk_a1/lib/ontology/mappers/kammandor-deals.js           5.6kb
../chk_a1/lib/ontology/mappers/gleif.js                     3.5kb
../chk_a1/lib/ontology/authRpc.js                           3.4kb
../chk_a1/lib/ontology/ingest.js                            3.4kb
Done in 11ms

Note: esbuild here is a transpile-only smoke test (no type checker), per the task's own verification
spec — it confirms syntax validity and import resolution, not full `tsc` type-soundness. No `tsc`
or `vitest` run was performed (both explicitly out of scope for this agent — the orchestrator runs
those gates).

`git -C /tmp/kx1783883103 diff --stat` scoped to this task's 7 files:
 .../api/ontology/ingest/__tests__/route.test.ts    | 124 ++++++++++++++++----
 src/app/api/ontology/ingest/route.ts               | 126 +++++++++++++++++----
 src/lib/ontology/__tests__/kammandor-deals.test.ts |  71 ++++++++++++
 src/lib/ontology/authRpc.ts                        |  71 ++++++++++++
 src/lib/ontology/ingest.ts                         |  12 +-
 src/lib/ontology/mappers/gleif.ts                  |  13 +++
 src/lib/ontology/mappers/kammandor-deals.ts        |  50 +++++++-
 7 files changed, 419 insertions(+), 48 deletions(-)

No commit was made (orchestrator's responsibility).

## Honest list of uncertainties / things the orchestrator should double-check

1. No `tsc --noEmit` run. esbuild transpiles per-file without cross-checking types (e.g. it
   won't catch a case where `MapperResult`'s new optional field is referenced with a typo, or where
   `ProposedEdit.payload` (`Record<string, unknown>`) comparisons behave unexpectedly under strict
   settings). I read the relevant type definitions (`src/lib/ontology/types.ts`'s `ProposedEdit`,
   `MapperResult` in `gleif.ts`) and mirrored the existing test file's own casting idioms
   (`e.payload.id`, `(e.payload as { type?: string })`, `row.evaluation as {...}`), but a real
   `tsc --noEmit` pass has not been run against this branch by me.
2. No `vitest` run. I did not execute the test suite (out of scope per the task's environment
   rules) — the new/edited tests are unrun. I traced the auth logic and the mapper/ingest grounding
   logic by hand against the test expectations and am confident in the assertions, but only an actual
   test run confirms it (particularly the exact-fetch-call-count assertions, which are easy to get
   subtly wrong with async ordering).
3. `existingEntities` vs `knownEntityIds` semantics for anchors: I deliberately built
   `anchorEntityIds` from only `existingEntities` (real, already-approved `intel.entity` rows),
   excluding ids sourced from `pendingEdits` (`status='pending'` proposals not yet approved). The task
   said "pass the already-fetched existing intel.entity ids into the record as anchor_entity_ids",
   which I read as specifically the approved-entity read, not the pending-proposal ids — but this is
   an interpretation call worth the orchestrator confirming against intent, since including pending
   ids as anchors too would arguably also be "safe" (they're at least proposed) but would let a link
   ground against something that might still get rejected on review.
4. `isDirectorOf` gap not closed (documented in the route's updated comment and above): already-
   approved director contacts with no other fresh signal this run still won't produce a new
   `isDirectorOf` proposal, because this route only ever passes fresh contacts into `rec.contacts`,
   and `isDirectorOf` is derived from that same array. This is a real, known limitation left honestly
   documented rather than silently fixed or silently ignored — I did not attempt to fix it as it was
   outside the literal instructions (which focused on the `relationships` freshness filter and the
   early-return condition) and fixing it properly would need re-fetching/re-diffing logic for non-
   fresh contacts that doesn't exist yet.
5. Pre-existing dirty state in the clone (`src/lib/sdk/intel/*`, new `actions.ts` /
   `0032_action_registry.sql` files) is unrelated to this task and was left untouched, but it means
   `git diff --stat` (unscoped) will show more files changed than this agent touched — see the scope
   note at the top of this report and the file-scoped diff stat above.
