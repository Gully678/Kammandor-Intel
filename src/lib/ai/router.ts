/**
 * KINTEL — MoE Router (model-matrix + retry/backoff/timeout)
 *
 * routeComplete() resolves task → tier, then walks the tier's ordered
 * {provider, model} matrix. For each step it:
 *   1. probes the provider key (skips the step if absent),
 *   2. attempts the call with a per-tier timeout,
 *   3. retries transient failures (429/5xx/timeout) up to MAX_RETRIES with
 *      exponential backoff,
 *   4. on any hard failure, falls through to the next step.
 * If every step fails, a universal open-weight fallback (OpenRouter GLM 5.2)
 * is tried once, then a loud aggregate error is thrown (never a fake answer).
 */

import { getSecret } from '@/lib/secrets';
import { AnthropicProvider }  from './providers/anthropic';
import { OpenAIProvider }     from './providers/openai';
import { GoogleProvider }     from './providers/google';
import { ZhipuProvider }      from './providers/zhipu';
import { OpenRouterProvider } from './providers/openrouter';
import { XaiProvider }        from './providers/xai';
import {
  tierForTask, matrixForTier, providersForTier,
  UNIVERSAL_FALLBACK, TIER_TIMEOUT_MS,
  type TaskTier, type ModelStep,
} from './policy';
import type { ChatProvider, ChatOptions } from './providers/types';

// Provider registry — instantiated once per process.
// google/zhipu remain registered (dormant) for back-compat; the matrix no
// longer references them (no Gemini; GLM is served via OpenRouter).
const PROVIDER_REGISTRY: Record<string, ChatProvider> = {
  anthropic:  new AnthropicProvider(),
  openai:     new OpenAIProvider(),
  google:     new GoogleProvider(),
  zhipu:      new ZhipuProvider(),
  openrouter: new OpenRouterProvider(),
  xai:        new XaiProvider(),
};

const PROVIDER_KEY_ENV: Record<string, string> = {
  anthropic:  'ANTHROPIC_API_KEY',
  openai:     'OPENAI_API_KEY',
  google:     'GOOGLE_API_KEY',
  zhipu:      'ZHIPU_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  xai:        'XAI_API_KEY',
};

const MAX_RETRIES = 2;         // per step, on transient failures
const BACKOFF_BASE_MS = 500;   // 0.5s, 1s, ...

export interface RouteOptions extends ChatOptions {
  task: string;
}

export interface RouteResult {
  text:     string;
  provider: string;
  model:    string;
  tier:     TaskTier;
}

// Re-export for callers/tests that import from the router.
export { tierForTask, providersForTier };

function isTransient(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /\b(429|500|502|503|504)\b/.test(msg) || /timeout|timed out|econnreset|etimedout|fetch failed|network/.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Attempt one matrix step with per-tier timeout + transient retry. */
async function attemptStep(
  step: ModelStep,
  chatOpts: ChatOptions,
  timeoutMs: number,
): Promise<{ text: string; model: string; provider: string }> {
  const provider = PROVIDER_REGISTRY[step.provider];
  if (!provider) throw new Error(`${step.provider}: not in registry`);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await withTimeout(
        provider.complete({ ...chatOpts, model: step.model }),
        timeoutMs,
        `${step.provider}:${step.model}`,
      );
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isTransient(err)) {
        await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

export async function routeComplete(opts: RouteOptions): Promise<RouteResult> {
  const { task, ...chatOpts } = opts;
  const tier      = tierForTask(task);
  const steps     = matrixForTier(tier);
  const timeoutMs = TIER_TIMEOUT_MS[tier];
  const errors: string[] = [];

  for (const step of steps) {
    const keyEnv = PROVIDER_KEY_ENV[step.provider];
    const key = keyEnv ? await getSecret(keyEnv).catch(() => undefined) : undefined;
    if (!key) {
      errors.push(`${step.provider}:${step.model} — key not configured (${keyEnv ?? 'unknown'})`);
      continue;
    }
    try {
      const result = await attemptStep(step, chatOpts, timeoutMs);
      return { ...result, tier };
    } catch (err) {
      errors.push(`${step.provider}:${step.model} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Universal last-resort (open-weight, high uptime) if not already tried.
  const alreadyTried = steps.some(
    (s) => s.provider === UNIVERSAL_FALLBACK.provider && s.model === UNIVERSAL_FALLBACK.model,
  );
  if (!alreadyTried) {
    const key = await getSecret(PROVIDER_KEY_ENV[UNIVERSAL_FALLBACK.provider]).catch(() => undefined);
    if (key) {
      try {
        const result = await attemptStep(UNIVERSAL_FALLBACK, chatOpts, timeoutMs);
        return { ...result, tier };
      } catch (err) {
        errors.push(`universal-fallback ${UNIVERSAL_FALLBACK.provider}:${UNIVERSAL_FALLBACK.model} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  throw new Error(
    `[MoE] All steps failed for tier "${tier}" (task: "${task}"):\n` +
    errors.map((e) => `  • ${e}`).join('\n'),
  );
}
