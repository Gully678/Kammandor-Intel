"""
KINTEL Workers — MoE Task Router
Mirrors src/lib/ai/policy.ts + src/lib/ai/router.ts

Tier mapping:
  fast:     extract, classify, summarize
  balanced: analyze, correlate
  critical: synthesize, dossier, critical

Provider preference per tier (first key that resolves wins):
  fast:     openai → google → openrouter (fallback)
  balanced: zhipu  → google → openrouter (fallback)
  critical: anthropic → zhipu → openrouter (fallback)

openrouter acts as universal fallback when preferred provider keys are absent
but OPENROUTER_API_KEY is set.

route_complete() calls the provider REST API via httpx.
Raises RuntimeError (503-worthy) if no provider key is available.
NEVER logs secret values.
"""

from __future__ import annotations

from typing import Literal, Optional

import httpx

from .config import get_secret, model_id

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

TaskTier = Literal["fast", "balanced", "critical"]

# ---------------------------------------------------------------------------
# Task → Tier mapping  (mirrors TASK_TIER_MAP in policy.ts)
# ---------------------------------------------------------------------------

_TASK_TIER_MAP: dict[str, TaskTier] = {
    "extract":   "fast",
    "classify":  "fast",
    "summarize": "fast",
    "analyze":   "balanced",
    "correlate": "balanced",
    "synthesize": "critical",
    "dossier":   "critical",
    "critical":  "critical",
}


def tier_for_task(task: str) -> TaskTier:
    """Return the tier for a task name. Falls back to 'balanced' for unknowns."""
    return _TASK_TIER_MAP.get(task.lower(), "balanced")


# ---------------------------------------------------------------------------
# Tier → ordered provider list  (mirrors TIER_PROVIDER_MAP in policy.ts)
# ---------------------------------------------------------------------------

_TIER_PROVIDER_MAP: dict[TaskTier, list[str]] = {
    "fast":     ["openai", "google"],
    "balanced": ["zhipu",  "google"],
    "critical": ["anthropic", "zhipu"],
}


def providers_for_tier(tier: TaskTier) -> list[str]:
    """Return the ordered provider list for a tier."""
    return _TIER_PROVIDER_MAP[tier]


# ---------------------------------------------------------------------------
# Provider key env names
# ---------------------------------------------------------------------------

_PROVIDER_KEY_ENV: dict[str, str] = {
    "anthropic":   "ANTHROPIC_API_KEY",
    "openai":      "OPENAI_API_KEY",
    "google":      "GOOGLE_API_KEY",
    "zhipu":       "ZHIPU_API_KEY",
    "openrouter":  "OPENROUTER_API_KEY",
}

# ---------------------------------------------------------------------------
# Per-provider REST call helpers
# ---------------------------------------------------------------------------


async def _call_anthropic(system: str, prompt: str) -> str:
    from .config import get_secret_or_raise
    key = await get_secret_or_raise("ANTHROPIC_API_KEY")
    mid = model_id("anthropic")
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key":         key,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            json={
                "model":      mid,
                "max_tokens": 4096,
                "system":     system,
                "messages":   [{"role": "user", "content": prompt}],
            },
        )
    resp.raise_for_status()
    data = resp.json()
    return data["content"][0]["text"]


async def _call_openai(system: str, prompt: str) -> str:
    from .config import get_secret_or_raise
    key = await get_secret_or_raise("OPENAI_API_KEY")
    mid = model_id("openai")
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type":  "application/json",
            },
            json={
                "model":    mid,
                "messages": [
                    {"role": "system",  "content": system},
                    {"role": "user",    "content": prompt},
                ],
            },
        )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


async def _call_google(system: str, prompt: str) -> str:
    from .config import get_secret_or_raise
    key = await get_secret_or_raise("GOOGLE_API_KEY")
    mid = model_id("google")
    full_prompt = f"{system}\n\n{prompt}" if system else prompt
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{mid}:generateContent",
            params={"key": key},
            headers={"Content-Type": "application/json"},
            json={"contents": [{"parts": [{"text": full_prompt}]}]},
        )
    resp.raise_for_status()
    data = resp.json()
    return data["candidates"][0]["content"]["parts"][0]["text"]


async def _call_zhipu(system: str, prompt: str) -> str:
    from .config import get_secret_or_raise
    key = await get_secret_or_raise("ZHIPU_API_KEY")
    mid = model_id("zhipu")
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type":  "application/json",
            },
            json={
                "model":    mid,
                "messages": [
                    {"role": "system",  "content": system},
                    {"role": "user",    "content": prompt},
                ],
            },
        )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


async def _call_openrouter(system: str, prompt: str) -> str:
    """
    Universal fallback via OpenRouter.
    POSTs to https://openrouter.ai/api/v1/chat/completions (OpenAI-compatible).
    Uses OPENROUTER_API_KEY and AI_MODEL_OPENROUTER env vars.
    """
    from .config import get_secret_or_raise
    key = await get_secret_or_raise("OPENROUTER_API_KEY")
    mid = model_id("openrouter")
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type":  "application/json",
            },
            json={
                "model":    mid,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user",   "content": prompt},
                ],
            },
        )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


_PROVIDER_CALLERS = {
    "anthropic":  _call_anthropic,
    "openai":     _call_openai,
    "google":     _call_google,
    "zhipu":      _call_zhipu,
    "openrouter": _call_openrouter,
}

# ---------------------------------------------------------------------------
# Public routing function
# ---------------------------------------------------------------------------


async def route_complete(
    task: str,
    system: str,
    prompt: str,
) -> dict:
    """
    Route a completion through the MoE layer.

    Steps:
      1. Resolve task → tier.
      2. Iterate provider preference for tier.
      3. For each provider: probe key (get_secret, not raise); skip if absent.
      4. Attempt the REST call; return on success.
      5. Raise RuntimeError if all providers exhausted (caller returns 503).
    """
    tier      = tier_for_task(task)
    providers = providers_for_tier(tier)
    errors: list[str] = []

    for provider_name in providers:
        key_env = _PROVIDER_KEY_ENV.get(provider_name)
        key     = await get_secret(key_env) if key_env else None
        if not key:
            errors.append(f"{provider_name}: key not configured ({key_env})")
            continue

        caller = _PROVIDER_CALLERS.get(provider_name)
        if not caller:
            errors.append(f"{provider_name}: no caller registered")
            continue

        try:
            text = await caller(system, prompt)
            return {
                "text":     text,
                "provider": provider_name,
                "tier":     tier,
                "model":    model_id(provider_name),
            }
        except Exception as exc:
            errors.append(f"{provider_name}: {exc}")

    # Primary providers exhausted — try OpenRouter as universal fallback
    or_key = await get_secret("OPENROUTER_API_KEY")
    if or_key and "openrouter" not in providers:
        try:
            text = await _call_openrouter(system, prompt)
            return {
                "text":     text,
                "provider": "openrouter",
                "tier":     tier,
                "model":    model_id("openrouter"),
            }
        except Exception as exc:
            errors.append(f"openrouter (fallback): {exc}")

    # All providers exhausted
    raise RuntimeError(
        f"[MoE] All providers failed for tier '{tier}' (task: '{task}'):\n"
        + "\n".join(f"  • {e}" for e in errors)
    )
