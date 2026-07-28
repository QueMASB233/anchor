/**
 * Primitives shared across the whole normalized model.
 *
 * Types are derived from the zod schemas rather than declared alongside them,
 * so a schema and its type cannot drift apart.
 */

import { z } from 'zod';

/**
 * Bumped whenever the shape of {@link DesignSystem} changes incompatibly.
 * Forms part of the cache key so a stale `.anchor/cache.json` written by an
 * older Anchor is discarded rather than misinterpreted.
 */
export const MODEL_SCHEMA_VERSION = 1;

/** Input formats Anchor can normalize a design system from. */
export const SOURCE_FORMATS = [
  'tailwind',
  'style-dictionary',
  'w3c-dtcg',
  'figma-variables',
  'css-variables',
  'unknown',
] as const;

export const SourceFormatSchema = z.enum(SOURCE_FORMATS);
export type SourceFormat = z.infer<typeof SourceFormatSchema>;

/** Severity of a rule or violation. `off` disables a rule entirely. */
export const SeveritySchema = z.enum(['error', 'warning', 'off']);
export type Severity = z.infer<typeof SeveritySchema>;

/** Severity a violation can actually carry — `off` rules never emit one. */
export const ViolationSeveritySchema = z.enum(['error', 'warning']);
export type ViolationSeverity = z.infer<typeof ViolationSeveritySchema>;

/**
 * A token identifier as authored by the team.
 *
 * Deliberately permissive: Figma uses slashes (`color/primary/500`), Style
 * Dictionary uses dots, Tailwind uses dashes. Anchor preserves whatever the
 * team wrote so generated docs and fix suggestions use their vocabulary. The
 * only constraints are non-emptiness and the absence of control characters,
 * which would corrupt terminal and Markdown output downstream.
 */
export const TokenNameSchema = z
  .string()
  .min(1, { error: 'Token names cannot be empty.' })
  .max(200, { error: 'Token names longer than 200 characters are almost certainly a parse error.' })
  // eslint-disable-next-line no-control-regex -- deliberately matching control chars to reject them
  .refine((name) => !/[\u0000-\u001F\u007F]/.test(name), {
    error: 'Token names cannot contain control characters.',
  })
  .refine((name) => name.trim() === name, {
    error: 'Token names cannot have leading or trailing whitespace.',
  });

/**
 * Where a token came from. Provenance matters because config-declared data
 * outranks anything Anchor inferred from source files, and because error
 * messages that name the originating file are far more actionable.
 */
export const ProvenanceSchema = z.strictObject({
  /** File the token was read from, relative to the project root. */
  file: z.string().optional(),
  /** Path within that file, e.g. `theme.extend.spacing.4` or `color/primary/500`. */
  path: z.string().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * Fields every token carries, regardless of what kind of value it holds.
 *
 * Exported as a raw shape so token schemas can spread it into their own
 * `z.strictObject(...)` call. Spreading rather than calling `.extend()` keeps
 * strictness explicit at every use site: an unknown key anywhere in the model
 * means a parser produced something we did not intend, and should fail loudly.
 */
export const tokenMetaShape = {
  /** Human description, surfaced verbatim in generated context files. */
  description: z.string().optional(),
  /** Deprecated tokens are documented but never suggested as a fix. */
  deprecated: z.boolean().optional(),
  /** Alternative names that resolve to this token. */
  aliases: z.array(TokenNameSchema).optional(),
  /**
   * Theme or mode this token belongs to, e.g. `light` / `dark`. Undefined means
   * the token applies to every mode. Multi-mode enforcement is not implemented
   * in v1; the field exists so adding it later is not a model migration.
   */
  mode: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
} as const;

export const TokenMetaSchema = z.strictObject(tokenMetaShape);
export type TokenMeta = z.infer<typeof TokenMetaSchema>;

/**
 * Formats a zod validation failure into something a developer can act on.
 * Used at every boundary where untrusted or external data enters the model.
 */
export function formatValidationError(error: z.ZodError, subject: string): string {
  return `${subject} failed validation:\n${z.prettifyError(error)}`;
}

/** Thrown when data crossing a model boundary does not match its schema. */
export class ModelValidationError extends Error {
  override readonly name = 'ModelValidationError';

  constructor(
    readonly subject: string,
    readonly issues: z.core.$ZodIssue[],
    message: string,
  ) {
    super(message);
  }

  static from(error: z.ZodError, subject: string): ModelValidationError {
    return new ModelValidationError(subject, error.issues, formatValidationError(error, subject));
  }
}
