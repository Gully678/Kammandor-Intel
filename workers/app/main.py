"""
KINTEL Workers — FastAPI Application Entry Point

Endpoints:
  GET  /health   — liveness + provider key presence (booleans, never values)
  POST /analyze  — run governed analysis graph; returns narrative + proposed_edit_ids

CORS is restricted to *.kammandor.com (and localhost for dev).

Architecture:
  Next.js (Vercel) enqueues via POST /analyze
    → worker runs LangGraph graph
    → graph writes ProposedEdit rows (status='pending') to Supabase
    → analyst approves in Kammandor UI
    → application layer applies approved edits to intel.entity / intel.link
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import get_secret
from .graph import run_analysis
from .harvest import harvest_tenant
from fastapi import Header

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Kammandor Intel Workers",
    description="LangGraph governed-analysis service for KINTEL.",
    version="0.1.0",
)

# CORS: allow only *.kammandor.com (+ localhost for dev)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*\.kammandor\.com",
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

_PROVIDER_KEYS = {
    "anthropic":  "ANTHROPIC_API_KEY",
    "openai":     "OPENAI_API_KEY",
    "google":     "GOOGLE_API_KEY",
    "zhipu":      "ZHIPU_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "xai":        "XAI_API_KEY",
}


class AnalyzeRequest(BaseModel):
    tenant_id:  str
    objective:  str
    entity_ids: Optional[list[str]] = None


class HealthResponse(BaseModel):
    status:    str
    providers: dict[str, bool]


class AnalyzeResponse(BaseModel):
    narrative:         str
    proposed_edit_ids: list[str]


class HarvestRequest(BaseModel):
    tenant: str

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health", response_model=HealthResponse, tags=["ops"])
async def health() -> HealthResponse:
    """
    Liveness probe.
    Returns OK + which provider keys are present (boolean — never the values).
    """
    provider_presence: dict[str, bool] = {}
    for provider, env_name in _PROVIDER_KEYS.items():
        key = await get_secret(env_name)
        provider_presence[provider] = bool(key)

    return HealthResponse(status="ok", providers=provider_presence)


@app.post("/analyze", response_model=AnalyzeResponse, tags=["intel"])
async def analyze(body: AnalyzeRequest) -> AnalyzeResponse:
    """
    Run the governed analysis graph for a tenant and objective.

    Returns:
      narrative          — LLM-synthesised intelligence summary
      proposed_edit_ids  — IDs of ProposedEdit rows written to Supabase

    Returns 503 if no provider keys are configured.
    """
    # Quick key-presence check before invoking the (expensive) graph
    from .moe import tier_for_task, providers_for_tier
    tier      = tier_for_task("synthesize")
    providers = providers_for_tier(tier)

    has_any_key = False
    for p in providers:
        key = await get_secret(_PROVIDER_KEYS.get(p, ""))
        if key:
            has_any_key = True
            break

    # Also accept openrouter as a valid key for the synthesize tier
    if not has_any_key:
        or_key = await get_secret("OPENROUTER_API_KEY")
        has_any_key = bool(or_key)

    if not has_any_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "No AI provider keys configured. "
                "Set at least one of ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY / XAI_API_KEY (via Supabase Vault)."
            ),
        )

    result = await run_analysis(
        tenant_id=  body.tenant_id,
        objective=  body.objective,
        entity_ids= body.entity_ids,
    )

    if result.get("error") and not result.get("narrative"):
        # Hard error: no narrative produced
        if "All providers failed" in (result["error"] or ""):
            raise HTTPException(status_code=503, detail=result["error"])
        raise HTTPException(status_code=500, detail=result["error"])

    return AnalyzeResponse(
        narrative=         result.get("narrative", ""),
        proposed_edit_ids= result.get("proposed_edit_ids", []),
    )


@app.post("/harvest", tags=["intel"])
async def harvest(
    body: HarvestRequest,
    x_automate_secret: Optional[str] = Header(default=None, alias="x-automate-secret"),
) -> dict:
    """
    Live-heartbeat harvest for one tenant (net-new signals).

    Server-to-server only. Auth: the x-automate-secret header MUST equal the
    AUTOMATE_SECRET env (the same shared secret the /api/signals/harvest-delta
    engine endpoint accepts). This scrapes the tenant's Bright Data
    collect-by-URL scrapers for each watchlist handle URL and PUSHES the typed
    items to the engine's delta brain, which does grounding + net-new/net-changed.

    Returns 401 if the secret is missing or wrong; 503 if AUTOMATE_SECRET is not
    configured on the worker. Never raises on scrape failure (gated no-op + notes).
    """
    configured = await get_secret("AUTOMATE_SECRET")
    if not configured:
        raise HTTPException(status_code=503, detail="AUTOMATE_SECRET not configured on the worker.")
    if not x_automate_secret or x_automate_secret != configured:
        raise HTTPException(status_code=401, detail="Invalid or missing automate secret.")
    if not body.tenant:
        raise HTTPException(status_code=400, detail='"tenant" is required.')

    result = await harvest_tenant(body.tenant)
    return result
