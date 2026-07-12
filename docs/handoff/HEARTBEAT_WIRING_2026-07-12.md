# LIVE HEARTBEAT — Python harvest agent: what it is + exact keys to add (2026-07-12)

**Strictly Private & Confidential — INVRT / PFO.** Engine repo: `Gully678/Kammandor-Intel` (`master`), engine URL `intel.kammandor.com` (Vercel), Python workers on Render.

## What now exists (live on push to `master`)
The **net-new signal heartbeat** is complete end-to-end:

1. **Advisor adds a subject** (PULSE or Kammandor) → a `handle` watchlist item whose value is a **profile/company URL** (e.g. `https://www.linkedin.com/company/lotus-cars`, `https://www.tiktok.com/@evreviewer`).
2. **The Python agent** (`workers/app/harvest.py`, route `POST /harvest`) reads those URLs, detects the platform, and runs the tenant's **Bright Data collect-by-URL scraper** (the same 65 scrapers PULSE already uses) via the standard REST flow (`trigger → poll progress → snapshot`).
3. It maps each record to a **typed item** (`external_id, kind, title, url, content_hash, attributes`) — engagement + sentiment pulled verbatim — and **pushes** to the engine's grounding/delta brain `POST /api/signals/harvest-delta`.
4. **The brain** baselines on first sight (**grounding** — 0 signals, "learn from this"), then on later runs signals only **net-new** (new `external_id`) or **net-changed** (`content_hash` moved), as TYPED alerts (`post` + engagement/sentiment, `new_product`, `price_change`, `job_listing`, `review`, `mention`) with **deterministic** severity — no LLM figure invented.
5. **The scheduler** (`workers/app/scheduler.py`, Render `cron` every 6h) drives step 2 for every tenant that has handle URLs.

> Honest scope: v1 does **profile-collect** (URL → that profile/company record + its engagement snapshot). The richer *post-level* mention listening (Bright Data discover-by-URL post scrapers) is the same client + different dataset IDs — the next increment. Per-scraper attribute field names (engagement/sentiment/price/role) are **best-effort** and should be confirmed against **one live sample per scraper** once keys land (Bright Data record schemas differ per dataset).

---

## KEYS TO ADD — Render (both the `web` and the `cron` service)
Set these on **`kammandor-intel-workers`** (web) **and** **`kammandor-intel-heartbeat`** (cron). All are `sync:false` (you paste the value in the Render dashboard).

| Env var | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://ucbnnhfttahmqhvccvyw.supabase.co` | already set on web; set on cron too |
| `SUPABASE_SERVICE_ROLE_KEY` | (service role key) | already on web; set on cron too |
| `AUTOMATE_SECRET` | a long random string | **MUST be the same value** already set on the Vercel engine (`AUTOMATE_SECRET`) — this is how the worker authenticates to `/api/signals/harvest-delta` |
| `INTEL_ENGINE_BASE` | `https://intel.kammandor.com` | pre-filled in `render.yaml`; only change for a preview URL |
| `BRIGHTDATA_API_KEY` | Bright Data → Control Panel → API keys | can instead live in Supabase Vault (worker resolves env→Vault) |

### Bright Data dataset IDs — the `gd_…` id from each scraper's `</> Scraper API` page
Set only the platforms you actually watch:

| Env var | Bright Data scraper |
|---|---|
| `BRIGHTDATA_DS_LI_COMPANIES` | LinkedIn company — collect by URL |
| `BRIGHTDATA_DS_LI_PEOPLE` | LinkedIn people — collect by URL |
| `BRIGHTDATA_DS_X_PROFILES` | X (Twitter) profiles — collect by URL |
| `BRIGHTDATA_DS_IG_PROFILES` | Instagram profiles — collect by URL |
| `BRIGHTDATA_DS_TIKTOK_PROFILES` | TikTok profiles — collect by URL |
| `BRIGHTDATA_DS_YT_CHANNELS` | YouTube — collect by URL |
| `BRIGHTDATA_DS_FB_PAGES` | Facebook pages — collect by URL |
| `BRIGHTDATA_DS_REDDIT` | Reddit posts — collect by URL |

**Add `AUTOMATE_SECRET` on the Vercel engine too** (if not already) — same value on all three surfaces (engine + worker web + worker cron). That single shared secret is the entire server-to-server trust for the delta push.

---

## How to run / verify
- **Automatic:** the Render `cron` (`kammandor-intel-heartbeat`, `0 */6 * * *`) runs `python -m app.scheduler` — enumerates tenants with handle URLs and harvests each. Change the cadence in the Render dashboard.
- **On demand (one tenant):** `POST https://<worker-url>/harvest` with header `x-automate-secret: <AUTOMATE_SECRET>` and body `{"tenant":"<org uuid>"}`. Returns per-subject collected counts + the delta result.
- **What "working" looks like:** first run of a new subject → `grounded:true, baselined:N, signalled:0`. A later run after the subject posts/changes → `net_new` / `net_changed` > 0 and rows land in `public.intelligence_alerts` (status `open`) → dashboard feed + SSE.

**When keys are in, tell me** and I'll trigger a live `/harvest` for a test watchlist and confirm grounding-then-delta on the real Bright Data schema (and lock the exact attribute field names per scraper).

---

## SERP layer added (2026-07-12, commit fb6085b — live, verified)
The heartbeat now also listens on **search engines** via DataForSEO SERP (read live from docs.dataforseo.com/v3/serp/). For every **name-based** watchlist subject (`keyword` / `company` / `product`) the engine pulls **Google News + Google Organic** (Live/Advanced, inline result) and pushes each result through the **same** grounding/delta brain → first sight baselines, later runs signal only net-new articles (new URL) or net-changed (title/snippet/rank moved).

**Endpoints wired:** `POST /v3/serp/google/news/live/advanced` and `/organic/live/advanced` (Basic `base64(DATAFORSEO_LOGIN:DATAFORSEO_API_KEY)`; `location_code=2826` UK, `language_code=en`).

**New engine route:** `POST /api/automate/serp` — auth = handoff token OR `x-automate-secret`+`{tenant}`. Gated: no DataForSEO keys / no name subjects → clean no-op.

**Keys to add:** none new — SERP reuses the **DataForSEO** keys already listed for reviews (`DATAFORSEO_LOGIN` + `DATAFORSEO_API_KEY` in Vault). Optional `SERP_PROVIDER` (default `dataforseo`).

**Scheduling:** the Render cron (`kammandor-intel-heartbeat`) now enumerates every tenant with any active watchlist item and, per tenant, runs BOTH the Bright Data social harvest AND the SERP harvest — both gated no-ops when not applicable.

**Full DataForSEO SERP surface available** (for future slices): Google (Organic, News, Maps, Local Finder, Events, Images, Jobs, Autocomplete, Ads, Finance), Bing, YouTube, Yahoo, Baidu, Naver, Seznam — plus SERP Screenshot + AI Summary. We wired News + Organic first as the highest-value net-new signals; the rest are the same client + a different endpoint slug.
