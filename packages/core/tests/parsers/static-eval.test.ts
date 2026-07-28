import { describe, expect, it, vi } from 'vitest';

import { evaluateConfigModule, isResolved, UNRESOLVED } from '../../src/parsers/static-eval.js';

/** Folds a config and asserts it resolved, returning the plain value. */
function fold(code: string, file = 'tailwind.config.js'): Record<string, unknown> {
  const { value } = evaluateConfigModule(code, file);
  expect(isResolved(value)).toBe(true);
  return value as Record<string, unknown>;
}

describe('evaluateConfigModule', () => {
  describe('export shapes real configs use', () => {
    it('reads module.exports', () => {
      expect(fold(`module.exports = { theme: { spacing: { sm: '4px' } } };`)).toEqual({
        theme: { spacing: { sm: '4px' } },
      });
    });

    it('reads export default', () => {
      expect(fold(`export default { theme: { spacing: { sm: '4px' } } };`)).toEqual({
        theme: { spacing: { sm: '4px' } },
      });
    });

    it('reads exports.default', () => {
      expect(fold(`exports.default = { a: 1 };`)).toEqual({ a: 1 });
    });

    it('follows a variable reference, the most common TypeScript config shape', () => {
      expect(
        fold(`const config = { theme: { spacing: { sm: '4px' } } };\nexport default config;`),
      ).toEqual({ theme: { spacing: { sm: '4px' } } });
    });

    it('unwraps `satisfies Config`', () => {
      expect(
        fold(
          `import type { Config } from 'tailwindcss';\nexport default { content: [] } satisfies Config;`,
          'tailwind.config.ts',
        ),
      ).toEqual({ content: [] });
    });

    it('unwraps `as const`', () => {
      expect(fold(`export default { a: 1 } as const;`, 'tailwind.config.ts')).toEqual({ a: 1 });
    });

    it('unwraps an exported const with a type annotation', () => {
      expect(
        fold(
          `import type { Config } from 'tailwindcss';\nexport const config: Config = { a: 1 };\nexport default config;`,
          'tailwind.config.ts',
        ),
      ).toEqual({ a: 1 });
    });

    it('reports a config with no recognizable export', () => {
      const { value, warnings } = evaluateConfigModule(`const x = 1;`, 'tailwind.config.js');
      expect(value).toBe(UNRESOLVED);
      expect(warnings[0]?.code).toBe('unsupported-construct');
      expect(warnings[0]?.message).toContain('No default export');
    });
  });

  describe('literal folding', () => {
    it('folds nested objects, arrays, numbers, booleans and null', () => {
      expect(fold(`module.exports = { a: [1, 'two', true, null], b: { c: -4 }, d: 1.5 };`)).toEqual(
        { a: [1, 'two', true, null], b: { c: -4 }, d: 1.5 },
      );
    });

    it('folds quoted and numeric keys', () => {
      expect(fold(`module.exports = { '2xl': '1rem', 4: '2rem' };`)).toEqual({
        '2xl': '1rem',
        '4': '2rem',
      });
    });

    it('folds a template literal with no interpolation', () => {
      expect(fold('module.exports = { a: `1rem` };')).toEqual({ a: '1rem' });
    });

    it('folds string concatenation of literals', () => {
      expect(fold(`module.exports = { a: '1' + 'rem' };`)).toEqual({ a: '1rem' });
    });

    it('folds a spread of an object declared in the same file', () => {
      expect(
        fold(`const base = { sm: '4px' };\nmodule.exports = { theme: { ...base, md: '8px' } };`),
      ).toEqual({ theme: { sm: '4px', md: '8px' } });
    });

    it('folds a member expression into a locally declared object', () => {
      expect(
        fold(
          `const palette = { blue: { 500: '#3b82f6' } };\nmodule.exports = { c: palette.blue };`,
        ),
      ).toEqual({ c: { 500: '#3b82f6' } });
    });
  });

  describe('constructs it cannot resolve without executing code', () => {
    it('skips require() and names it in the warning', () => {
      const { warnings } = evaluateConfigModule(
        `const colors = require('tailwindcss/colors');\nmodule.exports = { theme: { colors } };`,
        'tailwind.config.js',
      );

      const warning = warnings.find((w) => w.path === 'theme.colors');
      expect(warning?.code).toBe('unresolvable-expression');
      expect(warning?.message).toContain('tailwindcss/colors');
    });

    it('skips a function-valued theme key', () => {
      const { warnings } = evaluateConfigModule(
        `module.exports = { theme: { spacing: ({ theme }) => theme('foo') } };`,
        'tailwind.config.js',
      );

      const warning = warnings.find((w) => w.path === 'theme.spacing');
      expect(warning?.message).toContain('function value');
    });

    it('skips a conditional expression', () => {
      const { warnings } = evaluateConfigModule(
        `module.exports = { theme: { a: process.env.X ? '1px' : '2px' } };`,
        'tailwind.config.js',
      );
      expect(warnings.some((w) => w.message.includes('conditional'))).toBe(true);
    });

    it('keeps the keys it could resolve alongside the ones it could not', () => {
      const { value, warnings } = evaluateConfigModule(
        `module.exports = { theme: { spacing: { sm: '4px', md: require('x') } } };`,
        'tailwind.config.js',
      );

      expect(isResolved(value)).toBe(true);
      // Partial data beats no data, as long as the gap is reported.
      expect(value).toEqual({ theme: { spacing: { sm: '4px' } } });
      expect(warnings).toHaveLength(1);
    });

    it('locates each warning at the offending line', () => {
      const { warnings } = evaluateConfigModule(
        ['module.exports = {', '  theme: {', '    colors: require("x"),', '  },', '};'].join('\n'),
        'tailwind.config.js',
      );

      expect(warnings[0]?.line).toBe(3);
      expect(warnings[0]?.file).toBe('tailwind.config.js');
      expect(warnings[0]?.path).toBe('theme.colors');
    });

    it('explains that Anchor never executes analyzed code', () => {
      const { warnings } = evaluateConfigModule(
        `module.exports = { theme: (x) => x };`,
        'tailwind.config.js',
      );
      expect(warnings[0]?.message).toContain('never executes');
    });
  });

  describe('it must never execute the config', () => {
    it('does not evaluate a call expression, however inviting', () => {
      // If this were executed the spy would fire and the process would exit.
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const { warnings } = evaluateConfigModule(
        `module.exports = { theme: { spacing: process.exit(1) } };`,
        'evil.config.js',
      );

      expect(exitSpy).not.toHaveBeenCalled();
      expect(warnings.length).toBeGreaterThan(0);
      exitSpy.mockRestore();
    });

    it('does not throw when the config would throw if run', () => {
      expect(() =>
        evaluateConfigModule(
          `throw new Error('boom');\nmodule.exports = { a: 1 };`,
          'evil.config.js',
        ),
      ).not.toThrow();
    });

    it('does not resolve an import, so no other file can be reached', () => {
      const { value, warnings } = evaluateConfigModule(
        `import secrets from '../../.env';\nmodule.exports = { theme: secrets };`,
        'evil.config.ts',
      );
      // The key is omitted rather than emptied: an empty `theme` would falsely
      // suggest the team declared one and it happened to have no tokens.
      expect(value).toEqual({});
      expect(warnings[0]?.path).toBe('theme');
    });

    it('terminates on a cyclic reference instead of looping forever', () => {
      const { value, warnings } = evaluateConfigModule(
        `const a = b;\nconst b = a;\nmodule.exports = { theme: a };`,
        'cyclic.config.js',
      );
      expect(value).toEqual({});
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('survives deeply nested input without blowing the stack', () => {
      const depth = 200;
      const nested = `${'{ a: '.repeat(depth)}1${' }'.repeat(depth)}`;
      expect(() =>
        evaluateConfigModule(`module.exports = { theme: ${nested} };`, 'deep.config.js'),
      ).not.toThrow();
    });
  });

  describe('malformed input', () => {
    it('reports a syntax error as a warning rather than throwing', () => {
      const { value, warnings } = evaluateConfigModule(
        `module.exports = { theme: { ,,, } };`,
        'broken.config.js',
      );
      expect(value).toBe(UNRESOLVED);
      expect(warnings[0]?.code).toBe('parse-error');
      expect(warnings[0]?.file).toBe('broken.config.js');
    });

    it('handles an empty file', () => {
      const { value, warnings } = evaluateConfigModule('', 'empty.config.js');
      expect(value).toBe(UNRESOLVED);
      expect(warnings).toHaveLength(1);
    });
  });
});
