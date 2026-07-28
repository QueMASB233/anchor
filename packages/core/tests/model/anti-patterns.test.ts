import { describe, expect, it } from 'vitest';

import { AntiPatternSchema } from '../../src/model/anti-patterns.js';

/**
 * Anti-patterns arrive from `anchor.config`. In the GitHub Action that config
 * comes from the pull request being linted, which is attacker-controlled — so
 * these are security tests, not validation niceties.
 */
describe('AntiPatternSchema', () => {
  const base = { id: 'no-legacy', description: 'Do not use the legacy modal.', severity: 'error' };

  describe('accepts the matcher forms it supports', () => {
    it.each([
      ['class-name-regex', { kind: 'class-name-regex', pattern: '^!.*' }],
      ['jsx-element', { kind: 'jsx-element', element: 'LegacyModal' }],
      ['jsx-element with a prop', { kind: 'jsx-element', element: 'Box', withProp: 'sx' }],
      ['inline-style-property', { kind: 'inline-style-property', property: 'zIndex' }],
      ['import-source', { kind: 'import-source', source: '@acme/legacy-ui' }],
    ])('accepts a %s matcher', (_label, matcher) => {
      expect(AntiPatternSchema.safeParse({ ...base, matcher }).success).toBe(true);
    });
  });

  describe('rejects matchers that would mean executing config-supplied code', () => {
    it('rejects an unknown matcher kind', () => {
      const result = AntiPatternSchema.safeParse({
        ...base,
        matcher: { kind: 'javascript', code: 'process.exit(1)' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a function-valued matcher', () => {
      const result = AntiPatternSchema.safeParse({
        ...base,
        matcher: { kind: 'class-name-regex', pattern: '.*', test: () => true },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('regex hardening', () => {
    it('rejects nested unbounded quantifiers that risk catastrophic backtracking', () => {
      const result = AntiPatternSchema.safeParse({
        ...base,
        matcher: { kind: 'class-name-regex', pattern: '(a+)+$' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects the (a*)* variant too', () => {
      const result = AntiPatternSchema.safeParse({
        ...base,
        matcher: { kind: 'class-name-regex', pattern: '^(x*)*y' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a pattern longer than the cap', () => {
      const result = AntiPatternSchema.safeParse({
        ...base,
        matcher: { kind: 'class-name-regex', pattern: 'a'.repeat(501) },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a syntactically invalid regex instead of throwing at match time', () => {
      const result = AntiPatternSchema.safeParse({
        ...base,
        matcher: { kind: 'class-name-regex', pattern: '([unclosed' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects stateful g and y flags, which make matching order-dependent', () => {
      for (const flags of ['g', 'y', 'gi']) {
        const result = AntiPatternSchema.safeParse({
          ...base,
          matcher: { kind: 'class-name-regex', pattern: 'x', flags },
        });
        expect(result.success, `flags: ${flags}`).toBe(false);
      }
    });

    it('accepts the safe flags', () => {
      const result = AntiPatternSchema.safeParse({
        ...base,
        matcher: { kind: 'class-name-regex', pattern: 'x', flags: 'imsu' },
      });
      expect(result.success).toBe(true);
    });

    it('still accepts ordinary patterns a team would realistically write', () => {
      for (const pattern of ['^!', 'text-\\[#[0-9a-f]{6}\\]', '(hover|focus):bg-red-500']) {
        const result = AntiPatternSchema.safeParse({
          ...base,
          matcher: { kind: 'class-name-regex', pattern },
        });
        expect(result.success, pattern).toBe(true);
      }
    });
  });

  describe('required fields', () => {
    it('requires a non-empty id', () => {
      const matcher = { kind: 'jsx-element', element: 'X' };
      expect(AntiPatternSchema.safeParse({ ...base, id: '', matcher }).success).toBe(false);
    });

    it('requires a description, since it is shown verbatim to developers', () => {
      const matcher = { kind: 'jsx-element', element: 'X' };
      const { description: _omitted, ...withoutDescription } = base;
      expect(AntiPatternSchema.safeParse({ ...withoutDescription, matcher }).success).toBe(false);
    });

    it('rejects unknown top-level keys', () => {
      const matcher = { kind: 'jsx-element', element: 'X' };
      expect(AntiPatternSchema.safeParse({ ...base, matcher, autofix: true }).success).toBe(false);
    });
  });
});
