/**
 * A value as it appears in a Tailwind theme.
 *
 * Recursive because Tailwind mixes shapes freely: `fontSize` entries are
 * `[size, { lineHeight }]` tuples, `fontFamily` entries are string arrays, and
 * `colors` nests groups arbitrarily deep.
 */
export type TailwindThemeValue =
  string | number | readonly TailwindThemeValue[] | { readonly [key: string]: TailwindThemeValue };
