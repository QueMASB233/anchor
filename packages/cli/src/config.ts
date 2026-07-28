/**
 * Configuration loading and validation.
 *
 * cosmiconfig finds `anchor.config.{js,ts,mjs,cjs,json}`, `.anchorrc*`, or a
 * `anchor` key in package.json. Whatever it finds is validated with zod before
 * anything reads it, so a typo produces one clear message instead of a
 * confusing failure three layers down.
 *
 * SECURITY: in the GitHub Action this config comes from the pull request being
 * linted, so it is untrusted input. That is why anti-pattern matchers are
 * declarative data (see the core model) and why `tailwind.resolveConfig` is
 * ignored outright when running inside the Action.
 */

import { cosmiconfig, type CosmiconfigResult } from 'cosmiconfig';
import {
  AntiPatternSchema,
  ComponentDefinitionSchema,
  CompositionRuleSchema,
  RULE_IDS,
  SeveritySchema,
  z,
} from './zod-shim.js';

/** Per-rule configuration: a bare severity, or severity plus options. */
const RuleConfigSchema = z.union([
  SeveritySchema,
  z.strictObject({
    severity: SeveritySchema.optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const GeneratorTargetSchema = z.union([
  z.boolean(),
  z.string().min(1), // an explicit output path
]);

export const AnchorConfigSchema = z.strictObject({
  /**
   * JSON Schema reference. Ignored by Anchor, but editors use it for
   * autocomplete and `anchor init` writes it, so the schema must accept it —
   * otherwise init would produce a config that every other command rejects.
   */
  $schema: z.string().optional(),

  /** Display name for the design system. Defaults to the package name. */
  name: z.string().min(1).optional(),

  /**
   * Token sources. Globs relative to the project root. When omitted, Anchor
   * looks in the conventional places and auto-detects the format.
   */
  tokens: z.union([z.string(), z.array(z.string())]).optional(),

  /** Component sources to extract CVA variants from. */
  components: z.union([z.string(), z.array(z.string())]).optional(),

  /** Files to lint. */
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),

  /** Rule severities and options, keyed by rule id. */
  rules: z.record(z.string(), RuleConfigSchema).optional(),

  /** Functions whose string arguments should be treated as class names. */
  classHelpers: z.array(z.string().min(1)).optional(),

  /** Root font size used to resolve `rem` values. */
  rootFontSize: z.number().positive().optional(),

  /** Which context files `anchor sync` writes. */
  generators: z
    .strictObject({
      claudeMd: GeneratorTargetSchema.optional(),
      cursorrules: GeneratorTargetSchema.optional(),
      agentsMd: GeneratorTargetSchema.optional(),
      /** Appended verbatim to every generated file. */
      extraInstructions: z.string().optional(),
      /** Cap on tokens listed per group before summarizing. */
      maxTokensPerGroup: z.number().int().positive().optional(),
    })
    .optional(),

  tailwind: z
    .strictObject({
      /**
       * Load `tailwind.config.js` in a sandboxed child process for full
       * accuracy. OFF by default and IGNORED inside the GitHub Action, where
       * the config is attacker-controlled. See SECURITY.md.
       */
      resolveConfig: z.boolean().optional(),
    })
    .optional(),

  /** Design system facts no token file can carry. */
  designSystem: z
    .strictObject({
      components: z.record(z.string(), ComponentDefinitionSchema).optional(),
      compositionRules: z.array(CompositionRuleSchema).optional(),
      antiPatterns: z.array(AntiPatternSchema).optional(),
    })
    .optional(),

  /** Where the token cache lives, relative to the project root. */
  cacheDir: z.string().optional(),

  /** Optional Ed25519 license key for the private tier. Verified offline. */
  license: z.string().optional(),
});

export type AnchorConfig = z.infer<typeof AnchorConfigSchema>;

export interface LoadedConfig {
  config: AnchorConfig;
  /** Absolute path of the file it came from, or `null` when using defaults. */
  filepath: string | null;
}

/** Thrown when a config file exists but does not validate. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';

  constructor(
    message: string,
    readonly filepath: string | null,
  ) {
    super(message);
  }
}

const MODULE_NAME = 'anchor';

/** Everything cosmiconfig should look for, most specific first. */
const SEARCH_PLACES = [
  'package.json',
  '.anchorrc',
  '.anchorrc.json',
  '.anchorrc.yaml',
  '.anchorrc.yml',
  '.anchorrc.js',
  '.anchorrc.cjs',
  '.anchorrc.mjs',
  'anchor.config.json',
  'anchor.config.js',
  'anchor.config.cjs',
  'anchor.config.mjs',
  'anchor.config.ts',
];

/**
 * Validates a raw config object.
 *
 * Unknown rule ids are rejected rather than ignored: silently dropping a
 * misspelled rule name means a team believes a rule is enforced when it is not.
 */
export function validateConfig(raw: unknown, filepath: string | null): AnchorConfig {
  const result = AnchorConfigSchema.safeParse(raw);

  if (!result.success) {
    throw new ConfigError(
      `Invalid Anchor configuration${filepath === null ? '' : ` in ${filepath}`}:\n${z.prettifyError(result.error)}`,
      filepath,
    );
  }

  const unknownRules = Object.keys(result.data.rules ?? {}).filter((id) => !RULE_IDS.includes(id));

  if (unknownRules.length > 0) {
    throw new ConfigError(
      `Unknown rule${unknownRules.length === 1 ? '' : 's'} in configuration: ${unknownRules
        .map((id) => `\`${id}\``)
        .join(', ')}.\nAvailable rules: ${RULE_IDS.join(', ')}.`,
      filepath,
    );
  }

  return result.data;
}

/**
 * Finds and validates the configuration.
 *
 * A missing config is not an error — the zero-config path is a feature, so
 * Anchor falls back to defaults and auto-detection.
 */
export async function loadConfig(cwd: string): Promise<LoadedConfig> {
  const explorer = cosmiconfig(MODULE_NAME, { searchPlaces: SEARCH_PLACES });

  let found: CosmiconfigResult;
  try {
    found = await explorer.search(cwd);
  } catch (error) {
    throw new ConfigError(
      `Could not read the Anchor configuration: ${error instanceof Error ? error.message : String(error)}`,
      null,
    );
  }

  if (found === null || found.isEmpty === true) {
    return { config: {}, filepath: null };
  }

  return {
    config: validateConfig(found.config, found.filepath),
    filepath: found.filepath,
  };
}

/** Normalizes a string-or-array field into an array. */
export function toArray(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : [...value];
}

/** Default globs for finding token sources when the config does not say. */
export const DEFAULT_TOKEN_GLOBS: readonly string[] = [
  'tailwind.config.{js,cjs,mjs,ts}',
  'src/**/*.css',
  'app/**/*.css',
  'styles/**/*.css',
  'tokens/**/*.json',
  'tokens.json',
  'design-tokens.json',
  '**/*.tokens.json',
];

/** Default globs for the files `anchor lint` checks. */
export const DEFAULT_INCLUDE: readonly string[] = ['src/**/*.{tsx,jsx}', 'app/**/*.{tsx,jsx}'];

/** Always excluded, regardless of config. Scanning these is never useful. */
export const ALWAYS_EXCLUDE: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/*.d.ts',
];
