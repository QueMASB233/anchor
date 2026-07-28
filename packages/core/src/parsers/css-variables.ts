/**
 * Plain CSS custom properties.
 *
 * The fallback format, and the one with the least structure to work from: a
 * bare `--brand-primary: #3b82f6` says nothing about which token group it
 * belongs to. Classification therefore leans entirely on naming conventions,
 * which is a heuristic — so the parser reports how many properties it could not
 * place rather than quietly filing them under "custom".
 *
 * shadcn/ui is handled specially because it is so widespread: it writes bare
 * HSL triplets (`--primary: 222.2 47.4% 11.2%`) intended to be wrapped in
 * `hsl(...)` at the point of use. Read literally those are not colours at all.
 */

import postcss, { type Declaration } from 'postcss';

import { createDesignSystem, normalizeColor } from '../model/index.js';
import { buildTokens, type ClassifiedToken } from './build-tokens.js';
import { classifyToken, type TokenGroupKind } from './token-tree.js';
import type { Parser, ParserContext, ParserInput, ParseResult, ParseWarning } from './types.js';

/** A bare HSL triplet as written by shadcn/ui: `222.2 47.4% 11.2%`. */
const BARE_HSL = /^-?\d+(?:\.\d+)?(?:deg)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%$/;

/** Selectors that conventionally declare design tokens. */
const TOKEN_SELECTORS = /^(:root|html|:host|\[data-theme[^\]]*\]|\.dark|\.light)$/;

/** Rewrites a shadcn-style bare triplet into a real colour value. */
export function normalizeBareHsl(value: string): string {
  return BARE_HSL.test(value.trim()) ? `hsl(${value.trim()})` : value;
}

/**
 * Guesses the token group from the property name, falling back to the value.
 *
 * The name is the stronger signal and is tried first: `--color-brand: var(--x)`
 * is a colour even though its value is opaque.
 *
 * The value-based fallback exists for shadcn/ui, whose most-used tokens are
 * single bare words — `--primary`, `--background`, `--border`, `--ring` — that
 * no naming convention can classify. Since a colour value is self-identifying,
 * recognizing one is more reliable than guessing from the name. Lengths get no
 * such fallback: `4px` could be spacing, radius or font size, and inventing an
 * answer would be worse than reporting that we could not tell.
 *
 * Returns `null` when neither signal is conclusive, which the caller turns into
 * a reported warning rather than a silent guess.
 */
export function classifyCssVariable(
  property: string,
  value = '',
): { group: TokenGroupKind; customGroup?: string } | null {
  const parts = property.replace(/^--/, '').split('-').filter(Boolean);
  if (parts.length === 0) return null;

  // Match against progressively shorter prefixes rather than single segments.
  // Splitting `--font-size-base` into words would let `size` match spacing
  // before `font-size` could match font size — the specific name must win.
  const prefixes = Array.from({ length: parts.length }, (_unused, index) =>
    parts.slice(0, parts.length - index).join('-'),
  );

  const group = classifyToken(prefixes, undefined);
  if (group !== 'custom') return { group };

  if (normalizeColor(normalizeBareHsl(value)) !== null) return { group: 'color' };

  // A recognizable prefix with no known meaning still forms a custom group.
  return parts.length > 1 ? { group: 'custom', customGroup: parts[0]! } : null;
}

export function parseCssVariables(
  inputs: readonly ParserInput[],
  context: ParserContext = {},
): ParseResult {
  const warnings: ParseWarning[] = [];
  const classified: ClassifiedToken[] = [];
  const sourceFiles: string[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    sourceFiles.push(input.path);

    let root;
    try {
      root = postcss.parse(input.content, { from: input.path });
    } catch (error) {
      warnings.push({
        code: 'parse-error',
        message: `Could not parse ${input.path}: ${error instanceof Error ? error.message : String(error)}`,
        file: input.path,
      });
      continue;
    }

    const declarations: Declaration[] = [];
    root.walkRules((rule) => {
      const selectors = rule.selectors.map((selector) => selector.trim());
      if (!selectors.some((selector) => TOKEN_SELECTORS.test(selector))) return;
      rule.walkDecls((declaration) => {
        if (declaration.prop.startsWith('--')) declarations.push(declaration);
      });
    });

    let unclassified = 0;

    for (const declaration of declarations) {
      const property = declaration.prop;
      const name = property.replace(/^--/, '');

      // Later declarations win, matching the cascade, but a token redefined in
      // a theme block should not appear twice in the model.
      if (seen.has(name)) {
        const index = classified.findIndex((token) => token.name === name);
        if (index !== -1) classified.splice(index, 1);
      }
      seen.add(name);

      const value = normalizeBareHsl(declaration.value.trim());

      const classification = classifyCssVariable(property, value);
      if (classification === null) {
        unclassified += 1;
        continue;
      }

      classified.push({
        name,
        value,
        group: classification.group,
        ...(classification.customGroup === undefined
          ? {}
          : { customGroup: classification.customGroup }),
        provenance: { file: input.path, path: property },
      });
    }

    if (unclassified > 0) {
      warnings.push({
        code: 'unsupported-construct',
        message: `${unclassified} custom ${unclassified === 1 ? 'property' : 'properties'} in ${input.path} could not be matched to a token group from ${unclassified === 1 ? 'its name' : 'their names'}. Rename them with a recognizable prefix (\`--color-\`, \`--spacing-\`, \`--radius-\`) or use a structured token format.`,
        file: input.path,
      });
    }

    if (declarations.length === 0) {
      warnings.push({
        code: 'unsupported-construct',
        message: `No custom properties found in ${input.path} under a token-declaring selector (\`:root\`, \`html\`, \`:host\`, \`[data-theme]\`).`,
        file: input.path,
      });
    }
  }

  return {
    designSystem: createDesignSystem({
      meta: {
        name: context.name ?? 'CSS design system',
        source: 'css-variables',
        sourceFiles,
      },
      tokens: buildTokens(classified, {
        ...(context.rootFontSize === undefined ? {} : { rootFontSize: context.rootFontSize }),
      }),
    }),
    warnings,
  };
}

export const cssVariablesParser: Parser = {
  format: 'css-variables',
  displayName: 'CSS custom properties',

  detect(input: ParserInput): number {
    if (!/\.(css|scss|less|pcss)$/i.test(input.path)) return 0;
    // Tailwind v4 owns any file with a @theme block.
    if (/@theme\b/.test(input.content)) return 0;
    // Not anchored to the line start: `:root { --a: 1px; }` on one line is
    // perfectly ordinary CSS. The file extension check above is what keeps
    // this from matching unrelated text.
    if (/--[\w-]+\s*:/.test(input.content)) return 0.6;
    return 0;
  },

  parse: parseCssVariables,
};
