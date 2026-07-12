# 🦄 EPIC CONVERSATION STARTER — Kammandor INTEL: THE ENGINE ROOM (paste this into the next agent)

**Strictly Private & Confidential — INVRT (owner & operator of Kammandor).** Date: 2026-07-13. UK English, USD. Copy everything below into the next agent — it is self-contained.

Ownership & tenancy: INVRT owns and operates the platform. PFO (Pitt Family Office FZE) is the FIRST CLIENT — a tenant, never an owner. Multi-tenant (PFO + Atlas + INVRT platform org), isolated by RLS + `organization_id`. Nothing hardcoded to any tenant. All tenant data Strictly Private & Confidential; tenants never cross.

You are the incoming UNICORN builder on **Kammandor INTEL** (`github.com/Gully678/Kammandor-Intel`, live at intel.kammandor.com). Bar = UNICORN / bank-grade / zero silent failure / full audit trails. Operate under **GSD + Superpowers + RALPH**. INTEL is the ENGINE ROOM: one governed ontology feeding the Kammandor main app (same Supabase), PULSE (different Supabase, SDK-only), the INVRT platform org, and external clients.

## 0. NON-NEGOTIABLE FIRST ACTIONS (in this order)
1. Invoke `superpowers:using-superpowers`; **INSTALL/LOAD ALL RELEVANT SKILLS — a RULE**: `dev-frontend` (typescript-pro / react-expert) for ALL TS/UI, the Supabase MCP, `coterai-council` on substantive product/architecture decisions, Python skills for worker code. Force every sub-agent to load `dev-frontend:typescript-pro` as ITS first action too.
2. Clone (sandbox; file tools CANNOT reach /tmp — use bash only):
```bash
cd "$(find /sessions -maxdepth 4 -type d -name Kammandor | head -1)"   # mounted MAIN-APP repo (STALE — never build there)
TOK=$(git remote get-url origin | sed -E 's#https://([^@]+)@.*#\1#')   # lift the PAT
D=/tmp/kintel$(date +%s) && git clone -q "https://${TOK}@github.com/Gully678/Kammandor-Intel.git" "$D" && cd "$D"
git config user.name "Gully678"; git config user.email "mark@expaind.com"   # MANDATORY — wrong author = Vercel rejects deploy
git log --oneline -3 | sed -E 's/(ghp|github_pat|gho|ghs|ghr)_[A-Za-z0-9_]+/\1_***/g'
```
   Push to `master` auto-deploys: Vercel (engine, runs the REAL tsc gate) + Render (Python workers). ALWAYS sanitise tokens in output. `/tmp` may hold stale root-owned clones from prior boots — always clone to a FRESH path.
3. **AUDIT THE PRIOR SESSION (2026-07-13) BEFORE BUILDING.** Verify every claim below against the live DB (Supabase MCP, project `ucbnnhfttahmqhvccvyw`) + repo + live endpoints; give the founder a Gut Feel /10:
```sql
select (select count(*) from intel.entity) entities,            -- claimed 39
       (select count(*) from intel.link) links,                 -- claimed 11
       (select count(*) from intel.entity_provenance) prov,     -- claimed 50
       (select count(*) from intel.entity_crosswalk) crosswalk, -- claimed 39
       (select count(*) from intel.proposed_edit where status='approved') approved, -- claimed 52
       (select count(*) from intel.entity where lei is not null) leis,              -- claimed 2
       (select count(*) from intel.action) actions,             -- claimed 0
       (select count(*) from intel.tenant_watchlist) watchlists; -- claimed 0 (heartbeat dark)
```
   Also: `web_fetch https://intel.kammandor.com/api/health` (tip was `5cb0213`, database:ok) and `get_advisors` (baseline: 1 vector-extension WARN, 4 intel definer-RPC WARNs — intentional pattern — plus main-app km_* WARNs; any NEW intel warning is a regression).

