/**
 * Tailwind v4 — CSS-first `@theme` blocks.
 *
 * v4 moved the design system out of JavaScript and into CSS custom properties,
 * which is a strictly better situation for Anchor: there is no code to avoid
 * executing, so this parser has none of v3's blind spots.
 *
 * The substantive difference is spacing. v4 defines a single multiplier:
 *
 *   @theme { --spacing: 0.25rem; }
 *
 * and every integer multiple is then a valid utility — `p-13` is legitimate in
 * v4 and a violation in v3. That is recorded as `dynamicMultiplier` on the
 * scale so rules test divisibility rather than set membership.
 */

import postcss, { type ChildNode, type Declaration } from 'postcss';

import {
  createColorSystem,
  createNamedTokens,
  createScaleTokens,
  createShadowSystem,
  createSpacingScale,
  createTypographySystem,
  createDesignSystem,
  toPx,
  type DesignSystem,
  type TokenGroup,
} from '../../model/index.js';
import type { ParserContext, ParserInput, ParseResult, ParseWarning } from '../types.js';

/**
 * Multiples of `--spacing` materialized as tokens so nearest-value suggestions
 * have something to point at. Mirrors Tailwind's own documented scale; the
 * authoritative membership test remains divisibility.
 */
const SPACING_STEPS = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44,
  48, 52, 56, 60, 64, 72, 80, 96,
];

/**
 * `--<namespace>-<name>` maps a custom property to a token group.
 * Order matters: `--font-weight-*` must be tested before `--font-*`.
 */
const NAMESPACES: readonly { prefix: string; group: string }[] = [
  { prefix: '--font-weight-', group: 'fontWeight' },
  { prefix: '--color-', group: 'colors' },
  { prefix: '--spacing-', group: 'spacing' },
  { prefix: '--radius-', group: 'borderRadius' },
  { prefix: '--shadow-', group: 'boxShadow' },
  { prefix: '--inset-shadow-', group: 'boxShadow' },
  { prefix: '--text-', group: 'fontSize' },
  { prefix: '--font-', group: 'fontFamily' },
  { prefix: '--leading-', group: 'lineHeight' },
  { prefix: '--tracking-', group: 'letterSpacing' },
  { prefix: '--breakpoint-', group: 'breakpoint' },
  { prefix: '--container-', group: 'container' },
  { prefix: '--ease-', group: 'ease' },
  { prefix: '--animate-', group: 'animate' },
  { prefix: '--blur-', group: 'blur' },
  { prefix: '--perspective-', group: 'perspective' },
  { prefix: '--aspect-', group: 'aspect' },
];

interface ThemeEntry {
  name: string;
  value: string;
  line?: number;
}

/** True when this at-rule introduces theme variables. */
function isThemeAtRule(node: ChildNode): boolean {
  return node.type === 'atrule' && (node.name === 'theme' || node.name === 'tw-theme');
}

/** Collects declarations from every `@theme` block, and from `:root` as a fallback. */
function collectDeclarations(
  css: string,
  file: string,
): {
  declarations: Declaration[];
  sawThemeBlock: boolean;
  warnings: ParseWarning[];
} {
  const warnings: ParseWarning[] = [];
  const declarations: Declaration[] = [];
  let sawThemeBlock = false;

  let root;
  try {
    root = postcss.parse(css, { from: file });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      declarations: [],
      sawThemeBlock: false,
      warnings: [{ code: 'parse-error', message: `Could not parse ${file}: ${message}`, file }],
    };
  }

  root.walkAtRules((atRule) => {
    if (!isThemeAtRule(atRule)) return;
    sawThemeBlock = true;
    atRule.walkDecls((declaration) => {
      if (declaration.prop.startsWith('--')) declarations.push(declaration);
    });
  });

  return { declarations, sawThemeBlock, warnings };
}

function classify(property: string): { group: string; name: string } | null {
  for (const { prefix, group } of NAMESPACES) {
    if (property.startsWith(prefix)) {
      const name = property.slice(prefix.length);
      if (name === '') return null;
      return { group, name };
    }
  }
  return null;
}

