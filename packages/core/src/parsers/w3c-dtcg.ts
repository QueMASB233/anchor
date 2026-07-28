/**
 * W3C Design Token Community Group format.
 *
 * Leaves carry `$value` and `$type`; groups may declare a `$type` that their
 * children inherit. Aliases are `{group.token}` with no trailing `.value`.
 *
 * Composite values (shadow, typography, border) arrive as objects rather than
 * strings. Shadows are flattened into CSS shorthand so they can be compared
 * against what a developer actually writes in a class name.
 */

import { createDesignSystem } from '../model/index.js';
import { buildTokens, type ClassifiedToken } from './build-tokens.js';
import { classifyToken, resolveAliases, walkTokenTree, type TokenLeaf } from './token-tree.js';
import type { Parser, ParserContext, ParserInput, ParseResult, ParseWarning } from './types.js';

const VALUE_KEYS = ['$value'] as const;
const TYPE_KEYS = ['$type'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value that can be rendered into CSS without stringifying an object. */
function isScalar(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

/** Renders a DTCG composite shadow as CSS shorthand. */
function shadowToCss(value: Record<string, unknown>): string | null {
  const parts = ['offsetX', 'offsetY', 'blur', 'spread']
    .map((key) => value[key])
    .filter(isScalar)
    .map((part) => String(part));

  const color = value['color'];
  if (parts.length === 0 || typeof color !== 'string') return null;

  const inset = value['inset'] === true ? 'inset ' : '';
  return `${inset}${parts.join(' ')} ${color}`;
}

/** Reduces a DTCG value — scalar, dimension object, or composite — to a string. */
function flattenValue(leaf: TokenLeaf): string | null {
  const { rawValue } = leaf;

  if (typeof rawValue === 'string' || typeof rawValue === 'number') return String(rawValue);

  if (Array.isArray(rawValue)) {
    // A multi-layer shadow, or a font family stack.
    const rendered = (rawValue as unknown[])
      .map((entry) =>
        isRecord(entry) ? shadowToCss(entry) : isScalar(entry) ? String(entry) : null,
      )
      .filter((entry): entry is string => entry !== null);
    return rendered.length === 0 ? null : rendered.join(', ');
  }

  if (isRecord(rawValue)) {
    // A dimension object: { value: 4, unit: 'px' }.
    const dimension = rawValue['value'];
    const unit = rawValue['unit'];
    if (isScalar(dimension) && typeof unit === 'string') {
      return `${dimension}${unit}`;
    }
    if ('offsetX' in rawValue || 'blur' in rawValue) return shadowToCss(rawValue);
    // A composite typography token has no single scalar form.
    return null;
  }

  return null;
}

export function parseW3cDtcg(
  inputs: readonly ParserInput[],
  context: ParserContext = {},
): ParseResult {
  const warnings: ParseWarning[] = [];
  const classified: ClassifiedToken[] = [];
  const sourceFiles: string[] = [];

  for (const input of inputs) {
    sourceFiles.push(input.path);

    let json: unknown;
    try {
      json = JSON.parse(input.content);
    } catch (error) {
      warnings.push({
        code: 'parse-error',
        message: `Could not parse ${input.path} as JSON: ${error instanceof Error ? error.message : String(error)}`,
        file: input.path,
      });
      continue;
    }

    const { leaves, warnings: walkWarnings } = walkTokenTree(json, {
      valueKeys: VALUE_KEYS,
      typeKeys: TYPE_KEYS,
      file: input.path,
    });
    warnings.push(...walkWarnings);

    const {
      values,
      references,
      warnings: aliasWarnings,
    } = resolveAliases(leaves, {
      file: input.path,
    });
    warnings.push(...aliasWarnings);

    for (const leaf of leaves) {
      const value = values.get(leaf.name) ?? flattenValue(leaf);
      if (value === null || value === undefined) {
        warnings.push({
          code: 'unresolvable-value',
          message: `Token \`${leaf.name}\` in ${input.path} is a composite Anchor cannot reduce to a single value. It is documented but not enforced.`,
          file: input.path,
          path: leaf.path.join('.'),
        });
        continue;
      }

      const group = classifyToken(leaf.path, leaf.type);
      classified.push({
        name: leaf.name,
        value,
        group,
        ...(group === 'custom' ? { customGroup: leaf.type ?? leaf.path[0] ?? 'other' } : {}),
        ...(references.has(leaf.name) ? { reference: references.get(leaf.name)! } : {}),
        ...(leaf.description === undefined ? {} : { description: leaf.description }),
        ...(leaf.deprecated === undefined ? {} : { deprecated: leaf.deprecated }),
        provenance: { file: input.path, path: leaf.path.join('.') },
      });
    }
  }

  return {
    designSystem: createDesignSystem({
      meta: {
        name: context.name ?? 'Design tokens',
        source: 'w3c-dtcg',
        sourceFiles,
      },
      tokens: buildTokens(classified, {
        ...(context.rootFontSize === undefined ? {} : { rootFontSize: context.rootFontSize }),
      }),
    }),
    warnings,
  };
}

export const w3cDtcgParser: Parser = {
  format: 'w3c-dtcg',
  displayName: 'W3C Design Tokens',

  detect(input: ParserInput): number {
    if (!/\.(json|tokens)$/i.test(input.path)) return 0;
    if (/"\$value"\s*:/.test(input.content)) return 1;
    if (/"\$type"\s*:/.test(input.content)) return 0.8;
    return 0;
  },

  parse: parseW3cDtcg,
};
