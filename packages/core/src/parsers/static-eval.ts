/**
 * Static evaluation of JavaScript and TypeScript configuration objects.
 *
 * This is how Anchor reads `tailwind.config.js` without running it. The config
 * is parsed to an AST and only *literal* constructs are folded into values.
 * Nothing here calls a function, resolves an import, or touches the filesystem,
 * so a hostile config in a pull request has no path to execution — the worst it
 * can do is fail to be understood, which is reported as a warning.
 *
 * The trade-off is real and deliberate: dynamic configs are partially opaque.
 * `require('tailwindcss/colors')`, spread of an imported object, and
 * `spacing: ({ theme }) => ...` cannot be resolved this way. Every one of those
 * produces a located warning naming what was skipped, so a user is never left
 * quietly missing half their tokens. See SECURITY.md.
 */

import { AST_NODE_TYPES, parse, type TSESTree } from '@typescript-eslint/typescript-estree';

import type { ParseWarning } from './types.js';

/** A value that could be folded from literal syntax alone. */
export type StaticValue =
  string | number | boolean | null | StaticValue[] | { [key: string]: StaticValue };

/**
 * Marker for "this expression exists but cannot be known without executing
 * code". Distinct from `undefined`, which means the key was absent entirely —
 * a distinction that matters when merging a config over defaults.
 */
export const UNRESOLVED = Symbol('anchor.unresolved');
export type EvalOutcome = StaticValue | typeof UNRESOLVED;

export function isResolved(outcome: EvalOutcome): outcome is StaticValue {
  return outcome !== UNRESOLVED;
}

/** Top-level `const`/`let`/`var` bindings, so `export default config` resolves. */
type Scope = ReadonlyMap<string, TSESTree.Expression>;

interface EvalState {
  scope: Scope;
  warnings: ParseWarning[];
  file: string;
  /** Identifiers currently being resolved, to stop cyclic references looping. */
  resolving: Set<string>;
}

export interface ParseModuleResult {
  program: TSESTree.Program | null;
  warnings: ParseWarning[];
}

/** Parses source text to an ESTree AST, reporting syntax errors as warnings. */
export function parseModule(code: string, file: string, jsx = false): ParseModuleResult {
  try {
    const program = parse(code, {
      jsx,
      loc: true,
      range: false,
      comment: false,
      errorOnUnknownASTType: false,
      // No `project` option: type information would require reading tsconfig
      // and the whole program off disk, which this layer must never do.
    });
    return { program, warnings: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      program: null,
      warnings: [{ code: 'parse-error', message: `Could not parse ${file}: ${message}`, file }],
    };
  }
}

/** Strips TypeScript-only wrappers such as `satisfies Config` and `as const`. */
function unwrap(node: TSESTree.Node): TSESTree.Node {
  switch (node.type) {
    case AST_NODE_TYPES.TSAsExpression:
    case AST_NODE_TYPES.TSSatisfiesExpression:
    case AST_NODE_TYPES.TSNonNullExpression:
    case AST_NODE_TYPES.TSInstantiationExpression:
      return unwrap(node.expression);
    default:
      return node;
  }
}

/** Collects top-level variable initializers so identifier references resolve. */
function collectScope(program: TSESTree.Program): Scope {
  const scope = new Map<string, TSESTree.Expression>();

  for (const statement of program.body) {
    const declaration =
      statement.type === AST_NODE_TYPES.ExportNamedDeclaration ? statement.declaration : statement;

    if (declaration?.type !== AST_NODE_TYPES.VariableDeclaration) continue;

    for (const declarator of declaration.declarations) {
      if (declarator.id.type === AST_NODE_TYPES.Identifier && declarator.init !== null) {
        scope.set(declarator.id.name, declarator.init);
      }
    }
  }

  return scope;
}

/**
 * Finds the exported configuration object, covering the shapes real configs use:
 * `module.exports = {}`, `export default {}`, `exports.default = {}`, and any
 * of those referencing a variable declared above.
 */
export function findDefaultExport(program: TSESTree.Program): TSESTree.Node | null {
  for (const statement of program.body) {
    if (statement.type === AST_NODE_TYPES.ExportDefaultDeclaration) {
      // Returned as a Node rather than an Expression: a default-exported class
      // or function is not a config object, and `evaluate` already reports
      // anything it cannot fold with a located, actionable warning.
      return statement.declaration;
    }

    if (
      statement.type !== AST_NODE_TYPES.ExpressionStatement ||
      statement.expression.type !== AST_NODE_TYPES.AssignmentExpression
    ) {
      continue;
    }

    const { left, right } = statement.expression;
    if (left.type !== AST_NODE_TYPES.MemberExpression) continue;

    const target = memberPath(left);
    if (target === 'module.exports' || target === 'exports.default') {
      return right;
    }
  }

  return null;
}

