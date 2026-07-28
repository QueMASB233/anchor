import { describe, expect, it } from 'vitest';

import { parseCssVariables, normalizeBareHsl } from '../../src/parsers/css-variables.js';
import { figmaColorToCss, parseFigmaVariables } from '../../src/parsers/figma-variables.js';
import { parseStyleDictionary } from '../../src/parsers/style-dictionary.js';
import { classifyToken } from '../../src/parsers/token-tree.js';
import { parseW3cDtcg } from '../../src/parsers/w3c-dtcg.js';

const json = (value: unknown): string => JSON.stringify(value);

describe('classifyToken', () => {
  it('trusts an unambiguous declared type', () => {
    expect(classifyToken(['brand', 'primary'], 'color')).toBe('color');
    expect(classifyToken(['x'], 'fontWeight')).toBe('fontWeight');
  });

  it('falls back to the path when the type is the ambiguous `dimension`', () => {
    // DTCG uses `dimension` for spacing, radius and font size alike.
    expect(classifyToken(['spacing', 'md'], 'dimension')).toBe('spacing');
    expect(classifyToken(['radius', 'lg'], 'dimension')).toBe('borderRadius');
    expect(classifyToken(['font-size', 'lg'], 'dimension')).toBe('fontSize');
  });

  it('files genuinely unknown tokens under custom rather than guessing', () => {
    expect(classifyToken(['z-index', 'modal'], undefined)).toBe('custom');
  });
});

describe('parseStyleDictionary', () => {
  const tokens = {
    color: {
      base: { blue: { value: '#3b82f6', type: 'color' } },
      brand: { primary: { value: '{color.base.blue.value}', type: 'color' } },
    },
    spacing: {
      sm: { value: '4px', type: 'spacing' },
      md: { value: '8px', type: 'spacing' },
      lg: { value: '16px', type: 'spacing', comment: 'Default gap' },
    },
    radius: { md: { value: '6px' } },
  };

  const { designSystem, warnings } = parseStyleDictionary([
    { path: 'tokens.json', content: json(tokens) },
  ]);

  it('flattens nested groups into dashed names', () => {
    expect(designSystem.tokens.color.tokens.map((t) => t.name)).toEqual([
      'color-base-blue',
      'color-brand-primary',
    ]);
  });

  it('resolves a `{group.token.value}` alias to the referenced value', () => {
    const brand = designSystem.tokens.color.tokens.find((t) => t.name === 'color-brand-primary');
    expect(brand?.hex).toBe('#3b82f6');
    expect(brand?.reference).toBe('color-base-blue');
    expect(brand?.kind).toBe('semantic');
  });

  it('routes tokens to groups by declared type', () => {
    expect(designSystem.tokens.spacing.tokens).toHaveLength(3);
    expect(designSystem.tokens.spacing.baseUnit).toBe(4);
  });

  it('classifies by path when the type is absent', () => {
    expect(designSystem.tokens.borderRadius.tokens[0]?.name).toBe('radius-md');
  });

  it('carries descriptions through for generated docs', () => {
    const lg = designSystem.tokens.spacing.tokens.find((t) => t.name === 'spacing-lg');
    expect(lg?.description).toBe('Default gap');
  });

  it('records the source format', () => {
    expect(designSystem.meta.source).toBe('style-dictionary');
    expect(warnings).toEqual([]);
  });

  it('warns about a dangling alias instead of emptying the token', () => {
    const { warnings: dangling } = parseStyleDictionary([
      { path: 't.json', content: json({ color: { a: { value: '{color.nope.value}' } } }) },
    ]);
    expect(dangling.some((w) => w.code === 'dangling-reference')).toBe(true);
  });

  it('reports invalid JSON rather than throwing', () => {
    const { warnings: broken } = parseStyleDictionary([{ path: 't.json', content: '{ nope' }]);
    expect(broken[0]?.code).toBe('parse-error');
  });
});

