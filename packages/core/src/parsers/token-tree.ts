/**
 * Shared machinery for JSON token trees.
 *
 * Style Dictionary and the W3C Design Token Community Group format are the same
 * idea with different spellings: a nested tree whose leaves are objects holding
 * a value, a type, and some metadata. The differences are the key names (`value`
 * vs `$value`) and the alias syntax, so the traversal, alias resolution and
 * group classification live here once.
 */

import type { ParseWarning } from './types.js';

/** A resolved leaf of a token tree. */
export interface TokenLeaf {
  /** Path segments from the root, e.g. `['color', 'brand', 'primary']`. */
  path: string[];
  /** Flattened name joined with `-`, matching how these are usually consumed. */
  name: string;
  /** Raw value, before alias resolution. */
  rawValue: unknown;
  /** Declared or inherited type, e.g. `color`, `dimension`. */
  type: string | undefined;
  description: string | undefined;
  deprecated: boolean | undefined;
}

export interface WalkOptions {
  /** Keys that mark a node as a leaf, in priority order. */
  valueKeys: readonly string[];
  /** Keys that carry a type, in priority order. */
  typeKeys: readonly string[];
  /** Keys that carry a description, in priority order. */
  descriptionKeys?: readonly string[];
  /** Keys treated as metadata rather than child tokens. */
  reservedPrefixes?: readonly string[];
  file?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstDefined(node: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in node) return node[key];
  }
  return undefined;
}

/**
 * Flattens a token tree into leaves, inheriting `type` from ancestor groups as
 * both formats specify.
 */
export function walkTokenTree(
  root: unknown,
  options: WalkOptions,
): { leaves: TokenLeaf[]; warnings: ParseWarning[] } {
  const leaves: TokenLeaf[] = [];
  const warnings: ParseWarning[] = [];
  const {
    valueKeys,
    typeKeys,
    descriptionKeys = ['description', '$description', 'comment'],
    reservedPrefixes = ['$'],
  } = options;

  if (!isRecord(root)) {
    return {
      leaves,
      warnings: [
        {
          code: 'parse-error',
          message: 'Expected the token file to contain a JSON object at its root.',
          ...(options.file === undefined ? {} : { file: options.file }),
        },
      ],
    };
  }

  const isReserved = (key: string): boolean =>
    reservedPrefixes.some((prefix) => key.startsWith(prefix)) ||
    valueKeys.includes(key) ||
    typeKeys.includes(key) ||
    descriptionKeys.includes(key);

  const walk = (node: unknown, path: string[], inheritedType: string | undefined): void => {
    if (!isRecord(node)) return;

    const declaredType = firstDefined(node, typeKeys);
    const type = typeof declaredType === 'string' ? declaredType : inheritedType;

    const value = firstDefined(node, valueKeys);
    if (value !== undefined) {
      const description = firstDefined(node, descriptionKeys);
      const deprecated = node['deprecated'] ?? node['$deprecated'];

      leaves.push({
        path: [...path],
        name: path.join('-'),
        rawValue: value,
        type,
        description: typeof description === 'string' ? description : undefined,
        deprecated: typeof deprecated === 'boolean' ? deprecated : undefined,
      });
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      if (isReserved(key)) continue;
      walk(child, [...path, key], type);
    }
  };

  walk(root, [], undefined);
  return { leaves, warnings };
}

/** Matches `{a.b.c}` references used by both formats. */
const ALIAS_PATTERN = /^\{([^{}]+)\}$/;

export interface ResolveAliasOptions {
  /** Trailing segment to strip, e.g. Style Dictionary's `.value`. */
  stripSuffix?: string;
  file?: string;
  /** Guards against alias cycles. */
  maxDepth?: number;
}

/**
 * Resolves `{group.token}` references against the flattened leaves.
 *
 * Chains are followed, cycles terminate, and a dangling reference produces a
 * warning and leaves the raw text in place rather than silently emptying the
 * token.
 */
