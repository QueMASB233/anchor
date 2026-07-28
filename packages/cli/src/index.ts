/**
 * @eleva/anchor — the Anchor CLI.
 *
 * A thin wrapper over @eleva/anchor-core. All design system logic lives in
 * core; this package owns argument parsing, config discovery, filesystem access
 * and process exit codes only.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command, Option } from 'commander';
import { REPORTER_FORMATS, type ReporterFormat } from '@eleva/anchor-core';

import { ConfigError, loadConfig } from './config.js';
import { NoDesignSystemError } from './resolve-design-system.js';
import { GitError } from './workspace.js';
import { resolveUiOptions, Ui } from './ui.js';
import { EXIT, type CommandContext } from './commands/context.js';
import { runInit } from './commands/init.js';
import { runLint } from './commands/lint.js';
import { runSync } from './commands/sync.js';

export { runInit, runLint, runSync };
export * from './config.js';
export * from './resolve-design-system.js';
export * from './ui.js';
export * from './workspace.js';
export { EXIT, type CommandContext } from './commands/context.js';

/** Read from package.json so the version can never drift from what ships. */
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, '..', 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const CLI_VERSION = readVersion();

interface GlobalOptions {
  cwd?: string;
  config?: string;
  color?: boolean;
  emoji?: boolean;
  quiet?: boolean;
}

/** Builds the context every command receives. */
async function buildContext(global: GlobalOptions): Promise<CommandContext> {
  const cwd = resolve(global.cwd ?? process.cwd());

  const ui = new Ui(
    resolveUiOptions(process.env, process.stdout.isTTY === true, {
      ...(global.color === undefined ? {} : { color: global.color }),
      ...(global.emoji === undefined ? {} : { emoji: global.emoji }),
      ...(global.quiet === undefined ? {} : { quiet: global.quiet }),
    }),
  );

  const loaded = await loadConfig(cwd);

  return { ui, cwd, version: CLI_VERSION, config: loaded.config, configPath: loaded.filepath };
}

/**
 * Turns an error into a message a person can act on.
 *
 * Anchor's own errors carry guidance and are printed as-is. Anything else is a
 * bug, and says so rather than presenting a stack trace as if it were advice.
 */
function reportError(ui: Ui, error: unknown): number {
  if (
    error instanceof ConfigError ||
    error instanceof NoDesignSystemError ||
    error instanceof GitError
  ) {
    ui.stderr('');
    ui.fail(error.message);
    ui.stderr('');
    return EXIT.error;
  }

  const message = error instanceof Error ? error.message : String(error);
  ui.stderr('');
  ui.fail(`Anchor hit an unexpected error: ${message}`);
  ui.stderr('');
  ui.stderr('  This is a bug. Please report it with the command you ran:');
  ui.stderr('  https://github.com/eleva-builds/anchor/issues');

  if (process.env['ANCHOR_DEBUG'] !== undefined && error instanceof Error) {
    ui.stderr('');
    ui.stderr(error.stack ?? '');
  } else {
    ui.stderr('');
    ui.stderr('  Re-run with ANCHOR_DEBUG=1 for a stack trace.');
  }

  return EXIT.error;
}

