import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyFixes } from '../../src/engine/fixer.js';
import { lintFile, type LintOptions } from '../../src/engine/linter.js';
import type { Violation } from '../../src/engine/violation.js';
import {
  createColorSystem,
  createDesignSystem,
  createScaleTokens,
  createShadowSystem,
  createSpacingScale,
  type DesignSystem,
} from '../../src/model/index.js';
import { ALL_RULES, getRule } from '../../src/rules/index.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'rules');

/** The design system both fixtures are written against. */
const designSystem: DesignSystem = createDesignSystem({
  meta: { name: 'Acme', source: 'tailwind' },
  tokens: {
    spacing: createSpacingScale([
      { name: '0', value: '0px' },
      { name: '1', value: '4px' },
      { name: '2', value: '8px' },
      { name: '3', value: '12px' },
      { name: '4', value: '16px' },
      { name: '6', value: '24px' },
      { name: '8', value: '32px' },
    ]),
    color: createColorSystem([
      { name: 'blue-500', value: '#3b82f6' },
      { name: 'gray-500', value: '#6b7280' },
      // Deliberately has no semantic equivalent, so `use-design-tokens` has a
      // case where it must stay silent.
      { name: 'red-500', value: '#ef4444' },
      { name: 'brand', value: '#3b82f6', kind: 'semantic', reference: 'blue-500' },
      { name: 'secondary', value: '#6b7280', kind: 'semantic', reference: 'gray-500' },
      { name: 'surface', value: '#ffffff', kind: 'semantic' },
    ]),
    borderRadius: createScaleTokens([{ name: 'md', value: '6px' }]),
    shadow: createShadowSystem([{ name: 'card', value: '0 4px 6px rgba(0, 0, 0, 0.1)' }]),
  },
  components: {
    Button: {
      name: 'Button',
      variants: { variant: ['primary', 'secondary', 'ghost'], size: ['sm', 'md', 'lg'] },
      requiredProps: [],
      source: 'config',
    },
    List: {
      name: 'List',
      variants: {},
      requiredProps: [],
      allowedChildren: ['ListItem'],
      source: 'config',
    },
  },
  compositionRules: [
    { id: 'no-nested-card', parent: 'Card', forbiddenDescendants: ['Card'], severity: 'error' },
  ],
});

function fixture(name: string): { path: string; content: string } {
  return { path: `${name}.tsx`, content: readFileSync(join(FIXTURES, `${name}.tsx`), 'utf8') };
}

function lint(source: { path: string; content: string }, options: LintOptions = {}): Violation[] {
  return lintFile(source, designSystem, ALL_RULES, options).violations;
}

function inline(content: string, options: LintOptions = {}): Violation[] {
  return lint({ path: 'Test.tsx', content }, options);
}

describe('the clean fixture', () => {
  const violations = lint(fixture('clean'));

  it('produces zero violations', () => {
    expect(violations.map((v) => `${v.ruleId}:${v.line} ${v.message}`)).toEqual([]);
  });
});

describe('the dirty fixture', () => {
  const violations = lint(fixture('dirty'));

  it('produces exactly the expected set, with nothing extra', () => {
    expect(violations.map((violation) => [violation.ruleId, violation.line])).toEqual([
      ['no-arbitrary-spacing', 9],
      ['no-raw-hex-colors', 12],
      ['use-design-tokens', 15],
      ['no-inline-styles', 18],
      ['valid-component-variants', 21],
      ['composition-rules', 24],
      ['no-custom-shadows', 27],
      ['heading-order', 31],
      ['no-arbitrary-spacing', 33],
    ]);
  });

  it('fires every rule at least once', () => {
    const fired = new Set(violations.map((violation) => violation.ruleId));
    for (const rule of ALL_RULES) {
      expect(fired, `${rule.meta.id} never fired`).toContain(rule.meta.id);
    }
  });
});

