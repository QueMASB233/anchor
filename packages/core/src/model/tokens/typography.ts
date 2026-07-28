/**
 * Typography tokens.
 *
 * Typography is the token group where teams diverge most: some ship a flat
 * font-size scale, others ship composite "text styles" that bundle size,
 * weight and line height under one name. The model carries both, because
 * generated context files should describe whichever the team actually uses.
 */

import { z } from 'zod';

import { TokenNameSchema } from '../common.js';
import {
  emptyNamedTokens,
  emptyScale,
  NamedTokensSchema,
  ScaleTokensSchema,
  type NamedTokens,
  type ScaleTokens,
} from './scale.js';

/**
 * A named bundle of typography properties, e.g. `heading-1`.
 * Each field holds the *name* of a token in the corresponding group, so a text
 * style stays consistent with the scales it is built from.
 */
export const TextStyleSchema = z.strictObject({
  name: TokenNameSchema,
  description: z.string().optional(),
  fontFamily: TokenNameSchema.optional(),
  fontSize: TokenNameSchema.optional(),
  fontWeight: TokenNameSchema.optional(),
  lineHeight: TokenNameSchema.optional(),
  letterSpacing: TokenNameSchema.optional(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const TypographySystemSchema = z.strictObject({
  /** Font stacks, e.g. `sans` -> `"Inter, system-ui, sans-serif"`. */
  fontFamilies: NamedTokensSchema,
  /** Font sizes, normalized to pixels where possible. */
  fontSizes: ScaleTokensSchema,
  /** Weights, kept as authored (`"600"`, `"semibold"`) rather than coerced. */
  fontWeights: NamedTokensSchema,
  /** Line heights, which may be unitless ratios or lengths, so no `px`. */
  lineHeights: NamedTokensSchema,
  /** Letter spacing, normalized to pixels where possible. */
  letterSpacings: ScaleTokensSchema,
  /** Composite styles, when the team defines them. */
  textStyles: z.array(TextStyleSchema),
});
export type TypographySystem = z.infer<typeof TypographySystemSchema>;

/** A typography system with every group empty. */
export function emptyTypographySystem(): TypographySystem {
  return {
    fontFamilies: emptyNamedTokens(),
    fontSizes: emptyScale(),
    fontWeights: emptyNamedTokens(),
    lineHeights: emptyNamedTokens(),
    letterSpacings: emptyScale(),
    textStyles: [],
  };
}

/** Fills in any group a parser did not produce, so consumers never see `undefined`. */
export function createTypographySystem(
  partial: Partial<{
    fontFamilies: NamedTokens;
    fontSizes: ScaleTokens;
    fontWeights: NamedTokens;
    lineHeights: NamedTokens;
    letterSpacings: ScaleTokens;
    textStyles: TextStyle[];
  }>,
): TypographySystem {
  return { ...emptyTypographySystem(), ...partial };
}