/** Wraps a command so every failure path produces a sensible exit code. */
function runCommand(
  program: Command,
  action: (context: CommandContext) => Promise<number>,
): () => Promise<void> {
  return async () => {
    const global = program.opts<GlobalOptions>();
    let ui = new Ui(resolveUiOptions(process.env, process.stdout.isTTY === true));

    try {
      const context = await buildContext(global);
      ui = context.ui;
      process.exitCode = await action(context);
    } catch (error) {
      process.exitCode = reportError(ui, error);
    }
  };
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('anchor')
    .description(
      'Make AI coding agents respect your design system.\n' +
        'Runs entirely on your machine. Your design system never leaves this repo.',
    )
    .version(CLI_VERSION, '-v, --version')
    .option('-C, --cwd <path>', 'run as if started in this directory')
    .option('--no-color', 'disable coloured output')
    .option('--no-emoji', 'disable emoji, keeping plain ASCII markers')
    .option('-q, --quiet', 'only print errors');

  program
    .command('init')
    .description('detect your design system and write a starter anchor.config.json')
    .option('-f, --force', 'overwrite an existing config')
    .action(async (options: { force?: boolean }) => {
      await runCommand(program, (context) =>
        runInit(context, { ...(options.force === undefined ? {} : { force: options.force }) }),
      )();
    });

  program
    .command('sync')
    .description('generate CLAUDE.md, .cursorrules and AGENTS.md from your design system')
    .option('--check', 'report whether the files are up to date, without writing')
    .option('--no-cache', 'ignore the token cache')
    .addOption(
      new Option('--only <targets...>', 'limit to specific outputs').choices([
        'claude-md',
        'cursorrules',
        'agents-md',
      ]),
    )
    .action(async (options: { check?: boolean; cache?: boolean; only?: string[] }) => {
      await runCommand(program, (context) =>
        runSync(context, {
          ...(options.check === undefined ? {} : { check: options.check }),
          ...(options.cache === false ? { noCache: true } : {}),
          ...(options.only === undefined ? {} : { only: options.only }),
        }),
      )();
    });

  program
    .command('lint')
    .description('check your components against the design system')
    .argument('[patterns...]', 'files or globs to check')
    .option('-c, --check <patterns...>', 'files or globs to check')
    .option('--since <ref>', 'only check files changed against this git ref')
    .addOption(
      new Option('-f, --format <format>', 'output format')
        .choices([...REPORTER_FORMATS])
        .default('terminal'),
    )
    .option('--fix', 'apply every fix that can be applied safely')
    .option('--strict', 'exit 1 when any error-severity violation is found')
    .option('--max-warnings <count>', 'exit 1 above this many warnings', Number.parseInt)
    .option('-o, --output-file <path>', 'write the report to a file instead of stdout')
    .option('--comment-file <path>', 'write a pull request comment body to this file')
    .option('--no-cache', 'ignore the token cache')
    .action(
      async (
        patterns: string[],
        options: {
          check?: string[];
          since?: string;
          format?: string;
          fix?: boolean;
          strict?: boolean;
          maxWarnings?: number;
          outputFile?: string;
          commentFile?: string;
          cache?: boolean;
        },
      ) => {
        const globs = [...patterns, ...(options.check ?? [])];

        await runCommand(program, (context) =>
          runLint(context, {
            ...(globs.length === 0 ? {} : { check: globs }),
            ...(options.since === undefined ? {} : { since: options.since }),
            ...(options.format === undefined ? {} : { format: options.format as ReporterFormat }),
            ...(options.fix === undefined ? {} : { fix: options.fix }),
            ...(options.strict === undefined ? {} : { strict: options.strict }),
            ...(options.maxWarnings === undefined ? {} : { maxWarnings: options.maxWarnings }),
            ...(options.outputFile === undefined ? {} : { outputFile: options.outputFile }),
            ...(options.commentFile === undefined ? {} : { commentFile: options.commentFile }),
            ...(options.cache === false ? { noCache: true } : {}),
          }),
        )();
      },
    );

  program.addHelpText(
    'after',
    `
Examples
  $ anchor init                          set up in an existing project
  $ anchor sync                          teach your agents the design system
  $ anchor lint                          check everything
  $ anchor lint --since main             check only what this branch changed
  $ anchor lint --fix                    apply the safe fixes
  $ anchor lint --format sarif -o out    for GitHub code scanning

Anchor runs 100% locally. No telemetry, no network, no account.
`,
  );

  return program;
}

/** Entry point used by the `anchor` bin. */
export async function main(argv: readonly string[] = process.argv): Promise<void> {
  await createProgram().parseAsync([...argv]);
}

// Only run when executed as a binary, so importing this module is side-effect free.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split('/').pop() ?? ' ')
) {
  await main();
}
