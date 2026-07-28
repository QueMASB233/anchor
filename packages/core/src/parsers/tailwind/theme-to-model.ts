/**
 * Maps a resolved Tailwind theme onto Anchor's normalized model.
 *
 * Shared by both the v3 (JS config) and v4 (CSS `@theme`) parsers: once either
 * has produced a plain theme object, everything downstream is identical.
 */

import {
  createColorSystem,
  createNamedTokens,
  createScaleTokens,
  createShadowSystem,
  createSpacingScale,
  createTypographySystem,
  type ColorTokenInput,
  type DesignTokens,
  type NamedTokenInput,
  type ScaleTokenInput,
  type ShadowTokenInput,
  type SpacingTokenInput,
  type TokenGroup,
} from '../../model/index.js';
import type { ParseWarning } from '../types.js';
import type { TailwindThemeValue } from './theme-types.js';

/** A theme entry flattened to a single name and a scalar value. */
export interface FlatToken {
  name: string;
  value: string;
  /** Dotted path in the original theme, for provenance. */
  path: string;
}

/**
 * Tailwind's `DEFAULT` key means "the class with no suffix" — `rounded` rather
 * than `rounded-DEFAULT`. Dropping the segment keeps generated docs and fix
 * suggestions using the class name a developer would actually type.
 */
const DEFAULT_KEY = 'DEFAULT';

/**
 * Explicit predicate: `Array.isArray` widens a `readonly T[]` branch to `any[]`,
 * which then propagates untyped values through the whole walk.
 */
function isThemeArray(value: TailwindThemeValue): value is readonly TailwindThemeValue[] {
  return Array.isArray(value);
}

/**
 * Flattens a nested theme group into `parent-child` names, matching how
 * Tailwind composes class names.
 *
 * Arrays are handled by shape rather than position: a `fontSize` entry is
 * `[size, { lineHeight }]`, a `fontFamily` entry is a list of family names.
 * The first element of a tuple is the value; a pure string list is joined.
 */
export function flattenThemeGroup(
  group: TailwindThemeValue,
  options: { file?: string; basePath: string } = { basePath: '' },
): { tokens: FlatToken[]; warnings: ParseWarning[] } {
  const tokens: FlatToken[] = [];
  const warnings: ParseWarning[] = [];

  const walk = (value: TailwindThemeValue, segments: string[], path: string): void => {
    if (typeof value === 'string' || typeof value === 'number') {
      tokens.push({ name: segments.join('-'), value: String(value), path });
      return;
    }

    if (isThemeArray(value)) {
      const flat = value.filter((v): v is string | number => typeof v !== 'object');

      // A font stack: every element is a family name, so join them.
      if (flat.length === value.length && value.length > 0) {
        tokens.push({ name: segments.join('-'), value: flat.join(', '), path });
        return;
      }

      // A `[size, { lineHeight }]` tuple: the first element carries the value.
      const [head] = value;
      if (typeof head === 'string' || typeof head === 'number') {
        tokens.push({ name: segments.join('-'), value: String(head), path });
        return;
      }

      warnings.push({
        code: 'unresolvable-value',
        message: `Anchor could not interpret the value at ${path}.`,
        ...(options.file === undefined ? {} : { file: options.file }),
        path,
      });
      return;
    }

    if (value === null || typeof value !== 'object') return;

    for (const [key, nested] of Object.entries(value)) {
      let nextSegments = key === DEFAULT_KEY ? segments : [...segments, key];

      // A DEFAULT nested under a parent collapses into it: `primary.DEFAULT`
      // is the `primary` token. A DEFAULT at the very top of a group has no
      // parent to collapse into (`borderRadius.DEFAULT` is the bare `rounded`
      // class), so it keeps its config key rather than being dropped.
      if (nextSegments.length === 0) nextSegments = [DEFAULT_KEY];

      walk(nested, nextSegments, path === '' ? key : `${path}.${key}`);
    }
  };

  walk(group, [], options.basePath);
  return { tokens, warnings };
}

