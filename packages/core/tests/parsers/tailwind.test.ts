import { describe, expect, it } from 'vitest';

import { isOnSpacingScale, nearestSpacingToken } from '../../src/model/index.js';
import {
  detectTailwindFlavor,
  parseTailwindV3,
  parseTailwindV4,
  resolveTailwindTheme,
  tailwindParser,
} from '../../src/parsers/tailwind/index.js';

const file = 'tailwind.config.js';

function parseV3(content: string, options = {}) {
  return parseTailwindV3({ path: file, content }, options);
}

describe('resolveTailwindTheme', () => {
  it('lets a top-level key replace the default group outright', () => {
    const resolved = resolveTailwindTheme({ spacing: { sm: '4px' } });
    expect(resolved['spacing']).toEqual({ sm: '4px' });
  });

  it('leaves other default groups intact when one is replaced', () => {
    const resolved = resolveTailwindTheme({ spacing: { sm: '4px' } });
    expect(resolved['borderRadius']).toHaveProperty('md');
  });

  it('merges `extend` into the defaults rather than replacing them', () => {
    const resolved = resolveTailwindTheme({ extend: { spacing: { huge: '200px' } } });
    const spacing = resolved['spacing'] as Record<string, string>;
    expect(spacing['huge']).toBe('200px');
    expect(spacing['4']).toBe('1rem');
  });

  it('merges `extend` deeply into nested colour groups', () => {
    const resolved = resolveTailwindTheme({ extend: { colors: { blue: { 1000: '#000033' } } } });
    const blue = (resolved['colors'] as Record<string, Record<string, string>>)['blue'];
    expect(blue?.['1000']).toBe('#000033');
    expect(blue?.['500']).toBe('#3b82f6');
  });

  it('applies `extend` on top of a replaced group, matching Tailwind', () => {
    const resolved = resolveTailwindTheme({
      spacing: { sm: '4px' },
      extend: { spacing: { md: '8px' } },
    });
    expect(resolved['spacing']).toEqual({ sm: '4px', md: '8px' });
  });

  it('can exclude defaults entirely', () => {
    const resolved = resolveTailwindTheme({ spacing: { sm: '4px' } }, false);
    expect(Object.keys(resolved)).toEqual(['spacing']);
  });
});

