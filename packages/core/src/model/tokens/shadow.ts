/**
 * Shadow tokens.
 *
 * `no-custom-shadows` flags arbitrary values like `shadow-[0_4px_8px_rgba(0,0,0,.1)]`.
 * To tell "arbitrary" from "the team's `shadow-md` written the long way", the
 * rule compares against a whitespace- and notation-normalized form, since
 * `0 4px 8px` and `0_4px_8px` are the same shadow written for different places.
 */

import { z } from 'zod';

import { TokenNameSchema, type TokenMeta, tokenMetaShape } from '../common.js';

export const ShadowTokenSchema = z.strictObject({
  ...tokenMetaShape,
  name: TokenNameSchema,
  /** The value exactly as authored. */
  value: z.string(),
  /** Comparable form: lowercased, single-spaced, with Tailwind underscores expanded. */
  normalized: z.string(),
});
export type ShadowToken = z.infer<typeof ShadowTokenSchema>;

export const ShadowSystemSchema = z.strictObject({
  tokens: z.array(ShadowTokenSchema),
});
export type ShadowSystem = z.infer<typeof ShadowSystemSchema>;

export interface ShadowTokenInput extends TokenMeta {
  name: string;
  value: string;
}

/**
 * Reduces a shadow to a comparable string.
 *
 * Tailwind arbitrary values encode spaces as underscores (`0_4px_8px`), so
 * those are expanded first. Whitespace around commas is collapsed, colour
 * notation is lowercased, and a leading `0px` is left alone — normalizing
 * lengths here would require parsing the whole shadow grammar for very little
 * gain, since teams write their own tokens consistently.
 */
export function normalizeShadow(raw: string): string {
  return raw
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createShadowSystem(inputs: readonly ShadowTokenInput[]): ShadowSystem {
  return {
    tokens: inputs.map(({ name, value, ...meta }) => ({
      ...meta,
      name,
      value,
      normalized: normalizeShadow(value),
    })),
  };
}

/** Finds a shadow token matching `value`, ignoring notation differences. */
export function findShadowToken(system: ShadowSystem, value: string): ShadowToken | null {
  const target = normalizeShadow(value);
  return system.tokens.find((token) => token.normalized === target) ?? null;
}