## 1. WHAT WAS SHIPPED 2026-07-12/13 (build ON it — read `docs/handoff/` + `_agent_reports/` in the repo)
- **Mission A — ontology POPULATED**: `kammandor-deals` first-party connector (mapper + ingest + auto-fetch) → 50 proposals → founder-approved in /review → 39 entities + 11 links + 50 provenance rows across PFO + Atlas. Migrations `0029` (approve RPC honours payload entity id — root-cause fix for links never binding) + `0030` (source registered, licence `proprietary`).
- **`0031`**: platform-org super_admin may approve/reject cross-tenant (impersonation-proven [P/N1/N2]; re-runnable proof `tests/rls/cross_tenant_review.sql`). All other cross-tenant callers hard-denied.
- **`0032`**: Mission C kinetic layer v1 — `intel.action_type` (5 kinds, abstention tiers act/draft/ask_human) + `intel.action` queue (RLS) + governed `approve_action`/`reject_action` + deterministic router (`src/lib/ontology/actions.ts`) + `/api/ontology/actions` + **executor** `/api/ontology/actions/execute` (x-automate-secret only; executes ONLY `notify` → `public.intelligence_alerts`, severity allow-list CRITICAL/NOTABLE/BACKGROUND; fired by `workers/app/scheduler.py` per cron tick). NO executor for other action types yet.
- **Mission B — resolution**: `/api/ontology/crosswalk/sync` (UUID-equality-only, 39/39 linked), `/api/ontology/resolve/gleif` (exact-name unique-candidate → governed `update_entity` LEI proposals; 2 approved: Morgan Motor `6488V65V6PL505OX5J70`, Adamas `894500GLEJO13EAOON51` — **verify the Adamas LEI record**, short-name risk), `/api/ontology/screen/ofac` (HITL: exact SDN match → informational CRITICAL alert ONLY; 18 screened, 0 matches).
- **Hardening**: ingest auth = x-automate-secret OR live-verified Supabase user token (`verifySupabaseUserToken`); incremental link grounding via `anchor_entity_ids`.
- **Auth fix**: `AuthHashBridge` (root layout) rescues magic-link sessions landing on the Site URL; `signInWithOtp` now requests `/review`.
- Migrations applied = committed: `0001–0032`. **NEXT = `0033`.**

