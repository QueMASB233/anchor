/**
 * Colour tokens.
 *
 * Two kinds of colour token exist and the distinction drives a real rule.
 * A *palette* token names a raw colour (`blue-500`). A *semantic* token names
 * an intent (`text-secondary`) and usually points at a palette token.
 * `use-design-tokens` exists to nudge authors from the former to the latter, so
 * the model has to be able to tell them apart and to walk from one to the other.
 */

import { z } from 'zod';

import { TokenNameSchema, type TokenMeta, tokenMetaShape } from '../common.js';
import { normalizeColor } from './color-value.js';

export const ColorTokenKindSchema = z.enum(['palette', 'semantic']);
export type ColorTokenKind = z.infer<typeof ColorTokenKindSchema>;

export const ColorTokenSchema = z.strictObject({
  ...tokenMetaShape,
  name: TokenNameSchema,
  /** The value exactly as authored, e.g. `"#2D3748"` or `"hsl(210 40% 96%)"`. */
  value: z.string(),
  /** Canonical lowercase `#rrggbb`, or `null` if the value is not a concrete colour. */
  hex: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .nullable(),
  /** Opacity 0–1, kept separate from `hex` so tokens match regardless of opacity. */
  alpha: z.number().min(0).max(1),
  kind: ColorTokenKindSchema,
  /** For semantic tokens, the palette token this one resolves to, when known. */
  reference: TokenNameSchema.optional(),
  /** Palette family, e.g. `"blue"` in `blue-500`. */
  family: z.string().optional(),
  /** Palette step, e.g. `"500"` in `blue-500`. */
  shade: z.string().optional(),
});
export type ColorToken = z.infer<typeof ColorTokenSchema>;

export const ColorSystemSchema = z.strictObject({
  tokens: z.array(ColorTokenSchema),
});
export type ColorSystem = z.infer<typeof ColorSystemSchema>;

/** What a parser hands to {@link createColorSystem}, before normalization. */
export interface ColorTokenInput extends TokenMeta {
  name: string;
  value: string;
  kind?: ColorTokenKind;
  reference?: string;
  family?: string;
  shade?: string;
}

/**
 * Splits a palette-style name into family and shade.
 *
 * Handles the three separators in the wild: `blue-500`, `blue.500`, and
 * `color/blue/500`. Returns `null` when the name carries no numeric step,
 * which is the usual signal that a token is semantic rather than palette.
 */
export function splitPaletteName(name: string): { family: string; shade: string } | null {
  const match = /^(.+)[-./](\d{2,4})$/.exec(name);
  if (match === null) return null;

  const [, family, shade] = match;
  if (family === undefined || shade === undefined || family === '') return null;

  return { family, shade };
}

/**
 * Builds a {@link ColorSystem}, normalizing every value and filling in the
 * palette/semantic classification where a parser did not state it.
 *
 * The classification heuristic is deliberately simple: a name ending in a
 * numeric step is a palette entry, anything else is semantic. Parsers that
 * know better (W3C DTCG groups, Figma collections) should pass `kind`
 * explicitly rather than rely on the guess.
 */
export function createColorSystem(inputs: readonly ColorTokenInput[]): ColorSystem {
  const tokens: ColorToken[] = inputs.map(({ name, value, kind, family, shade, ...rest }) => {
    const parts = splitPaletteName(name);
    const normalized = normalizeColor(value);

    const resolvedFamily = family ?? parts?.family;
    const resolvedShade = shade ?? parts?.shade;

    return {
      ...rest,
      name,
      value,
      hex: normalized?.hex ?? null,
      alpha: normalized?.alpha ?? 1,
      kind: kind ?? (parts === null ? 'semantic' : 'palette'),
      ...(resolvedFamily === undefined ? {} : { family: resolvedFamily }),
      ...(resolvedShade === undefined ? {} : { shade: resolvedShade }),
    };
  });

  return { tokens };
}

/** All tokens whose colour matches `hex`, ignoring opacity. */
export function findColorTokensByHex(system: ColorSystem, hex: string): ColorToken[] {
  const target = hex.toLowerCase();
  return system.tokens.filter((token) => token.hex === target && token.deprecated !== true);
}

/**
 * Semantic tokens that resolve to the same colour as `token`, for
 * `use-design-tokens` suggestions.
 *
 * Matches both by explicit reference and by resolved colour, since plenty of
 * design systems duplicate the hex into the semantic layer instead of aliasing.
 */
export function findSemanticAlternatives(system: ColorSystem, token: ColorToken): ColorToken[] {
  return system.tokens.filter(
    (candidate) =>
      candidate.kind === 'semantic' &&
      candidate.deprecated !== true &&
      candidate.name !== token.name &&
      (candidate.reference === token.name ||
        (candidate.hex !== null && candidate.hex === token.hex)),
  );
}
