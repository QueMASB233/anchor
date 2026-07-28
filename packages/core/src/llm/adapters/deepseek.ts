/**
 * DeepSeek, which speaks the OpenAI wire format.
 */

import type { LlmAdapter } from '../types.js';
import { completeOpenAiCompatible } from './openai.js';

export const deepseekAdapter: LlmAdapter = {
  provider: 'deepseek',
  apiKeyEnvVar: 'DEEPSEEK_API_KEY',
  defaultModel: 'deepseek-chat',
  defaultBaseUrl: 'https://api.deepseek.com',
  isLocal: false,

  complete(request, fetchImpl = fetch) {
    return completeOpenAiCompatible(
      request,
      { label: 'DeepSeek', baseUrl: deepseekAdapter.defaultBaseUrl },
      fetchImpl,
    );
  },
};
