/**
 * KINTEL — xAI (Grok) provider adapter
 *
 * REST: POST https://api.x.ai/v1/chat/completions  (OpenAI-compatible)
 * Auth: Bearer XAI_API_KEY
 * Secret key: XAI_API_KEY (env or Supabase Vault)
 * Model:  opts.model (matrix passes 'grok-4.5'); default 'grok-4.5'.
 *
 * Throws if key absent → router falls to the next step (Grok is also
 * reachable via OpenRouter as an automatic fallback in the matrix).
 */

import { getSecretOrThrow } from '@/lib/secrets';
import type { ChatOptions, ChatResult, ChatProvider } from './types';

interface XAIMessage {
  role:    'system' | 'user' | 'assistant';
  content: string;
}

interface XAIRequest {
  model:        string;
  messages:     XAIMessage[];
  max_tokens?:  number;
  temperature?: number;
}

interface XAIChoice {
  message: { role: string; content: string };
}

interface XAIResponse {
  model:   string;
  choices: XAIChoice[];
  error?:  { message: string; code?: number };
}

export class XaiProvider implements ChatProvider {
  readonly name = 'xai';

  async complete(opts: ChatOptions): Promise<ChatResult> {
    const apiKey = await getSecretOrThrow('XAI_API_KEY');
    const model  = opts.model ?? 'grok-4.5';

    const messages: XAIMessage[] = [];
    if (opts.system) {
      messages.push({ role: 'system', content: opts.system });
    }
    messages.push({ role: 'user', content: opts.prompt });

    const body: XAIRequest = {
      model,
      messages,
      ...(opts.maxTokens   !== undefined ? { max_tokens:  opts.maxTokens  } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    };

    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`xAI ${res.status}: ${err}`);
    }

    const data = (await res.json()) as XAIResponse;

    if (data.error) {
      throw new Error(`xAI API error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('xAI returned no content');
    }

    return { text: content, model: data.model ?? model, provider: this.name };
  }
}