describe('no-arbitrary-spacing', () => {
  it('suggests the nearest value on the scale', () => {
    const [violation] = inline('<div className="p-[13px]" />');
    expect(violation?.message).toContain('`p-3` (12px)');
    expect(violation?.suggestedFix).toBe('p-3');
  });

  it('preserves variants and modifiers in the fix', () => {
    const [violation] = inline('<div className="md:hover:!-mt-[13px]" />');
    expect(violation?.suggestedFix).toBe('md:hover:!-mt-3');
  });

  it('accepts an arbitrary value that happens to be on the scale', () => {
    expect(inline('<div className="p-[16px]" />')).toEqual([]);
  });

  it('accepts rem written the long way', () => {
    expect(inline('<div className="p-[1rem]" />')).toEqual([]);
  });

  it('ignores values that are not fixed lengths', () => {
    expect(inline('<div className="w-[calc(100%-1rem)]" />')).toEqual([]);
  });

  it('ignores utilities that do not take spacing', () => {
    // `z-[13]` and `border-[3px]` come from other scales entirely.
    expect(inline('<div className="z-[13] border-[3px] opacity-[0.13]" />')).toEqual([]);
  });

  it('respects a configured tolerance', () => {
    const options = { rules: { 'no-arbitrary-spacing': { options: { tolerancePx: 1 } } } };
    expect(inline('<div className="p-[13px]" />', options)).toEqual([]);
    expect(inline('<div className="p-[19px]" />', options)).toHaveLength(1);
  });
});

describe('no-raw-hex-colors', () => {
  it('offers a fix when the hex matches a token exactly', () => {
    const [violation] = inline('<div className="bg-[#3b82f6]" />');
    expect(violation?.suggestedFix).toBe('bg-brand');
    expect(violation?.fix).toBeDefined();
  });

  it('prefers the semantic token over the palette entry it aliases', () => {
    const [violation] = inline('<div className="text-[#6b7280]" />');
    expect(violation?.suggestedFix).toBe('text-secondary');
  });

  it('reports without a fix when nothing matches, rather than guessing', () => {
    const [violation] = inline('<div className="bg-[#123456]" />');
    expect(violation?.fix).toBeUndefined();
    expect(violation?.message).toContain('does not match any design system token');
  });

  it('is case-insensitive about the hex', () => {
    expect(inline('<div className="bg-[#3B82F6]" />')[0]?.suggestedFix).toBe('bg-brand');
  });

  it('flags a literal colour in an inline style object', () => {
    const violations = inline(`<div style={{ color: '#3b82f6' }} />`);
    expect(violations.some((violation) => violation.ruleId === 'no-raw-hex-colors')).toBe(true);
  });

  it('ignores non-colour utilities that use arbitrary values', () => {
    const violations = inline('<div className="w-[300px]" />');
    expect(violations.every((violation) => violation.ruleId !== 'no-raw-hex-colors')).toBe(true);
  });
});

describe('use-design-tokens', () => {
  it('points a palette value at its semantic equivalent', () => {
    const [violation] = inline('<span className="text-gray-500" />');
    expect(violation?.ruleId).toBe('use-design-tokens');
    expect(violation?.suggestedFix).toBe('text-secondary');
    expect(violation?.severity).toBe('warning');
  });

  it('stays quiet when the semantic token is already used', () => {
    expect(inline('<span className="text-secondary" />')).toEqual([]);
  });

  it('stays quiet for a palette value with no semantic equivalent', () => {
    // Nothing to suggest, so nagging would be pure noise.
    expect(inline('<span className="text-red-500" />')).toEqual([]);
  });

  it('flags a palette value whose semantic equivalent is only an alias', () => {
    // `brand` aliases `blue-500` rather than duplicating its hex.
    expect(inline('<span className="text-blue-500" />')[0]?.suggestedFix).toBe('text-brand');
  });
});

describe('no-inline-styles', () => {
  it('flags a static style object', () => {
    const [violation] = inline(`<div style={{ marginTop: '13px' }} />`);
    expect(violation?.ruleId).toBe('no-inline-styles');
    expect(violation?.message).toContain('`marginTop`');
    expect(violation?.fix).toBeUndefined();
  });

  it('allows a fully dynamic style object by default', () => {
    // There is no static answer for a computed value, so flagging it would
    // only teach people to suppress the rule.
    expect(inline('<div style={{ width: computed }} />')).toEqual([]);
  });

  it('allows CSS custom properties, the sanctioned runtime escape hatch', () => {
    expect(inline('<div style={{ "--progress": pct }} />')).toEqual([]);
  });

  it('can be configured to flag dynamic styles too', () => {
    const options = { rules: { 'no-inline-styles': { options: { allowDynamic: false } } } };
    expect(inline('<div style={{ width: computed }} />', options)).toHaveLength(1);
  });
});

