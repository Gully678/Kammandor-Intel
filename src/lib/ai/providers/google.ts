/**
 * KINTEL Phase 3 — Google (Gemini/Gemma) provider adapter
 *
 * REST: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * Auth: API key as ?key= query param
 * Secret key: GOOGLE_API_KEY (env or Supabase Vault)
 * Model:  env AI_MODEL_GEMMA  (e.g. gemma-3-27b-it or gemini-2.0-flash)
 *
 * This is the ONLY place @google/generative-ai REST endpoint is called in app code.
 * We use the raw REST API (no SDK import) so there is no GoogleGenerativeAI constructor
 * outside this file. Throws if key absent → router falls back gracefully.
 */

import { getSecretOrThrow } from '@/lib/secrets';
import type { ChatOptions, ChatResult, ChatProvider } from './types';

interface GeminiPart {
  text: string;
}

interface GeminiContent {
  role:  'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiRequest {
  contents:         GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?:     number;
  };
}

interface GeminiCandidate {
  content: { parts: GeminiPart[]; role: string };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?:      { code: number; message: string; status: string };
}

export class GoogleProvider implements ChatProvider {
  readonly name = 'google';

  async complete(opts: ChatOptions): Promise<ChatResult> {
    const apiKey = await getSecretOrThrow('GOOGLE_API_KEY');
    const model  = process.env.AI_MODEL_GEMMA ?? 'gemini-2.0-flash';

    const body: GeminiRequest = {
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
      ...(opts.system ? {
        systemInstruction: { parts: [{ text: opts.system }] },
      } : {}),
      generationConfig: {
        ...(opts.maxTokens  !== undefined ? { maxOutputTokens: opts.maxTokens  } : {}),
        ...(opts.temperature !== undefined ? { temperature:     opts.temperature } : {}),
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Google ${res.status}: ${err}`);
    }

    const data = (await res.json()) as GeminiResponse;

    if (data.error) {
      throw new Error(`Google API error: ${data.error.message}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Google returned no text content');
    }

    return { text, model, provider: this.name };
  }
}
