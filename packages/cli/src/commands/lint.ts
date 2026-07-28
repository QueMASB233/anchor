/**
 * `anchor lint` — check source against the design system.
 *
 * The command the whole product exists for. Two things it is careful about:
 *
 * Machine-readable output goes to stdout and nothing else does, so
 * `anchor lint --format json > report.json` produces a valid file rather than
 * one with a banner glued to the front.
 *
 * Exit codes distinguish "your code has violations" from "Anchor could not
 * run", because a CI job that treats a missing config as a lint failure teaches
 * people to ignore the check.
 */

import { resolve } from 'node:path';

import {
  applyFixes,
  ALL_RULES,
  buildReport,
  getReporter,
  lintFile,
  renderComment,
  suggestFixes,
  type LintFileResult,
  type LintOptions,
  type ReporterFormat,
} from '@eleva/anchor-core';

import { DEFAULT_INCLUDE, toArray } from '../config.js';
import { formatCount, formatDuration } from '../ui.js';
import {
  changedFilesSince,
  findFiles,
  intersectPaths,
  readFiles,
  writeFileEnsuringDir,
} from '../workspace.js';
import { resolveDesignSystem } from '../resolve-design-system.js';
import { EXIT, type CommandContext } from './context.js';

export interface LintCommandOptions {
  /** Extra globs to check, from positional arguments or `--check`. */
  check?: string[];
  /** Only lint files changed against this git ref. */
  since?: string;
  format?: ReporterFormat;
  fix?: boolean;
  /** Exit non-zero when any error-severity violation is found. */
  strict?: boolean;
  /** Write the pull request comment body here, for the Action. */
  commentFile?: string;
  /** Write reporter output to a file instead of stdout. */
  outputFile?: string;
  noCache?: boolean;
  maxWarnings?: number;
}

/**
 * How many files to read at once.
 *
 * Linting is CPU-bound and fast (sub-millisecond per file), so this bounds
 * concurrent file descriptors rather than chasing parallelism. A pool larger
 * than this trades open handles for no measurable gain.
 */
const READ_CONCURRENCY = 64;

async function readInBatches(cwd: string, paths: readonly string[]) {
  const sources = [];
  for (let index = 0; index < paths.length; index += READ_CONCURRENCY) {
    sources.push(...(await readFiles(cwd, paths.slice(index, index + READ_CONCURRENCY))));
  }
  return sources;
}

