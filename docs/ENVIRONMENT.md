# Kammandor Intel — Environment Variable Matrix

**Strictly Private & Confidential — INVRT / Pitt Family Office.**
v2.5 ops slice (PRD §14/§15). Every variable the engine reads, verified against
the codebase (`grep -rn "process.env." src workers`). `/api/health` reports the
coarse state of the starred (★) operational trio without leaking values.

**Resolution order for named secrets:** `getSecret(name)` (`src/lib/secrets.ts`)
reads `process.env[name]` first, then falls back to Supabase Vault via the
`intel_get_secret` RPC (migration `0004`). The Python workers mirror this in
`workers/app/config.py`. Variables marked *env-only* are read directly from
`process.env` and never consult Vault.

---

## 1. Core data store

| Variable | Component | Required | When missing |
|---|---|---|---|
| `SUPABASE_URL` | All service API routes (`/api/automate`, `/api/signals/scan`, `/api/ontology/*`, `/api/intel/monitoring-config`, `/api/health`), secrets resolver, Python workers | **Yes** | Explicit not-configured responses: `/api/automate` → 503 "The data store is not configured. Nothing was run."; `/api/signals/scan` → 502 watchlist-load failure; `authRpc` → 500 "SUPABASE_URL not configured"; `/api/health` → `database: "unreachable"`. Vault fallback also disabled. |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as above (service PostgREST reads/writes), Python workers | **Yes** | Same explicit 502/503/unreachable behaviours as `SUPABASE_URL`. **Server-only — never expose in a `NEXT_PUBLIC_*` var.** |
| `SUPABASE_ANON_KEY` | `src/lib/ontology/authRpc.ts` (user-JWT RPC calls: approve/reject) | Optional | Falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then to the caller's token as `apikey`. |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser client (`src/lib/supabase/browserClient.ts`) — /review analyst inbox magic-link sign-in | For /review only | Review inbox sign-in unavailable; server routes unaffected. Public browser-safe values (anon key only). |

## 2. Security & tenancy (★ reported by /api/health)

| Variable | Component | Required | When missing |
|---|---|---|---|
| ★ `INTEL_HANDOFF_SECRET` | Tenant handoff verification (`src/lib/handoff/*`; used by `/api/signals/scan`, `/api/intel/monitoring-config`). Via `getSecret` (env → Vault). Shared verbatim with the MAIN Kammandor app. | **Yes (prod)** | Handoff verification **fails closed** — no tenant resolved → 401 "No valid tenant could be resolved for this request." Health reports `handoffSecret: "missing"`. |
| `INTEL_ALLOW_UNSIGNED_TENANT` | `src/lib/handoff/resolveTenant.ts` (env-only) | **Leave unset in prod** | Default (unset/false): plain `?tenant=` params are IGNORED — only signed tokens are trusted. Set to exactly `'true'` for dev back-compat only; spoofable. |
| ★ `AUTOMATE_SECRET` | `/api/automate` guard (env-only; header `x-automate-secret` or `?secret=` for Vercel cron GET) | **Yes** | 503 "automate not configured (AUTOMATE_SECRET is not set)" — the route is never silently open. Health reports `automateSecret: "missing"`. |
| `SDK_INGEST_KEY` | `/api/sdk/ingest` (env-only, fail-closed) | To enable SDK ingest | 503 "Ingest endpoint disabled — SDK_INGEST_KEY not configured". |
| `GITHUB_WEBHOOK_SECRET` + `GITHUB_WEBHOOK_FORWARD_URL` | `/api/github-webhook` (env-only, fail-closed; both required together) | To enable webhook | 503 "Webhook endpoint not configured". |

## 3. Pipeline connectors (governed ingest)

| Variable | Component | Required | When missing |
|---|---|---|---|
| `MARKETS_FX_BASE_URL` + `MARKETS_FX_API_KEY` | `src/lib/pipeline/connectors/markets.ts` (licensed FX/quotes connector) | **Pending vendor** — set only once the licensed vendor is approved | Connector reports an EXPLICIT not-configured state ("markets connector not configured … set MARKETS_FX_BASE_URL and MARKETS_FX_API_KEY once approved") and ingests nothing. It never fabricates data and never falls back to an unlicensed source. |
| `COMTRADE_KEY` | `/api/un-comtrade`, `/api/ontology/ingest` (via `getSecret`) | Optional | UN Comtrade calls run keyless at preview rate limits / reduced capability. |

## 4. Market-data providers (dashboard/map layer)

| Variable | Component | Required | When missing |
|---|---|---|---|
| `MARKET_DATA_PROVIDER` | `src/lib/markets/index.ts` (env-only selector) | No — defaults `'ecb'` (keyless) | Default keyless ECB provider is used. |
| `FINNHUB_KEY` / `ALPHAVANTAGE_KEY` / `TWELVEDATA_KEY` / `OXR_KEY` | Matching provider in `src/lib/markets/providers/` | Only for the selected provider | Selected provider errors loudly ("not configured"); switch provider or supply the key. |
| `INTEL_DEV_MODE` | `src/lib/markets/providers/yahoo.ts` | Dev only | `yahoo-dev` provider refuses to run unless `MARKET_DATA_PROVIDER=yahoo-dev` AND `INTEL_DEV_MODE=true` (licence guard — never production). |

## 5. Reviews & social providers

