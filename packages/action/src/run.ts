/**
 * The Action's orchestration.
 *
 * SECURITY POSTURE
 * ----------------
 * Everything this file touches is attacker-controlled. On a `pull_request`
 * event the checked-out tree is the contributor's branch: the source, the
 * `anchor.config`, and the token files all come from them.
 *
 * Three specific consequences, each enforced here rather than assumed:
 *
 * 1. `tailwind.resolveConfig` is stripped unconditionally. That option exists
 *    to load `tailwind.config.js` in a child process for accuracy, and running
 *    a contributor's JavaScript on a runner is exactly the thing Anchor
 *    promises never to do. A config that asks for it is overruled, loudly.
 *
 * 2. `--fix` is refused. Writing to the tree and pushing would turn a linter
 *    into a commit author, and on a fork the token cannot push anyway.
 *
 * 3. The LLM layer is disabled outright. `llm.baseUrl` is a URL read from the
 *    pull request's own config, so leaving it on would let a contributor point
 *    Anchor at a server they control and have it POST the repository's source
 *    there — a data exfiltration primitive handed over by a linter. Suggestions
 *    are a local convenience; they have no place in CI.
 *
 * 4. `pull_request_target` is called out. That trigger combines a write-scoped
 *    token with contributor-controlled code, and while Anchor never executes
 *    that code, a workflow built that way is usually one step from something
 *    that does.
 */

import { readFileSync } from 'node:fs';

import {
  ALL_RULES,
  buildReport,
  COMMENT_MARKER,
  countTokens,
  getReporter,
  lintFile,
  renderComment,
  type LintFileResult,
  type LintOptions,
} from '@eleva/anchor-core';
import {
  DEFAULT_INCLUDE,
  findFiles,
  loadConfig,
  readFiles,
  resolveDesignSystem,
  toArray,
  changedFilesSince,
  intersectPaths,
  type AnchorConfig,
} from '@eleva/anchor';

import { upsertComment } from './github-api.js';
import {
  appendSummary,
  error,
  maskSecret,
  notice,
  readContext,
  readInputs,
  setOutput,
  warning,
  type ActionContext,
  type ActionInputs,
} from './inputs.js';

export const ACTION_VERSION = '0.0.0';

/**
 * Removes every option that would mean executing repository code.
 *
 * Defence in depth: the static parser does not implement `resolveConfig` yet,
 * so today this is inert. It is written now so that the day the escape hatch
 * ships, the Action is already immune rather than newly vulnerable.
 */
export function hardenConfig(config: AnchorConfig): { config: AnchorConfig; stripped: string[] } {
  const stripped: string[] = [];
  const hardened: AnchorConfig = { ...config };

  if (config.tailwind?.resolveConfig === true) {
    stripped.push('tailwind.resolveConfig');
    hardened.tailwind = { ...config.tailwind, resolveConfig: false };
  }

  // `llm.baseUrl` comes from the pull request. Enabled, it would send the
  // repository's source to whatever host that config names.
  if (config.llm?.enabled === true) {
    stripped.push('llm.enabled');
    hardened.llm = { ...config.llm, enabled: false };
  }

  return { config: hardened, stripped };
}

export interface RunResult {
  exitCode: number;
  errors: number;
  warnings: number;
  total: number;
}

/** Reads the event payload, returning `null` rather than throwing. */
function readEventFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export async function run(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<RunResult> {
  const inputs: ActionInputs = readInputs(env);
  const context: ActionContext = readContext(env, readEventFile);

  maskSecret(context.token);

  if (context.isPullRequestTarget) {
    warning(
      'This workflow uses `pull_request_target`, which gives a write-scoped token to a job running against contributor-controlled code. ' +
        'Anchor never executes that code, but prefer `pull_request` unless you specifically need the elevated token.',
    );
  }

  if (inputs.fix) {
    warning(
      '`fix: true` is ignored in CI. Applying fixes here would make the linter a commit author, and a fork-triggered run cannot push anyway. Run `anchor lint --fix` locally.',
    );
  }

  const cwd = context.workspace;
  const loaded = await loadConfig(cwd);
  const { config, stripped } = hardenConfig(loaded.config);

  for (const option of stripped) {
    warning(
      option === 'llm.enabled'
        ? "Ignored `llm.enabled` from the repository configuration. Its `baseUrl` is contributor-controlled, so honouring it would let a pull request send this repository's source to a server of its choosing. Suggestions are a local-only feature."
        : `Ignored \`${option}\` from the repository configuration. It would require executing code from this pull request, which the Anchor Action never does.`,
    );
  }

  const resolved = await resolveDesignSystem({ cwd, config, version: ACTION_VERSION });

  const patterns =
    inputs.check.length > 0 ? inputs.check : (config.include ?? [...DEFAULT_INCLUDE]);

  let paths = await findFiles(cwd, patterns, toArray(config.exclude));

  if (inputs.since !== null) {
    const changed = await changedFilesSince(cwd, inputs.since);
    paths = intersectPaths(paths, changed);
  }

  const sources = await readFiles(cwd, paths);

  const lintOptions: LintOptions = {
    ...(config.rules === undefined ? {} : { rules: config.rules }),
    ...(config.classHelpers === undefined ? {} : { classHelpers: config.classHelpers }),
  };

  const results: LintFileResult[] = sources.map((source) =>
    lintFile(source, resolved.designSystem, ALL_RULES, lintOptions),
  );

  const report = buildReport({
    results,
    designSystem: {
      name: resolved.designSystem.meta.name,
      source: resolved.designSystem.meta.source,
    },
  });

  // Annotations. Every value is escaped by the reporter; see its module comment.
  const annotations = getReporter(inputs.format).render(report, { cwd, version: ACTION_VERSION });
  if (annotations.trim() !== '') process.stdout.write(annotations);

  const { errors, warnings, total } = report.counts;

  // `env` is threaded through rather than letting this read `process.env`: a
  // function that half-honours the environment it was handed is untestable and
  // surprising.
  appendSummary(renderComment(report, { cwd }), env);

  if (inputs.comment && context.pullNumber !== null && context.token !== '') {
    const outcome = await upsertComment(
      {
        owner: context.owner,
        repo: context.repo,
        pullNumber: context.pullNumber,
        token: context.token,
        ...(env['GITHUB_API_URL'] === undefined ? {} : { apiUrl: env['GITHUB_API_URL'] }),
      },
      renderComment(report, { cwd }),
      COMMENT_MARKER,
      fetchImpl,
    );

    if (outcome.status === 'skipped') {
      // Reported, never fatal: the annotations already landed on the diff.
      warning(`Could not post the pull request comment — ${outcome.reason}`);
    }
  } else if (inputs.comment && context.pullNumber === null) {
    notice('Not running on a pull request, so no comment was posted.');
  }

  setOutput('violations', String(total), env);
  setOutput('errors', String(errors), env);
  setOutput('warnings', String(warnings), env);
  setOutput('files-checked', String(report.filesChecked), env);

  if (total === 0) {
    notice(
      `Design system check passed. ${report.filesChecked} files checked against ${countTokens(resolved.designSystem)} tokens.`,
    );
  }

  const failing = inputs.strict && errors > 0;

  if (failing) {
    error(
      `${errors} design system ${errors === 1 ? 'violation' : 'violations'} must be fixed before merging. Run \`anchor lint --fix\` locally for the ones that can be fixed automatically.`,
    );
  }

  return { exitCode: failing ? 1 : 0, errors, warnings, total };
}