/** Renders a non-computed member expression as a dotted path, or `null`. */
function memberPath(node: TSESTree.MemberExpression): string | null {
  const parts: string[] = [];
  let current: TSESTree.Node = node;

  while (current.type === AST_NODE_TYPES.MemberExpression) {
    if (current.computed || current.property.type !== AST_NODE_TYPES.Identifier) return null;
    parts.unshift(current.property.name);
    current = current.object;
  }

  if (current.type !== AST_NODE_TYPES.Identifier) return null;
  parts.unshift(current.name);
  return parts.join('.');
}

/** Resolves a property key to a string, for both `{ a: 1 }` and `{ 'a-b': 1 }`. */
function propertyKey(property: TSESTree.Property): string | null {
  if (!property.computed) {
    if (property.key.type === AST_NODE_TYPES.Identifier) return property.key.name;
    if (property.key.type === AST_NODE_TYPES.Literal) return String(property.key.value);
    return null;
  }
  // A computed key is only knowable when it is itself a literal: `{ ['a']: 1 }`.
  if (property.key.type === AST_NODE_TYPES.Literal) return String(property.key.value);
  return null;
}

function warn(state: EvalState, node: TSESTree.Node, path: string, message: string): void {
  state.warnings.push({
    code: 'unresolvable-expression',
    message,
    file: state.file,
    path,
    ...(node.loc === undefined ? {} : { line: node.loc.start.line, column: node.loc.start.column }),
  });
}

/** Describes an unresolvable node in terms a user can act on. */
function describe(node: TSESTree.Node): string {
  switch (node.type) {
    case AST_NODE_TYPES.CallExpression: {
      const callee =
        node.callee.type === AST_NODE_TYPES.Identifier
          ? node.callee.name
          : node.callee.type === AST_NODE_TYPES.MemberExpression
            ? (memberPath(node.callee) ?? 'a function')
            : 'a function';
      const firstArgument = node.arguments[0];
      const argument =
        firstArgument?.type === AST_NODE_TYPES.Literal && typeof firstArgument.value === 'string'
          ? `('${firstArgument.value}')`
          : '(...)';
      return `a call to ${callee}${argument}`;
    }
    case AST_NODE_TYPES.ArrowFunctionExpression:
    case AST_NODE_TYPES.FunctionExpression:
      return 'a function value';
    case AST_NODE_TYPES.ConditionalExpression:
      return 'a conditional expression';
    case AST_NODE_TYPES.Identifier:
      return `the identifier \`${node.name}\``;
    case AST_NODE_TYPES.MemberExpression:
      return `the reference \`${memberPath(node) ?? 'a member expression'}\``;
    case AST_NODE_TYPES.SpreadElement:
      return 'a spread of a value defined elsewhere';
    default:
      return `a ${node.type}`;
  }
}

/**
 * Folds an expression into a plain value using literal syntax only.
 *
 * @param path Dotted location within the config, used in warnings.
 */
