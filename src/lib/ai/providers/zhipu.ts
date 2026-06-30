/**
 * KINTEL Phase 3 — Zhipu AI (GLM) provider adapter
 *
 * REST: POST https://open.bigmodel.cn/api/paas/v4/chat/completions
 * Auth: Bearer ZHIPU_API_KEY
 * Secret key: ZHIPU_API_KEY (env or Supabase Vault)
 * Model:  env AI_MODEL_BALANCED  (e.g. glm-4-flash or glm-4-plus)
 *
 * Zhipu's API is OpenAI-compatible (same request/response shape).
 * Throws if key absent → router falls back gracefully.
 */

import { getSecretOrThrow } from '@/lib/secrets';
import type { ChatOptions, ChatResult, ChatProvider } from './types';

interface ZhipuMessage {
  role:    'system' | 'user' | 'assistant';
  content: string;
}

interface ZhipuRequest {
  model:        string;
  messages:     ZhipuMessage[];
  max_tokens?:  number;
  temperature?: number;
}

interface ZhipuChoice {
  message: { role: string; content: string };
}

interface ZhipuResponse {
  model?:  string;
  choices: ZhipuChoice[];
  error?:  { message: string; code: string };
}

export class ZhipuProvider implements ChatProvider {
  readonly name = 'zhipu';

  async complete(opts: ChatOptions): Promise<ChatResult> {
    const apiKey = await getSecretOrThrow('ZHIPU_API_KEY');
    const model  = process.env.AI_MODEL_BALANCED ?? 'glm-4-flash';

    const messages: ZhipuMessage[] = [];
    if (opts.system) {
      messages.push({ role: 'system', content: opts.system });
    }
    messages.push({ role: 'user', content: opts.prompt });

    const body: ZhipuRequest = {
      model,
      messages,
      ...(opts.maxTokens  !== undefined ? { max_tokens:  opts.maxTokens  } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    };

    const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Zhipu ${res.status}: ${err}`);
    }

    const data = (await res.json()) as ZhipuResponse;

    if (data.error) {
      throw new Error(`Zhipu API error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Zhipu returned no content');
    }

    return { text: content, model: data.model ?? model, provider: this.name };
  }
}
