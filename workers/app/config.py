"""
KINTEL Workers — Config & Secrets Resolver
Mirrors src/lib/secrets.ts

Resolution order:
  1. os.environ[name]               — set on Render / Docker / CI
  2. Supabase Vault RPC             — POST /rest/v1/rpc/intel_get_secret
  3. None                           — silent; callers decide whether to raise

NEVER log secret values.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Optional

import httpx

# ---------------------------------------------------------------------------
# In-process secret cache (avoids re-hitting Vault per request)
# ---------------------------------------------------------------------------

_cache: dict[str, Optional[str]] = {}


async def _fetch_from_vault(name: str) -> Optional[str]:
    """
    Hit the Supabase Vault RPC intel_get_secret.
    Returns the secret string or None on miss / any error.
    """
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not service_key:
        return None

    headers = {
        "apikey":        service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type":  "application/json",
    }
    payload = {"p_name": name}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"{supabase_url}/rest/v1/rpc/intel_get_secret",
                headers=headers,
                json=payload,
            )

        if resp.status_code != 200:
            return None

        text = resp.text.strip()
        if not text or text == "null":
            return None

        # PostgREST returns a JSON-encoded string literal
        if text.startswith('"') and text.endswith('"'):
            import json
            return json.loads(text)
        return text

    except Exception:
        # Network error, DNS failure, RPC not present — never propagate
        return None


async def get_secret(name: str) -> Optional[str]:
    """
    Resolve a secret by name.
    Returns the value string, or None if not found.
    """
    if name in _cache:
        return _cache[name]

    # Primary: environment variable
    env_val = os.environ.get(name)
    if env_val:
        _cache[name] = env_val
        return env_val

    # Secondary: Supabase Vault
    vault_val = await _fetch_from_vault(name)
    _cache[name] = vault_val
    return vault_val


async def get_secret_or_raise(name: str) -> str:
    """
    Resolve a secret or raise ValueError with a clear message.
    Use in code paths that cannot operate without the key.
    """
    value = await get_secret(name)
    if not value:
        raise ValueError(f"{name} not configured (set env var or Supabase Vault)")
    return value


# ---------------------------------------------------------------------------
# Model IDs — env-driven so Render dashboard controls upgrades
# ---------------------------------------------------------------------------

@lru_cache(maxsize=None)
def model_id(provider: str) -> str:
    """
    Return the model ID for a provider from env.
    Env var: AI_MODEL_ANTHROPIC, AI_MODEL_OPENAI, AI_MODEL_GOOGLE, AI_MODEL_ZHIPU
    Falls back to sensible defaults.
    """
    defaults = {
        "anthropic": "claude-opus-4-5",
        "openai":    "gpt-4o-mini",
        "google":    "gemini-1.5-flash",
        "zhipu":     "glm-4-flash",
    }
    env_key = f"AI_MODEL_{provider.upper()}"
    return os.environ.get(env_key, defaults.get(provider, "unknown"))
