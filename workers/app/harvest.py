"""
KINTEL Workers — live-heartbeat harvest agent (net-new signals for PULSE + Kammandor).

For each tenant's watchlist subjects (profile/company URLs), this agent runs the
tenant's Bright Data "collect by URL" scraper, then PUSHES the collected items to
the engine's net-new/grounding brain (POST /api/signals/harvest-delta). The engine
baselines on first sight (grounding) and signals only net-new / net-changed.

The Bright Data scraping is the SAME REST flow PULSE already uses:
  POST /datasets/v3/trigger?dataset_id=&format=json   body [{url}]  -> {snapshot_id}
  GET  /datasets/v3/progress/{snapshot_id}            -> {status}
  GET  /datasets/v3/snapshot/{snapshot_id}?format=json -> [records]
Auth: Bearer BRIGHTDATA_API_KEY.

GATED: no BRIGHTDATA_API_KEY / no dataset_id env / no INTEL_ENGINE_BASE => clean
no-op with a note. Never raises into the request.

NOTE on field mapping: Bright Data record schemas differ per scraper. The generic
mapper below extracts the common id/title/url + engagement/sentiment fields; the
per-dataset attribute mapping (engagement counts, sentiment, price, role) should be
confirmed against one live sample per scraper before relying on those attributes.
"""

from __future__ import annotations

import os
import asyncio
import hashlib
from typing import Any, Optional

import httpx

from .config import get_secret

BD_BASE = "https://api.brightdata.com/datasets/v3"
POLL_MAX = 20
POLL_EVERY_S = 3.0

# host substring -> env var holding the "collect by URL" dataset_id + platform label
PLATFORM_DATASETS: list[tuple[str, str, str]] = [
    ("linkedin.com/company", "BRIGHTDATA_DS_LI_COMPANIES", "linkedin-company"),
    ("linkedin.com/in",      "BRIGHTDATA_DS_LI_PEOPLE",    "linkedin-person"),
    ("tiktok.com",           "BRIGHTDATA_DS_TIKTOK_PROFILES", "tiktok"),
    ("instagram.com",        "BRIGHTDATA_DS_IG_PROFILES",  "instagram"),
    ("youtube.com",          "BRIGHTDATA_DS_YT_CHANNELS",  "youtube"),
    ("youtu.be",             "BRIGHTDATA_DS_YT_CHANNELS",  "youtube"),
    ("facebook.com",         "BRIGHTDATA_DS_FB_PAGES",     "facebook"),
    ("reddit.com",           "BRIGHTDATA_DS_REDDIT",       "reddit"),
    ("twitter.com",          "BRIGHTDATA_DS_X_PROFILES",   "x"),
    ("x.com",                "BRIGHTDATA_DS_X_PROFILES",   "x"),
]

_ENGAGEMENT_KEYS = (
    "likes", "num_likes", "likes_count", "comments", "num_comments", "comments_count",
    "shares", "num_shares", "views", "num_views", "views_count", "followers",
    "reactions", "engagement", "plays", "retweets", "sentiment",
)


def _svc_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json", "Accept-Profile": "intel"}


def _resolve_dataset(url: str) -> Optional[tuple[str, str]]:
    low = url.lower()
    for sub, env, platform in PLATFORM_DATASETS:
        if sub in low:
            ds = os.environ.get(env, "").strip()
            return (ds, platform) if ds else None
    return None


def _s(v: Any) -> Optional[str]:
    return v if isinstance(v, str) and v else None


def _map_item(rec: dict[str, Any], platform: str) -> dict[str, Any]:
    ext = _s(rec.get("id")) or _s(rec.get("post_id")) or _s(rec.get("url")) or _s(rec.get("input_url")) \
        or hashlib.sha1(str(rec).encode()).hexdigest()[:16]
    title = _s(rec.get("title")) or _s(rec.get("caption")) or _s(rec.get("name")) or _s(rec.get("text")) or f"Item {ext}"
    url = _s(rec.get("url")) or _s(rec.get("post_url")) or _s(rec.get("input_url"))
    attrs = {k: rec[k] for k in _ENGAGEMENT_KEYS if k in rec and rec[k] not in (None, "")}
    # content_hash lets the engine detect net-CHANGED (e.g. engagement/price moved)
    content_hash = hashlib.sha1(repr(sorted(attrs.items())).encode()).hexdigest() if attrs else None
    kind = "post" if platform not in ("linkedin-company",) else "mention"
    return {
        "external_id": ext, "kind": kind, "title": title[:300], "url": url,
        "content_hash": content_hash, "attributes": attrs or None,
    }