describe('parseW3cDtcg', () => {
  const tokens = {
    color: {
      $type: 'color',
      blue: { $value: '#3b82f6' },
      primary: { $value: '{color.blue}', $description: 'Primary brand colour' },
    },
    spacing: {
      $type: 'dimension',
      sm: { $value: '4px' },
      md: { $value: { value: 8, unit: 'px' } },
    },
    shadow: {
      card: {
        $type: 'shadow',
        $value: { offsetX: '0px', offsetY: '4px', blur: '6px', color: 'rgba(0,0,0,0.1)' },
      },
    },
  };

  const { designSystem, warnings } = parseW3cDtcg([
    { path: 'tokens.tokens.json', content: json(tokens) },
  ]);

  it('inherits $type from the enclosing group', () => {
    expect(designSystem.tokens.color.tokens).toHaveLength(2);
    expect(designSystem.tokens.spacing.tokens).toHaveLength(2);
  });

  it('resolves a `{group.token}` alias with no .value suffix', () => {
    const primary = designSystem.tokens.color.tokens.find((t) => t.name === 'color-primary');
    expect(primary?.hex).toBe('#3b82f6');
    expect(primary?.reference).toBe('color-blue');
  });

  it('flattens a dimension object into a CSS length', () => {
    const md = designSystem.tokens.spacing.tokens.find((t) => t.name === 'spacing-md');
    expect(md).toMatchObject({ value: '8px', px: 8 });
  });

  it('flattens a composite shadow into CSS shorthand', () => {
    expect(designSystem.tokens.shadow?.tokens[0]).toMatchObject({
      name: 'shadow-card',
      value: '0px 4px 6px rgba(0,0,0,0.1)',
    });
  });

  it('carries $description through', () => {
    const primary = designSystem.tokens.color.tokens.find((t) => t.name === 'color-primary');
    expect(primary?.description).toBe('Primary brand colour');
  });

  it('parses cleanly', () => {
    expect(warnings).toEqual([]);
    expect(designSystem.meta.source).toBe('w3c-dtcg');
  });

  it('warns rather than dropping a composite it cannot reduce', () => {
    const { warnings: composite } = parseW3cDtcg([
      {
        path: 't.json',
        content: json({
          type: {
            heading: { $type: 'typography', $value: { fontFamily: 'Inter', fontSize: '2rem' } },
          },
        }),
      },
    ]);
    expect(composite[0]?.code).toBe('unresolvable-value');
    expect(composite[0]?.message).toContain('documented but not enforced');
  });
});

