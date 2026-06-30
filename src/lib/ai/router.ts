/**
 * KINTEL Phase 3 — MoE Router
 *
 * routeComplete() resolves the task tier, iterates the provider preference
 * order, picks the first provider whose API key resolves (i.e. getSecret
 * succeeds), calls it, and returns on success.
 *
 * If ALL providers fail (keys absent or API errors) it throws a clear
 * aggregate error — never crashes the build; callers catch and return 422.
 */

import { getSecret } from '@/lib/secrets';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider }    from './providers/openai';
import { GoogleProvider }    from './providers/google';
import { ZhipuProvider }     from './providers/zhipu';
import { tierForTask, providersForTier, type TaskTier } from './policy';
import type { ChatProvider, ChatOptions } from './providers/types';

// ---------------------------------------------------------------------------
// Provider registry — instantiated once per process
// ---------------------------------------------------------------------------

const PROVIDER_REGISTRY: Record<string, ChatProvider> = {
  anthropic: new AnthropicProvider(),
  openai:    new OpenAIProvider(),
  google:    new GoogleProvider(),
  zhipu:     new ZhipuProvider(),
};

// Env var names that hold each provider's key (for key-presence probe)
const PROVIDER_KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai:    'OPENAI_API_KEY',
  google:    'GOOGLE_API_KEY',
  zhipu:     'ZHIPU_API_KEY',
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RouteOptions extends ChatOptions {
  task: string;
}

export interface RouteResult {
  text:     string;
  provider: string;
  model:    string;
  tier:     TaskTier;
}

// ---------------------------------------------------------------------------
// routeComplete — the MoE dispatch function
// ---------------------------------------------------------------------------

/**
 * Route a completion request through the MoE layer.
 *
 * Steps:
 *   1. Resolve task → tier (tierForTask)
 *   2. Get ordered provider list for tier (providersForTier)
 *   3. For each provider: probe key presence (getSecret, not getSecretOrThrow),
 *      skip if absent, attempt completion, return on success.
 *   4. If all fail, throw aggregate error listing providers + reasons.
 */
export async function routeComplete(opts: RouteOptions): Promise<RouteResult> {
  const { task, ...chatOpts } = opts;
  const tier      = tierForTask(task);
  const providers = providersForTier(tier);

  const errors: string[] = [];

  for (const providerName of providers) {
    // Probe key existence without throwing — skip unconfigured providers
    const keyEnvName = PROVIDER_KEY_ENV[providerName];
    const key = keyEnvName ? await getSecret(keyEnvName).catch(() => undefined) : undefined;
    if (!key) {
      errors.push(`${providerName}: key not configured (${keyEnvName ?? 'unknown'})`);
      continue;
    }

    const provider = PROVIDER_REGISTRY[providerName];
    if (!provider) {
      errors.push(`${providerName}: not found in registry`);
      continue;
    }

    try {
      const result = await provider.complete(chatOpts);
      return { ...result, tier };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${providerName}: ${msg}`);
    }
  }

  // All providers exhausted
  throw new Error(
    `[MoE] All providers failed for tier "${tier}" (task: "${task}"):\n` +
    errors.map(e => `  • ${e}`).join('\n')
  );
}
