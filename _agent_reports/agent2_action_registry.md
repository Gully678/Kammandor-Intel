# Agent 2 — Mission C: Action Registry (v1 draft) — report

Repo clone: /tmp/kx1783883103 (branch master). Not committed (per instructions).
Note: `git status` shows several other files modified (src/app/api/ontology/ingest/*,
src/lib/ontology/authRpc.ts, ingest.ts, mappers/gleif.ts, mappers/kammandor-deals.ts,
src/lib/ontology/__tests__/kammandor-deals.test.ts) — these are PRE-EXISTING changes
from a concurrent agent in this same clone, NOT touched by this task. My changes are
listed below only.

## A. migrations/intel/0032_action_registry.sql (new, draft only)

- `intel.action_type`: platform catalogue (no tenant column), `risk_tier` CHECK
  in ('act','draft','ask_human'), seeded 5 rows exactly as specified
  (notify/draft, create_kammandor_task/ask_human, draft_pulse_asset/draft,
  attach_to_deal/ask_human, fire_webhook/ask_human) via `on conflict (key) do
  nothing`. Table comment explains the 3 abstention tiers. Added RLS (house
  law: "RLS mandatory on new tables") with a simple `for select using (true)`
  read-all policy — there's no tenant column to isolate on and no client
  write path (writes are seed-only via migration); grants mirror the
  read-only-for-authenticated / full-for-service_role posture used elsewhere.
- `intel.action`: tenant-scoped queue, exact column list from the spec (id,
  tenant_id, action_type_key FK, subject_entity_id FK-on-delete-set-null,
  payload, status CHECK across all 7 states, requested_by, rationale,
  approved_by/at, executed_at, error, created_at/updated_at). RLS +
  `action_isolation` policy copied EXACTLY from the 0025/0026
  `(tenant_id = cp_get_org()) or cp_is_super_admin()` pattern. Grants mirror
  0025/0026 (`select` to anon/authenticated, full CRUD to service_role — all
  writes go through server-side service-role code or the SECURITY DEFINER
  RPCs). Indexes on (tenant_id, status) and (action_type_key). Added an
  `updated_at` touch trigger (same pattern as 0025/0026's `tg_*_touch`) for
  defence-in-depth on any future direct UPDATE path (e.g. a later executor
  slice) — harmless alongside the RPCs' own explicit `updated_at = now()`.
- `intel.approve_action(p_action_id uuid)` / `intel.reject_action(p_action_id
  uuid, p_reason text)`: SECURITY DEFINER, `search_path = intel, public,
  pg_temp` pinned exactly like 0012/0029. Authz block is a verbatim
  structural copy of 0012's: caller org resolved from
  `auth.jwt()->'app_metadata'->>'organization_id'`, must be non-null AND
  exactly equal `action.tenant_id` (unconditional — no cross-tenant approval
  even for a super_admin of a different org), caller role from `cp_role`
  must be in `(super_admin, owner, admin, executive)`. Hard `raise
  exception` (not silent return) on every failure, same errcodes as 0012
  (`insufficient_privilege`, `no_data_found`, `invalid_parameter_value`,
  `serialization_failure`). Only `awaiting_approval` rows may be
  approved/rejected (loud error otherwise, matching the "only pending"
  guard in 0012). approve sets `status='approved', approved_by=auth.uid(),
  approved_at=now(), updated_at=now()`; reject sets `status='rejected',
  error=p_reason, updated_at=now()`. Both return the updated `intel.action`
  row (I chose to return the row rather than void/uuid — more useful for
  the API route's response and doesn't conflict with the spec, which didn't
  mandate a return type). Grants: revoked from public/anon, granted execute
  to authenticated only — identical posture to 0012.
- Governance banner at the top of the file states: these RPCs are the ONLY
  approval paths; agents/routes may only INSERT 'queued'/'awaiting_approval'
  rows; this migration does NOT create an executor (explicitly deferred to a
  later slice, as instructed).

### change_log decision (the flagged uncertainty)

Read migrations/intel/0016_change_log_versioning.sql first, as instructed.
`intel.change_log.table_name` has a hard `CHECK (table_name in ('entity',
'link'))`, and the table is populated exclusively by AFTER INSERT/UPDATE
triggers on `intel.entity`/`intel.link` using `to_jsonb(OLD)`/`to_jsonb(NEW)`
for versioning those two ontology row types specifically (PRD §7.8). An
`intel.action` status transition is a different kind of event (a workflow
state transition, not an ontology row version) and does not fit that shape
without widening the CHECK constraint — I did NOT guess at that; per your
instruction I documented the decision in a comment inside
`intel.approve_action()`'s body and skipped the insert entirely. If action
history/audit is wanted, the cleanest additive path is a further migration
either (a) widening `change_log.table_name`'s CHECK to include `'action'`
and adjusting the trigger fn to handle a row shape with no `before`
(status-only transitions could just log `after`), or (b) a dedicated
`intel.action_log` table — I'd lean towards (b) since action rows aren't
"entity-like" and forcing them into change_log's entity/link-shaped
before/after semantics would be a stretch. Left as an open decision for the
orchestrator/founder, not decided unilaterally.

Also flagging: migrations/intel/0031 does not exist yet in this clone (the
brief said NEXT = 0032, implying 0031 is either reserved for a concurrent
agent this session or already merged elsewhere) — followed the explicit
instruction to use 0032 regardless.

## B. src/lib/ontology/actions.ts (new)

Pure TS, no network/DB import. `ActionTypeKey`, `RiskTier`, `ActionStatus`
unions; `ActionType`/`Action` interfaces mirroring the SQL columns exactly
(including `subject_entity_id?: string | null` etc. matching the nullable
FK). `routeAction(riskTier, confidence)`: deterministic, matches the spec
matrix exactly —
- invalid confidence (NaN, or outside [0,1]) => 'ask_human' always
  (fail-closed), checked FIRST before any tier logic;
- 'ask_human' tier => always 'ask_human';
- 'draft' tier => confidence >= 0.9 ? 'draft' : 'ask_human';
- 'act' tier => confidence >= 0.9 ? 'act' : confidence >= 0.6 ? 'draft' :
  'ask_human'.
`initialStatusFor(route)`: 'act' => 'queued', 'draft'/'ask_human' =>
'awaiting_approval'. Doc comments throughout cite the abstention-layer
principle (act / draft & recommend / ask a human) and state explicitly that
routing is deterministic, never an LLM call.

## C. src/lib/ontology/__tests__/actions.test.ts (new)

vitest, matches the house style seen in kammandor-deals.test.ts /
mappers.test.ts (plain `describe`/`it`/`expect`, no custom harness). Covers:
per-tier behaviour (ask_human always; draft's 0.9 boundary inclusive both
sides; act's 0.9 and 0.6 boundaries inclusive both sides), a
parametrised fail-closed sweep across all 3 tiers × 7 invalid values
(NaN, -1, 2, -0.0001, 1.0001, ±Infinity), an explicit check that 0 and 1
themselves are treated as VALID (only outside [0,1] fails closed — this
was worth asserting explicitly since it's easy to conflate "low
confidence" with "invalid confidence"), and `initialStatusFor` mapping
for all 3 routes plus an explicit "never returns approved" assertion.

## D. SDK: client.ts / types.ts / index.ts / route.ts

- `types.ts`: imports `Action/ActionStatus/ActionType/ActionTypeKey/RiskTier`
  from `@/lib/ontology/actions` (re-exported), mirroring exactly how the
  existing ontology types are imported/re-exported at the top of the file.
  Added `ListActionsParams` (`status?: string; limit?: number` — matched the
  existing `ListAlertsParams` convention of using a loose `string` for a
  status filter rather than the narrow union, since that's the established
  in-file pattern), `ListActionsResponse`, `RequestActionInput`
  (`actionTypeKey: string` per your literal spec — the codebase actually
  mixes conventions here, e.g. `WatchlistItemInput.kind` IS the narrow
  union — so this is a judgement call favouring your explicit instruction
  over the stricter-typing alternative; flagging it as the one place I
  didn't over-ride your literal signature with a tighter type),
  `RequestActionResponse`.
- `client.ts`: added `listActions`/`requestAction` to the `IntelClient`
  interface and implementation, following the EXACT pattern of
  `listAlerts`/`upsertWatchlist` (same `request<T>()` helper, same
  query-param building, same doc-comment style, same header route-map
  comment at the top of the file updated to include the two new routes).
- `index.ts`: added the 8 new type names to the existing alphabetically-ish
  ordered `export type { ... } from './types'` block (Action, ActionStatus,
  ActionType, ActionTypeKey, ListActionsParams, ListActionsResponse,
  RequestActionInput, RequestActionResponse, RiskTier).
- `src/app/api/ontology/actions/route.ts` (new): GET (list, tenant-scoped,
  optional `status`/`limit`) + POST (request a new action). Auth: inline,
  NOT shared-helper-modifying — dual path exactly mirroring
  `harvest-delta/route.ts`: (1) `x-automate-secret` header + an explicit
  tenant (`body.tenant` for POST, `?tenant=` for GET) via a
  `timingSafeEq()` byte-compare copied from harvest-delta, or (2) the
  signed handoff token via `resolveTenantFromRequest` (imported, not
  modified — that file is owned by another agent this session).
  POST: validates `actionTypeKey` non-empty, `subjectEntityId` (if present)
  is a UUID, `payload` is a plain object (default `{}`), `rationale`
  capped at 4000 chars, `confidence` defaults to 1 (per spec, "for human
  requests"), `requestedBy` defaults to `'api'` if not supplied (the DB
  column is `not null` and the spec didn't define its source, so I added an
  optional body field with a safe default rather than guessing a fixed
  string — flagging this as a minor open decision: should `requestedBy`
  instead be derived from the resolved auth path, e.g. `'handoff:<tenant>'`
  vs `'automate:<tenant>'`? Left as the simplest safe default for v1).
  Fetches `intel.action_type.risk_tier` for the given key from the DB
  (never trusts a client-supplied tier) — unknown key => 400. Computes
  `routeAction()` then `initialStatusFor()` and inserts ONLY that computed
  status (`'queued'` or `'awaiting_approval'`) — there is no code path that
  can insert `'approved'`. GET/POST both use raw PostgREST with the
  service-role key + `Accept-Profile`/`Content-Profile: intel`, matching
  `src/app/api/intel/watchlist/route.ts` and `objects/shared.ts` exactly.

### One type-safety fix worth flagging

While matching the "action_type not found" validation to
`RiskTier` for `routeAction()`, an initial draft used a negated triple
`!==` guard (`if (riskTier !== 'act' && riskTier !== 'draft' && riskTier
!== 'ask_human') return;`) on a plain `string | null` value. TypeScript
does NOT narrow a general `string` type via negated literal-equality
guards (only positive equality/union-based narrowing works reliably), so
the subsequent call to `routeAction(riskTier, confidence)` would have been
a type mismatch (`string` vs the strict `RiskTier` union) once real
type-checking runs. I rewrote it as a positive-equality ternary
(`rawRiskTier === 'act' || ... ? rawRiskTier : null`) annotated as
`RiskTier | null`, which narrows correctly — no `as` cast needed. Caught
this by manual review since `tsc` isn't runnable in this sandbox
(no `node_modules`) — the esbuild check below only transpiles, it does not
type-check, so this class of bug would NOT have been caught by the
mandated verification command alone. Recommend the orchestrator's
rolled-back-prototype pass (or a real `tsc --noEmit` once dependencies are
installed) double-checks this file for any other narrowing issues I may
have missed.

## Verification run

```
cd /tmp/kx1783883103 && npx -y esbuild@0.24.0 src/lib/ontology/actions.ts \
  src/lib/ontology/__tests__/actions.test.ts src/lib/sdk/intel/client.ts \
  src/lib/sdk/intel/types.ts src/lib/sdk/intel/index.ts \
  src/app/api/ontology/actions/route.ts --loader:.ts=ts --outdir=/tmp/chk_a2
```
Exit 0, all 6 files transpiled cleanly (both before and after the
type-narrowing fix above).

SQL sanity (python3): file non-empty (16.9KB → grew slightly after no
further edits), `$$` pairs = 4 (balanced), `$body$` pairs = 2 (balanced),
naive paren count balanced (108/108). Cannot execute — orchestrator to
prototype in a ROLLED-BACK transaction per house law.

## Concerns / open decisions for the orchestrator

1. **change_log shape** (above) — deliberately not written; needs a
   decision (widen the CHECK vs a dedicated action_log) before any audit
   trail for actions exists.
2. **`requested_by` source** — currently a client-suppliable field
   defaulting to `'api'`; consider whether it should instead be derived
   server-side from the resolved auth path/caller identity.
3. **migrations/0031 absent** — used 0032 per explicit instruction; worth
   confirming no collision with a concurrently-run agent before applying.
4. **No executor** — by design (explicitly out of scope this slice) —
   `'queued'`/`'approved'` rows currently have nothing that dequeues them.
5. Did not run `npm install`/`vitest`/`tsc`, did not commit, did not touch
   any DB — all per the environment rules.
