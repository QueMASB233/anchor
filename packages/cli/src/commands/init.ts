/**
 * `anchor init` — detect the design system and write a starter config.
 *
 * This is the first thing anyone runs, so it has one job beyond writing a file:
 * prove within a few seconds that Anchor already understands their codebase.
 * It therefore reports what it actually found — the format, the token counts,
 * the inferred base unit — rather than a generic success message.
 */

import { resolve } from 'node:path';

import { countTokens, detectFormat, type ParserInput } from '@eleva/anchor-core';

import { DEFAULT_INCLUDE, DEFAULT_TOKEN_GLOBS } from '../config.js';
import type { CommandContext } from './context.js';
import { findFiles, readFiles, readIfExists, writeFileEnsuringDir } from '../workspace.js';
import { formatCount } from '../ui.js';
import { resolveDesignSystem } from '../resolve-design-system.js';

export interface InitOptions {
  force?: boolean;
}

const CONFIG_FILENAME = 'anchor.config.json';

export async function runInit(context: CommandContext, options: InitOptions = {}): Promise<number> {
  const { ui, cwd, version } = context;
  ui.banner('init');

  const configPath = resolve(cwd, CONFIG_FILENAME);
  const existing = await readIfExists(configPath);

  if (existing !== null && options.force !== true) {
    ui.warn(`${CONFIG_FILENAME} already exists.`);
    ui.detail('Run with --force to overwrite it, or edit it directly.');
    return 1;
  }

  ui.step('search', 'Looking for your design system…');
  ui.line();

  const tokenPaths = await findFiles(cwd, DEFAULT_TOKEN_GLOBS);
  const tokenSources = await readFiles(cwd, tokenPaths);

  if (tokenSources.length === 0) {
    ui.fail('No design system found.');
    ui.stderr('');
    ui.stderr('  Anchor looked for a Tailwind config, a CSS file with custom properties,');
    ui.stderr('  and common token file locations, and found none of them.');
    ui.stderr('');
    ui.stderr('  Create anchor.config.json with a `tokens` glob pointing at your tokens.');
    return 1;
  }

  const parserInputs: ParserInput[] = tokenSources.map((source) => ({
    path: source.path,
    content: source.content,
  }));
  const detection = detectFormat(parserInputs);

  if (detection.parser === null) {
    ui.fail(`Found ${tokenSources.length} candidate files, but none in a format Anchor reads.`);
    ui.stderr('');
    for (const source of tokenSources.slice(0, 5)) ui.stderr(`     ${source.path}`);
    return 1;
  }

  const claimed = detection.candidates[0]?.files ?? [];
  ui.ok(
    `${ui.paint(detection.parser.displayName, 'bold')}  ${ui.paint(ui.sign('bullet'), 'grey')}  ${claimed
      .slice(0, 3)
      .map((file) => file.path)
      .join(', ')}`,
  );

  if (detection.candidates.length > 1) {
    const runnerUp = detection.candidates[1];
    ui.detail(`Also saw ${runnerUp?.displayName}; using the more specific match.`);
  }

  // Discover components before writing the config, so the generated `components`
  // glob is one we have verified actually finds something.
  const componentGlobs = ['src/**/*.{tsx,jsx}', 'app/**/*.{tsx,jsx}', 'components/**/*.{tsx,jsx}'];
  const componentPaths = await findFiles(cwd, componentGlobs);

  const resolved = await resolveDesignSystem({
    cwd,
    config: componentPaths.length > 0 ? { components: componentGlobs } : {},
    version,
    noCache: true,
  });

  const { designSystem } = resolved;
  const { spacing } = designSystem.tokens;

  ui.ok(
    `${formatCount(countTokens(designSystem))} tokens  ${ui.paint(ui.sign('bullet'), 'grey')}  ` +
      `${formatCount(designSystem.tokens.color.tokens.length)} colours, ` +
      `${formatCount(spacing.tokens.length)} spacing steps`,
  );

  if (spacing.baseUnit !== null) {
    const confidence = spacing.confidence === 'high' ? '' : ` (${spacing.confidence} confidence)`;
    ui.ok(`${spacing.baseUnit}px base unit, inferred from your scale${confidence}`);
  }

  if (resolved.extractedComponents > 0) {
    ui.ok(
      `${formatCount(resolved.extractedComponents)} components with variants, read from your source`,
    );
  }

  for (const warning of resolved.warnings.slice(0, 3)) {
    ui.warn(warning.message);
  }
  if (resolved.warnings.length > 3) {
    ui.detail(
      `…and ${resolved.warnings.length - 3} more warnings. Run \`anchor sync\` to see them.`,
    );
  }

  const config = {
    $schema: 'https://anchor.elevabuilds.com/schema.json',
    tokens: claimed.map((file) => file.path),
    ...(componentPaths.length > 0 ? { components: componentGlobs } : {}),
    include: [...DEFAULT_INCLUDE],
  };

  await writeFileEnsuringDir(configPath, `${JSON.stringify(config, null, 2)}\n`);

  ui.line();
  ui.step('write', `Wrote ${ui.paint(CONFIG_FILENAME, 'bold')}`);

  ui.nextSteps([
    { command: 'anchor sync', description: 'teach your AI agents this design system' },
    { command: 'anchor lint', description: 'check your components against it' },
  ]);

  ui.privacyNote();
  return 0;
}