describe('figmaColorToCss', () => {
  it('converts opaque colours to hex', () => {
    expect(figmaColorToCss({ r: 1, g: 0, b: 0, a: 1 })).toBe('#ff0000');
  });

  it('keeps alpha as rgba when it is meaningful', () => {
    expect(figmaColorToCss({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('rgba(0, 0, 0, 0.5)');
  });

  it('treats a missing alpha as opaque', () => {
    expect(figmaColorToCss({ r: 1, g: 1, b: 1 })).toBe('#ffffff');
  });
});

describe('parseFigmaVariables', () => {
  const payload = {
    meta: {
      variableCollections: {
        'c:1': { name: 'Primitives', defaultModeId: 'm:light', modes: [{ modeId: 'm:light' }] },
      },
      variables: {
        'v:1': {
          name: 'color/brand/primary',
          resolvedType: 'COLOR',
          variableCollectionId: 'c:1',
          valuesByMode: { 'm:light': { r: 0.231, g: 0.51, b: 0.965, a: 1 } },
          description: 'Brand blue',
        },
        'v:2': {
          name: 'color/text/accent',
          resolvedType: 'COLOR',
          variableCollectionId: 'c:1',
          valuesByMode: { 'm:light': { type: 'VARIABLE_ALIAS', id: 'v:1' } },
        },
        'v:3': {
          name: 'spacing/md',
          resolvedType: 'FLOAT',
          variableCollectionId: 'c:1',
          valuesByMode: { 'm:light': 8 },
        },
        'v:4': { name: 'deleted/old', resolvedType: 'FLOAT', deletedButReferenced: true },
      },
    },
  };

  const { designSystem, warnings } = parseFigmaVariables([
    { path: 'figma.json', content: json(payload) },
  ]);

  it('converts slash-separated names to dashed token names', () => {
    expect(designSystem.tokens.color.tokens.map((t) => t.name)).toEqual([
      'color-brand-primary',
      'color-text-accent',
    ]);
  });

  it('converts 0-1 RGBA floats back to hex', () => {
    expect(designSystem.tokens.color.tokens[0]?.hex).toBe('#3b82f6');
  });

  it('resolves a VARIABLE_ALIAS to the target token name', () => {
    const accent = designSystem.tokens.color.tokens[1];
    expect(accent?.reference).toBe('color-brand-primary');
    expect(accent?.kind).toBe('semantic');
  });

  it('routes FLOAT variables by their path', () => {
    expect(designSystem.tokens.spacing.tokens).toEqual([
      expect.objectContaining({ name: 'spacing-md', px: 8 }),
    ]);
  });

  it('skips soft-deleted variables', () => {
    const names = designSystem.tokens.custom?.['deleted']?.tokens ?? [];
    expect(names).toEqual([]);
  });

  it('parses the documented shape cleanly', () => {
    expect(warnings).toEqual([]);
  });

  it('warns when a variable has multiple modes instead of silently picking one', () => {
    const multi = {
      meta: {
        variableCollections: { 'c:1': { name: 'Theme', defaultModeId: 'm:light' } },
        variables: {
          'v:1': {
            name: 'color/bg',
            resolvedType: 'COLOR',
            variableCollectionId: 'c:1',
            valuesByMode: {
              'm:light': { r: 1, g: 1, b: 1, a: 1 },
              'm:dark': { r: 0, g: 0, b: 0, a: 1 },
            },
          },
        },
      },
    };
    const result = parseFigmaVariables([{ path: 'f.json', content: json(multi) }]);
    expect(result.warnings[0]?.message).toContain('2 modes');
    // The default mode is the one that survives.
    expect(result.designSystem.tokens.color.tokens[0]?.hex).toBe('#ffffff');
  });

  it('rejects a file that is not a Figma export, with a clear explanation', () => {
    const { warnings: wrong } = parseFigmaVariables([
      { path: 'x.json', content: json({ color: { primary: '#fff' } }) },
    ]);
    expect(wrong[0]?.message).toContain('Get local variables');
  });

  it('warns about an alias pointing outside the export', () => {
    const orphan = {
      meta: {
        variables: {
          'v:1': {
            name: 'color/a',
            resolvedType: 'COLOR',
            valuesByMode: { m: { type: 'VARIABLE_ALIAS', id: 'v:missing' } },
          },
        },
      },
    };
    const { warnings: dangling } = parseFigmaVariables([{ path: 'f.json', content: json(orphan) }]);
    expect(dangling.some((w) => w.code === 'dangling-reference')).toBe(true);
  });
});

describe('normalizeBareHsl', () => {
  it('wraps a shadcn-style triplet so it reads as a colour', () => {
    expect(normalizeBareHsl('222.2 47.4% 11.2%')).toBe('hsl(222.2 47.4% 11.2%)');
  });

  it('leaves a real colour value alone', () => {
    expect(normalizeBareHsl('#3b82f6')).toBe('#3b82f6');
    expect(normalizeBareHsl('hsl(0 0% 100%)')).toBe('hsl(0 0% 100%)');
  });
});

describe('parseCssVariables', () => {
  const css = `
    :root {
      --color-brand: #3b82f6;
      --spacing-md: 1rem;
      --radius-lg: 8px;
      --font-size-base: 16px;
      --shadow-card: 0 4px 6px rgba(0,0,0,0.1);
      --z-index-modal: 50;
      --primary: 222.2 47.4% 11.2%;
      --nonsense: 4px;
    }
    .unrelated { --ignored: 1px; }
  `;

  const { designSystem, warnings } = parseCssVariables([{ path: 'theme.css', content: css }]);

  it('routes properties to groups by naming convention', () => {
    const { tokens } = designSystem;
    expect(tokens.color.tokens.map((t) => t.name)).toContain('color-brand');
    expect(tokens.spacing.tokens.map((t) => t.name)).toContain('spacing-md');
    expect(tokens.borderRadius.tokens.map((t) => t.name)).toContain('radius-lg');
    expect(tokens.shadow?.tokens.map((t) => t.name)).toContain('shadow-card');
    expect(tokens.typography.fontSizes.tokens.map((t) => t.name)).toContain('font-size-base');
  });

  it('normalizes a bare shadcn HSL triplet into a real colour', () => {
    const primary = designSystem.tokens.color.tokens.find((t) => t.name === 'primary');
    expect(primary?.value).toBe('hsl(222.2 47.4% 11.2%)');
    expect(primary?.hex).toBe('#0f172a');
  });

  it('files prefixed but unrecognized properties under custom', () => {
    expect(designSystem.tokens.custom?.['z']?.tokens[0]?.name).toBe('z-index-modal');
  });

  it('ignores custom properties outside token-declaring selectors', () => {
    const names = designSystem.tokens.spacing.tokens.map((t) => t.name);
    expect(names).not.toContain('ignored');
  });

  it('reports how many properties it could not place rather than guessing', () => {
    const unclassified = warnings.find((w) => w.message.includes('could not be matched'));
    expect(unclassified?.message).toContain('1 custom property');
    expect(unclassified?.message).toContain('--color-');
  });

  it('lets a later declaration win, matching the cascade', () => {
    const themed = parseCssVariables([
      {
        path: 'a.css',
        content: ':root { --color-bg: #ffffff; } .dark { --color-bg: #000000; }',
      },
    ]);
    const bg = themed.designSystem.tokens.color.tokens.filter((t) => t.name === 'color-bg');
    expect(bg).toHaveLength(1);
    expect(bg[0]?.hex).toBe('#000000');
  });

  it('warns when a stylesheet declares no tokens at all', () => {
    const { warnings: empty } = parseCssVariables([
      { path: 'a.css', content: '.button { color: red; }' },
    ]);
    expect(empty[0]?.message).toContain('No custom properties');
  });
});
