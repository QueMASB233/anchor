/**
 * Turning violations into optional model-written suggestions.
 *
 * THE CONSENT GATE
 * ----------------
 * `resolveLlm` is the single place that decides whether any code may leave the
 * machine, and it is deliberately hard to satisfy by accident:
 *
 *   - `enabled` must be exactly `true`. Not truthy, not "a key is present".
 *     A developer with `OPENAI_API_KEY` exported for some other tool must never
 *     find Anchor quietly uploading their components.
 *   - A key must resolve, except for Ollama, which needs none because it never
 *     leaves the machine.
 *
 * When either check fails, the reason is returned rather than thrown, so the
 * CLI can explain the situation instead of failing a lint run over an optional
 * feature.
 *
 * Every failure past that point degrades to silence: a timeout, a rate limit,
 * or a provider outage costs a suggestion, never the lint result.
 */

import type { Violation } from '../engine/violation.js';
import { getAdapter } from './adapters/index.js';
import { extractContext } from './redact.js';
import {
  type LlmAdapter,
  type LlmConfig,
  type LlmSuggestion,
  type SuggestInput,
  type SuggestOutcome,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_SUGGESTIONS = 10;
const DEFAULT_CONTEXT_LINES = 4;

/** Requests in flight at once. Small: this is a courtesy feature, not a race. */
const CONCURRENCY = 3;

const SYSTEM_PROMPT = [
  'You help developers fix design system violations in a React codebase.',
  'A deterministic linter has already identified the problem and the correct token.',
  'Your job is to explain, in at most three sentences, how to apply the fix in this specific code —',
  'especially when the mechanical replacement is not the right answer and the component needs a variant instead.',
  'Do not repeat the violation message back. Do not invent token names.',
  'If the suggested fix is already obviously correct, say so in one sentence.',
].join(' ');

export interface ResolvedLlm {
  adapter: LlmAdapter;
  model: string;
  apiKey: string | null;
  baseUrl: string | undefined;
  timeoutMs: number;
  maxSuggestions: number;
  contextLines: number;
}

export type LlmResolution =
  | { ok: true; llm: ResolvedLlm }
  | {
      ok: false;
      reason: string;
      /** True when the user never asked for this. */ inactive: boolean;
    };

/**
 * Decides whether the LLM layer may run, and with what.
 *
 * @param env consulted only for the provider's own key variable.
 */
export function resolveLlm(
  config: LlmConfig | undefined,
  env: Readonly<Record<string, string | undefined>> = {},
): LlmResolution {
  if (config?.enabled !== true) {
    return {
      ok: false,
      inactive: true,
      reason:
        'The LLM layer is off. Set `llm.enabled: true` in anchor.config to turn it on. Anchor lints exactly the same either way.',
    };
  }

  const provider = config.provider ?? 'ollama';
  let adapter: LlmAdapter;
  try {
    adapter = getAdapter(provider);
  } catch (cause) {
    return {
      ok: false,
      inactive: false,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }

  const apiKey =
    config.apiKey ?? (adapter.apiKeyEnvVar === null ? null : (env[adapter.apiKeyEnvVar] ?? null));

  if (!adapter.isLocal && (apiKey === null || apiKey === '')) {
    return {
      ok: false,
      inactive: false,
      reason: `\`llm.enabled\` is true but no ${provider} key was found. Set ${adapter.apiKeyEnvVar} in your environment, or switch to \`provider: "ollama"\` to run a model locally with no key.`,
    };
  }

  return {
    ok: true,
    llm: {
      adapter,
      model: config.model ?? adapter.defaultModel,
      apiKey: apiKey === '' ? null : apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxSuggestions: config.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS,
      contextLines: config.contextLines ?? DEFAULT_CONTEXT_LINES,
    },
  };
}

/** Builds the user prompt. The only place code is placed into a request. */
function buildPrompt(violation: Violation, snippet: string): string {
  return [
    `Rule: ${violation.ruleId}`,
    `Problem: ${violation.message}`,
    ...(violation.suggestedFix === undefined
      ? []
      : [`Linter's suggested replacement: ${violation.suggestedFix}`]),
    '',
    'Code (secrets removed):',
    '```tsx',
    snippet,
    '```',
  ].join('\n');
}

/** Runs one request with its own timeout. Resolves to `null` on any failure. */
async function suggestOne(
  input: SuggestInput,
  llm: ResolvedLlm,
  fetchImpl: typeof fetch,
  warnings: string[],
): Promise<{ suggestion: LlmSuggestion | null; redacted: number }> {
  const { snippet, redaction } = extractContext(
    input.source,
    input.violation.line,
    llm.contextLines,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, llm.timeoutMs);

  try {
    const text = await llm.adapter.complete(
      {
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(input.violation, snippet),
        model: llm.model,
        apiKey: llm.apiKey,
        baseUrl: llm.baseUrl,
        signal: controller.signal,
      },
      fetchImpl,
    );

    return {
      suggestion: {
        ruleId: input.violation.ruleId,
        file: input.violation.file,
        line: input.violation.line,
        text,
        provider: llm.adapter.provider,
        model: llm.model,
      },
      redacted: redaction.count,
    };
  } catch (cause) {
    const message = controller.signal.aborted
      ? `Suggestion timed out after ${llm.timeoutMs}ms.`
      : cause instanceof Error
        ? cause.message
        : String(cause);

    // Deduplicated by the caller; a rate limit would otherwise repeat per file.
    if (!warnings.includes(message)) warnings.push(message);
    return { suggestion: null, redacted: redaction.count };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adds suggestions to violations, if and only if the user asked for it.
 *
 * Never throws. The deterministic result is already complete by the time this
 * runs, and nothing optional is allowed to endanger it.
 */
export async function suggestFixes(
  inputs: readonly SuggestInput[],
  config: LlmConfig | undefined,
  options: { env?: Readonly<Record<string, string | undefined>>; fetchImpl?: typeof fetch } = {},
): Promise<SuggestOutcome> {
  const resolution = resolveLlm(config, options.env ?? {});

  if (!resolution.ok) {
    return { suggestions: [], skipped: resolution.reason, warnings: [], redactedSecrets: 0 };
  }

  const { llm } = resolution;
  const fetchImpl = options.fetchImpl ?? fetch;

  // Errors first: they are what a developer most wants help with.
  const queue = [...inputs]
    .sort((a, b) => {
      if (a.violation.severity === b.violation.severity) return 0;
      return a.violation.severity === 'error' ? -1 : 1;
    })
    .slice(0, llm.maxSuggestions);

  if (queue.length === 0) {
    return { suggestions: [], warnings: [], redactedSecrets: 0 };
  }

  const suggestions: LlmSuggestion[] = [];
  const warnings: string[] = [];
  let redactedSecrets = 0;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      const input = queue[cursor];
      cursor += 1;
      if (input === undefined) return;

      const { suggestion, redacted } = await suggestOne(input, llm, fetchImpl, warnings);
      redactedSecrets += redacted;
      if (suggestion !== null) suggestions.push(suggestion);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  // Restore source order; concurrency scrambles it.
  suggestions.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  return {
    suggestions,
    warnings,
    redactedSecrets,
    ...(inputs.length > llm.maxSuggestions
      ? {
          skipped: `Only the first ${llm.maxSuggestions} violations were sent for suggestions. Raise \`llm.maxSuggestions\` to send more.`,
        }
      : {}),
  };
}
