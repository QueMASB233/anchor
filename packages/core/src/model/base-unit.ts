/**
 * Spacing base-unit inference.
 *
 * Most teams never declare "our grid is 4px" anywhere machine-readable, so
 * Anchor derives it from the token values themselves.
 *
 * The obvious approach — take the GCD of every value — is correct in theory
 * and useless in practice, because real scales contain outliers that drag the
 * GCD to 1. Tailwind's default spacing scale includes a literal `px: '1px'`
 * token, which alone would make the inferred base unit 1px for essentially
 * every Tailwind project.
 *
 * So instead we search for the *largest* candidate step that still explains
 * almost every value, and report how much of the scale it actually explains.
 * A base unit that covers 97% of tokens while ignoring one 1px outlier is a
 * far more useful answer than a mathematically pure 1.
 */

import { isMultipleOf, PX_SCALE, roundPx } from './units.js';

/**
 * How much evidence stood behind the inference. Confidence describes our
 * certainty about the *inference*, not the quality of the design system.
 */
export type BaseUnitConfidence = 'high' | 'medium' | 'low' | 'none';

export interface BaseUnitInference {
  /** The inferred grid step in pixels, or `null` when nothing usable was supplied. */
  baseUnit: number | null;
  /** Fraction of distinct non-zero values that are exact multiples of `baseUnit` (0–1). */
  coverage: number;
  /** Confidence in the inference itself. */
  confidence: BaseUnitConfidence;
  /** Count of distinct, positive, finite values the inference was drawn from. */
  sampleSize: number;
  /** Values that are not multiples of `baseUnit`, ascending. Surfaced in `anchor sync` output. */
  outliers: number[];
}

/**
 * Minimum share of values a candidate must explain to be preferred over a
 * smaller one. 0.9 tolerates a handful of deliberate off-grid tokens (hairline
 * borders, optical adjustments) without letting them dictate the result.
 */
const COVERAGE_THRESHOLD = 0.9;

/** Greatest common divisor of two non-negative integers. */
function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

/**
 * Infers the grid step underlying a set of spacing values, all in pixels.
 *
 * Zero and negative values are ignored: zero is a multiple of every step and
 * carries no information, and negative spacing is not part of a scale.
 *
 * @example
 * inferBaseUnit([0, 4, 8, 16, 24, 32]).baseUnit // 4
 * inferBaseUnit([0, 5, 10, 20, 40]).baseUnit    // 5
 * inferBaseUnit([1, 2, 4, 8, 12, 16]).baseUnit  // 2, ignoring the 1px outlier
 */
export function inferBaseUnit(values: readonly number[]): BaseUnitInference {
  const distinct = [
    ...new Set(values.filter((v) => Number.isFinite(v) && v > 0).map(roundPx)),
  ].sort((a, b) => a - b);

  if (distinct.length === 0) {
    return { baseUnit: null, coverage: 0, confidence: 'none', sampleSize: 0, outliers: [] };
  }

  // Candidates: every value in the scale (a base unit is usually itself a
  // token), plus the GCD, which covers grids whose step was never tokenized —
  // [6, 9, 12] has a base unit of 3 even though 3 is not a value.
  const scaled = distinct.map((v) => Math.round(v * PX_SCALE));
  const overallGcd = roundPx(scaled.reduce((acc, v) => gcd(acc, v)) / PX_SCALE);

  const candidates = [...new Set([...distinct, overallGcd])]
    .filter((c) => c > 0)
    .sort((a, b) => b - a); // largest first: prefer the most informative step

  // The GCD divides every value by construction, so it always scores a perfect
  // coverage of 1 and is always present as a candidate. The search below is
  // therefore guaranteed to terminate on some candidate at or above the
  // threshold — the GCD is the floor, and anything larger that still explains
  // the scale is strictly more informative.
  let best = { baseUnit: overallGcd, coverage: 1 };
  for (const candidate of candidates) {
    const covered = distinct.filter((v) => isMultipleOf(v, candidate)).length;
    const coverage = covered / distinct.length;

    if (coverage >= COVERAGE_THRESHOLD) {
      best = { baseUnit: candidate, coverage };
      break; // candidates are descending, so the first match is the largest
    }
  }

  const outliers = distinct.filter((v) => !isMultipleOf(v, best.baseUnit));

  return {
    baseUnit: best.baseUnit,
    coverage: best.coverage,
    confidence: scoreConfidence(distinct.length, best.coverage),
    sampleSize: distinct.length,
    outliers,
  };
}

/**
 * Confidence is driven by sample size first: a base unit derived from two
 * values is a guess no matter how cleanly it divides them.
 */
function scoreConfidence(sampleSize: number, coverage: number): BaseUnitConfidence {
  if (sampleSize === 0) return 'none';
  if (sampleSize < 3) return 'low';
  if (sampleSize >= 5 && coverage === 1) return 'high';
  if (coverage >= COVERAGE_THRESHOLD) return 'medium';
  return 'low';
}