describe('valid-component-variants', () => {
  it('names the allowed values and guesses the intended one', () => {
    const [violation] = inline('<Button variant="primarry" />');
    expect(violation?.message).toContain('`primary`, `secondary`, `ghost`');
    expect(violation?.message).toContain('Did you mean `primary`?');
    expect(violation?.suggestedFix).toBe('primary');
  });

  it('fixes the typo in place, leaving the quotes alone', () => {
    const source = '<Button variant="primarry" />';
    const { output } = applyFixes(source, inline(source));
    expect(output).toBe('<Button variant="primary" />');
  });

  it('offers no guess when the value is not a near miss', () => {
    const [violation] = inline('<Button variant="enormous" />');
    expect(violation?.message).not.toContain('Did you mean');
    expect(violation?.fix).toBeUndefined();
  });

  it('accepts every declared value', () => {
    expect(inline('<Button variant="ghost" size="lg" />')).toEqual([]);
  });

  it('says nothing about components it has no declaration for', () => {
    expect(inline('<Mystery variant="whatever" />')).toEqual([]);
  });

  it('says nothing about props that are not variant dimensions', () => {
    expect(inline('<Button onClick={fn} aria-label="x" />')).toEqual([]);
  });

  it('cannot judge a dynamic value, and does not try', () => {
    expect(inline('<Button variant={someVariant} />')).toEqual([]);
  });
});

describe('composition-rules', () => {
  it('flags a Card nested directly inside a Card', () => {
    const [violation] = inline('<Card><Card /></Card>');
    expect(violation?.ruleId).toBe('composition-rules');
    expect(violation?.message).toContain('must not appear inside `Card`');
  });

  it('flags a Card nested at any depth, not just directly', () => {
    expect(inline('<Card><div><section><Card /></section></div></Card>')).toHaveLength(1);
  });

  it('reports the inner element, which is the one to change', () => {
    const source = '<Card>\n  <div>\n    <Card />\n  </div>\n</Card>';
    expect(inline(source)[0]?.line).toBe(3);
  });

  it('allows sibling Cards', () => {
    expect(inline('<div><Card /><Card /></div>')).toEqual([]);
  });

  it('enforces an allowed-children list', () => {
    const [violation] = inline('<List><div /></List>');
    expect(violation?.message).toContain('accepts only `ListItem`');
  });

  it('sees through a map callback when checking children', () => {
    // `<List>{items.map(i => <ListItem/>)}</List>` is idiomatic and legal.
    expect(inline('<List>{items.map((i) => <ListItem key={i} />)}</List>')).toEqual([]);
  });

  it('sees through fragments and conditionals', () => {
    expect(inline('<List>{ok ? <ListItem /> : <ListItem />}</List>')).toEqual([]);
    expect(inline('<List><><ListItem /></></List>')).toEqual([]);
  });
});

describe('no-custom-shadows', () => {
  it('flags an arbitrary shadow and lists the available tokens', () => {
    const [violation] = inline('<div className="shadow-[0_9px_31px_rgba(0,0,0,0.42)]" />');
    expect(violation?.ruleId).toBe('no-custom-shadows');
    expect(violation?.severity).toBe('warning');
    expect(violation?.message).toContain('Available: `card`');
  });

  it('rewrites a shadow that already exists as a token', () => {
    const [violation] = inline('<div className="shadow-[0_4px_6px_rgba(0,0,0,0.1)]" />');
    expect(violation?.suggestedFix).toBe('shadow-card');
  });

  it('accepts a named shadow token', () => {
    expect(inline('<div className="shadow-card" />')).toEqual([]);
  });
});

describe('heading-order', () => {
  it('flags a skipped level', () => {
    const [violation] = inline('<div><h1>A</h1><h3>B</h3></div>');
    expect(violation?.message).toContain('jumps from `h1` to `h3`');
    expect(violation?.suggestedFix).toBe('h2');
  });

  it('accepts a sequential progression', () => {
    expect(inline('<div><h1>A</h1><h2>B</h2><h3>C</h3></div>')).toEqual([]);
  });

  it('accepts going back up any number of levels', () => {
    expect(inline('<div><h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2></div>')).toEqual([]);
  });

  it('does not demand an h1 by default, since a component is not a page', () => {
    expect(inline('<div><h3>Section</h3><h4>Sub</h4></div>')).toEqual([]);
  });

  it('can be configured to require an h1', () => {
    const options = { rules: { 'heading-order': { options: { requireH1: true } } } };
    expect(inline('<div><h3>Section</h3></div>', options)).toHaveLength(1);
  });
});

describe('rule configuration', () => {
  it('honours a severity override', () => {
    const options = { rules: { 'no-arbitrary-spacing': 'warning' as const } };
    expect(inline('<div className="p-[13px]" />', options)[0]?.severity).toBe('warning');
  });

  it('honours turning a rule off', () => {
    const options = { rules: { 'no-arbitrary-spacing': 'off' as const } };
    expect(inline('<div className="p-[13px]" />', options)).toEqual([]);
  });

  it('uses each rule’s documented default severity', () => {
    expect(getRule('no-arbitrary-spacing')?.meta.defaultSeverity).toBe('error');
    expect(getRule('use-design-tokens')?.meta.defaultSeverity).toBe('warning');
  });
});

