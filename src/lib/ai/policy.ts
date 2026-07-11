/**
 * KINTEL — MoE Task/Tier Policy + Model Matrix
 *
 * Each task maps to a tier; each tier is an ORDERED LIST of {provider, model}
 * steps. The router tries each step in order (with retry+backoff per step),
 * falling through to the next on failure. Open-weight-first, cross-provider
 * redundancy, a fallback at every step, and every chain ends on an open-weight
 * model so an answer always returns at the cost floor.
 *
 *   fast     → extract / classify / summarize / route   (cheapest, highest volume)
 *   balanced → analyze / correlate                       (mid reasoning)
 *   critical → synthesize / dossier                      (highest stakes)
 *   vision   → image / document understanding            (multimodal; NO Gemini)
 *
 * NOTE: this file is the INTERACTIVE (Next.js/Vercel) matrix — `critical` leads
 * with Opus 4.8. The async Python workers (workers/app/moe.py) use the same
 * matrix except `critical` leads with Grok 4.5 (cheaper for non-latency-critical
 * dossier synthesis), Opus as fallback. Keep the two in sync when editing.
 */

export type TaskTier = 'fast' | 'balanced' | 'critical' | 'vision';

export interface ModelStep {
  /** provider adapter key in the router registry */
  provider: string;
  /** exact model slug for that provider (OpenRouter uses vendor/model) */
  model: string;
}

// ---------------------------------------------------------------------------
// Model catalogue (single place to bump a version)
// ---------------------------------------------------------------------------

const M = {
  // open-weight via OpenRouter
  gemma4:     { provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it' },
  minimaxM3:  { provider: 'openrouter', model: 'minimax/minimax-m3' },
  glm52:      { provider: 'openrouter', model: 'z-ai/glm-5.2' },
  // direct vendors
  gptNano:    { provider: 'openai',     model: 'gpt-5.4-nano' },
  gptMini:    { provider: 'openai',     model: 'gpt-5.4-mini' },
  grok45:     { provider: 'xai',        model: 'grok-4.5' },
  opus48:     { provider: 'anthropic',  model: 'claude-opus-4-8' },
} as const;

// ---------------------------------------------------------------------------
// Task → Tier
// ---------------------------------------------------------------------------

const TASK_TIER_MAP: Record<string, TaskTier> = {
  extract:    'fast',
  classify:   'fast',
  summarize:  'fast',
  route:      'fast',
  analyze:    'balanced',
  correlate:  'balanced',
  synthesize: 'critical',
  dossier:    'critical',
  critical:   'critical',
  vision:     'vision',
  image:      'vision',
  ocr:        'vision',
  screenshot: 'vision',
  chart:      'vision',
};

/** Return the tier for a task name. Unknown tasks default to 'balanced'. */
export function tierForTask(task: string): TaskTier {
  return TASK_TIER_MAP[task.toLowerCase()] ?? 'balanced';
}

// ---------------------------------------------------------------------------
// Tier → ordered {provider, model} steps  (INTERACTIVE matrix)
// ---------------------------------------------------------------------------

const TIER_MATRIX: Record<TaskTier, ModelStep[]> = {
  fast:     [M.gemma4,  M.gptNano,  M.minimaxM3],
  balanced: [M.glm52,   M.minimaxM3, M.grok45],
  critical: [M.opus48,  M.grok45,   M.glm52],     // interactive: Opus lead
  vision:   [M.minimaxM3, M.gemma4, M.gptMini],   // no Gemini
};

/** Universal last-resort if a whole tier chain fails (open-weight, high uptime). */
export const UNIVERSAL_FALLBACK: ModelStep = { provider: 'openrouter', model: 'z-ai/glm-5.2' };

/** Per-tier wall-clock budget (ms) for a single step attempt. */
export const TIER_TIMEOUT_MS: Record<TaskTier, number> = {
  fast:     20_000,
  balanced: 45_000,
  critical: 90_000,
  vision:   45_000,
};

/** The ordered model steps for a tier. */
export function matrixForTier(tier: TaskTier): ModelStep[] {
  return TIER_MATRIX[tier];
}

/**
 * Back-compat: ordered UNIQUE provider names for a tier (derived from the
 * matrix). Kept so existing callers/tests that reason about providers still work.
 */
export function providersForTier(tier: TaskTier): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const step of TIER_MATRIX[tier]) {
    if (!seen.has(step.provider)) { seen.add(step.provider); out.push(step.provider); }
  }
  return out;
}
