/**
 * The token half of the normalized model: every token group, its schema, and
 * the builders parsers use to produce them.
 */

import { z } from 'zod';

import { ColorSystemSchema } from './color.js';
import { ScaleTokensSchema, TokenGroupSchema } from './scale.js';
import { ShadowSystemSchema } from './shadow.js';
import { SpacingScaleSchema } from './spacing.js';
import { TypographySystemSchema } from './typography.js';

export * from './color.js';
export * from './color-value.js';
export * from './px-token.js';
export * from './scale.js';
export * from './shadow.js';
export * from './spacing.js';
export * from './typography.js';

/**
 * Every token group Anchor understands.
 *
 * `custom` is the extensibility seam: token groups Anchor has no first-class
 * model for (z-index, breakpoints, animation curves) survive parsing and reach
 * the generators, so a team's context files stay complete even where the lint
 * rules have nothing to say yet.
 */
export const DesignTokensSchema = z.strictObject({
  spacing: SpacingScaleSchema,
  color: ColorSystemSchema,
  typography: TypographySystemSchema,
  borderRadius: ScaleTokensSchema,
  shadow: ShadowSystemSchema.optional(),
  custom: z.record(z.string(), TokenGroupSchema).optional(),
});
export type DesignTokens = z.infer<typeof DesignTokensSchema>;
