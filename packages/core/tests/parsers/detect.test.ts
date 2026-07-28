import { describe, expect, it } from 'vitest';

import { detectFormat, parseAuto, UnknownFormatError } from '../../src/parsers/detect.js';
import type { ParserInput } from '../../src/parsers/types.js';

const tailwindV3: ParserInput = {
  path: 'tailwind.config.js',
  content: `module.exports = { theme: { extend: { spacing: { huge: '200px' } } } };`,
};

const tailwindV4: ParserInput = {
  path: 'src/app.css',
  content: '@import "tailwindcss";\n@theme { --color-brand: #3b82f6; }',
};

const styleDictionary: ParserInput = {
  path: 'tokens.json',
  content: JSON.stringify({
    color: { blue: { value: '#3b82f6' }, brand: { value: '{color.blue.value}' } },
  }),
};

const dtcg: ParserInput = {
  path: 'tokens.tokens.json',
  content: JSON.stringify({ color: { blue: { $value: '#3b82f6', $type: 'color' } } }),
};

const figma: ParserInput = {
  path: 'figma.json',
  content: JSON.stringify({
    meta: {
      variables: {
        'v:1': {
          name: 'color/brand',
          resolvedType: 'COLOR',
          variableCollectionId: 'c:1',
          valuesByMode: { m: { r: 1, g: 0, b: 0, a: 1 } },
        },
      },
    },
  }),
};

const cssVariables: ParserInput = {
  path: 'theme.css',
  content: ':root { --color-brand: #3b82f6; --spacing-md: 1rem; }',
};

describe('detectFormat', () => {
  it.each([
    ['Tailwind v3 config', tailwindV3, 'tailwind'],
    ['Tailwind v4 CSS', tailwindV4, 'tailwind'],
    ['Style Dictionary', styleDictionary, 'style-dictionary'],
    ['W3C DTCG', dtcg, 'w3c-dtcg'],
    ['Figma variables', figma, 'figma-variables'],
    ['CSS custom properties', cssVariables, 'css-variables'],
  ])('identifies %s', (_label, input, expected) => {
    expect(detectFormat([input]).format).toBe(expected);
  });

  describe('formats that genuinely overlap', () => {
    it('prefers DTCG over Style Dictionary when $value is present', () => {
      // Both are nested JSON; `$value` is the specific signal.
      expect(detectFormat([dtcg]).format).toBe('w3c-dtcg');
    });

    it('prefers Style Dictionary when the alias carries a .value suffix', () => {
      expect(detectFormat([styleDictionary]).format).toBe('style-dictionary');
    });

    it('prefers Tailwind over plain CSS variables for a @theme block', () => {
      const mixed: ParserInput = {
        path: 'app.css',
        content: ':root { --legacy: 1px; }\n@theme { --color-brand: #fff; }',
      };
      expect(detectFormat([mixed]).format).toBe('tailwind');
    });

    it('prefers Figma over generic JSON for a variables export', () => {
      expect(detectFormat([figma]).format).toBe('figma-variables');
    });
  });

  it('reports runner-up candidates so the choice can be explained', () => {
    const result = detectFormat([tailwindV3, cssVariables]);
    expect(result.format).toBe('tailwind');
    expect(result.candidates.map((candidate) => candidate.format)).toEqual([
      'tailwind',
      'css-variables',
    ]);
  });

  it('claims only the files that actually matched', () => {
    const result = detectFormat([tailwindV3, { path: 'README.md', content: '# hi' }]);
    expect(result.candidates[0]?.files.map((file) => file.path)).toEqual(['tailwind.config.js']);
  });

  it('returns unknown when nothing matches', () => {
    const result = detectFormat([{ path: 'README.md', content: '# Anchor' }]);
    expect(result).toEqual({ parser: null, format: 'unknown', candidates: [] });
  });

  it('returns unknown for no input at all', () => {
    expect(detectFormat([]).format).toBe('unknown');
  });

  it('ignores a stylesheet with no custom properties', () => {
    expect(detectFormat([{ path: 'a.css', content: '.x { color: red; }' }]).format).toBe('unknown');
  });
});

describe('parseAuto', () => {
  it('detects and parses in one step', () => {
    const result = parseAuto([tailwindV4]);
    expect(result.format).toBe('tailwind');
    expect(result.designSystem.tokens.color.tokens[0]?.name).toBe('brand');
  });

  it('passes context through to the chosen parser', () => {
    const result = parseAuto([styleDictionary], { name: 'Acme' });
    expect(result.designSystem.meta.name).toBe('Acme');
  });

  it('hands the parser every file it claimed', () => {
    const result = parseAuto([
      { path: 'a.json', content: JSON.stringify({ color: { a: { $value: '#000' } } }) },
      { path: 'b.json', content: JSON.stringify({ color: { b: { $value: '#fff' } } }) },
    ]);
    expect(result.designSystem.tokens.color.tokens.map((t) => t.name)).toEqual([
      'color-a',
      'color-b',
    ]);
  });

  it('throws a helpful error listing the supported formats', () => {
    expect(() => parseAuto([{ path: 'README.md', content: '# hi' }])).toThrow(UnknownFormatError);
    expect(() => parseAuto([{ path: 'README.md', content: '# hi' }])).toThrow(/Tailwind/);
  });

  it('names the files it inspected in the error', () => {
    try {
      parseAuto([{ path: 'weird.txt', content: 'nope' }]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as UnknownFormatError).inspected).toEqual(['weird.txt']);
    }
  });
});
