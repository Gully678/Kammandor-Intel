# Kammandor Intel — Operations & Disaster-Recovery Runbook

**Strictly Private & Confidential — INVRT / Pitt Family Office.**
v2.5 ops slice (PRD §14 observability, §15 zero-silent-failure + DR readiness).
Written to be founder-runnable: every step is a concrete command or click, no
tribal knowledge assumed. USD unless stated. UK English.

---

## 1. Deploy topology — what runs where

| Component | Platform | Source of truth | Notes |
|---|---|---|---|
| UI + API (Next.js) | **Vercel** | `master` branch of this repo | All `/api/*` routes, including `/api/health`, `/api/automate`, `/api/signals/scan`, `/api/ontology/*`. |
| Scheduled cycle | **Vercel Cron** | `vercel.json` | `GET /api/automate` every 30 minutes (`*/30 * * * *`). Guarded by `AUTOMATE_SECRET` (`?secret=` on GET — Hobby plan cannot set headers). |
| Python worker (AI jobs) | **Render** | `workers/render.yaml` (`kammandor-intel-workers`, rootDir `workers`, uvicorn, health check `/health`) | Reached from the API via `WORKER_URL` (`/api/ai/enqueue` forwarder). |
| Database | **Supabase** project `ucbnnhfttahmqhvccvyw` (eu-central-1) | `migrations/intel/0001–0019` | **Shared with the main Kammandor app.** Intel owns the `intel` schema; the `public` schema objects it touches (`km_monitoring_config`, `intelligence_alerts`) belong to the main-app track. |
| Self-host fallback | Docker | `Dockerfile`, `docker-compose.yml`, `DOCKER.md`, `nginx/` | Standalone Next.js image + nginx cache + entity-resolver container. Not the production path; kept working for DR/local. |

**First move in ANY incident:** `curl -s https://<deployment>/api/health` — it is
unauthenticated, always answers 200, and reports
`{ status, version, gitSha, checks: { database, handoffSecret, automateSecret }, time }`.
`status: "degraded"` tells you *which* dependency is out without exposing any secret.

---

## 2. Backup / restore posture

### 2.1 What protects what

- **Schema (deterministic rebuild).** `migrations/intel/0001_*.sql … 0019_*.sql`
  rebuild the entire `intel` schema from nothing, in order, idempotently.
  Committed file == applied SQL from `0013` onward (see
  `docs/db/INTEL_LIVE_STATE_2026-07-03.md` for the pre-0013 mapping).
- **Data (operator rows: proposals, approvals, traces, alerts).** Covered by
  Supabase Point-in-Time Recovery — **founder TODO A4 in the main-app track**
  (the project is shared, so PITR is enabled once, there). Until A4 is done,
  data protection is Supabase's default daily backups only.
- **Seeds.** `0001` + `0011` seed the source registry: **10 rows in
  `intel.sources`** (companies-house, fred, gdelt, gleif, markets-fx,
  sec-edgar, un-comtrade, world-bank, reviews, social); `0013` backfills a
  `licence_class` on every row (`licensed | public-attribution | public-open |
  proprietary`). This is the restore-drill invariant.

### 2.2 Restore drill — prove the rebuild actually works

> ⚠️ **COST GATE — founder approval required.** This creates a throwaway
> Supabase project, which is billable. Get the founder's explicit go-ahead
> and run the Supabase MCP `confirm_cost` step **first**. Never run the drill
> against `ucbnnhfttahmqhvccvyw`.

1. **Create a throwaway Supabase project** (any region; smallest tier).
   Via MCP: `get_cost` → `confirm_cost` → `create_project`. Note the new
   project ref, URL and service-role key.
2. **Apply the migrations in order** — `migrations/intel/0001` through `0019`,
   one at a time, no skips, no re-ordering (via MCP `apply_migration` or
   `psql -f`). All are additive + idempotent; a second pass must be a no-op.
3. **Point a local engine at it and run the health endpoint:**
   ```bash
   SUPABASE_URL=https://<throwaway>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<throwaway-service-key> \
   npm run dev   # then:
   curl -s http://localhost:3000/api/health
   ```
   Expect `checks.database: "ok"`. (`handoffSecret`/`automateSecret` will read
   `missing` unless you also set them — that is fine for the drill.)
4. **Verify the seed invariant:**
   ```sql
   select count(*) from intel.sources;                         -- expect 10
   select count(*) from intel.sources where licence_class is null;  -- expect 0
   ```
5. **Tear down** the throwaway project (MCP `pause_project` then delete via
   dashboard, or delete outright). Record drill date + result in the handoff doc.