## 2. THE LAWS (never violate)
- Additive/RALPH: one slice, self-audit to 100% before the next; never delete/rewrite working code.
- DB via migrations only (Supabase MCP `apply_migration`; committed file == applied SQL; additive + idempotent; prototype risky/RLS/DDL in a ROLLED-BACK transaction ending `RAISE EXCEPTION 'X_OK_ROLLED_BACK'` — MCP won't return notices).
- RLS is the gate; `intel.approve_proposed_edit` is the SOLE writer to entity/link/provenance; connectors/agents write ONLY `intel.proposed_edit`; `approve_action`/`reject_action` are the only action approval paths; executor never touches `awaiting_approval`.
- Never fabricate a figure, licence, or severity. Provenance verbatim. Deterministic severity/matching only. Sanctions/AML = HITL, alerts only.
- Evidence before done: esbuild/py_compile → push → live `gitSha` + endpoint check → advisors clean; `git add -A` (never `commit -a`); sanitise tokens; never break `master`.
- MULTI-SUB-AGENT DOCTRINE: delegate disjoint-file slices to sub-agents (Sonnet fine; Opus for complex); FORCE them to bash on the explicit /tmp clone path (their file tools silently read the STALE mount); they never commit/push — YOU audit every diff against the gates and SEND BACK until 100%, then commit.

## 3. YOUR MISSION QUEUE (RALPH order)
**T1 — LIGHT THE HEARTBEAT (founder-gated key fix + verify).** THE GOTCHA FOUND 2026-07-13: the founder's keys sit in Supabase **Edge-Function secrets** (dashboard "Custom secrets") — but the engine + Render workers resolve `env → Vault` via the `intel_get_secret` RPC, and **Vault does NOT contain** `BRIGHTDATA_API_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_API_KEY`. Founder must add those THREE to **Vault** (Dashboard → Integrations → Vault → Add secret, same names). Dataset IDs are NOT secrets — global Bright Data identifiers, set as plain Render env vars on BOTH worker services (web + cron), CONFIRMED via Bright Data's assistant:
   `BRIGHTDATA_DS_LI_COMPANIES=gd_l1vikfnt1wgvvqz95w` · `BRIGHTDATA_DS_LI_PEOPLE=gd_l1viktl72bvl7bjuj0` · `BRIGHTDATA_DS_IG_PROFILES=gd_l1vikfch901nx3by4` · `BRIGHTDATA_DS_TIKTOK_PROFILES=gd_l1villgoiiidt09ci` (X/YouTube/Facebook/Reddit: founder grabs the gd_ id from each scraper's `</> Scraper API` page in their control panel). Then: create test watchlist subjects, run `/harvest` + `/api/automate/serp`, confirm grounding-then-delta and alerts landing.
**T2 — Mission D, deterministic workflow engine**: ontology state-change triggers → abstention router → `intel.action` rows (first wires: sanctions entity approved → act-tier notify; new isNamedInDeal link → draft notify). Migration `0033`: widen `intel.change_log` CHECK so action transitions are audited (see `_agent_reports/agent2_action_registry.md` for the reasoning left open).
**T3 — Scheduled re-ingest**: nightly per-tenant `kammandor-deals` ingest + `crosswalk/sync` + OFAC re-screen via scheduler.py (engine calls with x-automate-secret) — the ontology must track the book unattended.
**T4 — Executor expansion**: `attach_to_deal` (use the crosswalk), `create_kammandor_task`, `fire_webhook` (per-tenant allow-listed URLs, signed payloads, idempotency keys — PULSE consumes this).
**T5 — Resolution hardening**: GLEIF matches require jurisdiction/registration agreement when available; incremental isDirectorOf gap (documented in ingest route); tiered fuzzy OFAC (still alert-only).
**T6 — Mission E, SDK productisation**: freeze + version the object/link/action contract; per-tenant handoff tokens documented; publish `docs/SDK_CONTRACT_v1.md` for PULSE + external clients (one-pagers already delivered to founder: `PULSE_TEAM_ONE_PAGER.md`, `KAMMANDOR_APP_AGENT_ONE_PAGER.md` in the mounted folder — keep them true).
**T7 — Ops nits**: add `https://intel.kammandor.com/review` to Supabase Auth redirect allow-list; dashboard→map link tenant context; review UX (bulk approve, provenance inline).

## 4. ENVIRONMENT TRAPS (verbatim lessons)
- No local `npm install`/vitest (45s shell cap). Syntax gate = `npx -y esbuild@0.24.0 <files> --loader:.ts=ts --outdir=/tmp/chk`; Vercel `next build` is the real tsc gate. Python: `python3 -m py_compile`.
- File tools can't reach /tmp; write via bash heredocs / python3 with exact-match asserts. PostgREST bulk inserts need IDENTICAL keys per row (PGRST102).
- Sub-agents MUST bash on the explicit /tmp clone path. Never `sleep` in a call with real work. Supabase MCP `execute_sql` won't return `raise notice` — rolled-back prototypes must `RAISE EXCEPTION`.
- Browser work: the founder's magic-link sessions land per-PROFILE; if driving the /review UI, have the founder sign in INSIDE the Claude-controlled tab (AuthHashBridge now makes any landing page work). NEVER extract session tokens for bulk writes — click the UI's own buttons under explicit founder authorisation; approvals are the human gate.
- Founder's user: `mark@invrt.com` (super_admin, INVRT platform org) — can review cross-tenant since 0031. PFO approvers: ceo@pfo.ae (owner), stuart.brown@pfo.ae (admin).

Bar = UNICORN. The moat is the ontology; the engine room feeds every app. Audit first, then build, verify everything live. Go. 🦄
