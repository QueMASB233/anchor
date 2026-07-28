/**
 * Generates a static snapshot of Tailwind v3's default theme.
 *
 * WHY THIS EXISTS
 * ---------------
 * Almost every real `tailwind.config.js` uses `theme.extend`, which merges into
 * Tailwind's defaults rather than replacing them. Without those defaults Anchor
 * would only see a team's handful of custom tokens, and would then flag `p-4`
 * as off-scale in a project where `p-4` is perfectly ordinary.
 *
 * Anchor must never execute the code of the project it lints — but this script
 * runs at *our* build time against *our own* pinned dependency, which is a
 * completely different trust relationship. The committed output is plain data,
 * so the parser itself stays fully static.
 *
 * Generating beats hand-writing: the palette alone is 242 hex values, and a
 * typo there would make `no-raw-hex-colors` suggest the wrong token forever.
 *
 * Run with: pnpm --filter @eleva/anchor-core run generate:tailwind-defaults
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import resolveConfig from 'tailwindcss/resolveConfig.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tailwindVersion = require('tailwindcss/package.json').version;

const OUTPUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'parsers',
  'tailwind',
  'default-theme.generated.ts',
);

/** Theme keys Anchor models. Everything else is intentionally dropped. */
const KEYS = [
  'spacing',
  'colors',
  'borderRadius',
  'boxShadow',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
];

const resolved = resolveConfig({ content: [] }).theme;

/**
 * Reduces a resolved theme value to plain JSON.
 *
 * Tailwind leaves a few values as arrays (font stacks, `fontSize` tuples of
 * `[size, { lineHeight }]`). Those are preserved as-is; the parser understands
 * both shapes. Anything still a function after resolution is dropped, since it
 * cannot be represented as static data.
 */
function toPlain(value) {
  if (typeof value === 'function') return undefined;
  if (Array.isArray(value)) return value.map(toPlain).filter((v) => v !== undefined);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      const plain = toPlain(nested);
      if (plain !== undefined) out[key] = plain;
    }
    return out;
  }
  return value;
}

const theme = {};
for (const key of KEYS) {
  const plain = toPlain(resolved[key]);
  if (plain !== undefined) theme[key] = plain;
}

const banner = `/**
 * Tailwind v3 default theme — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Regenerate with:
 *   pnpm --filter @eleva/anchor-core run generate:tailwind-defaults
 *
 * Snapshot of tailwindcss@${tailwindVersion} defaults, needed because
 * \`theme.extend\` merges into these rather than replacing them. See
 * scripts/generate-tailwind-defaults.mjs for why this is generated rather
 * than resolved at runtime.
 */

import type { TailwindThemeValue } from './theme-types.js';

export const TAILWIND_VERSION_SNAPSHOT = '${tailwindVersion}';

export const TAILWIND_DEFAULT_THEME: Record<string, TailwindThemeValue> = `;

writeFileSync(OUTPUT, `${banner}${JSON.stringify(theme, null, 2)};\n`, 'utf8');

const colorFamilies = Object.keys(theme.colors ?? {}).length;
const spacingSteps = Object.keys(theme.spacing ?? {}).length;
console.log(
  `Wrote ${OUTPUT}\n  tailwindcss@${tailwindVersion}: ${colorFamilies} colour entries, ${spacingSteps} spacing steps`,
);
