import { describe, expect, it } from 'vitest';

import { MODEL_SCHEMA_VERSION, ModelValidationError } from '../../src/model/common.js';
import {
  countTokens,
  createDesignSystem,
  isEmptyDesignSystem,
  parseDesignSystem,
  safeParseDesignSystem,
} from '../../src/model/design-system.js';
import { createColorSystem } from '../../src/model/tokens/color.js';
import { createSpacingScale } from '../../src/model/tokens/spacing.js';

const meta = { name: 'Acme DS', source: 'tailwind' } as const;

describe('createDesignSystem', () => {
  it('fills in every token group a parser did not supply', () => {
    const system = createDesignSystem({ meta });

    expect(system.tokens.spacing.tokens).toEqual([]);
    expect(system.tokens.color.tokens).toEqual([]);
    expect(system.tokens.borderRadius.tokens).toEqual([]);
    expect(system.tokens.typography.textStyles).toEqual([]);
  });

  it('stamps the schema version so a stale cache can be detected', () => {
    expect(createDesignSystem({ meta }).meta.schemaVersion).toBe(MODEL_SCHEMA_VERSION);
  });

  it('stamps an ISO timestamp when the parser does not supply one', () => {
    const { parsedAt } = createDesignSystem({ meta }).meta;
    expect(() => new Date(parsedAt).toISOString()).not.toThrow();
    expect(new Date(parsedAt).toISOString()).toBe(parsedAt);
  });

  it('preserves a parser-supplied timestamp, keeping output reproducible', () => {
    const parsedAt = '2026-01-01T00:00:00.000Z';
    expect(createDesignSystem({ meta: { ...meta, parsedAt } }).meta.parsedAt).toBe(parsedAt);
  });

  it('omits optional groups rather than setting them to undefined', () => {
    const system = createDesignSystem({ meta });
    expect('shadow' in system.tokens).toBe(false);
    expect('components' in system).toBe(false);
  });

  it('validates its own output, so a parser bug surfaces here', () => {
    expect(() =>
      createDesignSystem({
        // A parser emitting a bad source format should fail loudly at the boundary.
        meta: { ...meta, source: 'not-a-real-format' as unknown as 'tailwind' },
      }),
    ).toThrow(ModelValidationError);
  });

  it('carries components and composition rules through untouched', () => {
    const system = createDesignSystem({
      meta,
      components: {
        Button: {
          name: 'Button',
          variants: { variant: ['primary', 'secondary'] },
          requiredProps: [],
          source: 'config',
        },
      },
      compositionRules: [
        { id: 'no-nested-card', parent: 'Card', forbiddenDescendants: ['Card'], severity: 'error' },
      ],
    });

    expect(system.components?.['Button']?.variants['variant']).toEqual(['primary', 'secondary']);
    expect(system.compositionRules?.[0]?.id).toBe('no-nested-card');
  });
});

describe('parseDesignSystem', () => {
  const valid = createDesignSystem({
    meta,
    tokens: { spacing: createSpacingScale([{ name: '1', value: '4px' }]) },
  });

  it('accepts a well-formed model', () => {
    expect(parseDesignSystem(structuredClone(valid))).toEqual(valid);
  });

  it('rejects unknown keys rather than silently dropping them', () => {
    const withExtra = { ...structuredClone(valid), unexpected: true };
    expect(() => parseDesignSystem(withExtra)).toThrow(ModelValidationError);
  });

  it('rejects a model missing its token groups', () => {
    expect(() => parseDesignSystem({ meta: valid.meta })).toThrow(ModelValidationError);
  });

  it('rejects a mismatched schema version, so old caches cannot be misread', () => {
    const stale = structuredClone(valid);
    (stale.meta as { schemaVersion: number }).schemaVersion = MODEL_SCHEMA_VERSION + 1;
    expect(() => parseDesignSystem(stale)).toThrow(ModelValidationError);
  });

  it('rejects a non-ISO timestamp', () => {
    const bad = structuredClone(valid);
    (bad.meta as { parsedAt: string }).parsedAt = 'last Tuesday';
    expect(() => parseDesignSystem(bad)).toThrow(ModelValidationError);
  });

  it('produces an error naming the offending path', () => {
    try {
      parseDesignSystem({ meta: { ...valid.meta, name: '' }, tokens: valid.tokens });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelValidationError);
      expect((error as ModelValidationError).message).toContain('name');
      expect((error as ModelValidationError).issues.length).toBeGreaterThan(0);
    }
  });

  it('names the subject it was validating', () => {
    expect(() => parseDesignSystem({}, 'Cached design system')).toThrow(/Cached design system/);
  });
});

describe('safeParseDesignSystem', () => {
  it('reports success without throwing', () => {
    const system = createDesignSystem({ meta });
    const result = safeParseDesignSystem(structuredClone(system));
    expect(result.success).toBe(true);
  });

  it('reports failure without throwing', () => {
    const result = safeParseDesignSystem({ nope: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ModelValidationError);
    }
  });
});

describe('isEmptyDesignSystem', () => {
  it('is true for a system with no tokens at all', () => {
    expect(isEmptyDesignSystem(createDesignSystem({ meta }))).toBe(true);
  });

  it('is false once any group has a token', () => {
    const system = createDesignSystem({
      meta,
      tokens: { color: createColorSystem([{ name: 'brand', value: '#fff' }]) },
    });
    expect(isEmptyDesignSystem(system)).toBe(false);
  });
});

describe('countTokens', () => {
  it('counts across every group', () => {
    const system = createDesignSystem({
      meta,
      tokens: {
        spacing: createSpacingScale([
          { name: '1', value: '4px' },
          { name: '2', value: '8px' },
        ]),
        color: createColorSystem([{ name: 'brand', value: '#fff' }]),
      },
    });
    expect(countTokens(system)).toBe(3);
  });

  it('is zero for an empty system', () => {
    expect(countTokens(createDesignSystem({ meta }))).toBe(0);
  });
});
