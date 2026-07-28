import { describe, expect, it } from 'vitest';

import { extractClassTokens } from '../../src/engine/class-names.js';
import { parseSourceFile } from '../../src/engine/source-file.js';

/** Parses source and returns the extracted class names, in source order. */
function classesOf(source: string): string[] {
  const { file } = parseSourceFile('Component.tsx', source);
  expect(file).not.toBeNull();
  return extractClassTokens(file!).map((token) => token.value);
}

/** Returns tokens with their resolved positions, for offset assertions. */
function tokensOf(source: string) {
  const { file } = parseSourceFile('Component.tsx', source);
  return extractClassTokens(file!);
}

describe('extractClassTokens', () => {
  describe('plain attributes', () => {
    it('reads a string literal className', () => {
      expect(classesOf('<div className="flex p-4 gap-2" />')).toEqual(['flex', 'p-4', 'gap-2']);
    });

    it('reads the HTML `class` attribute too', () => {
      expect(classesOf('<div class="flex p-4" />')).toEqual(['flex', 'p-4']);
    });

    it('collapses irregular whitespace and newlines', () => {
      expect(classesOf('<div className="flex\n  p-4\t gap-2" />')).toEqual([
        'flex',
        'p-4',
        'gap-2',
      ]);
    });

    it('ignores unrelated attributes', () => {
      expect(classesOf('<div id="p-4" data-x="gap-2" />')).toEqual([]);
    });
  });

  describe('the cn/clsx family, which is where real code lives', () => {
    it('reads every string argument of a helper call', () => {
      expect(classesOf(`<div className={cn('flex p-4', 'gap-2')} />`)).toEqual([
        'flex',
        'p-4',
        'gap-2',
      ]);
    });

    it('reads the branches of a conditional', () => {
      expect(classesOf(`<div className={cn(isOn ? 'p-4' : 'p-8')} />`)).toEqual(['p-4', 'p-8']);
    });

    it('reads the right side of a logical guard', () => {
      expect(classesOf(`<div className={cn('flex', dense && 'gap-[7px]')} />`)).toEqual([
        'flex',
        'gap-[7px]',
      ]);
    });

    it('reads object keys, the clsx conditional form', () => {
      expect(classesOf(`<div className={clsx({ 'p-[13px]': dense, 'p-4': !dense })} />`)).toEqual([
        'p-[13px]',
        'p-4',
      ]);
    });

    it('reads array forms', () => {
      expect(classesOf(`<div className={clsx(['p-4', 'gap-2'])} />`)).toEqual(['p-4', 'gap-2']);
    });

    it('reads nested helper calls', () => {
      expect(classesOf(`<div className={cn('flex', clsx('p-4'))} />`)).toEqual(['flex', 'p-4']);
    });

    it('does not follow calls to unknown functions', () => {
      // `getStyles('p-4')` may not be class names at all; guessing would
      // produce violations on strings that never reach the DOM.
      expect(classesOf(`<div className={getStyles('p-4')} />`)).toEqual([]);
    });
  });

  describe('cva variant definitions', () => {
    it('reads class strings from a cva call outside any JSX', () => {
      const source = `
        const button = cva('inline-flex rounded-md', {
          variants: {
            size: { sm: 'p-[7px]', md: 'p-4' },
            tone: { danger: 'bg-[#ff0000]' },
          },
        });
      `;
      expect(classesOf(source)).toEqual([
        'inline-flex',
        'rounded-md',
        'p-[7px]',
        'p-4',
        'bg-[#ff0000]',
      ]);
    });
  });

  describe('template literals', () => {
    it('reads the static segments', () => {
      expect(classesOf('<div className={`flex p-4`} />')).toEqual(['flex', 'p-4']);
    });

    it('keeps static segments either side of an interpolation', () => {
      expect(classesOf('<div className={`flex ${size} gap-2`} />')).toEqual(['flex', 'gap-2']);
    });

    it('does not emit a fragment glued to an interpolation', () => {
      // `p-${n}` must not surface as the class `p-`, which no rule can judge.
      const classes = classesOf('<div className={`p-${n} flex`} />');
      expect(classes).toContain('flex');
      expect(classes).not.toContain('p-');
    });

    it('reads interpolated helper calls', () => {
      expect(classesOf('<div className={`flex ${cn("p-4")}`} />')).toEqual(['flex', 'p-4']);
    });
  });

  describe('positions', () => {
    it('locates a class at its own offset, not the enclosing literal', () => {
      const [flex, padding] = tokensOf('<div className="flex p-[13px]" />');

      expect(flex).toMatchObject({ value: 'flex', line: 1, column: 17 });
      expect(padding).toMatchObject({ value: 'p-[13px]', line: 1, column: 22 });
    });

    it('reports the range that exactly covers the class', () => {
      const source = '<div className="flex p-[13px]" />';
      const [, padding] = tokensOf(source);
      expect(source.slice(padding!.range[0], padding!.range[1])).toBe('p-[13px]');
    });

    it('tracks lines through a multi-line call', () => {
      const source = ['<div', '  className={cn(', "    'p-[13px]',", '  )}', '/>'].join('\n');
      const [token] = tokensOf(source);
      expect(token).toMatchObject({ value: 'p-[13px]', line: 3 });
      expect(source.slice(token!.range[0], token!.range[1])).toBe('p-[13px]');
    });

    it('keeps offsets exact inside a template literal', () => {
      const source = '<div className={`flex gap-[7px]`} />';
      const gap = tokensOf(source).find((token) => token.value === 'gap-[7px]');
      expect(source.slice(gap!.range[0], gap!.range[1])).toBe('gap-[7px]');
    });
  });

  describe('deduplication', () => {
    it('reports a class once even when reachable by two paths', () => {
      // The `cn` call is visited both as a className value and as a helper call.
      expect(classesOf(`<div className={cn('p-4')} />`)).toEqual(['p-4']);
    });
  });

  describe('robustness', () => {
    it('handles TypeScript syntax around the classes', () => {
      expect(classesOf(`<div className={cn('p-4' as string)} />`)).toEqual(['p-4']);
    });

    it('terminates on deeply nested expressions', () => {
      const nested = `cn(${'cn('.repeat(40)}'p-4'${')'.repeat(40)})`;
      expect(() => classesOf(`<div className={${nested}} />`)).not.toThrow();
    });

    it('returns nothing for a file with no classes', () => {
      expect(classesOf('export const x = 1;')).toEqual([]);
    });
  });
});
