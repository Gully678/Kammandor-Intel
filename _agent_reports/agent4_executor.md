# Agent 4 — ACTION EXECUTOR v1 (Mission C completion)

## Delivered

1. **`src/app/api/ontology/actions/execute/route.ts`** (new) — `POST /api/ontology/actions/execute`.
   - Auth: ONLY `x-automate-secret === process.env.AUTOMATE_SECRET` (constant-time compare). No bearer/handoff-token path — deliberately narrower than the read/queue route (`src/app/api/ontology/actions/route.ts`), since this route causes a real-world side effect.
   - Body: `{ tenant?: uuid, limit?: number }` (default 10, max 25); `tenant` validated as a UUID if present (400 if malformed).
   - Reads `intel.action` where `status=in.(queued,approved)` AND `action_type_key=eq.notify` (optionally `tenant_id=eq.<tenant>`), `order=created_at.asc`, `limit=<limit>`. **v1 executes ONLY `notify`** — every other catalogue action type (`create_kammandor_task`, `draft_pulse_asset`, `attach_to_deal`, `fire_webhook`) is left completely untouched; this is documented in the file's governance banner and echoed in the response's `skippedOtherTypes` string.
   - Per row, sequentially, never throwing across rows:
     - `headline = payload.headline` — if missing/not a string/whitespace-only, PATCH the action to `status='failed', error='notify payload missing headline'`, continue.
     - `severity` — resolved against a **fixed allow-list**, deterministic, never computed.
     - `detail = payload.detail (optional) + ' — executed from the governed action queue (intel.action).'`
     - `organization_id = action.tenant_id`, `status: 'open'`.
     - Insert into `public.intelligence_alerts` using the **default PostgREST profile** (no `Accept-Profile`/`Content-Profile` header) — intentionally different from the `intel.action` reads/writes, which use `Content-Profile: intel` (mirrored verbatim from the actions route's `intelHeaders()`).
     - On success: PATCH the action row to `status='executed', executed_at=<ISO now>, updated_at=<ISO now>`. On any failure (alert insert fails, or the post-insert PATCH itself fails, or an unexpected exception): PATCH to `status='failed', error=<message, trimmed to 500 chars>`. Every write's HTTP status is checked; nothing is silently dropped.
   - Response: `{ picked, executed, failed, skippedOtherTypes, tenant? }`.

2. **`workers/app/scheduler.py`** (additive edit) — added `_push_execute()` (mirrors `_push_serp()`'s httpx/env conventions exactly: `INTEL_ENGINE_BASE` env, `get_secret("AUTOMATE_SECRET")`, `x-automate-secret` header, best-effort try/except). Called **once per scheduler tick** (not per-tenant — the executor scopes tenant filtering itself) after the existing per-tenant harvest loop, with `{"limit": 25}`. Result folded into the run's final JSON summary under an `"execute"` key. Failures are caught and logged into that key; never fatal to the heartbeat. Module docstring updated with a new numbered item (3) describing the call.
   - **Known gap, by design of the literal brief:** the executor call sits *after* the per-tenant loop, so it is skipped in the two early-return branches (`SUPABASE not configured`, `no tenants with watchlist items`) — the same "clean no-op" behaviour those branches already had. If notify actions should still be executed even when no tenant has an active watchlist item, that's a one-line follow-up (move the call above the `if not tenants` early return) — flagging it rather than guessing, since the brief said "after the existing per-run work."

3. **Tests:**
   - `src/app/api/ontology/actions/__tests__/execute.test.ts` (vitest, mocked `global.fetch`, styled after `src/app/api/ontology/ingest/__tests__/route.test.ts`): 401 with no/wrong secret and zero fetch calls; missing-headline row → `failed` + exact governed error string, no alert insert attempted; happy path → alert insert (asserts default-profile headers, i.e. no `Content-Profile`) + `executed` PATCH (asserts `Content-Profile: intel`); severity outside the allow-list (`'HIGH'`) defaults to `'BACKGROUND'`; and a query-shape test asserting the exact URL-encoded `status=in.(queued,approved)` + `action_type_key=eq.notify` filters.
   - Per house rules for this session, vitest itself was **not run** (constraint: no npm install / no vitest) — verified instead via `esbuild` transform (see below).

## Verification evidence

- `npx --yes esbuild src/app/api/ontology/actions/execute/route.ts --format=esm --outfile=...` → **exit 0**, no errors.
- `npx --yes esbuild src/app/api/ontology/actions/__tests__/execute.test.ts --format=esm --outfile=...` → **exit 0**, no errors.
- `python3 -m py_compile workers/app/scheduler.py` → **passes, no output**.
- `git diff --stat`: only `workers/app/scheduler.py` modified (40 insertions / 2 deletions). New untracked files confirmed as exactly the 2 expected: `src/app/api/ontology/actions/execute/route.ts`, `src/app/api/ontology/actions/__tests__/execute.test.ts`. (Other untracked files present in the working tree — `src/app/api/ontology/resolve/`, `src/app/api/ontology/screen/`, `src/lib/ontology/resolveExternal.ts`, `_agent_reports/agent3_resolution.md` — belong to a sibling agent's concurrent work in the same clone and were not touched.)
- No `npm install`, no `vitest`, no `git commit`/`push`, no DB writes/migrations were run, per the environment rules.

## Key deviation from the brief, verified and documented

The brief suggested a default severity allow-list of `['INFO','WARNING','HIGH','CRITICAL']` but instructed to grep the actual codebase vocabulary and use that instead if different. It IS different: `src/lib/signals/types.ts`'s `SignalSeverity` type, `migrations/intel/0024_sanctions_entity_alert.sql`'s `'CRITICAL'` literal insert, and `src/app/api/signals/harvest-delta/route.ts`'s `buildAlert()` all confirm `public.intelligence_alerts.severity`'s real CHECK-constraint vocabulary is **`'CRITICAL' | 'NOTABLE' | 'BACKGROUND'`**. The executor's allow-list and default (`'BACKGROUND'`) use this real vocabulary — using the brief's suggested set would have violated the table's CHECK constraint and made every alert insert fail. This is documented in the route's governance banner and in code comments.

## Uncertainties for the orchestrator to confirm

1. **Scheduler no-op gap** (above) — executor call doesn't fire when there are zero tenants with watchlist items, even if `AUTOMATE_SECRET`/Supabase are configured and notify actions are queued. Flagging for a decision rather than silently changing loop structure.
2. **`intelligence_alerts` schema profile** — `src/app/api/signals/harvest-delta/route.ts`'s own insert into `intelligence_alerts` uses its `h(cfg, true)` helper, which unconditionally sets `Content-Profile: intel`, seemingly inconsistent with `intelligence_alerts` living in the `public` schema per `docs/runbooks/OPS_DR_RUNBOOK.md`. I did NOT touch that existing route (out of scope, additive-only), but built THIS executor's insert on the explicit brief instruction ("default profile, public.intelligence_alerts") — i.e. no profile header at all. Worth a follow-up check on whether harvest-delta's existing insert is actually working in production or silently 404ing/misrouting; not something I could verify without live DB access in this sandbox.
3. Per the current `intel.action_type` seed data, `notify`'s `risk_tier` is `'draft'`, and `initialStatusFor()` never yields `'queued'` for a `'draft'`-tier type — only `'act'`-tier types reach `'queued'` via the deterministic router. So today, `notify` rows will only ever reach this executor via `'approved'` (human path). The `queued` branch of the executor's query is future-proofing for if/when an act-tier router inserts `notify` actions directly, per the brief's explicit instruction to select both statuses — not a bug, just worth knowing when testing end-to-end.
