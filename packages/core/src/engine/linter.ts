/**
 * The lint runner.
 *
 * Parses a file once, extracts class names once, then drives every enabled rule
 * over a single AST traversal. Rules are cheap; parsing is not, so nothing here
 * walks the tree more than once per file.
 *
 * A rule that throws is contained rather than allowed to abort the run: one
 * buggy rule must not cost a team their entire CI signal. The failure is
 * reported as a violation against Anchor itself so it cannot pass unnoticed.
 */

import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/typescript-estree';

import type { DesignSystem, Severity, ViolationSeverity } from '../model/index.js';
import type { Rule, RuleContext, RuleVisitor } from '../rules/rule.js';
import { extractClassTokens, type ClassToken } from './class-names.js';
import { parseSourceFile, type SourceFile } from './source-file.js';
import { Suppressions } from './suppression.js';
import { compareViolations, type Violation } from './violation.js';

/** Per-rule configuration, as it appears in `anchor.config`. */
export interface RuleSetting {
  severity?: Severity;
  options?: Record<string, unknown>;
}

export type RuleConfig = Severity | RuleSetting;

export interface LintOptions {
  /** Severity or settings per rule id. Unlisted rules use their default. */
  rules?: Readonly<Record<string, RuleConfig>>;
  /** Extra functions whose string arguments are class names. */
  classHelpers?: readonly string[];
}

export interface LintFileResult {
  file: string;
  violations: Violation[];
  /** Set when the file could not be parsed; violations will be empty. */
  parseError?: { message: string; line?: number; column?: number };
}

function resolveSetting(rule: Rule, config: LintOptions['rules']): RuleSetting | null {
  const entry = config?.[rule.meta.id];

  if (entry === undefined) {
    return rule.meta.defaultSeverity === 'off' ? null : { severity: rule.meta.defaultSeverity };
  }
  if (typeof entry === 'string') {
    return entry === 'off' ? null : { severity: entry };
  }

  const severity = entry.severity ?? rule.meta.defaultSeverity;
  return severity === 'off' ? null : { severity, options: entry.options ?? {} };
}

/** Runs the enabled rules over one already-parsed file. */
function runRules(
  file: SourceFile,
  designSystem: DesignSystem,
  rules: readonly Rule[],
  options: LintOptions,
): Violation[] {
  const classTokens: readonly ClassToken[] = extractClassTokens(file, {
    ...(options.classHelpers === undefined ? {} : { classHelpers: options.classHelpers }),
  });

  const totalLines = file.positionAt(file.text.length).line;
  const suppressions = new Suppressions(file.comments, totalLines);
  const violations: Violation[] = [];

  const active: { rule: Rule; visitor: RuleVisitor; severity: ViolationSeverity }[] = [];

  for (const rule of rules) {
    const setting = resolveSetting(rule, options.rules);
    if (setting === null) continue;

    const severity = (setting.severity ?? 'error') as ViolationSeverity;

    const context: RuleContext = {
      file,
      designSystem,
      classTokens,
      options: setting.options ?? {},
      report(descriptor) {
        const start = file.positionAt(descriptor.range[0]);
        const end = file.positionAt(descriptor.range[1]);

        if (suppressions.isSuppressed(rule.meta.id, start.line)) return;

        violations.push({
          ruleId: rule.meta.id,
          severity,
          file: file.path,
          line: start.line,
          column: start.column,
          endLine: end.line,
          endColumn: end.column,
          message: descriptor.message,
          ...(descriptor.suggestedFix === undefined
            ? {}
            : { suggestedFix: descriptor.suggestedFix }),
          ...(descriptor.fix === undefined ? {} : { fix: descriptor.fix }),
        });
      },
    };

    try {
      active.push({ rule, visitor: rule.create(context), severity });
    } catch (error) {
      violations.push(internalError(rule, file, error));
    }
  }

  /** Invokes a rule hook, converting a throw into a reported failure. */
  const safely = (entry: (typeof active)[number], run: () => void): void => {
    try {
      run();
    } catch (error) {
      violations.push(internalError(entry.rule, file, error));
    }
  };

  for (const entry of active) {
    const hook = entry.visitor.classToken;
    if (hook === undefined) continue;
    for (const token of classTokens)
      safely(entry, () => {
        hook(token);
      });
  }

  const needsWalk = active.filter(
    (entry) => entry.visitor.jsxElement !== undefined || entry.visitor.node !== undefined,
  );

  if (needsWalk.length > 0) {
    walkWithHooks(file.ast, needsWalk, safely);
  }

  for (const entry of active) {
    const finish = entry.visitor.finish;
    if (finish !== undefined)
      safely(entry, () => {
        finish();
      });
  }

  return violations.sort(compareViolations);
}

/** Single traversal feeding every rule that asked for nodes. */
function walkWithHooks(
  root: TSESTree.Node,
  entries: readonly { rule: Rule; visitor: RuleVisitor; severity: ViolationSeverity }[],
  safely: (entry: (typeof entries)[number], run: () => void) => void,
): void {
  const ancestors: TSESTree.Node[] = [];

  const isNode = (value: unknown): value is TSESTree.Node =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string';

  const visit = (node: TSESTree.Node): void => {
    for (const entry of entries) {
      const { node: nodeHook, jsxElement } = entry.visitor;
      if (nodeHook !== undefined) {
        safely(entry, () => {
          nodeHook(node, ancestors);
        });
      }
      if (jsxElement !== undefined && node.type === AST_NODE_TYPES.JSXElement) {
        safely(entry, () => {
          jsxElement(node, ancestors);
        });
      }
    }

    ancestors.push(node);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) visit(item);
      } else if (isNode(value)) {
        visit(value);
      }
    }
    ancestors.pop();
  };

  visit(root);
}

/** A rule crash, surfaced as a violation so it is impossible to miss. */
function internalError(rule: Rule, file: SourceFile, error: unknown): Violation {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ruleId: 'anchor/internal-error',
    severity: 'warning',
    file: file.path,
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 1,
    message: `The rule \`${rule.meta.id}\` crashed while checking this file: ${message}. This is a bug in Anchor; please report it. Other rules still ran.`,
  };
}

/**
 * Lints one file against a design system.
 *
 * Takes content as text: the caller owns all file I/O, which keeps this layer
 * unable to reach beyond what it was handed.
 */
export function lintFile(
  input: { path: string; content: string },
  designSystem: DesignSystem,
  rules: readonly Rule[],
  options: LintOptions = {},
): LintFileResult {
  const { file, error } = parseSourceFile(input.path, input.content);

  if (file === null) {
    return {
      file: input.path,
      violations: [],
      ...(error === undefined ? {} : { parseError: error }),
    };
  }

  return { file: input.path, violations: runRules(file, designSystem, rules, options) };
}
