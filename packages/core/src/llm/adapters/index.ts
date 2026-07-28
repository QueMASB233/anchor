/**
 * Provider adapters.
 *
 * Thin `fetch` calls rather than vendor SDKs. Three reasons, in order of
 * importance: install size for a tool people add to every repo; a smaller
 * dependency surface for something whose pitch is that it does not exfiltrate
 * code; and the fact that all four providers need roughly forty lines each.
 */

import { anthropicAdapter } from './anthropic.js';
import { deepseekAdapter } from './deepseek.js';
import { ollamaAdapter } from './ollama.js';
import { openaiAdapter } from './openai.js';
import type { LlmAdapter, LlmProvider } from '../types.js';

export { anthropicAdapter } from './anthropic.js';
export { deepseekAdapter } from './deepseek.js';
export { ollamaAdapter } from './ollama.js';
export { openaiAdapter } from './openai.js';

export const ADAPTERS: readonly LlmAdapter[] = [
  anthropicAdapter,
  openaiAdapter,
  deepseekAdapter,
  ollamaAdapter,
];

export function getAdapter(provider: LlmProvider): LlmAdapter {
  const adapter = ADAPTERS.find((candidate) => candidate.provider === provider);
  if (adapter === undefined) {
    throw new Error(
      `Unknown LLM provider: ${provider}. Available: ${ADAPTERS.map((a) => a.provider).join(', ')}.`,
    );
  }
  return adapter;
}

/**
 * Shared response handling.
 *
 * Error messages deliberately carry the status and the provider's own message
 * but never the request headers, so an API key cannot reach a log through an
 * error path.
 */
export async function readJsonResponse(response: Response, provider: string): Promise<unknown> {
  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.text()).slice(0, 400);
      if (body !== '') detail = ` ${body}`;
    } catch {
      /* An unreadable error body adds nothing. */
    }

    const hint =
      response.status === 401 || response.status === 403
        ? ' Check that the API key is valid and has credit.'
        : response.status === 429
          ? ' The provider is rate limiting; suggestions were skipped for this run.'
          : '';

    throw new Error(`${provider} returned ${response.status}.${detail}${hint}`);
  }

  return response.json();
}
