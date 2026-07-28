import { describe, expect, it } from 'vitest';

import { extractCvaComponents } from '../../src/extractors/cva.js';
import { lintFile } from '../../src/engine/linter.js';
import { parseSourceFile } from '../../src/engine/source-file.js';
import {
  createDesignSystem,
  createSpacingScale,
  mergeComponentInventories,
} from '../../src/model/index.js';
import { ALL_RULES } from '../../src/rules/index.js';

function extract(source: string) {
  const { file } = parseSourceFile('Button.tsx', source);
  expect(file).not.toBeNull();
  return extractCvaComponents(file!);
}

describe('extractCvaComponents', () => {
  const shadcnStyle = `
    import { cva } from 'class-variance-authority';

    const buttonVariants = cva('inline-flex items-center rounded-md', {
      variants: {
        variant: {
          default: 'bg-primary text-primary-foreground',
          destructive: 'bg-destructive',
          outline: 'border border-input',
          ghost: 'hover:bg-accent',
        },
        size: { default: 'h-10 px-4', sm: 'h-9 px-3', lg: 'h-11 px-8' },
      },
      defaultVariants: { variant: 'default', size: 'default' },
    });
  `;

  it('reads variant dimensions and their values', () => {
    const inventory = extract(shadcnStyle);
    expect(inventory['Button']?.variants).toEqual({
      variant: ['default', 'destructive', 'outline', 'ghost'],
      size: ['default', 'sm', 'lg'],
    });
  });

  it('derives the component name from the variable, stripping the suffix', () => {
    expect(Object.keys(extract(shadcnStyle))).toEqual(['Button']);
  });

  it('records where the definition came from', () => {
    expect(extract(shadcnStyle)['Button']?.provenance?.file).toBe('Button.tsx');
    expect(extract(shadcnStyle)['Button']?.source).toBe('cva');
  });

  it('treats CVA variants as optional, since they all have fallbacks', () => {
    expect(extract(shadcnStyle)['Button']?.requiredProps).toEqual([]);
  });

  it('handles boolean variants', () => {
    const source = `const x = cva('a', { variants: { disabled: { true: 'opacity-50', false: '' } } });`;
    expect(extract(source)['X']?.variants['disabled']).toEqual(['true', 'false']);
  });

  it('handles quoted variant keys', () => {
    const source = `const x = cva('a', { variants: { 'data-state': { open: 'block' } } });`;
    expect(extract(source)['X']?.variants['data-state']).toEqual(['open']);
  });

  it('supports tailwind-variants too', () => {
    const source = `const cardStyles = tv({ variants: { tone: { neutral: 'bg-white' } } });`;
    expect(extract(source)['Card']?.variants['tone']).toEqual(['neutral']);
  });

  it('ignores a call with no variants block', () => {
    expect(extract(`const x = cva('just-a-base-class');`)).toEqual({});
  });

  it('ignores an anonymous call, which has no name to attach', () => {
    expect(extract(`cva('a', { variants: { size: { sm: 'p-1' } } });`)).toEqual({});
  });

  it('skips a dynamically built variant map rather than guessing', () => {
    // Resolving this would mean executing the file.
    const source = `const x = cva('a', { variants: buildVariants() });`;
    expect(extract(source)).toEqual({});
  });

  it('extracts several components from one file', () => {
    const source = `
      const buttonVariants = cva('a', { variants: { size: { sm: 'p-1' } } });
      const badgeVariants = cva('b', { variants: { tone: { info: 'p-2' } } });
    `;
    expect(Object.keys(extract(source)).sort()).toEqual(['Badge', 'Button']);
  });
});

describe('extraction feeding valid-component-variants', () => {
  it('makes the rule work with no hand-written inventory', () => {
    const componentSource = `
      const buttonVariants = cva('base', {
        variants: { variant: { primary: 'bg-blue-500', ghost: 'bg-transparent' } },
      });
    `;
    const { file } = parseSourceFile('Button.tsx', componentSource);
    const components = extractCvaComponents(file!);

    const designSystem = createDesignSystem({
      meta: { name: 'Acme', source: 'tailwind' },
      tokens: { spacing: createSpacingScale([{ name: '1', value: '4px' }]) },
      components,
    });

    const { violations } = lintFile(
      { path: 'App.tsx', content: '<Button variant="primarry" />' },
      designSystem,
      ALL_RULES,
    );

    expect(violations[0]?.ruleId).toBe('valid-component-variants');
    expect(violations[0]?.suggestedFix).toBe('primary');
  });

  it('lets config-declared components override extracted ones', () => {
    const extracted = {
      Button: {
        name: 'Button',
        variants: { variant: ['primary'] },
        requiredProps: [],
        source: 'cva' as const,
      },
    };
    const configured = {
      Button: {
        name: 'Button',
        variants: { variant: ['primary', 'secondary'] },
        requiredProps: [],
        source: 'config' as const,
      },
    };

    const merged = mergeComponentInventories(extracted, configured);
    const designSystem = createDesignSystem({
      meta: { name: 'Acme', source: 'tailwind' },
      components: merged,
    });

    const { violations } = lintFile(
      { path: 'App.tsx', content: '<Button variant="secondary" />' },
      designSystem,
      ALL_RULES,
    );

    expect(violations).toEqual([]);
  });
});
