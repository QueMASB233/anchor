/**
 * `anchor sync` — generate the context files AI agents read.
 *
 * Reports per-file whether content was created, updated or left alone. The
 * "unchanged" case is the one worth surfacing: it is the proof that sync is
 * deterministic and safe to run on every commit, which is what makes it
 * reasonable to put in a pre-commit hook.
 */

import { resolve } from 'node:path';

import { countTokens, GENERATORS, RULE_IDS, type GeneratorDefinition } from '@eleva/anchor-core';

import { formatCount, formatDuration } from '../ui.js';
import { readIfExists, writeFileEnsuringDir } from '../workspace.js';
import { resolveDesignSystem } from '../resolve-design-system.js';
import { EXIT, type CommandContext } from './context.js';

export interface SyncOptions {
  /** Report what would change without writing anything. */
  check?: boolean;
  noCache?: boolean;
  /** Restrict to specific targets. */
  only?: string[];
}

/** Resolves a generator's output path and whether it is enabled. */
function targetFor(
  generator: GeneratorDefinition,
  context: CommandContext,
): { enabled: boolean; path: string } {
  const key =
    generator.target === 'claude-md'
      ? 'claudeMd'
      : generator.target === 'cursorrules'
        ? 'cursorrules'
        : 'agentsMd';

  const setting = context.config.generators?.[key];

  if (setting === false) return { enabled: false, path: generator.defaultPath };
  if (typeof setting === 'string') return { enabled: true, path: setting };
  return { enabled: true, path: generator.defaultPath };
}

export async function runSync(context: CommandContext, options: SyncOptions = {}): Promise<number> {
  const { ui, cwd, version, config } = context;
  const started = performance.now();

  ui.banner('sync');

  const resolved = await resolveDesignSystem({
    cwd,
    config,
    version,
    ...(options.noCache === true ? { noCache: true } : {}),
  });
  const { designSystem } = resolved;

  ui.step(
    'palette',
    `${ui.paint(designSystem.meta.name, 'bold')}  ${ui.paint(ui.sign('bullet'), 'grey')}  ` +
      `${ui.paint(designSystem.meta.source, 'grey')}  ${ui.paint(ui.sign('bullet'), 'grey')}  ` +
      `${ui.paint(`${formatCount(countTokens(designSystem))} tokens`, 'grey')}`,
  );

  if (resolved.fromCache) ui.detail('Read from cache.');
  ui.line();

  const enabledRules = Object.entries(config.rules ?? {})
    .filter(
      ([, setting]) =>
        setting !== 'off' && (typeof setting === 'string' || setting.severity !== 'off'),
    )
    .map(([id]) => id);

  const generatorOptions = {
    enabledRules: enabledRules.length > 0 ? enabledRules : RULE_IDS,
    ...(config.generators?.extraInstructions === undefined
      ? {}
      : { extraInstructions: config.generators.extraInstructions }),
    ...(config.generators?.maxTokensPerGroup === undefined
      ? {}
      : { maxTokensPerGroup: config.generators.maxTokensPerGroup }),
  };

  const only = new Set(options.only ?? []);
  let changed = 0;
  let wouldChange = 0;

  for (const generator of GENERATORS) {
    const { enabled, path } = targetFor(generator, context);
    if (!enabled) continue;
    if (only.size > 0 && !only.has(generator.target)) continue;

    const absolute = resolve(cwd, path);
    const existing = await readIfExists(absolute);
    const result = generator.sync(designSystem, existing, generatorOptions);

    if (result.warning !== undefined) ui.warn(result.warning);

    if (result.outcome === 'unchanged') {
      ui.line(
        `   ${ui.paint(ui.sign('ok'), 'grey')} ${path.padEnd(16)} ${ui.paint('unchanged', 'grey')}`,
      );
      continue;
    }

    if (options.check === true) {
      wouldChange += 1;
      ui.line(
        `   ${ui.paint(ui.sign('warn'), 'yellow')} ${path.padEnd(16)} ${ui.paint(`would be ${result.outcome}`, 'yellow')}`,
      );
      continue;
    }

    await writeFileEnsuringDir(absolute, result.content);
    changed += 1;
    ui.line(
      `   ${ui.paint(ui.sign('ok'), 'green')} ${path.padEnd(16)} ${ui.paint(result.outcome, 'green')}`,
    );
  }

  for (const warning of resolved.warnings.slice(0, 5)) ui.warn(warning.message);
  if (resolved.warnings.length > 5) {
    ui.detail(`…and ${resolved.warnings.length - 5} more parser warnings.`);
  }

  const elapsed = formatDuration(performance.now() - started);
  ui.line();

  if (options.check === true) {
    if (wouldChange === 0) {
      ui.step('sparkle', `Context files are up to date.  ${ui.paint(elapsed, 'grey')}`);
      return EXIT.ok;
    }
    ui.fail(
      `${wouldChange} context ${wouldChange === 1 ? 'file is' : 'files are'} out of date. Run \`anchor sync\`.`,
    );
    return EXIT.violations;
  }

  ui.step(
    'sparkle',
    changed === 0
      ? `Already in sync.  ${ui.paint(elapsed, 'grey')}`
      : `Your agents now know this design system.  ${ui.paint(elapsed, 'grey')}`,
  );

  ui.privacyNote();
  return EXIT.ok;
}