export function evaluate(node: TSESTree.Node, path: string, state: EvalState): EvalOutcome {
  const target = unwrap(node);

  switch (target.type) {
    case AST_NODE_TYPES.Literal: {
      const { value } = target;
      // Regular expressions and bigints have no JSON representation.
      if (value instanceof RegExp || typeof value === 'bigint') {
        warn(state, target, path, `Anchor skipped ${path}: it is ${describe(target)}.`);
        return UNRESOLVED;
      }
      return value;
    }

    case AST_NODE_TYPES.TemplateLiteral: {
      if (target.expressions.length === 0) {
        return target.quasis[0]?.value.cooked ?? '';
      }
      warn(
        state,
        target,
        path,
        `Anchor skipped ${path}: it is a template literal with interpolation, which cannot be resolved without running the config.`,
      );
      return UNRESOLVED;
    }

    case AST_NODE_TYPES.UnaryExpression: {
      const argument = evaluate(target.argument, path, state);
      if (!isResolved(argument)) return UNRESOLVED;
      if (target.operator === '-' && typeof argument === 'number') return -argument;
      if (target.operator === '+' && typeof argument === 'number') return argument;
      return UNRESOLVED;
    }

    case AST_NODE_TYPES.BinaryExpression: {
      if (target.operator !== '+') return UNRESOLVED;
      const left = evaluate(target.left, path, state);
      const right = evaluate(target.right, path, state);
      if (!isResolved(left) || !isResolved(right)) return UNRESOLVED;
      if (typeof left === 'number' && typeof right === 'number') return left + right;
      // Concatenation only where both sides are genuinely stringable. Letting an
      // object through would fold it to '[object Object]' and call it a token.
      const stringable = (value: StaticValue): value is string | number =>
        typeof value === 'string' || typeof value === 'number';
      if (stringable(left) && stringable(right)) return `${left}${right}`;
      return UNRESOLVED;
    }

    case AST_NODE_TYPES.ArrayExpression: {
      const values: StaticValue[] = [];
      for (const [index, element] of target.elements.entries()) {
        if (element === null) {
          values.push(null); // an array hole
          continue;
        }
        if (element.type === AST_NODE_TYPES.SpreadElement) {
          warn(
            state,
            element,
            `${path}[${index}]`,
            `Anchor skipped part of ${path}: it spreads ${describe(element)}, which cannot be resolved without running the config.`,
          );
          continue;
        }
        const value = evaluate(element, `${path}[${index}]`, state);
        if (isResolved(value)) values.push(value);
      }
      return values;
    }

    case AST_NODE_TYPES.ObjectExpression: {
      const result: Record<string, StaticValue> = {};
      for (const property of target.properties) {
        if (property.type === AST_NODE_TYPES.SpreadElement) {
          // A spread of a locally declared object can still be folded.
          const spread = evaluate(property.argument, path, state);
          if (
            isResolved(spread) &&
            typeof spread === 'object' &&
            spread !== null &&
            !Array.isArray(spread)
          ) {
            Object.assign(result, spread);
          } else {
            warn(
              state,
              property,
              path,
              `Anchor skipped a spread inside ${path}: it spreads ${describe(property.argument)}, so those tokens are missing from the parsed design system.`,
            );
          }
          continue;
        }

        const key = propertyKey(property);
        if (key === null) {
          warn(
            state,
            property,
            path,
            `Anchor skipped a computed key inside ${path}, which cannot be resolved without running the config.`,
          );
          continue;
        }

        const childPath = path === '' ? key : `${path}.${key}`;
        const value = evaluate(property.value, childPath, state);
        if (isResolved(value)) result[key] = value;
      }
      return result;
    }

    case AST_NODE_TYPES.Identifier: {
      if (target.name === 'undefined') return UNRESOLVED;

      const binding = state.scope.get(target.name);
      if (binding === undefined || state.resolving.has(target.name)) {
        warn(
          state,
          target,
          path,
          `Anchor skipped ${path}: it references ${describe(target)}, which is not defined as a literal in this file.`,
        );
        return UNRESOLVED;
      }

      state.resolving.add(target.name);
      try {
        return evaluate(binding, path, state);
      } finally {
        state.resolving.delete(target.name);
      }
    }

    case AST_NODE_TYPES.MemberExpression: {
      // Resolvable only when the whole object chain is literal in this file.
      const object = evaluate(target.object, path, state);
      if (!isResolved(object) || object === null || typeof object !== 'object') return UNRESOLVED;

      const key = target.computed
        ? target.property.type === AST_NODE_TYPES.Literal
          ? String(target.property.value)
          : null
        : target.property.type === AST_NODE_TYPES.Identifier
          ? target.property.name
          : null;

      if (key === null) return UNRESOLVED;
      const value = Array.isArray(object)
        ? object[Number(key)]
        : (object as Record<string, StaticValue>)[key];
      return value ?? UNRESOLVED;
    }

    default:
      warn(
        state,
        target,
        path,
        `Anchor skipped ${path}: it is ${describe(target)}, which cannot be resolved without running the config. Anchor never executes the code it analyzes.`,
      );
      return UNRESOLVED;
  }
}

export interface EvaluateConfigResult {
  value: EvalOutcome;
  warnings: ParseWarning[];
}

/**
 * Parses a JS/TS module and statically folds its default export.
 *
 * The single entry point Tailwind's v3 parser uses. Returns `UNRESOLVED` when
 * there is no recognizable default export, with a warning explaining why.
 */
export function evaluateConfigModule(code: string, file: string): EvaluateConfigResult {
  const { program, warnings } = parseModule(code, file);
  if (program === null) return { value: UNRESOLVED, warnings };

  const exported = findDefaultExport(program);
  if (exported === null) {
    return {
      value: UNRESOLVED,
      warnings: [
        {
          code: 'unsupported-construct',
          message: `No default export found in ${file}. Anchor looks for \`export default\`, \`module.exports =\`, or \`exports.default =\`.`,
          file,
        },
      ],
    };
  }

  const state: EvalState = {
    scope: collectScope(program),
    warnings: [...warnings],
    file,
    resolving: new Set(),
  };

  const value = evaluate(exported, '', state);
  return { value, warnings: state.warnings };
}