export function resolveAliases(
  leaves: readonly TokenLeaf[],
  options: ResolveAliasOptions = {},
): { values: Map<string, string>; references: Map<string, string>; warnings: ParseWarning[] } {
  const { stripSuffix, maxDepth = 10 } = options;
  const warnings: ParseWarning[] = [];
  const values = new Map<string, string>();
  const references = new Map<string, string>();

  const byPath = new Map<string, TokenLeaf>();
  for (const leaf of leaves) {
    byPath.set(leaf.path.join('.'), leaf);
  }

  const targetName = (reference: string): string | null => {
    let pointer = reference.trim();
    if (stripSuffix !== undefined && pointer.endsWith(stripSuffix)) {
      pointer = pointer.slice(0, -stripSuffix.length);
    }
    return byPath.get(pointer)?.name ?? null;
  };

  for (const leaf of leaves) {
    let current: unknown = leaf.rawValue;
    let depth = 0;
    let firstReference: string | null = null;

    while (typeof current === 'string' && depth < maxDepth) {
      const match = ALIAS_PATTERN.exec(current.trim());
      if (match?.[1] === undefined) break;

      const name = targetName(match[1]);
      if (name === null) {
        warnings.push({
          code: 'dangling-reference',
          message: `Token \`${leaf.name}\` references \`${current}\`, which does not exist in this file.`,
          ...(options.file === undefined ? {} : { file: options.file }),
          path: leaf.path.join('.'),
        });
        break;
      }

      firstReference ??= name;
      const target = leaves.find((candidate) => candidate.name === name);
      if (target === undefined) break;
      current = target.rawValue;
      depth += 1;
    }

    if (firstReference !== null) references.set(leaf.name, firstReference);
    if (typeof current === 'string' || typeof current === 'number') {
      values.set(leaf.name, String(current));
    }
  }

  return { values, references, warnings };
}

/** The normalized token group a leaf belongs to. */
export type TokenGroupKind =
  | 'spacing'
  | 'color'
  | 'borderRadius'
  | 'shadow'
  | 'fontSize'
  | 'fontFamily'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing'
  | 'custom';

const TYPE_TO_GROUP: Readonly<Record<string, TokenGroupKind>> = {
  color: 'color',
  shadow: 'shadow',
  boxshadow: 'shadow',
  fontfamily: 'fontFamily',
  fontweight: 'fontWeight',
  fontsize: 'fontSize',
  lineheight: 'lineHeight',
  letterspacing: 'letterSpacing',
  borderradius: 'borderRadius',
  spacing: 'spacing',
  size: 'spacing',
  sizing: 'spacing',
};

/** Path segments that identify a group when the declared type is ambiguous. */
const PATH_HINTS: readonly { match: RegExp; group: TokenGroupKind }[] = [
  { match: /^(border-?radius|radius|corner|rounded)$/i, group: 'borderRadius' },
  { match: /^(spacing|space|gap|sizing|size)$/i, group: 'spacing' },
  { match: /^(shadow|box-?shadow|elevation)$/i, group: 'shadow' },
  { match: /^(colou?r|palette|brand)$/i, group: 'color' },
  { match: /^(font-?size|text-?size|type-?scale)$/i, group: 'fontSize' },
  { match: /^(font-?famil(y|ies)|typeface)$/i, group: 'fontFamily' },
  { match: /^(font-?weight|weight)$/i, group: 'fontWeight' },
  { match: /^(line-?height|leading)$/i, group: 'lineHeight' },
  { match: /^(letter-?spacing|tracking)$/i, group: 'letterSpacing' },
];

/**
 * Decides which token group a leaf belongs to.
 *
 * The declared type wins where it is unambiguous. `dimension` is not — it
 * covers spacing, radius and font size alike — so those fall back to the path,
 * which is how design systems actually disambiguate them in practice.
 */
export function classifyToken(path: readonly string[], type: string | undefined): TokenGroupKind {
  const normalizedType = type?.toLowerCase().replace(/[-_\s]/g, '');

  if (normalizedType !== undefined && normalizedType in TYPE_TO_GROUP) {
    const group = TYPE_TO_GROUP[normalizedType];
    if (group !== undefined) return group;
  }

  for (const segment of path) {
    for (const hint of PATH_HINTS) {
      if (hint.match.test(segment)) return hint.group;
    }
  }

  return 'custom';
}
