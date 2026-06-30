/**
 * KINTEL Phase 3 — OpenAI provider adapter
 *
 * REST: POST https://api.openai.com/v1/chat/completions
 * Auth: Bearer OPENAI_API_KEY
 * Secret key: OPENAI_API_KEY (env or Supabase Vault)
 * Model:  env AI_MODEL_FAST  (e.g. gpt-4o-mini or o4-mini)
 *
 * Throws if key absent → router falls back gracefully.
 */

import { getSecretOrThrow } from '@/lib/secrets';
import type { ChatOptions, ChatResult, ChatProvider } from './types';

interface OAIMessage {
  role:    'system' | 'user' | 'assistant';
  content: string;
}

interface OAIRequest {
  model:        string;
  messages:     OAIMessage[];
  max_tokens?:  number;
  temperature?: number;
}

interface OAIChoice {
  message: { role: string; content: string };
}

interface OAIResponse {
  model:   string;
  choices: OAIChoice[];
  error?:  { message: string; type: string };
}

export class OpenAIProvider implements ChatProvider {
  readonly name = 'openai';

  async complete(opts: ChatOptions): Promise<ChatResult> {
    const apiKey = await getSecretOrThrow('OPENAI_API_KEY');
    const model  = process.env.AI_MODEL_FAST ?? 'gpt-4o-mini';

    const messages: OAIMessage[] = [];
    if (opts.system) {
      messages.push({ role: 'system', content: opts.system });
    }
    messages.push({ role: 'user', content: opts.prompt });

    const body: OAIRequest = {
      model,
      messages,
      ...(opts.maxTokens  !== undefined ? { max_tokens:  opts.maxTokens  } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    };

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI ${res.status}: ${err}`);
    }

    const data = (await res.json()) as OAIResponse;

    if (data.error) {
      throw new Error(`OpenAI API error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned no content');
    }

    return { text: content, model: data.model, provider: this.name };
  }
}
