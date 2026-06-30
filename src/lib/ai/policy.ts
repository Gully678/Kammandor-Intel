/**
 * KINTEL Phase 3 — MoE Task/Tier Policy
 *
 * Defines which tier each task belongs to and which provider order to try
 * per tier.  The routing principle: match model capability to task complexity
 * and cost sensitivity.
 *
 *   fast      → cheap, low-latency (extract, classify, summarize)
 *   balanced  → mid-tier, good reasoning/cost ratio (analyze, correlate)
 *   critical  → highest capability, dossier/synthesis (synthesize, dossier, critical)
 */

export type TaskTier = 'fast' | 'balanced' | 'critical';

// ---------------------------------------------------------------------------
// Task → Tier mapping
// ---------------------------------------------------------------------------

const TASK_TIER_MAP: Record<string, TaskTier> = {
  extract:    'fast',
  classify:   'fast',
  summarize:  'fast',
  analyze:    'balanced',
  correlate:  'balanced',
  synthesize: 'critical',
  dossier:    'critical',
  critical:   'critical',
};

/**
 * Return the tier for a given task name.
 * Falls back to 'balanced' for unknown tasks.
 */
export function tierForTask(task: string): TaskTier {
  return TASK_TIER_MAP[task.toLowerCase()] ?? 'balanced';
}

// ---------------------------------------------------------------------------
// Tier → preferred provider order
// ---------------------------------------------------------------------------

/**
 * Provider names in preferred call order per tier.
 * The router tries each in sequence, picking the first with a live key.
 *
 * fast:     openai (gpt-nano-class, cheapest) → google (gemma, free tier fallback)
 * balanced: zhipu  (glm — cost-efficient Chinese LLM) → google (gemma)
 * critical: anthropic (opus-class) → zhipu (cost fallback)
 */
const TIER_PROVIDER_MAP: Record<TaskTier, string[]> = {
  fast:     ['openai', 'google'],
  balanced: ['zhipu', 'google'],
  critical: ['anthropic', 'zhipu'],
};

/**
 * Return the ordered list of provider names for a given tier.
 */
export function providersForTier(tier: TaskTier): string[] {
  return TIER_PROVIDER_MAP[tier];
}
