/**
 * Ollama — a model running on the developer's own machine.
 *
 * The recommended provider, and the only one that keeps Anchor's privacy
 * guarantee fully intact: no key, no account, and nothing crosses the network
 * boundary. `isLocal` is what lets the CLI say so honestly in its output.
 */

import { LlmRequestError, type LlmAdapter, type SuggestRequest } from '../types.js';
import { readJsonResponse } from './index.js';

interface OllamaResponse {
  message?: { content?: unknown };
}

export const ollamaAdapter: LlmAdapter = {
  provider: 'ollama',
  // No key exists to look up; a local daemon needs no credential.
  apiKeyEnvVar: null,
  defaultModel: 'llama3.1',
  defaultBaseUrl: 'http://127.0.0.1:11434',
  isLocal: true,

  async complete(request: SuggestRequest, fetchImpl: typeof fetch = fetch): Promise<string> {
    const base = request.baseUrl ?? ollamaAdapter.defaultBaseUrl;

    let response: Response;
    try {
      response = await fetchImpl(`${base}/api/chat`, {
        method: 'POST',
        signal: request.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          stream: false,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
        }),
      });
    } catch {
      // The overwhelmingly likely cause is that Ollama simply is not running,
      // so say that rather than surfacing a socket error.
      throw new LlmRequestError(
        `Could not reach Ollama at ${base}. Is it running? Start it with \`ollama serve\`, then pull the model with \`ollama pull ${request.model}\`.`,
      );
    }

    const body = (await readJsonResponse(response, 'Ollama')) as OllamaResponse;
    const content = body.message?.content;

    if (typeof content !== 'string' || content.trim() === '') {
      throw new LlmRequestError('Ollama returned no text content.');
    }
    return content.trim();
  },
};
