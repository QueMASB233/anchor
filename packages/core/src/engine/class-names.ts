/**
 * Finding class names in source.
 *
 * Reading only `className="..."` string literals would miss most of the code
 * Anchor exists to lint. Real component code looks like this:
 *
 *   className={cn('flex p-4', isActive && 'p-[13px]', { 'gap-[7px]': dense })}
 *
 * and variant definitions look like this:
 *
 *   const button = cva('rounded-md', { variants: { size: { sm: 'p-[7px]' } } })
 *
 * So extraction follows class-helper calls wherever they appear, walks
 * conditionals, template literals and array/object forms, and reports every
 * class with its exact offset in the original file — which is what makes
 * precise underlining and surgical autofixes possible.
 */

import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { AST_NODE_TYPES } from '@typescript-eslint/typescript-estree';

import type { SourceFile } from './source-file.js';
import { walk } from './walker.js';

/** One class name, located precisely in the source. */
export interface ClassToken {
  /** The class exactly as written, e.g. `md:p-[13px]`. */
  value: string;
  /** Absolute half-open offsets of this class in the file. */
  range: [number, number];
  /** 1-based position of the class itself, not of the enclosing literal. */
  line: number;
  column: number;
}

/**
 * Functions whose string arguments are class names.
 *
 * Covers the `clsx`/`cn` family that virtually every Tailwind codebase uses,
 * plus `cva`, whose strings define the component variants themselves.
 */
export const DEFAULT_CLASS_HELPERS: readonly string[] = [
  'cn',
  'clsx',
  'classnames',
  'classNames',
  'cva',
  'cx',
  'tv',
  'twMerge',
  'twJoin',
  'tw',
];

/** JSX attributes whose value is a class list. */
const CLASS_ATTRIBUTES = new Set(['className', 'class']);

export interface ExtractOptions {
  /** Overrides {@link DEFAULT_CLASS_HELPERS}. */
  classHelpers?: readonly string[];
}

/** Resolves a call's callee to a bare name, handling `foo.bar()`. */
function calleeName(node: TSESTree.CallExpression): string | null {
  if (node.callee.type === AST_NODE_TYPES.Identifier) return node.callee.name;
  if (
    node.callee.type === AST_NODE_TYPES.MemberExpression &&
    node.callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    return node.callee.property.name;
  }
  return null;
}

/**
 * Locates the raw text of a string-bearing node within the file.
 *
 * Offsets come from the source rather than from the parsed value, because a
 * cooked value with escapes resolved would drift out of alignment and land the
 * violation underline on the wrong characters.
 */
function contentRange(node: TSESTree.Node, file: SourceFile): [number, number] | null {
  const [start, end] = node.range;

  if (node.type === AST_NODE_TYPES.Literal) {
    // Skip the surrounding quotes.
    return [start + 1, end - 1];
  }

  if (node.type === AST_NODE_TYPES.TemplateElement) {
    // A quasi is preceded by a backtick or a closing brace, and followed by a
    // backtick or `${`. Anchor to the raw text length instead of guessing.
    const raw = node.value.raw;
    let contentStart = start;
    while (contentStart < end && file.text.slice(contentStart, contentStart + raw.length) !== raw) {
      contentStart += 1;
    }
    return [contentStart, contentStart + raw.length];
  }

  return null;
}

/**
 * Splits a class string into tokens, preserving each one's offset.
 *
 * Template literals contribute their static segments only: the interpolated
 * parts are unknowable statically, and a partial class fragment either side of
 * a hole would produce nonsense like `p-` or `-500`.
 */
function tokenize(text: string, offset: number, file: SourceFile, out: ClassToken[]): void {
  for (const match of text.matchAll(/\S+/g)) {
    const value = match[0];
    if (match.index === undefined) continue;

    const start = offset + match.index;
    const position = file.positionAt(start);

    out.push({
      value,
      range: [start, start + value.length],
      line: position.line,
      column: position.column,
    });
  }
}

/**
 * Extracts every class name in the file.
 *
 * Results are deduplicated by source range, since a `cn()` call inside a
 * `className` attribute is reachable by two paths.
 */
