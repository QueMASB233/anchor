/**
 * Style Dictionary token files.
 *
 * The v3 convention: leaves carry `value`, optionally `type`/`category`, and
 * aliases are written `{group.token.value}` — note the trailing `.value`, which
 * is what distinguishes this from the DTCG syntax.
 */

import { createDesignSystem } from '../model/index.js';
import { buildTokens, type ClassifiedToken } from './build-tokens.js';
import { classifyToken, resolveAliases, walkTokenTree } from './token-tree.js';
import type { Parser, ParserContext, ParserInput, ParseResult, ParseWarning } from './types.js';

const VALUE_KEYS = ['value', '$value'] as const;
const TYPE_KEYS = ['type', '$type', 'category'] as const;

export function parseStyleDictionary(
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
      // `$`-prefixed keys are DTCG metadata; Style Dictionary uses bare keys,
      // so nothing else is reserved here.
      reservedPrefixes: ['$'],
    });
    warnings.push(...walkWarnings);

    const {
      values,
      references,
      warnings: aliasWarnings,
    } = resolveAliases(leaves, {
      stripSuffix: '.value',
      file: input.path,
    });
    warnings.push(...aliasWarnings);

    for (const leaf of leaves) {
      const value = values.get(leaf.name);
      if (value === undefined) {
        warnings.push({
          code: 'unresolvable-value',
          message: `Token \`${leaf.name}\` in ${input.path} has a value Anchor could not reduce to a string.`,
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
        ...(group === 'custom' ? { customGroup: leaf.path[0] ?? 'other' } : {}),
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
        name: context.name ?? 'Style Dictionary design system',
        source: 'style-dictionary',
        sourceFiles,
      },
      tokens: buildTokens(classified, {
        ...(context.rootFontSize === undefined ? {} : { rootFontSize: context.rootFontSize }),
      }),
    }),
    warnings,
  };
}

export const styleDictionaryParser: Parser = {
  format: 'style-dictionary',
  displayName: 'Style Dictionary',

  detect(input: ParserInput): number {
    if (!/\.json$/i.test(input.path)) return 0;
    // A `.value` inside an alias is the unambiguous Style Dictionary signal.
    if (/\{[^{}]+\.value\}/.test(input.content)) return 1;
    if (/"\$value"\s*:/.test(input.content)) return 0; // DTCG owns this
    if (/"value"\s*:/.test(input.content)) return 0.7;
    return 0;
  },

  parse: parseStyleDictionary,
};
