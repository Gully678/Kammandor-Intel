/**
 * KINTEL Phase 3 — OpenRouter provider adapter (universal fallback)
 *
 * REST: POST https://openrouter.ai/api/v1/chat/completions  (OpenAI-compatible)
 * Auth: Bearer OPENROUTER_API_KEY
 * Secret key: OPENROUTER_API_KEY (env or Supabase Vault)
 * Model:  env AI_MODEL_OPENROUTER  (default: openai/gpt-4o-mini)
 *
 * OpenRouter acts as universal fallback when preferred provider keys are
 * absent but OPENROUTER_API_KEY is set.  Supports any model slug that
 * OpenRouter hosts (e.g. "anthropic/claude-opus-4-5", "google/gemini-flash-1.5").
 *
 * Throws if key absent → router falls back gracefully.
 */

import { getSecretOrThrow } from '@/lib/secrets';
import type { ChatOptions, ChatResult, ChatProvider } from './types';

interface ORMessage {
  role:    'system' | 'user' | 'assistant';
  content: string;
}

interface ORRequest {
  model:        string;
  messages:     ORMessage[];
  max_tokens?:  number;
  temperature?: number;
}

interface ORChoice {
  message: { role: string; content: string };
}

interface ORResponse {
  model:   string;
  choices: ORChoice[];
  error?:  { message: string; code?: number };
}

export class OpenRouterProvider implements ChatProvider {
  readonly name = 'openrouter';

  async complete(opts: ChatOptions): Promise<ChatResult> {
    const apiKey = await getSecretOrThrow('OPENROUTER_API_KEY');
    const model  = process.env.AI_MODEL_OPENROUTER ?? 'openai/gpt-4o-mini';

    const messages: ORMessage[] = [];
    if (opts.system) {
      messages.push({ role: 'system', content: opts.system });
    }
    messages.push({ role: 'user', content: opts.prompt });

    const body: ORRequest = {
      model,
      messages,
      ...(opts.maxTokens   !== undefined ? { max_tokens:  opts.maxTokens  } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    };

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`OpenRouter ${res.status}: ${err}`);
    }

    const data = (await res.json()) as ORResponse;

    if (data.error) {
      throw new Error(`OpenRouter API error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenRouter returned no content');
    }

    return { text: content, model: data.model ?? model, provider: this.name };
  }
}
