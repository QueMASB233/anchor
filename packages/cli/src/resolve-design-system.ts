/**
 * Turning a repository into a design system.
 *
 * Shared by `sync` and `lint`, and the single place that decides where tokens
 * come from, how components are discovered, and what the config overrides.
 *
 * Precedence is fixed and documented: config wins over anything Anchor
 * inferred. A team that has written something down means it.
 */

import { join, resolve } from 'node:path';

import {
  createDesignSystem,
  extractCvaComponents,
  mergeComponentInventories,
  parseAuto,
  parseDesignSystem,
  parseSourceFile,
  UnknownFormatError,
  type ComponentInventory,
  type DesignSystem,
  type ParserInput,
  type ParseWarning,
} from '@eleva/anchor-core';

import { DEFAULT_TOKEN_GLOBS, toArray, type AnchorConfig } from './config.js';
import {
  findFiles,
  hashInputs,
  readCache,
  readFiles,
  writeCache,
  type SourceInput,
} from './workspace.js';

export interface ResolveOptions {
  cwd: string;
  config: AnchorConfig;
  /** Version of Anchor, mixed into the cache key. */
  version: string;
  /** Skip the cache entirely. */
  noCache?: boolean;
}

export interface ResolvedDesignSystem {
  designSystem: DesignSystem;
  warnings: ParseWarning[];
  /** Token files the system was parsed from, relative to the project root. */
  sourceFiles: string[];
  /** Components discovered by static CVA extraction. */
  extractedComponents: number;
  /** Component source files scanned for variant definitions. */
  componentFilesScanned: number;
  /** True when the result came from `.anchor/cache.json`. */
  fromCache: boolean;
}

/** Raised when there is nothing to parse, with guidance rather than a stack trace. */
export class NoDesignSystemError extends Error {
  override readonly name = 'NoDesignSystemError';

  constructor(searched: readonly string[]) {
    super(
      `Anchor could not find a design system.\n\nLooked in: ${searched.join(', ')}\n\n` +
        'Point Anchor at your tokens with `tokens` in anchor.config, or run `anchor init` to set one up.',
    );
  }
}

/** Finds candidate token files, using config when present and conventions otherwise. */
async function findTokenFiles(cwd: string, config: AnchorConfig): Promise<string[]> {
  const configured = toArray(config.tokens);
  if (configured.length > 0) return findFiles(cwd, configured);

  // The zero-config path. Conventional locations only, so a stray JSON file
  // deep in the repo is never mistaken for a design system.
  return findFiles(cwd, DEFAULT_TOKEN_GLOBS);
}

/** Statically extracts component variants from the team's own source. */
async function extractComponents(
  cwd: string,
  config: AnchorConfig,
): Promise<{ inventory: ComponentInventory; fileCount: number }> {
  const patterns = toArray(config.components);
  if (patterns.length === 0) return { inventory: {}, fileCount: 0 };

  const paths = await findFiles(cwd, patterns);
  const sources = await readFiles(cwd, paths);

  let inventory: ComponentInventory = {};
  for (const source of sources) {
    const { file } = parseSourceFile(source.path, source.content);
    if (file === null) continue;
    inventory = mergeComponentInventories(inventory, extractCvaComponents(file));
  }

  return { inventory, fileCount: sources.length };
}

/**
 * Builds the design system for a project.
 *
 * Results are cached under `.anchor/`, keyed by a content hash of the token
 * files, the config and the Anchor version — so a version bump or a config edit
 * invalidates it, and a branch switch that does not change tokens does not.
 */
export async function resolveDesignSystem(options: ResolveOptions): Promise<ResolvedDesignSystem> {
  const { cwd, config, version } = options;

  const tokenPaths = await findTokenFiles(cwd, config);
  const tokenSources = await readFiles(cwd, tokenPaths);

  if (tokenSources.length === 0) {
    throw new NoDesignSystemError(
      toArray(config.tokens).length > 0 ? toArray(config.tokens) : [...DEFAULT_TOKEN_GLOBS],
    );
  }

  const cacheDir = resolve(cwd, config.cacheDir ?? '.anchor');
  const cacheKey = hashInputs(tokenSources, [version, JSON.stringify(config)]);

  if (options.noCache !== true) {
    const cached = await readCache(cacheDir, cacheKey);
    if (cached !== null) {
      try {
        return {
          designSystem: parseDesignSystem(cached, 'Cached design system'),
          warnings: [],
          sourceFiles: tokenSources.map((source) => source.path),
          extractedComponents: 0,
          componentFilesScanned: 0,
          fromCache: true,
        };
      } catch {
        // A cache written by an incompatible version is a miss, not a failure.
      }
    }
  }

  const parserInputs: ParserInput[] = tokenSources.map((source: SourceInput) => ({
    path: source.path,
    content: source.content,
  }));

  let parsed;
  try {
    parsed = parseAuto(parserInputs, {
      ...(config.name === undefined ? {} : { name: config.name }),
      ...(config.rootFontSize === undefined ? {} : { rootFontSize: config.rootFontSize }),
    });
  } catch (error) {
    if (error instanceof UnknownFormatError) {
      throw new NoDesignSystemError(tokenSources.map((source) => source.path));
    }
    throw error;
  }

  const { inventory: extracted, fileCount: componentFilesScanned } = await extractComponents(
    cwd,
    config,
  );

  // Config always wins: an explicit declaration outranks an inference.
  const components = mergeComponentInventories(extracted, config.designSystem?.components ?? {});

  const designSystem = createDesignSystem({
    meta: {
      name: config.name ?? parsed.designSystem.meta.name,
      source: parsed.designSystem.meta.source,
      ...(parsed.designSystem.meta.version === undefined
        ? {}
        : { version: parsed.designSystem.meta.version }),
      sourceFiles: tokenSources.map((source) => source.path),
    },
    tokens: parsed.designSystem.tokens,
    ...(Object.keys(components).length === 0 ? {} : { components }),
    ...(config.designSystem?.compositionRules === undefined
      ? {}
      : { compositionRules: config.designSystem.compositionRules }),
    ...(config.designSystem?.antiPatterns === undefined
      ? {}
      : { antiPatterns: config.designSystem.antiPatterns }),
  });

  if (options.noCache !== true) {
    await writeCache(cacheDir, cacheKey, designSystem);
  }

  return {
    designSystem,
    warnings: parsed.warnings,
    sourceFiles: tokenSources.map((source) => source.path),
    extractedComponents: Object.keys(extracted).length,
    componentFilesScanned,
    fromCache: false,
  };
}

/** Path of the cache directory, for `--no-cache` messaging and cleanup. */
export function cacheDirFor(cwd: string, config: AnchorConfig): string {
  return join(cwd, config.cacheDir ?? '.anchor');
}
