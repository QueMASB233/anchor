/**
 * The normalized design system — the contract every other part of Anchor
 * depends on.
 *
 * Every parser produces one of these. Every generator and lint rule consumes
 * one. Nothing downstream of parsing knows or cares whether the tokens
 * originated in Tailwind, Figma, or a pile of CSS custom properties, which is
 * what lets a new input format ship without touching rule logic.
 *
 * Validation happens at the boundary — on the way out of a parser and on the
 * way in from a cache file — rather than continuously. Inside the engine the
 * model is trusted, because it has already been checked.
 */

import { z } from 'zod';

import { AntiPatternSchema } from './anti-patterns.js';
import { ModelValidationError, MODEL_SCHEMA_VERSION, SourceFormatSchema } from './common.js';
import { ComponentInventorySchema, CompositionRuleSchema } from './components.js';
import { DesignTokensSchema } from './tokens/index.js';
import { createColorSystem } from './tokens/color.js';
import { emptyScale } from './tokens/scale.js';
import { createSpacingScale } from './tokens/spacing.js';
import { emptyTypographySystem } from './tokens/typography.js';

export const DesignSystemMetaSchema = z.strictObject({
  /** Display name, used in generated context files. */
  name: z.string().min(1),
  /** The team's own version string, when the source declares one. */
  version: z.string().optional(),
  source: SourceFormatSchema,
  /** ISO-8601 timestamp of when parsing produced this model. */
  parsedAt: z.iso.datetime(),
  /**
   * Version of the model shape itself. Persisted into the cache so a model
   * written by an older Anchor is discarded rather than misread.
   */
  schemaVersion: z.literal(MODEL_SCHEMA_VERSION),
  /** Files this system was parsed from, relative to the project root. */
  sourceFiles: z.array(z.string()).optional(),
});
export type DesignSystemMeta = z.infer<typeof DesignSystemMetaSchema>;

export const DesignSystemSchema = z.strictObject({
  meta: DesignSystemMetaSchema,
  tokens: DesignTokensSchema,
  components: ComponentInventorySchema.optional(),
  compositionRules: z.array(CompositionRuleSchema).optional(),
  antiPatterns: z.array(AntiPatternSchema).optional(),
});
export type DesignSystem = z.infer<typeof DesignSystemSchema>;

/**
 * Validates untrusted data as a {@link DesignSystem}.
 *
 * @throws {ModelValidationError} with a human-readable summary of every issue.
 */
export function parseDesignSystem(input: unknown, subject = 'Design system'): DesignSystem {
  const result = DesignSystemSchema.safeParse(input);
  if (!result.success) {
    throw ModelValidationError.from(result.error, subject);
  }
  return result.data;
}

/** Non-throwing variant of {@link parseDesignSystem}. */
export function safeParseDesignSystem(
  input: unknown,
): { success: true; data: DesignSystem } | { success: false; error: ModelValidationError } {
  const result = DesignSystemSchema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: ModelValidationError.from(result.error, 'Design system') };
}

/** The parts of a design system a parser must supply; everything else defaults. */
export interface CreateDesignSystemInput {
  meta: Omit<DesignSystemMeta, 'schemaVersion' | 'parsedAt'> & { parsedAt?: string };
  tokens?: Partial<DesignSystem['tokens']>;
  components?: DesignSystem['components'];
  compositionRules?: DesignSystem['compositionRules'];
  antiPatterns?: DesignSystem['antiPatterns'];
}

/**
 * Assembles a valid {@link DesignSystem} from partial parser output, filling in
 * empty token groups and stamping the schema version and timestamp.
 *
 * Parsers should always build through this rather than constructing the object
 * literally, so a newly added token group cannot be silently omitted by an
 * older parser and surface as `undefined` inside a rule.
 */
export function createDesignSystem(input: CreateDesignSystemInput): DesignSystem {
  const { parsedAt, ...meta } = input.meta;

  const system: DesignSystem = {
    meta: {
      ...meta,
      parsedAt: parsedAt ?? new Date().toISOString(),
      schemaVersion: MODEL_SCHEMA_VERSION,
    },
    tokens: {
      spacing: input.tokens?.spacing ?? createSpacingScale([]),
      color: input.tokens?.color ?? createColorSystem([]),
      typography: input.tokens?.typography ?? emptyTypographySystem(),
      borderRadius: input.tokens?.borderRadius ?? emptyScale(),
      ...(input.tokens?.shadow === undefined ? {} : { shadow: input.tokens.shadow }),
      ...(input.tokens?.custom === undefined ? {} : { custom: input.tokens.custom }),
    },
    ...(input.components === undefined ? {} : { components: input.components }),
    ...(input.compositionRules === undefined ? {} : { compositionRules: input.compositionRules }),
    ...(input.antiPatterns === undefined ? {} : { antiPatterns: input.antiPatterns }),
  };

  // Validate on the way out of every parser: a parser bug should surface here,
  // with a precise path, rather than as a confusing failure inside a rule.
  return parseDesignSystem(system, 'Parser output');
}

/** True when the model carries no tokens at all — usually a failed detection. */
export function isEmptyDesignSystem(system: DesignSystem): boolean {
  const { spacing, color, typography, borderRadius, shadow, custom } = system.tokens;

  return (
    spacing.tokens.length === 0 &&
    color.tokens.length === 0 &&
    borderRadius.tokens.length === 0 &&
    (shadow?.tokens.length ?? 0) === 0 &&
    typography.fontSizes.tokens.length === 0 &&
    typography.fontFamilies.tokens.length === 0 &&
    typography.fontWeights.tokens.length === 0 &&
    typography.lineHeights.tokens.length === 0 &&
    typography.letterSpacings.tokens.length === 0 &&
    typography.textStyles.length === 0 &&
    Object.keys(custom ?? {}).length === 0
  );
}

/** Total count of tokens across every group, for `anchor sync` summaries. */
export function countTokens(system: DesignSystem): number {
  const { spacing, color, typography, borderRadius, shadow, custom } = system.tokens;

  const customCount = Object.values(custom ?? {}).reduce(
    (total, group) => total + group.tokens.length,
    0,
  );

  return (
    spacing.tokens.length +
    color.tokens.length +
    borderRadius.tokens.length +
    (shadow?.tokens.length ?? 0) +
    typography.fontFamilies.tokens.length +
    typography.fontSizes.tokens.length +
    typography.fontWeights.tokens.length +
    typography.lineHeights.tokens.length +
    typography.letterSpacings.tokens.length +
    typography.textStyles.length +
    customCount
  );
}