async def _bd_collect(dataset_id: str, url: str, token: str) -> list[dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        trg = await client.post(
            f"{BD_BASE}/trigger", params={"dataset_id": dataset_id, "format": "json"},
            headers=headers, json=[{"url": url}],
        )
        trg.raise_for_status()
        snapshot_id = trg.json().get("snapshot_id")
        if not snapshot_id:
            return []
        for _ in range(POLL_MAX):
            await asyncio.sleep(POLL_EVERY_S)
            pr = await client.get(f"{BD_BASE}/progress/{snapshot_id}", headers=headers)
            if pr.status_code != 200:
                continue
            status = (pr.json() or {}).get("status")
            if status == "ready":
                break
            if status in ("failed", "error"):
                return []
        snap = await client.get(f"{BD_BASE}/snapshot/{snapshot_id}", params={"format": "json"}, headers=headers)
        if snap.status_code != 200:
            return []
        data = snap.json()
        return data if isinstance(data, list) else []


async def _load_subject_urls(tenant: str) -> list[str]:
    base = os.environ.get("SUPABASE_URL", "")
    if not base:
        return []
    url = (f"{base}/rest/v1/watchlist_item?tenant_id=eq.{tenant}&active=eq.true"
           f"&kind=eq.handle&select=value")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, headers=_svc_headers())
        if r.status_code != 200:
            return []
        rows = r.json()
        out = []
        for row in rows if isinstance(rows, list) else []:
            v = row.get("value")
            if isinstance(v, str) and v.lower().startswith("http"):
                out.append(v)
        return list(dict.fromkeys(out))
    except Exception:
        return []


async def _push_delta(tenant: str, subject: str, platform: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    engine = os.environ.get("INTEL_ENGINE_BASE", "https://intel.kammandor.com").rstrip("/")
    secret = await get_secret("AUTOMATE_SECRET")
    if not secret:
        return {"skipped": "AUTOMATE_SECRET not configured"}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{engine}/api/signals/harvest-delta",
                headers={"x-automate-secret": secret, "Content-Type": "application/json"},
                json={"tenant": tenant, "subject": subject, "platform": platform, "items": items},
            )
        return r.json() if r.status_code == 200 else {"error": f"delta HTTP {r.status_code}"}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


async def harvest_tenant(tenant: str) -> dict[str, Any]:
    """Run the live-heartbeat harvest for one tenant. Never raises."""
    notes: list[str] = []
    token = await get_secret("BRIGHTDATA_API_KEY")
    if not token:
        return {"tenant": tenant, "harvested": 0, "note": "BRIGHTDATA_API_KEY not configured"}
    urls = await _load_subject_urls(tenant)
    if not urls:
        return {"tenant": tenant, "harvested": 0, "note": "no handle URLs in watchlist"}

    results = []
    for u in urls[:25]:
        resolved = _resolve_dataset(u)
        if not resolved:
            notes.append(f"{u}: no dataset_id configured for platform")
            continue
        dataset_id, platform = resolved
        try:
            recs = await _bd_collect(dataset_id, u, token)
        except Exception as exc:  # noqa: BLE001
            notes.append(f"{u}: collect failed ({exc})")
            continue
        items = [_map_item(r, platform) for r in recs if isinstance(r, dict)]
        if not items:
            continue
        res = await _push_delta(tenant, u, platform, items)
        results.append({"subject": u, "platform": platform, "collected": len(items), "delta": res})

    return {"tenant": tenant, "subjects": len(results), "results": results, "notes": notes}
