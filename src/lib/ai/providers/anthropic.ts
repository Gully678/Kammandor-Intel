/**
 * KINTEL Phase 3 — Anthropic provider adapter
 *
 * REST: POST https://api.anthropic.com/v1/messages
 * Auth: x-api-key header
 * Secret key: ANTHROPIC_API_KEY (env or Supabase Vault)
 * Model:  env AI_MODEL_CRITICAL  (e.g. claude-opus-4-5 or claude-opus-4-0)
 *
 * If the key is absent this adapter throws — the router catches it and
 * falls to the next provider (graceful degradation, no build break).
 */

import { getSecretOrThrow } from '@/lib/secrets';
import type { ChatOptions, ChatResult, ChatProvider } from './types';

interface AnthropicMessage {
  role:    'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  model:       string;
  max_tokens:  number;
  messages:    AnthropicMessage[];
  system?:     string;
  temperature?: number;
}

interface AnthropicContent {
  type: string;
  text: string;
}

interface AnthropicResponse {
  id:      string;
  model:   string;
  content: AnthropicContent[];
  error?:  { type: string; message: string };
}

export class AnthropicProvider implements ChatProvider {
  readonly name = 'anthropic';

  async complete(opts: ChatOptions): Promise<ChatResult> {
    const apiKey = await getSecretOrThrow('ANTHROPIC_API_KEY');
    const model  = process.env.AI_MODEL_CRITICAL ?? 'claude-opus-4-5';

    const body: AnthropicRequest = {
      model,
      max_tokens:  opts.maxTokens  ?? 2048,
      messages:    [{ role: 'user', content: opts.prompt }],
      ...(opts.system      ? { system:      opts.system      } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Anthropic ${res.status}: ${err}`);
    }

    const data = (await res.json()) as AnthropicResponse;

    if (data.error) {
      throw new Error(`Anthropic API error: ${data.error.message}`);
    }

    const textBlock = data.content.find(c => c.type === 'text');
    if (!textBlock) {
      throw new Error('Anthropic returned no text content');
    }

    return { text: textBlock.text, model: data.model, provider: this.name };
  }
}
