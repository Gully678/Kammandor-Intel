# Agent 3 — Mission B: External entity resolution (GLEIF + OFAC)

## Files created (all new, additive only — no existing file modified)

1. `src/lib/ontology/resolveExternal.ts`
   Pure matching helpers (no network/DB):
   - `pickUniqueGleifMatch(entityName, records)` → `{status:'matched',match:{lei,legalName}} | {status:'no-match'} | {status:'ambiguous'}`.
     Deterministic: `normaliseCanonicalName(entityName) === normaliseCanonicalName(record.attributes.entity.legalName.name)`,
     requiring exactly one *distinct LEI* among matches (duplicate records sharing the same LEI collapse to one match, not a false ambiguity).
   - `extractGleifLei` / `extractGleifLegalName` — defensive field readers.
   - `ofacNameMatches(entityName, sdnNames)` — exact normalised-name equality, blank names never match.
   - `splitSdnAliases`, `sdnRecordNames`, `sdnRecordId` — helpers to turn a raw OFAC SDN CSV row into candidate names / an id, reused by the screen route.

2. `src/app/api/ontology/resolve/gleif/route.ts`
   `POST { tenant, limit? }` (default 10, max 25). Dual auth gate copied verbatim from `ingest/route.ts`'s `authenticateIngestRequest` (x-automate-secret OR verified Supabase bearer). Reads up to `limit` `intel.entity` rows (`type=eq.company&lei=is.null`) via service-role PostgREST (`Accept-Profile: intel`), skips entities already targeted by a pending `update_entity` proposal (batch pre-check on `proposed_edit` where `status=eq.pending&kind=eq.update_entity`, matched on `payload->>id`), queries GLEIF per remaining candidate (`filter[entity.legalName]=<name>&page[size]=5`, `Accept: application/vnd.api+json`), and only ever proposes via `proposeUpdate(tenant,'update_entity',entity.id,{lei},'gleif-resolver', rationale)` where rationale cites the legal name, LEI, and the exact GLEIF API URL, plus the deterministic-rule statement. Each edit is run through `evaluate()` from `@/lib/ai/analyze` before insert. The ONLY DB write is `POST intel.proposed_edit` (status='pending'), mirroring `insertProposedEdits` in the ingest route byte-for-byte in header convention. Never throws: GLEIF failures / DB read failures degrade to a `skipped.errors` increment or empty result, never an unhandled exception.
   Response: `{ proposed, skipped: {noMatch, ambiguous, alreadyPending, errors}, tenant }`.

3. `src/app/api/ontology/screen/ofac/route.ts`
   `POST { tenant }`. Same dual auth gate (separate local copy). Reads tenant `intel.entity` rows (`type=in.(company,person)`), fetches the OFAC SDN batch via `createOfacSdnConnector(fetch).fetch()` wrapped in try/catch — any failure degrades to `{screened, matches:0, alertsCreated:0, tenant, note:'ofac source unavailable'}`, never throws. Matches each entity's canonical name against every SDN record's name+aliases via `ofacNameMatches`. For each matched, not-yet-alerted entity, inserts exactly ONE row into `public.intelligence_alerts` (default PostgREST schema, no `Content-Profile` header) with `severity: 'CRITICAL'` (a literal constant, never computed), a headline `Possible OFAC SDN name match: <entity name>`, a detail citing the matched SDN record id/name and the exact-match rule plus the "informational... never an auto-action" line, `status: 'open'`, `organization_id: tenant`. Dedupe: reads existing open alerts' headlines once up front and also tracks headlines created within the same run, skipping insert if already present. Makes **zero** writes to any `intel.*` table.
   Response: `{ screened, matches, alertsCreated, tenant }`.

4. `src/lib/ontology/__tests__/resolve-external.test.ts`
   Vitest, pure (no network) coverage of `resolveExternal.ts`: exact match, case/punctuation-insensitivity (and legal-suffix normalisation) via `normaliseCanonicalName`, ambiguity (two distinct-LEI records both matching → `ambiguous`), same-LEI duplicate collapse (→ single match, not ambiguous), no-match, empty/blank inputs, malformed-record defensiveness, `splitSdnAliases` / `sdnRecordNames` / `sdnRecordId` behaviour, and an integration-style test proving an OFAC alias (not just the primary name) is matchable.

## Verification

- `npx -y esbuild@0.24.0 --loader:.ts=ts <file>` → exit 0 for all four new/changed files (syntax + TS-transpile clean).
- `git -C /tmp/kx1783883103 diff --stat` → empty (zero tracked-file modifications; `ingest/route.ts` untouched).
- `git status --porcelain` → only the new files listed above are untracked from this task (plus pre-existing untracked `src/app/api/ontology/actions/**` from other concurrent work, not touched by this agent).
- Did NOT run `tsc --noEmit` / vitest / npm install / git commit per the environment constraints given (esbuild-only verification was the mandated gate).

## Uncertainties / things a reviewer should double-check

1. **`tsc --noEmit` not run** (constraint said esbuild only) — esbuild strips types and does not catch type errors (e.g. a subtly wrong import path or interface mismatch). Recommend running `npx tsc --noEmit` before merge as the existing `BUILD_GATE.md` process requires.
2. **GLEIF API shape assumption**: `pickUniqueGleifMatch`/`extractGleifLei`/`extractGleifLegalName` assume the standard `data[].attributes.entity.legalName.name` / `attributes.lei` (falling back to `id`) shape used elsewhere in this repo (`ingest/route.ts`'s `fetchGleifRecords`). Not verified against a live GLEIF response in this session (no network access here) — only unit-tested against hand-built fixtures matching that documented shape.
3. **OFAC SDN `aliases` delimiter**: assumed semicolon-separated (`splitSdnAliases`), consistent with the OpenSanctions `targets.simple.csv` projection convention referenced in `ofac-sdn.ts`'s own doc comment, but not independently re-verified against a live fetch in this session.
4. **"matches" semantics in the OFAC response**: defined as *count of distinct tenant entities with at least one SDN name match* (not total name-pair collisions), since that's what drives `alertsCreated` 1:1 modulo dedupe. Flag if the intended semantics were "total match events."
5. **Entity-level ambiguity not specially handled for OFAC**: if an entity name matches multiple different SDN records, only the first (`Array.prototype.find`) is cited in the alert detail — this is intentional (informational signal, not adjudication) but worth confirming that's the desired UX; the alert body doesn't enumerate every matched SDN record.
6. Neither route currently checks `isSourceEnabled`/feature flags (unlike the ingest route's GLEIF/OFAC auto-fetch) — the brief didn't ask for this, so it was intentionally omitted, but flagging in case gating is expected before go-live.
