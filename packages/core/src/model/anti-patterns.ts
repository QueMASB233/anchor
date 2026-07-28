/**
 * Team-defined anti-patterns.
 *
 * An escape hatch for constraints the eight built-in rules do not express —
 * "never use the legacy `LegacyModal`", "no `!important` in class names".
 *
 * SECURITY: matchers are declarative data, never code. There is no callback
 * form and no expression evaluator, because anti-patterns arrive from
 * `anchor.config`, and in the GitHub Action that config comes from the pull
 * request under test — which is attacker-controlled. A matcher that could
 * execute would be remote code execution on the CI runner.
 *
 * The regex matcher is the one remaining sharp edge: a catastrophically
 * backtracking pattern could hang a runner even without executing anything.
 * The schema caps pattern length and rejects the constructs most associated
 * with exponential backtracking; the engine additionally runs every pattern
 * under a time budget. Both layers are needed — neither is sufficient alone.
 */

import { z } from 'zod';

import { SeveritySchema } from './common.js';

/** Upper bound on a user-supplied pattern. Real ones are far shorter. */
const MAX_PATTERN_LENGTH = 500;

/**
 * Rejects nested unbounded quantifiers such as `(a+)+` or `(a*)*`, the classic
 * shape behind exponential backtracking.
 *
 * This is a heuristic, not a proof of safety, and is intentionally paired with
 * the engine's execution timeout rather than trusted on its own.
 */
const NESTED_QUANTIFIER = /\([^)]*[+*]\)\s*[+*]/;

const SafeRegexSourceSchema = z
  .string()
  .min(1)
  .max(MAX_PATTERN_LENGTH, {
    error: `Anti-pattern regexes are limited to ${MAX_PATTERN_LENGTH} characters.`,
  })
  .refine((source) => !NESTED_QUANTIFIER.test(source), {
    error:
      'This pattern nests unbounded quantifiers, which risks catastrophic backtracking. Rewrite it without a repeated group that itself repeats.',
  })
  .refine(
    (source) => {
      try {
        new RegExp(source);
        return true;
      } catch {
        return false;
      }
    },
    { error: 'Not a valid regular expression.' },
  );

/** Regex flags a user may set. `g` and `y` are excluded: stateful `lastIndex` makes matching order-dependent. */
const RegexFlagsSchema = z
  .string()
  .max(4)
  .refine((flags) => /^[imsu]*$/.test(flags), {
    error: 'Only the i, m, s and u regex flags are supported.',
  });

/** Matches a class name anywhere in the file against a regular expression. */
const ClassNameRegexMatcherSchema = z.strictObject({
  kind: z.literal('class-name-regex'),
  pattern: SafeRegexSourceSchema,
  flags: RegexFlagsSchema.optional(),
});

/** Matches a JSX element, optionally narrowed to a prop or a specific prop value. */
const JsxElementMatcherSchema = z.strictObject({
  kind: z.literal('jsx-element'),
  /** Element name, e.g. `LegacyModal`. */
  element: z.string().min(1),
  /** When set, only matches when this prop is present. */
  withProp: z.string().min(1).optional(),
  /** When set alongside `withProp`, only matches this literal prop value. */
  propValue: z.string().optional(),
});

/** Matches a specific CSS property used in an inline `style` object. */
const InlineStylePropertyMatcherSchema = z.strictObject({
  kind: z.literal('inline-style-property'),
  /** Property name in camelCase, as written in JSX, e.g. `zIndex`. */
  property: z.string().min(1),
});

/** Matches an import from a specific module, for retiring deprecated packages. */
const ImportSourceMatcherSchema = z.strictObject({
  kind: z.literal('import-source'),
  /** Module specifier, e.g. `@acme/legacy-ui`. */
  source: z.string().min(1),
  /** When set, only matches these named imports. */
  imported: z.array(z.string().min(1)).optional(),
});

export const AntiPatternMatcherSchema = z.discriminatedUnion('kind', [
  ClassNameRegexMatcherSchema,
  JsxElementMatcherSchema,
  InlineStylePropertyMatcherSchema,
  ImportSourceMatcherSchema,
]);
export type AntiPatternMatcher = z.infer<typeof AntiPatternMatcherSchema>;

export const AntiPatternSchema = z.strictObject({
  /** Stable identifier, reported as the rule id and usable for suppression. */
  id: z.string().min(1),
  /** Explains what is wrong. Shown verbatim to the developer. */
  description: z.string().min(1),
  matcher: AntiPatternMatcherSchema,
  /** Human guidance on what to do instead. Never applied automatically. */
  fix: z.string().optional(),
  severity: SeveritySchema,
});
export type AntiPattern = z.infer<typeof AntiPatternSchema>;