Run the drill after any migration that touches `intel.sources` or RLS, and at
least quarterly.

---

## 3. Incident playbook

### 3.1 Cron silent (no alerts, no traces appearing)

1. `curl -s https://<deployment>/api/health` —
   - `checks.database: "unreachable"` → Supabase incident or rotated
     service key; fix env on Vercel, redeploy.
   - `checks.automateSecret: "missing"` → `AUTOMATE_SECRET` was lost from the
     Vercel env; `/api/automate` is returning **503 "automate not configured"**
     (it is never silently open). Restore the env var.
2. Vercel dashboard → project → **Cron Jobs / Logs**: confirm the `*/30` job is
   firing and read the response codes (401 = wrong secret in the cron URL;
   503 = not configured; 502 = watchlist load failed).
3. Manual replay to see the full CycleSummary loudly:
   ```bash
   curl -s -X POST "https://<deployment>/api/automate" \
     -H "x-automate-secret: $AUTOMATE_SECRET"
   ```
   Every held batch and every per-tenant failure is in the returned
   `CycleSummary` (`pipeline`, `tenants[]`, `failures[]`) — nothing fails silently.

### 3.2 Alert flood (too many rows landing in `intelligence_alerts`)

- The engine de-duplicates per tenant over a **7-day window**
  (`DEDUPE_WINDOW_DAYS` in `/api/automate` and `/api/signals/scan`, keyed on
  source URL/headline) — a flood therefore means genuinely *new* stories or an
  over-broad watchlist (`km_monitoring_config` keywords/entities/tickers/geos).
- Immediate stop: **disable the cron** (remove the entry from `vercel.json` and
  redeploy, or pause the job in the Vercel dashboard). The route stays guarded;
  nothing else needs to change.
- Then tighten the tenant watchlist and re-enable. Do NOT widen the dedupe
  window in a hurry — it changes matching semantics for every tenant.

### 3.3 Bad batch held (connector data failed expectations)

- A `held` verdict is batch-wide by design: the expectations gate
  (e.g. `GDELT_EXPECTATIONS`) holds the batch for **all** tenants rather than
  ingesting suspect rows for any of them.
- Where to look: the **expectations report in `CycleSummary.failures`**
  returned by `/api/automate` (and persisted per invocation in
  `intel.agent_run`). It names the failing expectation — that is the whole
  diagnosis.
- Resolution: fix upstream (source outage / format drift) or amend the
  expectation *with evidence*, then replay (§3.1 step 3). Held data is never
  written anywhere — nothing to clean up.

### 3.4 Bad deploy — rollback

Never force-push, never rewrite history:

```bash
git checkout -b hotfix/revert-<short-sha>
git revert <bad-commit-sha>        # or a range; keeps history intact
# open the branch, verify: npm test && npx tsc --noEmit
git checkout master && git merge --no-ff hotfix/revert-<short-sha>
git push origin master             # Vercel redeploys from master
```

Confirm with `/api/health` — `gitSha` in the body must show the new commit
(`VERCEL_GIT_COMMIT_SHA`).

---

## 4. Key rotation

Both secrets are shared-secret HMAC-style values; rotation is env-only, no code.

### 4.1 `AUTOMATE_SECRET` (cron guard)

1. Generate: `openssl rand -hex 32`.
2. Set the new value in Vercel env (Production) **and** anywhere the cron URL
   embeds `?secret=` (Vercel cron path if configured that way, monitoring
   scripts).
3. Redeploy. Verify: request with the old secret → **401**; with the new →
   **200** CycleSummary; `/api/health` → `automateSecret: "configured"`.

### 4.2 `INTEL_HANDOFF_SECRET` (tenant handoff HMAC)

⚠️ **Shared with the MAIN Kammandor app** — it signs the short-TTL tenant
handoff token the main app mints when embedding Intel. Rotate **in lockstep**:

1. Generate one new value (`openssl rand -hex 32`).
2. Set it in the main app's environment **and** this app's Vercel env (or
   Supabase Vault — `getSecret()` reads env first, then Vault) in the same
   maintenance window. Tokens are short-TTL, so a brief window is enough.
3. Redeploy both. Verify: embedded Intel view resolves the tenant again, and
   `/api/health` → `handoffSecret: "configured"`.
4. Mismatch symptom: handoff verification **fails closed** — 401 "No valid
   tenant could be resolved" on `/api/signals/scan` and
   `/api/intel/monitoring-config`. That is the designed failure mode, not a bug.

Never commit either value; never echo them into logs. `SUPABASE_SERVICE_ROLE_KEY`
rotation is owned by the main-app track (shared project) — coordinate there.