| Variable | Component | Required | When missing |
|---|---|---|---|
| `REVIEWS_PROVIDER` | `src/lib/reviews/index.ts` (env-only selector) | No — defaults `'appstore-rss'` (keyless) | Keyless App Store RSS provider used. |
| `YELP_API_KEY` / `TRUSTPILOT_API_KEY` / `G2_API_TOKEN` / `GOOGLE_PLACES_KEY` / `SERPAPI_KEY` / `OUTSCRAPER_KEY` / `APIFY_TOKEN` + `APIFY_ACTOR_ID` | Matching provider in `src/lib/reviews/providers/` | Only for the selected provider | Provider throws `"<NAME> not configured (set env or Supabase Vault)"` (getSecretOrThrow) — loud, never silent. |
| `SOCIAL_PROVIDER` | `src/lib/social/index.ts` (env-only selector) | No — defaults `'brightdata'` | Default requires the BrightData credentials below. |
| `BRIGHTDATA_API_KEY` | Reviews + social BrightData providers (via `getSecret`; Vault-wired name) | For BrightData paths | `getSecretOrThrow` → "BRIGHTDATA_API_KEY not configured (set env or Supabase Vault)". |
| `BRIGHTDATA_DS_LI_PEOPLE` / `_LI_COMPANIES` / `_LI_JOBS` / `_LI_POSTS` / `_GOOGLE_REVIEWS` / `_TRUSTPILOT_REVIEWS` / `_YELP_REVIEWS` | BrightData dataset IDs (env-only) | Per dataset used | "provider key required: set BRIGHTDATA_DS_… env var" for that entity/review type only. |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_API_KEY` | `src/lib/reviews/providers/aggregators/dataforseo.ts` (via `getSecret`; Vault-wired names) | For DataForSEO | Loud not-configured error on use. |

## 6. AI routing (Next.js router + Render Python workers)

| Variable | Component | Required | When missing |
|---|---|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` / `ZHIPU_API_KEY` / `OPENROUTER_API_KEY` | `src/lib/ai/router.ts` (via `getSecret`) + Python workers (`workers/render.yaml`) | At least one for AI features | Router SKIPS unconfigured providers and records "`<provider>`: key not configured" in the attempt errors; with none configured, AI calls fail loudly with the accumulated list. Booked figures are never LLM-emitted regardless. |
| `AI_MODEL_CRITICAL` / `AI_MODEL_FAST` / `AI_MODEL_GEMMA` / `AI_MODEL_BALANCED` / `AI_MODEL_OPENROUTER` | Per-provider model overrides in `src/lib/ai/providers/` (env-only) | No | Defaults: `claude-opus-4-5`, `gpt-4o-mini`, `gemini-2.0-flash`, `glm-4-flash`, `openai/gpt-4o-mini`. |
| `AI_MODEL_ANTHROPIC` / `AI_MODEL_OPENAI` / `AI_MODEL_GOOGLE` / `AI_MODEL_ZHIPU` (+ `AI_MODEL_OPENROUTER`) | Python workers model selection (`workers/app/config.py`; values pinned in `workers/render.yaml`) | No | Worker-side defaults per provider. |
| `PYTHON_VERSION` | Render build (`workers/render.yaml`) | Render-set | Pinned `3.11.9`. |

## 7. Service wiring & feature flags

| Variable | Component | Required | When missing |
|---|---|---|---|
| `WORKER_URL` | `/api/ai/enqueue` → Render worker forwarder (env-only) | To enable async AI jobs | 503 "Worker service not configured. Set WORKER_URL env var." — fail fast. |
| `ENTITY_RESOLVER_URL` | `/api/entity/expand` proxy (env-only) | No | Defaults `http://entity-resolver:4000` (prod) / `http://localhost:4000` (dev). |
| `INTEL_SOURCES` | `src/config/featureFlags.ts` — platform-level source allowlist (comma list) | No | Unset = registry defaults (`enabledByDefault` per source) apply; when set, a source must be listed to be enabled. |
| `INTEL_ACTIVE_RECON_ENABLED` | `src/config/featureFlags.ts` | **Leave unset** (default false) | Active-recon endpoints return 403 (pending compliance sign-off) — the safe default. |
| `OPENSKY_CLIENT_ID` + `OPENSKY_CLIENT_SECRET` | `/api/flights` (OAuth2, higher rate limits) | Optional | Keyless public feed used at lower rate limits. |
| `AIS_API_KEY` | `/api/maritime` (aisstream.io WebSocket) | Optional | Maritime live-AIS layer unavailable/limited; route degrades explicitly. |
| `NEXT_PUBLIC_SITE_TITLE` / `UMAMI_WEBSITE_ID` | `src/middleware.ts` (branding / analytics) | No | Defaults "Kammandor Intel" / analytics disabled (empty id). |

## 8. Platform-set & build/test

| Variable | Component | Notes |
|---|---|---|
| `VERCEL_GIT_COMMIT_SHA` / `RENDER_GIT_COMMIT` | `/api/health` `gitSha` | Set automatically by Vercel/Render; health falls back `'unknown'`. |
| `NODE_ENV` / `PORT` / `HOSTNAME` | Next.js runtime / Docker image | Set by the platform or `Dockerfile` (`production` / `3000` / `0.0.0.0`). |
| `OSIRIS_PORT` | `docker-compose.yml` host-port mapping only | Default 3000; container always listens on 3000. |
| `RUN_LIVE_TESTS` | Vitest (`npm run test:live`) | Opt-in live-network integration tests; unset = skipped. |
| `SCANNER_URL` / `SCANNER_KEY`, `FIRMS_API_KEY`, `N2YO_API_KEY`, `OSIRIS_TELEGRAM_CHANNELS` | Declared in `.env.example` (upstream OSIRIS recon backend / reserved feeds) | **Not read by current engine code** — reserved; safe to leave unset. |

---

*Rotation procedures for `AUTOMATE_SECRET` and `INTEL_HANDOFF_SECRET`:
see `docs/runbooks/OPS_DR_RUNBOOK.md` §4. Never commit secret values;
never place server keys in `NEXT_PUBLIC_*` variables.*
