/**
 * Tailwind v3 — `tailwind.config.{js,ts,cjs,mjs}`.
 *
 * The config is read statically; it is never imported or executed. See
 * static-eval.ts for what that costs and SECURITY.md for why.
 *
 * The subtlety here is Tailwind's own merge semantics, which have to be
 * reproduced faithfully or the resulting scale is wrong in a way that produces
 * confident false positives:
 *
 *   theme.spacing        replaces Tailwind's default spacing outright
 *   theme.extend.spacing merges into whatever spacing resolved to
 *
 * Getting this backwards would make `p-4` look off-scale in a project where it
 * is entirely ordinary, which is worse than not linting at all.
 */

import { createDesignSystem, type DesignSystem } from '../../model/index.js';
import { evaluateConfigModule, isResolved, type StaticValue } from '../static-eval.js';
import type { ParserContext, ParserInput, ParseResult, ParseWarning } from '../types.js';
import { TAILWIND_DEFAULT_THEME } from './default-theme.generated.js';
import type { TailwindThemeValue } from './theme-types.js';
import { themeToTokens } from './theme-to-model.js';

type PlainObject = Record<string, StaticValue>;

function isPlainObject(value: StaticValue | undefined): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively merges `extension` into `base`, matching how `theme.extend`
 * behaves for nested groups such as `colors.blue.500`.
 */
type ThemeObject = { readonly [key: string]: TailwindThemeValue };

/**
 * Explicit predicate rather than an inline `Array.isArray` check: TypeScript
 * does not narrow a `readonly T[]` branch out of a union in the negative case.
 */
function isThemeObject(value: TailwindThemeValue): value is ThemeObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: TailwindThemeValue, extension: TailwindThemeValue): TailwindThemeValue {
  if (!isThemeObject(base) || !isThemeObject(extension)) {
    return extension;
  }

  const merged: Record<string, TailwindThemeValue> = { ...base };
  for (const [key, value] of Object.entries(extension)) {
    const existing = merged[key];
    merged[key] = existing === undefined ? value : deepMerge(existing, value);
  }
  return merged;
}

/**
 * Applies Tailwind's theme resolution over the bundled defaults.
 *
 * @param includeDefaults set false to see only what the team declared.
 */
export function resolveTailwindTheme(
  theme: PlainObject,
  includeDefaults = true,
): Record<string, TailwindThemeValue> {
  const resolved: Record<string, TailwindThemeValue> = includeDefaults
    ? { ...TAILWIND_DEFAULT_THEME }
    : {};

  // A top-level key replaces the default group entirely.
  for (const [key, value] of Object.entries(theme)) {
    if (key === 'extend') continue;
    resolved[key] = value as TailwindThemeValue;
  }

  // `extend` merges into whatever the previous step left behind.
  const extend = theme['extend'];
  if (isPlainObject(extend)) {
    for (const [key, value] of Object.entries(extend)) {
      const existing = resolved[key];
      resolved[key] =
        existing === undefined
          ? (value as TailwindThemeValue)
          : deepMerge(existing, value as TailwindThemeValue);
    }
  }

  return resolved;
}

export interface ParseTailwindV3Options extends ParserContext {
  /** Merge over Tailwind's bundled defaults. Almost always what you want. */
  includeDefaults?: boolean;
}

export function parseTailwindV3(
  input: ParserInput,
  options: ParseTailwindV3Options = {},
): ParseResult {
  const warnings: ParseWarning[] = [];
  const { value, warnings: evalWarnings } = evaluateConfigModule(input.content, input.path);
  warnings.push(...evalWarnings);

  const config = isResolved(value) && isPlainObject(value) ? value : {};

  if (isResolved(value) && !isPlainObject(value)) {
    warnings.push({
      code: 'unsupported-construct',
      message: `The default export of ${input.path} is not an object literal, so no theme could be read.`,
      file: input.path,
    });
  }

  // Presets are separate modules; following them would mean reading and
  // resolving arbitrary files, which this layer deliberately cannot do.
  if (config['presets'] !== undefined) {
    warnings.push({
      code: 'unsupported-construct',
      message: `${input.path} uses \`presets\`, which Anchor does not follow because doing so would require executing the config. Tokens defined only in a preset are missing. Declare them in this config, or point Anchor at your token files directly.`,
      file: input.path,
      path: 'presets',
    });
  }

  const rawTheme = config['theme'];
  if (rawTheme !== undefined && !isPlainObject(rawTheme)) {
    warnings.push({
      code: 'unresolvable-expression',
      message: `\`theme\` in ${input.path} is not an object literal, so Anchor fell back to Tailwind's defaults.`,
      file: input.path,
      path: 'theme',
    });
  }

  const theme = isPlainObject(rawTheme) ? rawTheme : {};
  const resolved = resolveTailwindTheme(theme, options.includeDefaults ?? true);

  const { tokens, warnings: tokenWarnings } = themeToTokens(resolved, {
    file: input.path,
    ...(options.rootFontSize === undefined ? {} : { rootFontSize: options.rootFontSize }),
  });
  warnings.push(...tokenWarnings);

  const designSystem: DesignSystem = createDesignSystem({
    meta: {
      name: options.name ?? 'Tailwind design system',
      source: 'tailwind',
      sourceFiles: [input.path],
    },
    tokens,
  });

  return { designSystem, warnings };
}