describe('parseTailwindV3', () => {
  describe('the zero-config happy path', () => {
    const { designSystem, warnings } = parseV3(`module.exports = { content: ['./src/**/*.tsx'] };`);

    it('produces Tailwind defaults when the config declares no theme', () => {
      expect(designSystem.tokens.spacing.tokens.length).toBeGreaterThan(30);
      expect(designSystem.tokens.color.tokens.length).toBeGreaterThan(200);
    });

    it('infers the 2px base unit of the default scale', () => {
      // 2 rather than 4 because of the half-steps, and not 1 despite the
      // `px: 1px` token, which is reported as an outlier instead.
      expect(designSystem.tokens.spacing.baseUnit).toBe(2);
      expect(designSystem.tokens.spacing.outliers).toEqual([1]);
    });

    it('resolves rem values against the root font size', () => {
      const four = designSystem.tokens.spacing.tokens.find((t) => t.name === '4');
      expect(four).toMatchObject({ value: '1rem', px: 16 });
    });

    it('flattens nested colours into Tailwind class names', () => {
      const blue = designSystem.tokens.color.tokens.find((t) => t.name === 'blue-500');
      expect(blue).toMatchObject({ hex: '#3b82f6', kind: 'palette', family: 'blue', shade: '500' });
    });

    it('keeps a group-level DEFAULT rather than dropping the token', () => {
      // `borderRadius.DEFAULT` is the bare `rounded` class and has no parent
      // to collapse into, so it must survive under its own key.
      const radius = designSystem.tokens.borderRadius.tokens.find((t) => t.name === 'DEFAULT');
      expect(radius?.px).toBe(4);
    });

    it('reads the fontSize tuple shape', () => {
      const base = designSystem.tokens.typography.fontSizes.tokens.find((t) => t.name === 'base');
      expect(base).toMatchObject({ value: '1rem', px: 16 });
    });

    it('joins font family stacks', () => {
      const sans = designSystem.tokens.typography.fontFamilies.tokens.find(
        (t) => t.name === 'sans',
      );
      expect(sans?.value).toContain('ui-sans-serif');
      expect(sans?.value).toContain(', ');
    });

    it('captures shadows', () => {
      expect(designSystem.tokens.shadow?.tokens.some((t) => t.name === 'md')).toBe(true);
    });

    it('collapses a DEFAULT nested under a parent into the parent name', () => {
      const { designSystem: nested } = parseV3(`
        module.exports = { theme: { extend: { colors: { primary: { DEFAULT: '#111111', 500: '#222222' } } } } };
      `);
      const names = nested.tokens.color.tokens.map((t) => t.name);
      expect(names).toContain('primary');
      expect(names).toContain('primary-500');
      expect(names.some((n) => n.includes('DEFAULT'))).toBe(false);
    });

    it('produces no warnings for a clean config', () => {
      expect(warnings).toEqual([]);
    });

    it('records provenance back to the config file', () => {
      expect(designSystem.tokens.spacing.tokens[0]?.provenance?.file).toBe(file);
      expect(designSystem.meta.sourceFiles).toEqual([file]);
    });
  });

  describe('a custom design system', () => {
    const { designSystem } = parseV3(`
      module.exports = {
        theme: {
          spacing: { 0: '0', 1: '5px', 2: '10px', 3: '15px', 4: '20px', 5: '25px' },
          extend: {
            colors: { brand: { primary: '#2D3748', secondary: '#4A5568' } },
          },
        },
      };
    `);

    it('infers a 5px base unit from a replaced scale', () => {
      expect(designSystem.tokens.spacing.baseUnit).toBe(5);
      expect(designSystem.tokens.spacing.confidence).toBe('high');
    });

    it('exposes extended colours under flattened names', () => {
      const brand = designSystem.tokens.color.tokens.find((t) => t.name === 'brand-primary');
      expect(brand?.hex).toBe('#2d3748');
    });

    it('supports the scale lookups rules depend on', () => {
      const { spacing } = designSystem.tokens;
      expect(isOnSpacingScale(spacing, 15)).toBe(true);
      expect(isOnSpacingScale(spacing, 13)).toBe(false);
      expect(nearestSpacingToken(spacing, 13)?.value).toBe('15px');
    });
  });

  describe('configs it cannot fully read', () => {
    it('warns about presets instead of silently missing their tokens', () => {
      const { warnings } = parseV3(`module.exports = { presets: [require('./base')] };`);
      const preset = warnings.find((w) => w.path === 'presets');
      expect(preset?.message).toContain('does not follow');
      expect(preset?.message).toContain('missing');
    });

    it('still returns defaults when the theme is a function', () => {
      const { designSystem, warnings } = parseV3(`module.exports = { theme: () => ({}) };`);
      expect(designSystem.tokens.spacing.tokens.length).toBeGreaterThan(30);
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('keeps resolvable tokens when one value is dynamic', () => {
      const { designSystem, warnings } = parseV3(`
        module.exports = {
          theme: { extend: { colors: { brand: '#123456', legacy: require('./legacy') } } },
        };
      `);
      expect(designSystem.tokens.color.tokens.find((t) => t.name === 'brand')?.hex).toBe('#123456');
      expect(warnings.some((w) => w.path === 'theme.extend.colors.legacy')).toBe(true);
    });

    it('warns when the default export is not an object', () => {
      const { warnings } = parseV3(`module.exports = 'nope';`);
      expect(warnings.some((w) => w.code === 'unsupported-construct')).toBe(true);
    });
  });

  describe('TypeScript configs', () => {
    it('reads a `satisfies Config` default export', () => {
      const { designSystem } = parseTailwindV3({
        path: 'tailwind.config.ts',
        content: `
          import type { Config } from 'tailwindcss';
          export default {
            theme: { extend: { spacing: { huge: '200px' } } },
          } satisfies Config;
        `,
      });
      expect(designSystem.tokens.spacing.tokens.some((t) => t.name === 'huge')).toBe(true);
    });
  });
});

describe('parseTailwindV4', () => {
  const css = `
    @import "tailwindcss";

    @theme {
      --spacing: 0.25rem;
      --color-brand-500: #3b82f6;
      --color-surface: hsl(0 0% 100%);
      --radius-lg: 0.5rem;
      --shadow-card: 0 4px 6px rgb(0 0 0 / 0.1);
      --font-sans: Inter, system-ui, sans-serif;
      --font-weight-bold: 700;
      --text-base: 1rem;
      --leading-tight: 1.25;
      --tracking-wide: 0.025em;
      --breakpoint-md: 48rem;
    }
  `;
  const { designSystem, warnings } = parseTailwindV4({ path: 'app.css', content: css });

  it('parses without warnings', () => {
    expect(warnings).toEqual([]);
  });

  it('maps each namespace to the right token group', () => {
    const { tokens } = designSystem;
    expect(tokens.color.tokens.map((t) => t.name)).toEqual(['brand-500', 'surface']);
    expect(tokens.borderRadius.tokens[0]?.name).toBe('lg');
    expect(tokens.shadow?.tokens[0]?.name).toBe('card');
    expect(tokens.typography.fontSizes.tokens[0]?.name).toBe('base');
    expect(tokens.typography.lineHeights.tokens[0]?.name).toBe('tight');
    expect(tokens.typography.letterSpacings.tokens[0]?.name).toBe('wide');
  });

  it('distinguishes --font-weight-* from --font-*', () => {
    const { typography } = designSystem.tokens;
    expect(typography.fontWeights.tokens.map((t) => t.name)).toEqual(['bold']);
    expect(typography.fontFamilies.tokens.map((t) => t.name)).toEqual(['sans']);
  });

  it('normalizes an hsl colour to hex', () => {
    expect(designSystem.tokens.color.tokens.find((t) => t.name === 'surface')?.hex).toBe('#ffffff');
  });

  it('records the spacing multiplier that makes the scale computed', () => {
    expect(designSystem.tokens.spacing.dynamicMultiplier).toBe(4);
  });

  it('treats any multiple of the multiplier as on-scale, unlike v3', () => {
    const { spacing } = designSystem.tokens;
    // p-13 is legitimate in v4 and a violation in v3.
    expect(isOnSpacingScale(spacing, 52)).toBe(true);
    expect(isOnSpacingScale(spacing, 13)).toBe(false);
  });

  it('materializes representative steps so suggestions have a target', () => {
    expect(nearestSpacingToken(designSystem.tokens.spacing, 13)?.px).toBe(12);
  });

  it('puts unmapped namespaces under custom', () => {
    expect(designSystem.tokens.custom?.['breakpoint']?.tokens[0]?.name).toBe('md');
  });

  it('warns when a CSS file has no @theme block', () => {
    const { warnings: none } = parseTailwindV4({ path: 'a.css', content: '.x { color: red; }' });
    expect(none[0]?.code).toBe('unsupported-construct');
  });

  it('reports a CSS syntax error rather than throwing', () => {
    const { warnings: broken } = parseTailwindV4({ path: 'a.css', content: '@theme { --x: ;;{{' });
    expect(broken[0]?.code).toBe('parse-error');
  });
});

describe('detectTailwindFlavor', () => {
  it.each([
    ['@theme { --spacing: 4px; }', 'app.css', 'v4-css'],
    ['@import "tailwindcss";', 'app.css', 'v4-css'],
    ['module.exports = {};', 'tailwind.config.js', 'v3-config'],
    ['export default {};', 'tailwind.config.ts', 'v3-config'],
  ])('classifies %s', (content, path, expected) => {
    expect(detectTailwindFlavor({ path, content })).toBe(expected);
  });

  it('returns null for an unrelated file', () => {
    expect(detectTailwindFlavor({ path: 'styles.css', content: '.a { color: red }' })).toBeNull();
  });
});

describe('tailwindParser', () => {
  it('prefers the v4 CSS file when both flavours are present', () => {
    const { designSystem } = tailwindParser.parse([
      { path: 'tailwind.config.js', content: `module.exports = { theme: { colors: {} } };` },
      { path: 'app.css', content: '@theme { --color-only-v4: #abcdef; }' },
    ]);
    expect(designSystem.tokens.color.tokens.map((t) => t.name)).toEqual(['only-v4']);
  });

  it('scores detection highest for an unambiguous signal', () => {
    expect(tailwindParser.detect({ path: 'a.css', content: '@theme {}' })).toBe(1);
    expect(tailwindParser.detect({ path: 'other.js', content: 'const a = 1;' })).toBe(0);
  });

  it('throws only when given nothing at all', () => {
    expect(() => tailwindParser.parse([])).toThrow(/no input files/);
  });
});
