/**
 * Anthropic Messages API.
 */

import { LlmRequestError, type LlmAdapter, type SuggestRequest } from '../types.js';
import { readJsonResponse } from './index.js';

interface AnthropicResponse {
  content?: { type?: string; text?: string }[];
}

export const anthropicAdapter: LlmAdapter = {
  provider: 'anthropic',
  apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  defaultModel: 'claude-sonnet-5',
  defaultBaseUrl: 'https://api.anthropic.com',
  isLocal: false,

  async complete(request: SuggestRequest, fetchImpl: typeof fetch = fetch): Promise<string> {
    if (request.apiKey === null) {
      throw new LlmRequestError('No Anthropic API key available.');
    }

    const response = await fetchImpl(
      `${request.baseUrl ?? anthropicAdapter.defaultBaseUrl}/v1/messages`,
      {
        method: 'POST',
        signal: request.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': request.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: 400,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
        }),
      },
    );

    const body = (await readJsonResponse(response, 'Anthropic')) as AnthropicResponse;
    const text = body.content?.find((block) => block.type === 'text')?.text;

    if (typeof text !== 'string' || text.trim() === '') {
      throw new LlmRequestError('Anthropic returned no text content.');
    }
    return text.trim();
  },
};
