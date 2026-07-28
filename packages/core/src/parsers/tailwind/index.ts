/**
 * Tailwind parser — dispatches between the v3 JS config and the v4 CSS `@theme`.
 *
 * Detection is by unambiguous signal rather than by scoring: a `@theme` block
 * or a `@import "tailwindcss"` means v4, a config file with a `theme` key means
 * v3. Both can legitimately be present during a migration, in which case the
 * caller passes both files and v4 wins, matching Tailwind's own precedence.
 */

import type { Parser, ParserContext, ParserInput, ParseResult } from '../types.js';
import { parseTailwindV3 } from './v3-config.js';
import { parseTailwindV4 } from './v4-theme.js';

export * from './theme-to-model.js';
export * from './theme-types.js';
export { parseTailwindV3, resolveTailwindTheme } from './v3-config.js';
export { parseTailwindV4 } from './v4-theme.js';
export { TAILWIND_DEFAULT_THEME, TAILWIND_VERSION_SNAPSHOT } from './default-theme.generated.js';

const CONFIG_FILE = /(^|[/\\])tailwind\.config\.(js|cjs|mjs|ts|mts|cts)$/;
const THEME_BLOCK = /@theme\b/;
const TAILWIND_IMPORT = /@import\s+["']tailwindcss/;
const TAILWIND_DIRECTIVE = /@tailwind\s+(base|components|utilities)/;

export type TailwindFlavor = 'v3-config' | 'v4-css';

/** Identifies which Tailwind flavour a file represents, if any. */
export function detectTailwindFlavor(input: ParserInput): TailwindFlavor | null {
  if (THEME_BLOCK.test(input.content) || TAILWIND_IMPORT.test(input.content)) {
    return 'v4-css';
  }
  if (CONFIG_FILE.test(input.path)) {
    return 'v3-config';
  }
  // A CSS file with only `@tailwind` directives is v3, and carries no tokens.
  return null;
}

export const tailwindParser: Parser = {
  format: 'tailwind',
  displayName: 'Tailwind CSS',

  detect(input: ParserInput): number {
    if (THEME_BLOCK.test(input.content)) return 1;
    if (TAILWIND_IMPORT.test(input.content)) return 0.9;
    if (CONFIG_FILE.test(input.path)) return 0.95;
    if (TAILWIND_DIRECTIVE.test(input.content)) return 0.4;
    return 0;
  },

  parse(inputs: readonly ParserInput[], context: ParserContext = {}): ParseResult {
    const v4 = inputs.find((input) => detectTailwindFlavor(input) === 'v4-css');
    if (v4 !== undefined) return parseTailwindV4(v4, context);

    const v3 = inputs.find((input) => CONFIG_FILE.test(input.path)) ?? inputs[0];
    if (v3 === undefined) {
      throw new Error('The Tailwind parser was called with no input files.');
    }
    return parseTailwindV3(v3, context);
  },
};
