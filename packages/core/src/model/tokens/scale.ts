/**
 * Generic named scales.
 *
 * Border radius, z-index, breakpoints, and any team-specific group the `custom`
 * escape hatch carries all share one shape: named entries with a raw value and,
 * where meaningful, a pixel equivalent.
 */

import { z } from 'zod';

import { TokenNameSchema, type TokenMeta, tokenMetaShape } from '../common.js';
import { DEFAULT_ROOT_FONT_SIZE, toPx } from '../units.js';
import { isOnPxScale, nearestPxToken } from './px-token.js';

export const ScaleTokenSchema = z.strictObject({
  ...tokenMetaShape,
  name: TokenNameSchema,
  /** The value exactly as authored. */
  value: z.string(),
  /** Pixel equivalent, or `null` where the value is not a length (`9999`, `50%`). */
  px: z.number().nullable(),
});
export type ScaleToken = z.infer<typeof ScaleTokenSchema>;

export const ScaleTokensSchema = z.strictObject({
  tokens: z.array(ScaleTokenSchema),
});
export type ScaleTokens = z.infer<typeof ScaleTokensSchema>;

/**
 * An arbitrary group of tokens Anchor has no first-class model for.
 * Structurally identical to a scale; named separately so the intent at the use
 * site is clear.
 */
export const TokenGroupSchema = ScaleTokensSchema;
export type TokenGroup = ScaleTokens;

export interface ScaleTokenInput extends TokenMeta {
  name: string;
  value: string | number;
}

export function createScaleTokens(
  inputs: readonly ScaleTokenInput[],
  options: { rootFontSize?: number } = {},
): ScaleTokens {
  const rootFontSize = options.rootFontSize ?? DEFAULT_ROOT_FONT_SIZE;

  return {
    tokens: inputs.map(({ name, value, ...meta }) => ({
      ...meta,
      name,
      value: String(value),
      px: toPx(value, rootFontSize),
    })),
  };
}

/** Finds the scale entry closest to `px`. */
export function nearestScaleToken(scale: ScaleTokens, px: number): ScaleToken | null {
  return nearestPxToken(scale.tokens, px);
}

/** True when `px` exactly matches a non-deprecated entry. */
export function isOnScale(scale: ScaleTokens, px: number): boolean {
  return isOnPxScale(scale.tokens, px);
}

/** An empty scale, used as the default for optional token groups. */
export function emptyScale(): ScaleTokens {
  return { tokens: [] };
}

/**
 * A token whose value is not a length — font stacks, font weights, easing
 * curves. Carries no `px`, because inventing one would invite rules to compare
 * values that are not comparable.
 */
export const NamedTokenSchema = z.strictObject({
  ...tokenMetaShape,
  name: TokenNameSchema,
  value: z.string(),
});
export type NamedToken = z.infer<typeof NamedTokenSchema>;

export const NamedTokensSchema = z.strictObject({
  tokens: z.array(NamedTokenSchema),
});
export type NamedTokens = z.infer<typeof NamedTokensSchema>;

export interface NamedTokenInput extends TokenMeta {
  name: string;
  value: string | number;
}

export function createNamedTokens(inputs: readonly NamedTokenInput[]): NamedTokens {
  return {
    tokens: inputs.map(({ name, value, ...meta }) => ({ ...meta, name, value: String(value) })),
  };
}

/** An empty named-token group, used as the default for optional groups. */
export function emptyNamedTokens(): NamedTokens {
  return { tokens: [] };
}
