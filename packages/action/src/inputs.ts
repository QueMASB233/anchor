/**
 * Reading the Action's environment.
 *
 * Hand-rolled rather than pulled from `@actions/core`, for the same reason the
 * LLM adapters avoid vendor SDKs: the contract is a handful of environment
 * variables and two append-only files, and a GitHub Action ships its
 * dependencies as committed bundled code. Every kilobyte is one a user pulls
 * on every CI run.
 */

import { appendFileSync } from 'node:fs';

import { escapeData, escapeProperty, type ReporterFormat } from '@eleva/anchor-core';

/** GitHub exposes `with:` entries as `INPUT_<NAME>`, upper-cased, spaces to underscores. */
export function getInput(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
  return (env[key] ?? '').trim();
}

export function getBooleanInput(name: string, fallback: boolean, env = process.env): boolean {
  const raw = getInput(name, env).toLowerCase();
  if (raw === '') return fallback;
  if (['true', '1', 'yes', 'on'].includes(raw)) return true;
  if (['false', '0', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

/** Splits a multi-line or comma-separated input into a list. */
export function getListInput(name: string, env = process.env): string[] {
  return getInput(name, env)
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

export interface ActionContext {
  /** `owner/repo`, split. */
  owner: string;
  repo: string;
  /** Pull request number, when the run is attached to one. */
  pullNumber: number | null;
  eventName: string;
  token: string;
  /** Absolute path of the checked-out workspace. */
  workspace: string;
  isPullRequestTarget: boolean;
}

/**
 * Reads the pull request number.
 *
 * Taken from the event payload path rather than parsed out of a ref, because
 * `GITHUB_REF` shapes differ between event types and getting it wrong means
 * commenting on the wrong issue.
 */
function readPullNumber(
  env: NodeJS.ProcessEnv,
  readEvent: (path: string) => string | null,
): number | null {
  const payloadPath = env['GITHUB_EVENT_PATH'];
  if (payloadPath === undefined) return null;

  const raw = readEvent(payloadPath);
  if (raw === null) return null;

  try {
    const payload = JSON.parse(raw) as {
      pull_request?: { number?: unknown };
      number?: unknown;
    };
    const candidate = payload.pull_request?.number ?? payload.number;
    return typeof candidate === 'number' ? candidate : null;
  } catch {
    return null;
  }
}

export function readContext(
  env: NodeJS.ProcessEnv = process.env,
  readEvent: (path: string) => string | null = () => null,
): ActionContext {
  const [owner = '', repo = ''] = (env['GITHUB_REPOSITORY'] ?? '').split('/');
  const eventName = env['GITHUB_EVENT_NAME'] ?? '';

  return {
    owner,
    repo,
    pullNumber: readPullNumber(env, readEvent),
    eventName,
    token: getInput('github-token', env),
    workspace: env['GITHUB_WORKSPACE'] ?? process.cwd(),
    isPullRequestTarget: eventName === 'pull_request_target',
  };
}

export interface ActionInputs {
  check: string[];
  config: string | null;
  strict: boolean;
  comment: boolean;
  format: ReporterFormat;
  since: string | null;
  fix: boolean;
}

const VALID_FORMATS: readonly ReporterFormat[] = ['github', 'terminal', 'json', 'sarif'];

export function readInputs(env: NodeJS.ProcessEnv = process.env): ActionInputs {
  const rawFormat = getInput('format', env) || 'github';
  const format = (VALID_FORMATS as readonly string[]).includes(rawFormat)
    ? (rawFormat as ReporterFormat)
    : 'github';

  const since = getInput('since', env);
  const config = getInput('config', env);

  return {
    check: getListInput('check', env),
    config: config === '' ? null : config,
    strict: getBooleanInput('strict', true, env),
    comment: getBooleanInput('comment', true, env),
    format,
    since: since === '' ? null : since,
    fix: getBooleanInput('fix', false, env),
  };
}

/**
 * Writes a step output.
 *
 * Uses the heredoc form with a random delimiter. The older `::set-output`
 * command was deprecated precisely because a value containing a newline could
 * inject further commands, and Anchor's outputs are counts derived from
 * attacker-influenced input.
 */
export function setOutput(name: string, value: string, env: NodeJS.ProcessEnv = process.env): void {
  const file = env['GITHUB_OUTPUT'];
  const delimiter = `ghadelimiter_${Math.random().toString(36).slice(2)}`;

  if (file === undefined) {
    // Outside Actions there is nowhere to write; printing keeps local runs useful.
    process.stdout.write(`${name}=${value}\n`);
    return;
  }

  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8');
}

/** Appends Markdown to the job summary shown on the workflow run page. */
export function appendSummary(markdown: string, env: NodeJS.ProcessEnv = process.env): void {
  const file = env['GITHUB_STEP_SUMMARY'];
  if (file === undefined) return;
  appendFileSync(file, `${markdown}\n`, 'utf8');
}

/** A `::notice` workflow command, escaped like every other. */
export function notice(message: string): void {
  process.stdout.write(`::notice title=${escapeProperty('Anchor')}::${escapeData(message)}\n`);
}

/** A `::warning` not tied to a file. */
export function warning(message: string): void {
  process.stdout.write(`::warning title=${escapeProperty('Anchor')}::${escapeData(message)}\n`);
}

/** A `::error` not tied to a file. */
export function error(message: string): void {
  process.stdout.write(`::error title=${escapeProperty('Anchor')}::${escapeData(message)}\n`);
}

/**
 * Hides a value from the log.
 *
 * The token is never printed deliberately, but a stack trace or a verbose HTTP
 * error can carry one, so it is registered as a secret before any request runs.
 */
export function maskSecret(value: string): void {
  if (value === '') return;
  process.stdout.write(`::add-mask::${escapeData(value)}\n`);
}
