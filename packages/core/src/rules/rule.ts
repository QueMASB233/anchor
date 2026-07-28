/**
 * The rule contract.
 *
 * Each rule is a self-contained visitor. It receives pre-computed views of the
 * file — class tokens already extracted and located, JSX elements with their
 * ancestry — so no rule has to re-implement the fiddly parts, and so a fix to
 * class extraction improves every rule at once.
 *
 * Rules never read files, never call out, and never mutate the source. They
 * describe edits; the fixer decides whether to apply them.
 */

import type { TSESTree } from '@typescript-eslint/typescript-estree';

import type { DesignSystem, Severity } from '../model/index.js';
import type { ClassToken } from '../engine/class-names.js';
import type { SourceFile } from '../engine/source-file.js';
import type { Fix, Fixability } from '../engine/violation.js';

export interface RuleMeta {
  /** Stable identifier, used in config, reports and suppression comments. */
  id: string;
  /** One line, shown in `anchor lint --help` and generated docs. */
  description: string;
  defaultSeverity: Severity;
  fixability: Fixability;
  /**
   * Why the rule exists, in terms of consequence rather than preference.
   * Surfaced in reports so a developer hitting it understands the point.
   */
  rationale: string;
}

/** What a rule passes to `report`. */
export interface ReportDescriptor {
  /** What is wrong and what to do instead, in one sentence. */
  message: string;
  /** Absolute half-open offsets of the offending text. */
  range: [number, number];
  /** Human-readable replacement, shown even when no automatic fix exists. */
  suggestedFix?: string;
  /** Supplied only when applying it mechanically is safe. */
  fix?: Fix;
}

export interface RuleContext {
  readonly file: SourceFile;
  readonly designSystem: DesignSystem;
  /** Every class name in the file, already located. */
  readonly classTokens: readonly ClassToken[];
  /** Rule-specific options from `anchor.config`. */
  readonly options: Readonly<Record<string, unknown>>;
  report(descriptor: ReportDescriptor): void;
}

/**
 * The hooks a rule can implement. All are optional; a rule implements only
 * what it needs.
 */
export interface RuleVisitor {
  /** Called once per class name found anywhere in the file. */
  classToken?(this: void, token: ClassToken): void;
  /** Called for every JSX element, with the enclosing nodes outermost-first. */
  jsxElement?(this: void, node: TSESTree.JSXElement, ancestors: readonly TSESTree.Node[]): void;
  /** Escape hatch for rules that need arbitrary nodes. */
  node?(this: void, node: TSESTree.Node, ancestors: readonly TSESTree.Node[]): void;
  /** Called after traversal, for rules that must see the whole file first. */
  finish?(this: void): void;
}

export interface Rule {
  readonly meta: RuleMeta;
  create(context: RuleContext): RuleVisitor;
}

/** Helper for defining a rule with inferred types. */
export function defineRule(rule: Rule): Rule {
  return rule;
}

/** Reads a rule option, falling back when absent or of the wrong type. */
export function option<T>(options: Readonly<Record<string, unknown>>, key: string, fallback: T): T {
  const value = options[key];
  if (value === undefined || value === null) return fallback;
  return typeof value === typeof fallback ? (value as T) : fallback;
}