export function parseTailwindV4(input: ParserInput, options: ParserContext = {}): ParseResult {
  const { declarations, sawThemeBlock, warnings } = collectDeclarations(input.content, input.path);

  if (!sawThemeBlock && warnings.length === 0) {
    warnings.push({
      code: 'unsupported-construct',
      message: `No \`@theme\` block found in ${input.path}. Tailwind v4 declares design tokens inside \`@theme { ... }\`.`,
      file: input.path,
    });
  }

  const groups = new Map<string, ThemeEntry[]>();
  let spacingMultiplier: number | null = null;

  for (const declaration of declarations) {
    const property = declaration.prop;
    const value = declaration.value.trim();
    const line = declaration.source?.start?.line;

    // The bare `--spacing` is the multiplier for the whole computed scale.
    if (property === '--spacing') {
      const px = toPx(value, options.rootFontSize);
      if (px === null || px <= 0) {
        warnings.push({
          code: 'unresolvable-value',
          message: `\`--spacing: ${value}\` in ${input.path} is not a fixed length, so Anchor could not derive the spacing scale from it.`,
          file: input.path,
          path: '--spacing',
          ...(line === undefined ? {} : { line }),
        });
      } else {
        spacingMultiplier = px;
      }
      continue;
    }

    const classified = classify(property);
    if (classified === null) continue;

    const entries = groups.get(classified.group) ?? [];
    entries.push({
      name: classified.name,
      value,
      ...(line === undefined ? {} : { line }),
    });
    groups.set(classified.group, entries);
  }

  const entriesOf = (group: string): ThemeEntry[] => groups.get(group) ?? [];
  const toInput = (entry: ThemeEntry) => ({
    name: entry.name,
    value: entry.value,
    provenance: { file: input.path, path: entry.name },
  });

  const scaleOptions =
    options.rootFontSize === undefined ? {} : { rootFontSize: options.rootFontSize };

  // Materialize the computed scale so suggestions have concrete tokens.
  const declaredSpacing = entriesOf('spacing').map(toInput);
  const spacingInputs =
    spacingMultiplier === null
      ? declaredSpacing
      : [
          ...SPACING_STEPS.map((step) => ({
            name: String(step),
            value: `${step * spacingMultiplier}px`,
            provenance: { file: input.path, path: '--spacing' },
          })),
          ...declaredSpacing,
        ];

  const shadowEntries = entriesOf('boxShadow');
  const custom: Record<string, TokenGroup> = {};
  for (const [group, entries] of groups) {
    if (
      [
        'colors',
        'spacing',
        'borderRadius',
        'boxShadow',
        'fontSize',
        'fontFamily',
        'fontWeight',
        'lineHeight',
        'letterSpacing',
      ].includes(group)
    ) {
      continue;
    }
    custom[group] = createScaleTokens(entries.map(toInput), scaleOptions);
  }

  const designSystem: DesignSystem = createDesignSystem({
    meta: {
      name: options.name ?? 'Tailwind design system',
      source: 'tailwind',
      sourceFiles: [input.path],
    },
    tokens: {
      spacing: createSpacingScale(spacingInputs, {
        ...scaleOptions,
        ...(spacingMultiplier === null ? {} : { dynamicMultiplier: spacingMultiplier }),
      }),
      color: createColorSystem(entriesOf('colors').map(toInput)),
      typography: createTypographySystem({
        fontFamilies: createNamedTokens(entriesOf('fontFamily').map(toInput)),
        fontSizes: createScaleTokens(entriesOf('fontSize').map(toInput), scaleOptions),
        fontWeights: createNamedTokens(entriesOf('fontWeight').map(toInput)),
        lineHeights: createNamedTokens(entriesOf('lineHeight').map(toInput)),
        letterSpacings: createScaleTokens(entriesOf('letterSpacing').map(toInput), scaleOptions),
      }),
      borderRadius: createScaleTokens(entriesOf('borderRadius').map(toInput), scaleOptions),
      ...(shadowEntries.length === 0
        ? {}
        : { shadow: createShadowSystem(shadowEntries.map(toInput)) }),
      ...(Object.keys(custom).length === 0 ? {} : { custom }),
    },
  });

  return { designSystem, warnings };
}
