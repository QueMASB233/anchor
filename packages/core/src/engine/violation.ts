/**
 * What the linter reports.
 *
 * A violation must be actionable on its own: the file and position must be
 * precise enough to click, and the message must say what is wrong *and* what to
 * do instead. A violation that only says "this is wrong" makes the developer do
 * the work Anchor exists to do for them.
 */

import type { ViolationSeverity } from '../model/index.js';

/**
 * A machine-applicable edit, as an absolute character range in the source and
 * the text to put there.
 *
 * Ranges are half-open `[start, end)` and always refer to the *original*
 * source, never to an already-patched buffer. The fixer applies edits from the
 * end backwards so earlier offsets stay valid.
 */
export interface Fix {
  range: [number, number];
  text: string;
}

export interface Violation {
  ruleId: string;
  severity: ViolationSeverity;
  /** Path as supplied to the linter, used verbatim in reports. */
  file: string;
  /** 1-based line of the offending text. */
  line: number;
  /** 1-based column. */
  column: number;
  /** 1-based end line, for editors and SARIF regions. */
  endLine: number;
  /** 1-based, exclusive. */
  endColumn: number;
  /** What is wrong, in one sentence, ending with what to do instead. */
  message: string;
  /** Human-readable replacement suggestion, shown even when not auto-fixable. */
  suggestedFix?: string;
  /** Present only when the fix is safe to apply mechanically. */
  fix?: Fix;
}

/** How much of a rule's output can be applied automatically. */
export type Fixability = 'auto' | 'partial' | 'none';

/** Orders violations for stable, readable output. */
export function compareViolations(a: Violation, b: Violation): number {
  return (
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.column - b.column ||
    a.ruleId.localeCompare(b.ruleId)
  );
}

export interface ViolationCounts {
  errors: number;
  warnings: number;
  total: number;
  fixable: number;
}

export function countViolations(violations: readonly Violation[]): ViolationCounts {
  let errors = 0;
  let warnings = 0;
  let fixable = 0;

  for (const violation of violations) {
    if (violation.severity === 'error') errors += 1;
    else warnings += 1;
    if (violation.fix !== undefined) fixable += 1;
  }

  return { errors, warnings, total: violations.length, fixable };
}
