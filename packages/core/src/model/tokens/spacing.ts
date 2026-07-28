/**
 * Spacing tokens and the derived scale.
 *
 * Spacing is the token group Anchor reasons about most aggressively, because
 * `no-arbitrary-spacing` needs to answer "is 13px on the scale, and if not
 * what is nearest?" for every arbitrary value it finds.
 */

import { z } from 'zod';

import { type BaseUnitConfidence, inferBaseUnit } from '../base-unit.js';
import { type TokenMeta, TokenNameSchema, tokenMetaShape } from '../common.js';
import { DEFAULT_ROOT_FONT_SIZE, toPx } from '../units.js';
import { isOnPxScale, nearestPxToken } from './px-token.js';

export const SpacingTokenSchema = z.strictObject({
  ...tokenMetaShape,
  name: TokenNameSchema,
  /** The value exactly as the team authored it, e.g. `"0.75rem"`. */
  value: z.string(),
  /**
   * The value normalized to pixels, or `null` when it cannot be resolved to a
   * fixed length (`auto`, `100%`, `calc(...)`). Rules must skip `null` rather
   * than treat it as zero.
   */
  px: z.number().nullable(),
});
export type SpacingToken = z.infer<typeof SpacingTokenSchema>;

export const BaseUnitConfidenceSchema = z.enum(['high', 'medium', 'low', 'none']);

export const SpacingScaleSchema = z.strictObject({
  tokens: z.array(SpacingTokenSchema),
  /** Inferred grid step in pixels. See `inferBaseUnit` for how this is derived. */
  baseUnit: z.number().positive().nullable(),
  /** Fraction of tokens that are exact multiples of `baseUnit`. */
  coverage: z.number().min(0).max(1),
  confidence: BaseUnitConfidenceSchema,
  /** Token values that sit off the inferred grid, ascending. */
  outliers: z.array(z.number()),
  /** Root font size used to resolve `rem` values into `px`. */
  rootFontSize: z.number().positive(),
});
export type SpacingScale = z.infer<typeof SpacingScaleSchema>;

/** What a parser hands to {@link createSpacingScale}, before normalization. */
export interface SpacingTokenInput extends TokenMeta {
  name: string;
  value: string | number;
}

export interface CreateSpacingScaleOptions {
  rootFontSize?: number;
}

/**
 * Builds a {@link SpacingScale} from raw parser output, normalizing every value
 * to pixels and inferring the base unit.
 *
 * Every parser routes through here so base-unit inference cannot drift between
 * formats — a 4px grid must be detected identically whether it arrived from
 * Tailwind or from a Figma export.
 */
export function createSpacingScale(
  inputs: readonly SpacingTokenInput[],
  options: CreateSpacingScaleOptions = {},
): SpacingScale {
  const rootFontSize = options.rootFontSize ?? DEFAULT_ROOT_FONT_SIZE;

  const tokens: SpacingToken[] = inputs.map(({ name, value, ...meta }) => ({
    ...meta,
    name,
    value: String(value),
    px: toPx(value, rootFontSize),
  }));

  const resolvable = tokens
    .filter((token) => token.deprecated !== true)
    .map((token) => token.px)
    .filter((px): px is number => px !== null);

  const inference = inferBaseUnit(resolvable);

  return {
    tokens,
    baseUnit: inference.baseUnit,
    coverage: inference.coverage,
    confidence: inference.confidence satisfies BaseUnitConfidence,
    outliers: inference.outliers,
    rootFontSize,
  };
}

/** Finds the scale token closest to `px`, for fix suggestions. */
export function nearestSpacingToken(scale: SpacingScale, px: number): SpacingToken | null {
  return nearestPxToken(scale.tokens, px);
}

/** True when `px` exactly matches a non-deprecated token on the scale. */
export function isOnSpacingScale(scale: SpacingScale, px: number): boolean {
  return isOnPxScale(scale.tokens, px);
}
