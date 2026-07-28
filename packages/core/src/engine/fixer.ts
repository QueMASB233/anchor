/**
 * Applying automatic fixes.
 *
 * Fixes are described against the *original* source, so they are applied from
 * the end of the file backwards — that keeps every not-yet-applied offset
 * valid without any bookkeeping.
 *
 * Overlapping fixes are dropped rather than merged. Two rules editing the same
 * characters cannot both be right, and applying one on top of the other would
 * produce output neither rule intended. The dropped ones remain reported, so
 * a second `--fix` pass picks them up once the first conflict is resolved.
 */

import type { Violation } from './violation.js';

export interface FixResult {
  /** The patched source. Identical to the input when nothing applied. */
  output: string;
  /** Violations whose fix was applied. */
  applied: Violation[];
  /** Fixable violations skipped because their edit overlapped another. */
  skipped: Violation[];
}

/** Applies every non-overlapping fix among `violations`. */
export function applyFixes(source: string, violations: readonly Violation[]): FixResult {
  const fixable = violations
    .filter((violation) => violation.fix !== undefined)
    .sort((a, b) => {
      const left = a.fix!.range;
      const right = b.fix!.range;
      // Earliest first, then widest first, so a containing fix wins a tie.
      return left[0] - right[0] || right[1] - right[0] - (left[1] - left[0]);
    });

  const applied: Violation[] = [];
  const skipped: Violation[] = [];
  let lastEnd = -1;

  for (const violation of fixable) {
    const [start, end] = violation.fix!.range;
    if (start < lastEnd) {
      skipped.push(violation);
      continue;
    }
    applied.push(violation);
    lastEnd = end;
  }

  let output = source;
  for (const violation of [...applied].reverse()) {
    const [start, end] = violation.fix!.range;
    output = output.slice(0, start) + violation.fix!.text + output.slice(end);
  }

  return { output, applied, skipped };
}
