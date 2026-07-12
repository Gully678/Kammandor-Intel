"""
KINTEL Workers — heartbeat scheduler (Render cron entry point).

Run periodically (Render cron service) to drive the live net-new heartbeat for
EVERY tenant that has an active watchlist item. Per tenant it runs two gated,
no-op-safe harvests:

  1. Bright Data social  — harvest_tenant(): scrapes each handle-URL subject's
     collect-by-URL scraper and pushes typed items to /api/signals/harvest-delta.
  2. DataForSEO SERP      — POST {INTEL_ENGINE_BASE}/api/automate/serp: the engine
     pulls Google News + Organic for the tenant's keyword/company/product subjects
     and pushes them through the SAME grounding/delta brain.

Both baseline on first sight (0 signals) and later signal only net-new /
net-changed. Both are clean no-ops when their keys / subjects are absent.

  3. Governed ACTION executor — POST {INTEL_ENGINE_BASE}/api/ontology/actions/execute:
     asks the engine to dequeue and execute governed 'notify' actions sitting
     in intel.action (status 'queued'/'approved' — Mission C, the kinetic
     ACTION layer, v1 executor; migrations/intel/0032_action_registry.sql,
     src/app/api/ontology/actions/execute/route.ts). Runs ONCE per scheduler
     tick (not per-tenant — the executor scopes its own tenant filter
     internally), after the per-tenant harvest loop below.

Invoke:  python -m app.scheduler
GATED:   no SUPABASE creds => clean no-op. One tenant's failure never kills the
         batch. Only genuine infra faults would surface in logs. The action
         executor call is likewise best-effort: failures are logged into the
         run summary, never fatal to the heartbeat.
"""

from __future__ import annotations

import os
import asyncio
import json
from typing import Any

import httpx

from .harvest import harvest_tenant
from .config import get_secret


def _svc_headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json", "Accept-Profile": "intel"}


async def _list_tenants() -> list[str]:
    """Distinct tenant_ids that have at least one active watchlist item (any kind)."""
    base = os.environ.get("SUPABASE_URL", "")
    if not base:
        return []
    url = f"{base}/rest/v1/watchlist_item?active=eq.true&select=tenant_id"
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


async def _push_serp(tenant: str) -> dict[str, Any]:
    """Ask the engine to run the DataForSEO SERP harvest for this tenant."""
    engine = os.environ.get("INTEL_ENGINE_BASE", "https://intel.kammandor.com").rstrip("/")
    secret = await get_secret("AUTOMATE_SECRET")
    if not secret:
        return {"skipped": "AUTOMATE_SECRET not configured"}
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            r = await client.post(
                f"{engine}/api/automate/serp",
                headers={"x-automate-secret": secret, "Content-Type": "application/json"},
                json={"tenant": tenant},
            )
        return r.json() if r.status_code == 200 else {"error": f"serp HTTP {r.status_code}"}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


async def _push_execute() -> dict[str, Any]:
    """Ask the engine to execute governed 'notify' actions sitting in intel.action
    (Mission C — the kinetic ACTION layer, v1 executor). Runs once per scheduler
    tick, not per-tenant. Same auth/env conventions as _push_serp()."""
    engine = os.environ.get("INTEL_ENGINE_BASE", "https://intel.kammandor.com").rstrip("/")
    secret = await get_secret("AUTOMATE_SECRET")
    if not secret:
        return {"skipped": "AUTOMATE_SECRET not configured"}
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                f"{engine}/api/ontology/actions/execute",
                headers={"x-automate-secret": secret, "Content-Type": "application/json"},
                json={"limit": 25},
            )
        return r.json() if r.status_code == 200 else {"error": f"execute HTTP {r.status_code}"}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


async def main() -> int:
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        print(json.dumps({"heartbeat": "skipped", "reason": "SUPABASE not configured"}))
        return 0

    tenants = await _list_tenants()
    if not tenants:
        print(json.dumps({"heartbeat": "noop", "reason": "no tenants with watchlist items"}))
        return 0

    summaries: list[dict[str, Any]] = []
    for tenant in tenants:
        entry: dict[str, Any] = {"tenant": tenant}
        try:
            entry["social"] = await harvest_tenant(tenant)
        except Exception as exc:  # noqa: BLE001
            entry["social"] = {"error": str(exc)}
        try:
            entry["serp"] = await _push_serp(tenant)
        except Exception as exc:  # noqa: BLE001
            entry["serp"] = {"error": str(exc)}
        summaries.append(entry)

    try:
        execute_result = await _push_execute()
    except Exception as exc:  # noqa: BLE001
        execute_result = {"error": str(exc)}

    print(json.dumps(
        {"heartbeat": "done", "tenants": len(tenants), "results": summaries, "execute": execute_result},
        default=str,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
