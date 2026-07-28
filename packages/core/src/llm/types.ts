/**
 * The optional LLM layer.
 *
 * Strictly additive. The deterministic engine never calls into this, never
 * imports it on its lint path, and produces identical results whether or not a
 * provider is configured. A suggestion is a decoration on a violation Anchor
 * already found and already explained.
 *
 * That is not just a design preference. It is what lets Anchor promise that
 * linting works offline, costs nothing, and sends no code anywhere — a promise
 * that would be worthless if the core quietly depended on a model.
 */

import type { Violation } from '../engine/violation.js';

export const LLM_PROVIDERS = ['anthropic', 'openai', 'deepseek', 'ollama'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/**
 * Fields explicitly admit `undefined` because this arrives from parsed JSON,
 * where an absent key and an explicit `undefined` are the same thing.
 */
export interface LlmConfig {
  /**
   * Must be explicitly `true`. There is no "enabled by having a key present"
   * path: a key in the environment for some other tool must never cause
   * Anchor to start transmitting code.
   */
  enabled?: boolean | undefined;
  provider?: LlmProvider | undefined;
  model?: string | undefined;
  /**
   * Supplying a key here works but is discouraged, since config files get
   * committed. The environment variable is the intended route.
   */
  apiKey?: string | undefined;
  /** Overrides the provider endpoint. Required for a non-default Ollama host. */
  baseUrl?: string | undefined;
  /** Per-request budget. Past this the suggestion is dropped, never awaited. */
  timeoutMs?: number | undefined;
  /** Cap on how many violations get a suggestion in one run. */
  maxSuggestions?: number | undefined;
  /** Lines of surrounding code sent with each violation. */
  contextLines?: number | undefined;
}

/** Everything an adapter needs for one request. */
export interface SuggestRequest {
  /** Instruction text. Contains no code. */
  system: string;
  /** The violation, its rule, and the redacted snippet. */
  prompt: string;
  model: string;
  apiKey: string | null;
  baseUrl: string | undefined;
  signal: AbortSignal;
}

export interface LlmAdapter {
  readonly provider: LlmProvider;
  /** Environment variable consulted when the config supplies no key. */
  readonly apiKeyEnvVar: string | null;
  /** Model used when the config does not name one. */
  readonly defaultModel: string;
  /** Default endpoint. */
  readonly defaultBaseUrl: string;
  /**
   * Whether this provider transmits code off the machine. Ollama does not,
   * which is why it is the recommended option and why the CLI can say so.
   */
  readonly isLocal: boolean;
  /** Returns the model's text, or throws. Callers treat a throw as "no suggestion". */
  complete(request: SuggestRequest, fetchImpl?: typeof fetch): Promise<string>;
}

/** A suggestion attached to a violation. */
export interface LlmSuggestion {
  ruleId: string;
  file: string;
  line: number;
  /** The model's prose. Never applied automatically. */
  text: string;
  provider: LlmProvider;
  model: string;
}

export interface SuggestOutcome {
  suggestions: LlmSuggestion[];
  /** Why nothing was produced, when that is the case. Shown to the user. */
  skipped?: string;
  /** Non-fatal problems, e.g. a request that timed out. */
  warnings: string[];
  /** Number of secrets redacted before transmission, across all requests. */
  redactedSecrets: number;
}

/** Raised only inside adapters; never propagates out of `suggest`. */
export class LlmRequestError extends Error {
  override readonly name = 'LlmRequestError';

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Violation plus the source it came from, which the caller must supply. */
export interface SuggestInput {
  violation: Violation;
  /** Full text of the file. Only a redacted window around the line is sent. */
  source: string;
}
