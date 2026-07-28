/**
 * OpenAI Chat Completions API.
 */

import { LlmRequestError, type LlmAdapter, type SuggestRequest } from '../types.js';
import { readJsonResponse } from './index.js';

export interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown } }[];
}

/**
 * Shared by every OpenAI-compatible provider.
 *
 * DeepSeek implements the same wire format, so the request shape lives here
 * once rather than being copied and drifting.
 */
export async function completeOpenAiCompatible(
  request: SuggestRequest,
  options: { label: string; baseUrl: string; path?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (request.apiKey === null) {
    throw new LlmRequestError(`No ${options.label} API key available.`);
  }

  const response = await fetchImpl(
    `${request.baseUrl ?? options.baseUrl}${options.path ?? '/v1/chat/completions'}`,
    {
      method: 'POST',
      signal: request.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: 400,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ],
      }),
    },
  );

  const body = (await readJsonResponse(response, options.label)) as ChatCompletionResponse;
  const content = body.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || content.trim() === '') {
    throw new LlmRequestError(`${options.label} returned no text content.`);
  }
  return content.trim();
}

export const openaiAdapter: LlmAdapter = {
  provider: 'openai',
  apiKeyEnvVar: 'OPENAI_API_KEY',
  defaultModel: 'gpt-4o-mini',
  defaultBaseUrl: 'https://api.openai.com',
  isLocal: false,

  complete(request, fetchImpl = fetch) {
    return completeOpenAiCompatible(
      request,
      { label: 'OpenAI', baseUrl: openaiAdapter.defaultBaseUrl },
      fetchImpl,
    );
  },
};
