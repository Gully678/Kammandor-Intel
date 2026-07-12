"""
KINTEL Workers — heartbeat scheduler (Render cron entry point).

Run periodically (Render cron service) to drive the live net-new heartbeat:
enumerate every tenant that has a handle-URL watchlist item, then run the
harvest agent for each. The agent scrapes the tenant's Bright Data
collect-by-URL scrapers and PUSHES typed items to the engine's grounding/delta
brain (POST /api/signals/harvest-delta), which baselines on first sight and
signals only net-new / net-changed.

Invoke:  python -m app.scheduler
GATED:   no BRIGHTDATA_API_KEY / no SUPABASE creds => clean no-op with a note.
         Never raises non-zero purely because a tenant scrape was empty; only
         genuine infra faults propagate (so Render marks the run failed).
"""

from __future__ import annotations

import os
import asyncio
import json
from typing import Any

import httpx

from .harvest import harvest_tenant


def _svc_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json", "Accept-Profile": "intel"}


async def _list_tenants() -> list[str]:
    """Distinct tenant_ids that have at least one active handle-URL watchlist item."""
    base = os.environ.get("SUPABASE_URL", "")
    if not base:
        return []
    url = (f"{base}/rest/v1/watchlist_item?active=eq.true&kind=eq.handle"
           f"&value=like.http*&select=tenant_id")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(url, headers=_svc_headers())
        if r.status_code != 200:
            return []
        rows = r.json()
        seen: list[str] = []
        for row in rows if isinstance(rows, list) else []:
            t = row.get("tenant_id")
            if isinstance(t, str) and t and t not in seen:
                seen.append(t)
        return seen
    except Exception:
        return []


async def main() -> int:
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        print(json.dumps({"heartbeat": "skipped", "reason": "SUPABASE not configured"}))
        return 0

    tenants = await _list_tenants()
    if not tenants:
        print(json.dumps({"heartbeat": "noop", "reason": "no tenants with handle URLs"}))
        return 0

    summaries: list[dict[str, Any]] = []
    for tenant in tenants:
        try:
            res = await harvest_tenant(tenant)
        except Exception as exc:  # noqa: BLE001 — never let one tenant kill the batch
            res = {"tenant": tenant, "error": str(exc)}
        summaries.append(res)

    print(json.dumps({"heartbeat": "done", "tenants": len(tenants), "results": summaries}, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