/** Reads one group off a theme, returning an empty list when absent. */
function group(
  theme: Readonly<Record<string, TailwindThemeValue>>,
  key: string,
  file: string | undefined,
  warnings: ParseWarning[],
): FlatToken[] {
  const value = theme[key];
  if (value === undefined) return [];

  const result = flattenThemeGroup(value, {
    basePath: key,
    ...(file === undefined ? {} : { file }),
  });
  warnings.push(...result.warnings);
  return result.tokens;
}

/** Theme keys Anchor maps to first-class token groups. */
const MAPPED_KEYS = new Set([
  'spacing',
  'colors',
  'borderRadius',
  'boxShadow',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
]);

export interface ThemeToTokensOptions {
  file?: string;
  rootFontSize?: number;
  /** Include unmapped theme keys (zIndex, screens, opacity) under `custom`. */
  includeCustom?: boolean;
}

export interface ThemeToTokensResult {
  tokens: DesignTokens;
  warnings: ParseWarning[];
}

/** Converts a resolved Tailwind theme into the normalized token model. */
export function themeToTokens(
  theme: Readonly<Record<string, TailwindThemeValue>>,
  options: ThemeToTokensOptions = {},
): ThemeToTokensResult {
  const { file, rootFontSize, includeCustom = true } = options;
  const warnings: ParseWarning[] = [];

  const provenance = (token: FlatToken) =>
    file === undefined ? { path: token.path } : { file, path: token.path };

  const toSpacing = (token: FlatToken): SpacingTokenInput => ({
    name: token.name,
    value: token.value,
    provenance: provenance(token),
  });
  const toScale = (token: FlatToken): ScaleTokenInput => ({
    name: token.name,
    value: token.value,
    provenance: provenance(token),
  });
  const toNamed = (token: FlatToken): NamedTokenInput => ({
    name: token.name,
    value: token.value,
    provenance: provenance(token),
  });
  const toColor = (token: FlatToken): ColorTokenInput => ({
    name: token.name,
    value: token.value,
    provenance: provenance(token),
  });
  const toShadow = (token: FlatToken): ShadowTokenInput => ({
    name: token.name,
    value: token.value,
    provenance: provenance(token),
  });

  const scaleOptions = rootFontSize === undefined ? {} : { rootFontSize };

  const shadowTokens = group(theme, 'boxShadow', file, warnings);

  const custom: Record<string, TokenGroup> = {};
  if (includeCustom) {
    for (const key of Object.keys(theme)) {
      if (MAPPED_KEYS.has(key)) continue;
      const tokens = group(theme, key, file, warnings);
      if (tokens.length > 0) {
        custom[key] = createScaleTokens(tokens.map(toScale), scaleOptions);
      }
    }
  }

  const tokens: DesignTokens = {
    spacing: createSpacingScale(
      group(theme, 'spacing', file, warnings).map(toSpacing),
      scaleOptions,
    ),
    color: createColorSystem(group(theme, 'colors', file, warnings).map(toColor)),
    typography: createTypographySystem({
      fontFamilies: createNamedTokens(group(theme, 'fontFamily', file, warnings).map(toNamed)),
      fontSizes: createScaleTokens(
        group(theme, 'fontSize', file, warnings).map(toScale),
        scaleOptions,
      ),
      fontWeights: createNamedTokens(group(theme, 'fontWeight', file, warnings).map(toNamed)),
      lineHeights: createNamedTokens(group(theme, 'lineHeight', file, warnings).map(toNamed)),
      letterSpacings: createScaleTokens(
        group(theme, 'letterSpacing', file, warnings).map(toScale),
        scaleOptions,
      ),
    }),
    borderRadius: createScaleTokens(
      group(theme, 'borderRadius', file, warnings).map(toScale),
      scaleOptions,
    ),
    ...(shadowTokens.length === 0
      ? {}
      : { shadow: createShadowSystem(shadowTokens.map(toShadow)) }),
    ...(Object.keys(custom).length === 0 ? {} : { custom }),
  };

  return { tokens, warnings };
}