export function extractClassTokens(file: SourceFile, options: ExtractOptions = {}): ClassToken[] {
  const helpers = new Set(options.classHelpers ?? DEFAULT_CLASS_HELPERS);
  const byRange = new Map<string, ClassToken>();

  /**
   * @param dropLeading  the segment continues a class split by an interpolation
   * @param dropTrailing the segment is cut off by a following interpolation
   */
  const emit = (node: TSESTree.Node, dropLeading = false, dropTrailing = false): void => {
    const range = contentRange(node, file);
    if (range === null) return;

    const tokens: ClassToken[] = [];
    tokenize(file.text.slice(range[0], range[1]), range[0], file, tokens);

    // A class straddling an interpolation is only half a class. Reporting `p-`
    // from `p-${size}` would have rules judging a fragment that never reaches
    // the DOM, so the partial token at each seam is discarded.
    const start = dropLeading ? 1 : 0;
    const end = dropTrailing ? tokens.length - 1 : tokens.length;

    for (const token of tokens.slice(start, end)) {
      byRange.set(`${token.range[0]}:${token.range[1]}`, token);
    }
  };

  /** Collects class strings reachable from an expression. */
  const collect = (node: TSESTree.Node | null | undefined, depth = 0): void => {
    if (node === null || node === undefined || depth > 24) return;

    switch (node.type) {
      case AST_NODE_TYPES.Literal:
        if (typeof node.value === 'string') emit(node);
        return;

      case AST_NODE_TYPES.TemplateLiteral: {
        for (const [index, quasi] of node.quasis.entries()) {
          const raw = quasi.value.raw;
          // Whitespace at a seam means the class ended cleanly there.
          const continuesPrevious = index > 0 && !/^\s/.test(raw);
          const precedesNext = !quasi.tail && !/\s$/.test(raw);
          emit(quasi, continuesPrevious, precedesNext);
        }
        for (const expression of node.expressions) collect(expression, depth + 1);
        return;
      }

      case AST_NODE_TYPES.JSXExpressionContainer:
        collect(node.expression, depth + 1);
        return;

      case AST_NODE_TYPES.ConditionalExpression:
        collect(node.consequent, depth + 1);
        collect(node.alternate, depth + 1);
        return;

      case AST_NODE_TYPES.LogicalExpression:
      case AST_NODE_TYPES.BinaryExpression:
        collect(node.left, depth + 1);
        collect(node.right, depth + 1);
        return;

      case AST_NODE_TYPES.ArrayExpression:
        for (const element of node.elements) collect(element, depth + 1);
        return;

      case AST_NODE_TYPES.ObjectExpression:
        // `clsx({ 'p-4': cond })` — the *key* is the class name. Values are
        // conditions, and `cva`'s nested variant objects are handled by
        // recursing into them.
        for (const property of node.properties) {
          if (property.type !== AST_NODE_TYPES.Property) continue;
          if (
            property.key.type === AST_NODE_TYPES.Literal &&
            typeof property.key.value === 'string'
          ) {
            emit(property.key);
          }
          collect(property.value, depth + 1);
        }
        return;

      case AST_NODE_TYPES.CallExpression:
        if (calleeName(node) !== null && helpers.has(calleeName(node)!)) {
          for (const argument of node.arguments) collect(argument, depth + 1);
        }
        return;

      case AST_NODE_TYPES.TSAsExpression:
      case AST_NODE_TYPES.TSSatisfiesExpression:
      case AST_NODE_TYPES.TSNonNullExpression:
        collect(node.expression, depth + 1);
        return;

      default:
        return;
    }
  };

  walk(file.ast, (node) => {
    if (node.type === AST_NODE_TYPES.JSXAttribute) {
      const name = node.name.type === AST_NODE_TYPES.JSXIdentifier ? node.name.name : null;
      if (name !== null && CLASS_ATTRIBUTES.has(name)) collect(node.value);
      return;
    }

    // Helper calls anywhere, so `cva` variant maps declared outside JSX are
    // linted too. Those strings become class names at runtime just the same.
    if (node.type === AST_NODE_TYPES.CallExpression) {
      const name = calleeName(node);
      if (name !== null && helpers.has(name)) {
        for (const argument of node.arguments) collect(argument);
      }
    }
  });

  return [...byRange.values()].sort((a, b) => a.range[0] - b.range[0]);
}
