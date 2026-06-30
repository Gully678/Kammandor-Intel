/**
 * KINTEL Phase 3 — Common ChatProvider interface
 *
 * All provider adapters implement this single contract.
 * No SDK deps — pure fetch-based adapters for portability.
 */

export interface ChatOptions {
  system?:      string;
  prompt:       string;
  maxTokens?:   number;
  temperature?: number;
}

export interface ChatResult {
  text:     string;
  model:    string;
  provider: string;
}

export interface ChatProvider {
  readonly name: string;
  complete(opts: ChatOptions): Promise<ChatResult>;
}