describe('suppression comments', () => {
  it('honours anchor-disable-next-line', () => {
    const source = ['<div', '  // anchor-disable-next-line', '  className="p-[13px]"', '/>'].join(
      '\n',
    );
    expect(inline(source)).toEqual([]);
  });

  it('honours a rule-scoped suppression and still reports other rules', () => {
    const source = [
      '<div>',
      '  {/* anchor-disable-next-line no-arbitrary-spacing */}',
      '  <span className="p-[13px] text-gray-500" />',
      '</div>',
    ].join('\n');

    const violations = inline(source);
    expect(violations.map((violation) => violation.ruleId)).toEqual(['use-design-tokens']);
  });

  it('honours a disable/enable block', () => {
    const source = [
      '/* anchor-disable */',
      '<div className="p-[13px]" />;',
      '/* anchor-enable */',
      '<div className="p-[7px]" />;',
    ].join('\n');
    expect(inline(source)).toHaveLength(1);
  });

  it('honours a file-wide suppression', () => {
    const source = ['// anchor-disable-file', '<div className="p-[13px]" />;'].join('\n');
    expect(inline(source)).toEqual([]);
  });
});

describe('the linter itself', () => {
  it('reports a syntax error instead of throwing', () => {
    const result = lintFile({ path: 'Bad.tsx', content: 'const = = =;' }, designSystem, ALL_RULES);
    expect(result.parseError?.message).toBeTruthy();
    expect(result.violations).toEqual([]);
  });

  it('contains a crashing rule rather than losing the whole run', () => {
    const exploding = {
      meta: {
        id: 'exploding',
        description: 'x',
        defaultSeverity: 'error' as const,
        fixability: 'none' as const,
        rationale: 'x',
      },
      create: () => ({
        classToken() {
          throw new Error('boom');
        },
      }),
    };

    const result = lintFile(
      { path: 'A.tsx', content: '<div className="p-[13px]" />' },
      designSystem,
      [exploding, ...ALL_RULES],
    );

    const ids = result.violations.map((violation) => violation.ruleId);
    expect(ids).toContain('anchor/internal-error');
    // The real rule still ran.
    expect(ids).toContain('no-arbitrary-spacing');
  });

  it('reports violations in source order', () => {
    const source = '<div>\n<span className="p-[7px]" />\n<span className="p-[13px]" />\n</div>';
    expect(inline(source).map((violation) => violation.line)).toEqual([2, 3]);
  });

  it('lints class strings inside cva definitions', () => {
    const source = `const b = cva('base', { variants: { size: { sm: 'p-[13px]' } } });`;
    expect(inline(source).map((violation) => violation.ruleId)).toEqual(['no-arbitrary-spacing']);
  });
});

describe('applyFixes', () => {
  it('rewrites every non-overlapping fix', () => {
    const source = '<div className="p-[13px] bg-[#3b82f6]" />';
    const { output, applied } = applyFixes(source, inline(source));

    expect(output).toBe('<div className="p-3 bg-brand" />');
    expect(applied).toHaveLength(2);
  });

  it('leaves the file untouched when nothing is fixable', () => {
    const source = `<div style={{ marginTop: '13px' }} />`;
    expect(applyFixes(source, inline(source)).output).toBe(source);
  });

  it('produces a file that lints clean afterwards', () => {
    const source = '<div className="p-[13px] text-gray-500" />';
    const { output } = applyFixes(source, inline(source));
    expect(inline(output)).toEqual([]);
  });

  it('skips a fix that overlaps one already applied', () => {
    const overlapping: Violation[] = [
      {
        ruleId: 'a',
        severity: 'error',
        file: 'x.tsx',
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 5,
        message: 'a',
        fix: { range: [0, 10], text: 'AAA' },
      },
      {
        ruleId: 'b',
        severity: 'error',
        file: 'x.tsx',
        line: 1,
        column: 3,
        endLine: 1,
        endColumn: 6,
        message: 'b',
        fix: { range: [5, 12], text: 'BBB' },
      },
    ];

    const result = applyFixes('0123456789abcdef', overlapping);
    expect(result.applied.map((violation) => violation.ruleId)).toEqual(['a']);
    expect(result.skipped.map((violation) => violation.ruleId)).toEqual(['b']);
  });
});