export async function runLint(
  context: CommandContext,
  options: LintCommandOptions = {},
): Promise<number> {
  const { ui, cwd, version, config } = context;
  const started = performance.now();

  const format = options.format ?? 'terminal';
  const machineReadable = format !== 'terminal';

  // A banner would corrupt piped JSON or SARIF.
  if (!machineReadable) ui.banner('lint');

  const resolved = await resolveDesignSystem({
    cwd,
    config,
    version,
    ...(options.noCache === true ? { noCache: true } : {}),
  });

  const patterns =
    options.check !== undefined && options.check.length > 0
      ? options.check
      : (config.include ?? [...DEFAULT_INCLUDE]);

  let paths = await findFiles(cwd, patterns, toArray(config.exclude));

  if (options.since !== undefined) {
    const changed = await changedFilesSince(cwd, options.since);
    paths = intersectPaths(paths, changed);

    if (!machineReadable) {
      ui.detail(
        `${formatCount(paths.length)} of ${formatCount(changed.length)} changed files are lintable (since ${options.since}).`,
      );
    }
  }

  if (paths.length === 0) {
    if (!machineReadable) {
      ui.step('search', 'No files matched.');
      ui.detail(`Patterns: ${patterns.join(', ')}`);
    } else {
      ui.always(getReporter(format).render(buildReport({ results: [] }), { cwd, version }));
    }
    return EXIT.ok;
  }

  const sources = await readInBatches(cwd, paths);
  const lintOptions: LintOptions = {
    ...(config.rules === undefined ? {} : { rules: config.rules }),
    ...(config.classHelpers === undefined ? {} : { classHelpers: config.classHelpers }),
  };

  const sourceText = new Map(sources.map((source) => [source.path, source.content]));
  let results: LintFileResult[] = sources.map((source) =>
    lintFile(source, resolved.designSystem, ALL_RULES, lintOptions),
  );

  let fixedFiles = 0;
  let fixedViolations = 0;

  if (options.fix === true) {
    const rerun: LintFileResult[] = [];

    for (const result of results) {
      const original = sourceText.get(result.file);
      if (original === undefined || result.violations.length === 0) {
        rerun.push(result);
        continue;
      }

      const { output, applied } = applyFixes(original, result.violations);
      if (applied.length === 0) {
        rerun.push(result);
        continue;
      }

      await writeFileEnsuringDir(resolve(cwd, result.file), output);
      fixedFiles += 1;
      fixedViolations += applied.length;
      sourceText.set(result.file, output);

      // Re-lint the patched file so the report reflects reality on disk.
      rerun.push(
        lintFile(
          { path: result.file, content: output },
          resolved.designSystem,
          ALL_RULES,
          lintOptions,
        ),
      );
    }

    results = rerun;
  }

  const report = buildReport({
    results,
    designSystem: {
      name: resolved.designSystem.meta.name,
      source: resolved.designSystem.meta.source,
    },
    durationMs: performance.now() - started,
  });

  const reporterOptions = {
    cwd,
    version,
    color: !machineReadable && ui.colorEnabled,
    emoji: !machineReadable && ui.emojiEnabled,
    // The CLI prints its own summary below, with timing and fix guidance.
    summary: machineReadable,
    getSource: (path: string) => sourceText.get(path),
  };

  const rendered = getReporter(format).render(report, reporterOptions);

  if (options.outputFile !== undefined) {
    await writeFileEnsuringDir(resolve(cwd, options.outputFile), rendered);
    if (!machineReadable) ui.detail(`Report written to ${options.outputFile}`);
  } else if (machineReadable) {
    ui.always(rendered);
  } else if (rendered.trim() !== '') {
    ui.line(rendered.trimEnd());
  }

  if (options.commentFile !== undefined) {
    await writeFileEnsuringDir(resolve(cwd, options.commentFile), renderComment(report, { cwd }));
  }

  // The optional suggestion layer runs only after the deterministic result is
  // complete, and only when the user explicitly turned it on. Nothing here can
  // change a violation, a count, or an exit code.
  if (config.llm?.enabled === true && !machineReadable && report.violations.length > 0) {
    const outcome = await suggestFixes(
      report.violations.map((entry) => ({
        violation: entry,
        source: sourceText.get(entry.file) ?? '',
      })),
      config.llm,
      { env: process.env },
    );

    if (outcome.suggestions.length > 0) {
      ui.line();
      const provider = config.llm.provider ?? 'ollama';
      ui.step(
        'sparkle',
        `${ui.paint('Suggestions', 'bold')}  ${ui.paint(`via ${provider}`, 'grey')}`,
      );

      for (const suggestion of outcome.suggestions) {
        ui.line();
        ui.line(
          `   ${ui.paint(`${suggestion.file}:${suggestion.line}`, 'dim')}  ${ui.paint(suggestion.ruleId, 'grey')}`,
        );
        for (const sentence of suggestion.text.split('\n')) ui.line(`   ${sentence}`);
      }

      if (outcome.redactedSecrets > 0) {
        ui.line();
        ui.warn(
          `Redacted ${outcome.redactedSecrets} apparent ${outcome.redactedSecrets === 1 ? 'secret' : 'secrets'} from the code sent to ${provider}.`,
        );
      }
    }

    for (const warning of outcome.warnings) ui.warn(warning);
    if (outcome.skipped !== undefined && outcome.suggestions.length === 0) {
      ui.detail(outcome.skipped);
    }
  }

  const { errors, warnings, total, fixable } = report.counts;
  const elapsed = formatDuration(performance.now() - started);

  if (!machineReadable) {
    ui.line();

    if (fixedViolations > 0) {
      ui.step(
        'wrench',
        `Fixed ${formatCount(fixedViolations)} ${fixedViolations === 1 ? 'violation' : 'violations'} across ${formatCount(fixedFiles)} ${fixedFiles === 1 ? 'file' : 'files'}.`,
      );
    }

    if (total === 0) {
      ui.step(
        'sparkle',
        `On system. ${formatCount(report.filesChecked)} ${report.filesChecked === 1 ? 'file' : 'files'} checked, nothing out of place.  ${ui.paint(elapsed, 'grey')}`,
      );
    } else {
      const parts = [
        errors > 0
          ? ui.paint(`${formatCount(errors)} ${errors === 1 ? 'error' : 'errors'}`, 'red')
          : null,
        warnings > 0
          ? ui.paint(
              `${formatCount(warnings)} ${warnings === 1 ? 'warning' : 'warnings'}`,
              'yellow',
            )
          : null,
      ].filter((part): part is string => part !== null);

      ui.step(
        'bolt',
        `${parts.join('  ')}  ${ui.paint(ui.sign('bullet'), 'grey')}  ${ui.paint(
          `${formatCount(report.filesChecked)} ${report.filesChecked === 1 ? 'file' : 'files'} in ${elapsed}`,
          'grey',
        )}`,
      );

      if (fixable > 0 && options.fix !== true) {
        ui.line(
          `   ${ui.sign('wrench')} ${formatCount(fixable)} of these can be fixed automatically — run ${ui.paint('anchor lint --fix', 'cyan')}`,
        );
      }
    }

    const parseErrors = report.files.filter((file) => file.parseError !== undefined).length;
    if (parseErrors > 0) {
      ui.warn(
        `${formatCount(parseErrors)} ${parseErrors === 1 ? 'file' : 'files'} could not be parsed and ${parseErrors === 1 ? 'was' : 'were'} skipped.`,
      );
    }

    ui.privacyNote();
  }

  if (options.maxWarnings !== undefined && warnings > options.maxWarnings) {
    return EXIT.violations;
  }
  // `--strict` fails on errors. Without it, `lint` reports and exits clean, so
  // it can be adopted before a team is ready to block merges on it.
  if (options.strict === true && errors > 0) return EXIT.violations;

  return EXIT.ok;
}
