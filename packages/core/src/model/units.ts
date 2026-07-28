/**
 * Length normalization.
 *
 * Design systems express the same measurement in many ways: `1rem`, `16px`,
 * and a bare `16` are all the same spacing step. Rules like
 * `no-arbitrary-spacing` need to compare an author's `p-[13px]` against the
 * scale, which is only possible once everything is reduced to one unit.
 *
 * We reduce to pixels. Raw authored values are always preserved alongside the
 * normalized number so generated docs and fix suggestions can speak the
 * team's own vocabulary rather than ours.
 */

/** Assumed root font size when converting `rem` to `px`. Overridable per design system. */
export const DEFAULT_ROOT_FONT_SIZE = 16;

/**
 * Precision floor for normalized values, in decimal places. Guards against
 * float noise (0.1 + 0.2 problems) making two equal lengths compare unequal.
 */
const PRECISION = 4;

/** Scale factor used to do exact integer arithmetic on fractional pixel values. */
export const PX_SCALE = 10 ** PRECISION;

const LENGTH_PATTERN = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem|em|pt|pc|in|cm|mm|q)?$/i;

/** Absolute CSS units, expressed as a multiple of 1px. */
const ABSOLUTE_UNITS: Readonly<Record<string, number>> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

/** Rounds to {@link PRECISION} decimal places, normalizing `-0` to `0`. */
export function roundPx(value: number): number {
  const rounded = Math.round(value * PX_SCALE) / PX_SCALE;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Converts a CSS length to pixels.
 *
 * Returns `null` for anything that cannot be resolved to a fixed pixel value —
 * percentages, `auto`, `calc()`, viewport units, and unparseable input. Callers
 * must treat `null` as "not comparable" rather than as zero; a rule that
 * silently coerced an unresolvable length to 0 would emit confident nonsense.
 *
 * A bare number is interpreted as pixels. That is not valid CSS, but token
 * files (Style Dictionary and Figma exports especially) routinely carry
 * unitless numbers meaning pixels.
 *
 * `em` is resolved against the root font size, not the inherited font size,
 * which we cannot know without rendering. This is an approximation, and the
 * reason `em`-based scales infer less reliably than `rem`-based ones.
 */
export function toPx(
  raw: string | number,
  rootFontSize: number = DEFAULT_ROOT_FONT_SIZE,
): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? roundPx(raw) : null;
  }

  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const match = LENGTH_PATTERN.exec(trimmed);
  if (!match) return null;

  const [, rawNumber, rawUnit] = match;
  if (rawNumber === undefined) return null;

  const magnitude = Number.parseFloat(rawNumber);
  if (!Number.isFinite(magnitude)) return null;

  // A unitless zero is zero in any unit; a unitless non-zero is treated as px.
  if (rawUnit === undefined) return roundPx(magnitude);

  const unit = rawUnit.toLowerCase();
  if (unit === 'rem' || unit === 'em') {
    return roundPx(magnitude * rootFontSize);
  }

  const factor = ABSOLUTE_UNITS[unit];
  return factor === undefined ? null : roundPx(magnitude * factor);
}

/**
 * Formats a pixel value back into a token-friendly string, e.g. `16` -> `"16px"`.
 * Used by fix suggestions when no authored form is available.
 */
export function formatPx(value: number): string {
  return `${roundPx(value)}px`;
}

/** True when `value` is an exact integer multiple of `step`, within {@link PRECISION}. */
export function isMultipleOf(value: number, step: number): boolean {
  if (step === 0) return value === 0;
  const scaledValue = Math.round(value * PX_SCALE);
  const scaledStep = Math.round(step * PX_SCALE);
  if (scaledStep === 0) return scaledValue === 0;
  return scaledValue % scaledStep === 0;
}
