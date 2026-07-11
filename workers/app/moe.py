"""
KINTEL Workers — MoE Task Router (model-matrix + retry/backoff/timeout)
Mirrors src/lib/ai/policy.ts + src/lib/ai/router.ts.

Each task maps to a tier; each tier is an ORDERED LIST of (provider, model)
steps. The router walks them, retrying transient failures with backoff, and
falls through on hard failure. Every chain ends on an open-weight model.

ASYNC WORKER matrix — `critical` leads with Grok 4.5 (cheaper for non-latency-
critical dossier synthesis), Opus 4.8 as fallback. (The interactive Next.js
matrix leads `critical` with Opus; keep the two intentionally different.)

route_complete() calls the provider REST API via httpx.
Raises RuntimeError (503-worthy) if every step fails. NEVER logs secret values.
"""

from __future__ import annotations

import asyncio
from typing import Literal, Optional

import httpx

from .config import get_secret

TaskTier = Literal["fast", "balanced", "critical", "vision"]

# ---------------------------------------------------------------------------
# Task → Tier
# ---------------------------------------------------------------------------

_TASK_TIER_MAP: dict[str, TaskTier] = {
    "extract":    "fast",
    "classify":   "fast",
    "summarize":  "fast",
    "route":      "fast",
    "analyze":    "balanced",
    "correlate":  "balanced",
    "synthesize": "critical",
    "dossier":    "critical",
    "critical":   "critical",
    "vision":     "vision",
    "image":      "vision",
    "ocr":        "vision",
    "screenshot": "vision",
    "chart":      "vision",
}


def tier_for_task(task: str) -> TaskTier:
    return _TASK_TIER_MAP.get(task.lower(), "balanced")


# ---------------------------------------------------------------------------
# Model matrix — tier -> ordered [(provider, model)]
# ---------------------------------------------------------------------------

_GEMMA4    = ("openrouter", "google/gemma-4-26b-a4b-it")
_MINIMAX   = ("openrouter", "minimax/minimax-m3")
_GLM52     = ("openrouter", "z-ai/glm-5.2")
_GPT_NANO  = ("openai",     "gpt-5.4-nano")
_GPT_MINI  = ("openai",     "gpt-5.4-mini")
_GROK45    = ("xai",        "grok-4.5")
_OPUS48    = ("anthropic",  "claude-opus-4-8")

_TIER_MATRIX: dict[TaskTier, list[tuple[str, str]]] = {
    "fast":     [_GEMMA4, _GPT_NANO, _MINIMAX],
    "balanced": [_GLM52, _MINIMAX, _GROK45],
    "critical": [_GROK45, _OPUS48, _GLM52],   # ASYNC: Grok lead, Opus fallback
    "vision":   [_MINIMAX, _GEMMA4, _GPT_MINI],
}

_UNIVERSAL_FALLBACK = ("openrouter", "z-ai/glm-5.2")

_TIER_TIMEOUT_S: dict[TaskTier, float] = {
    "fast": 20.0, "balanced": 45.0, "critical": 90.0, "vision": 45.0,
}

_MAX_RETRIES = 2
_BACKOFF_BASE_S = 0.5


def matrix_for_tier(tier: TaskTier) -> list[tuple[str, str]]:
    return _TIER_MATRIX[tier]


def providers_for_tier(tier: TaskTier) -> list[str]:
    """Back-compat: ordered unique provider names derived from the matrix."""
    seen: set[str] = set()
    out: list[str] = []
    for provider, _model in _TIER_MATRIX[tier]:
        if provider not in seen:
            seen.add(provider)
            out.append(provider)
    return out


_PROVIDER_KEY_ENV: dict[str, str] = {
    "anthropic":   "ANTHROPIC_API_KEY",
    "openai":      "OPENAI_API_KEY",
    "openrouter":  "OPENROUTER_API_KEY",
    "xai":         "XAI_API_KEY",
}


# ---------------------------------------------------------------------------
# Per-provider REST calls (each takes an explicit model + timeout)
# ---------------------------------------------------------------------------


async def _call_anthropic(system: str, prompt: str, model: str, timeout_s: float) -> str:
    from .config import get_secret_or_raise
    key = await get_secret_or_raise("ANTHROPIC_API_KEY")
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": model, "max_tokens": 4096, "system": system, "messages": [{"role": "user", "content": prompt}]},
        )
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]


async def _call_openai(system: str, prompt: str, model: str, timeout_s: float) -> str:
    from .config import get_secret_or_raise
    key = await get_secret_or_raise("OPENAI_API_KEY")
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]},
        )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


async def _call_openrouter(system: str, prompt: str, model: str, timeout_s: float) -> str:
    from .config import get_secret_or_raise
    key = await get_secret_or_raise("OPENROUTER_API_KEY")
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]},
        )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


async def _call_xai(system: str, prompt: str, model: str, timeout_s: float) -> str:
    from .config import get_secret_or_raise
    key = await get_secret_or_raise("XAI_API_KEY")
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(
            "https://api.x.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]},
        )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


_PROVIDER_CALLERS = {
    "anthropic":  _call_anthropic,
    "openai":     _call_openai,
    "openrouter": _call_openrouter,
    "xai":        _call_xai,
}


def _is_transient(exc: Exception) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (429, 500, 502, 503, 504)
    if isinstance(exc, (httpx.TimeoutException, httpx.TransportError, asyncio.TimeoutError)):
        return True
    return False


async def _attempt_step(provider: str, model: str, system: str, prompt: str, timeout_s: float) -> str:
    caller = _PROVIDER_CALLERS.get(provider)
    if not caller:
        raise RuntimeError(f"{provider}: no caller registered")
    last: Optional[Exception] = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            return await caller(system, prompt, model, timeout_s)
        except Exception as exc:  # noqa: BLE001 — classify then re-raise
            last = exc
            if attempt < _MAX_RETRIES and _is_transient(exc):
                await asyncio.sleep(_BACKOFF_BASE_S * (2 ** attempt))
                continue
            raise
    assert last is not None
    raise last


# ---------------------------------------------------------------------------
# Public routing function
# ---------------------------------------------------------------------------


async def route_complete(task: str, system: str, prompt: str) -> dict:
    tier      = tier_for_task(task)
    steps     = matrix_for_tier(tier)
    timeout_s = _TIER_TIMEOUT_S[tier]
    errors: list[str] = []

    async def _key(provider: str) -> Optional[str]:
        env = _PROVIDER_KEY_ENV.get(provider)
        return await get_secret(env) if env else None

    for provider, model in steps:
        if not await _key(provider):
            errors.append(f"{provider}:{model} — key not configured ({_PROVIDER_KEY_ENV.get(provider)})")
            continue
        try:
            text = await _attempt_step(provider, model, system, prompt, timeout_s)
            return {"text": text, "provider": provider, "tier": tier, "model": model}
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{provider}:{model} — {exc}")

    # Universal open-weight last resort (if not already tried)
    if _UNIVERSAL_FALLBACK not in steps:
        up, um = _UNIVERSAL_FALLBACK
        if await _key(up):
            try:
                text = await _attempt_step(up, um, system, prompt, timeout_s)
                return {"text": text, "provider": up, "tier": tier, "model": um}
            except Exception as exc:  # noqa: BLE001
                errors.append(f"universal-fallback {up}:{um} — {exc}")

    raise RuntimeError(
        f"[MoE] All steps failed for tier '{tier}' (task: '{task}'):\n"
        + "\n".join(f"  • {e}" for e in errors)
    )
