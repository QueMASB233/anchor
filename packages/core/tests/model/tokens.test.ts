import { describe, expect, it } from 'vitest';

import {
  createColorSystem,
  findColorTokensByHex,
  findSemanticAlternatives,
  splitPaletteName,
} from '../../src/model/tokens/color.js';
import { createScaleTokens, isOnScale, nearestScaleToken } from '../../src/model/tokens/scale.js';
import {
  createShadowSystem,
  findShadowToken,
  normalizeShadow,
} from '../../src/model/tokens/shadow.js';
import {
  createSpacingScale,
  isOnSpacingScale,
  nearestSpacingToken,
  SpacingScaleSchema,
} from '../../src/model/tokens/spacing.js';

describe('createSpacingScale', () => {
  const scale = createSpacingScale([
    { name: '0', value: '0px' },
    { name: '1', value: '0.25rem' },
    { name: '2', value: '0.5rem' },
    { name: '4', value: '1rem' },
    { name: '6', value: '1.5rem' },
    { name: '8', value: '2rem' },
  ]);

  it('normalizes every value to pixels while preserving the authored form', () => {
    expect(scale.tokens.map((t) => [t.name, t.value, t.px])).toEqual([
      ['0', '0px', 0],
      ['1', '0.25rem', 4],
      ['2', '0.5rem', 8],
      ['4', '1rem', 16],
      ['6', '1.5rem', 24],
      ['8', '2rem', 32],
    ]);
  });

  it('infers the base unit from the normalized values', () => {
    expect(scale.baseUnit).toBe(4);
    expect(scale.confidence).toBe('high');
  });

  it('produces a model that satisfies its own schema', () => {
    expect(SpacingScaleSchema.safeParse(scale).success).toBe(true);
  });

  it('records the root font size used for the conversion', () => {
    const tenPx = createSpacingScale([{ name: 'sm', value: '1rem' }], { rootFontSize: 10 });
    expect(tenPx.rootFontSize).toBe(10);
    expect(tenPx.tokens[0]?.px).toBe(10);
  });

  it('keeps unresolvable values as tokens but excludes them from inference', () => {
    const withAuto = createSpacingScale([
      { name: 'auto', value: 'auto' },
      { name: '1', value: '4px' },
      { name: '2', value: '8px' },
      { name: '3', value: '12px' },
    ]);
    expect(withAuto.tokens).toHaveLength(4);
    expect(withAuto.tokens[0]?.px).toBeNull();
    expect(withAuto.baseUnit).toBe(4);
  });

  it('excludes deprecated tokens from base unit inference', () => {
    const withLegacy = createSpacingScale([
      { name: 'legacy', value: '13px', deprecated: true },
      { name: '1', value: '4px' },
      { name: '2', value: '8px' },
      { name: '3', value: '12px' },
      { name: '4', value: '16px' },
      { name: '5', value: '20px' },
    ]);
    expect(withLegacy.baseUnit).toBe(4);
    expect(withLegacy.outliers).toEqual([]);
  });

  it('handles an empty scale without throwing', () => {
    const empty = createSpacingScale([]);
    expect(empty.tokens).toEqual([]);
    expect(empty.baseUnit).toBeNull();
    expect(empty.confidence).toBe('none');
  });
});

describe('nearestSpacingToken', () => {
  const scale = createSpacingScale([
    { name: '0', value: '0px' },
    { name: '2', value: '8px' },
    { name: '3', value: '12px' },
    { name: '4', value: '16px' },
  ]);

  it('finds the closest token for an off-scale value', () => {
    expect(nearestSpacingToken(scale, 13)?.name).toBe('3');
  });

  it('resolves ties toward the smaller value', () => {
    // 10px sits exactly between 8px and 12px.
    expect(nearestSpacingToken(scale, 10)?.name).toBe('2');
  });

  it('never suggests a deprecated token', () => {
    const withDeprecated = createSpacingScale([
      { name: 'old-13', value: '13px', deprecated: true },
      { name: '3', value: '12px' },
    ]);
    expect(nearestSpacingToken(withDeprecated, 13)?.name).toBe('3');
  });

  it('returns null when nothing on the scale is resolvable', () => {
    expect(
      nearestSpacingToken(createSpacingScale([{ name: 'auto', value: 'auto' }]), 8),
    ).toBeNull();
  });
});

describe('isOnSpacingScale', () => {
  const scale = createSpacingScale([
    { name: '2', value: '8px' },
    { name: 'old', value: '13px', deprecated: true },
  ]);

  it('recognizes an exact match', () => {
    expect(isOnSpacingScale(scale, 8)).toBe(true);
  });

  it('rejects a near miss', () => {
    expect(isOnSpacingScale(scale, 9)).toBe(false);
  });

  it('does not count deprecated tokens as on-scale', () => {
    expect(isOnSpacingScale(scale, 13)).toBe(false);
  });
});

describe('splitPaletteName', () => {
  it.each([
    ['blue-500', 'blue', '500'],
    ['gray.700', 'gray', '700'],
    ['color/blue/500', 'color/blue', '500'],
    ['brand-primary-100', 'brand-primary', '100'],
  ])('splits %s', (name, family, shade) => {
    expect(splitPaletteName(name)).toEqual({ family, shade });
  });

  it.each([['primary'], ['text-secondary'], ['background'], ['blue-5']])(
    'returns null for the semantic-looking name %s',
    (name) => {
      expect(splitPaletteName(name)).toBeNull();
    },
  );
});

describe('createColorSystem', () => {
  const system = createColorSystem([
    { name: 'blue-500', value: '#3B82F6' },
    { name: 'gray-500', value: 'rgb(107, 114, 128)' },
    { name: 'text-secondary', value: '#6b7280' },
    { name: 'brand', value: '#3b82f6', reference: 'blue-500' },
  ]);

  it('normalizes values to canonical hex', () => {
    expect(system.tokens[0]?.hex).toBe('#3b82f6');
    expect(system.tokens[1]?.hex).toBe('#6b7280');
  });

  it('classifies numeric-suffixed names as palette entries', () => {
    expect(system.tokens[0]?.kind).toBe('palette');
    expect(system.tokens[0]?.family).toBe('blue');
    expect(system.tokens[0]?.shade).toBe('500');
  });

  it('classifies everything else as semantic', () => {
    expect(system.tokens[2]?.kind).toBe('semantic');
    expect(system.tokens[2]?.family).toBeUndefined();
  });

  it('lets a parser override the inferred classification', () => {
    const explicit = createColorSystem([{ name: 'blue-500', value: '#fff', kind: 'semantic' }]);
    expect(explicit.tokens[0]?.kind).toBe('semantic');
  });

  it('records a null hex for values it cannot resolve', () => {
    const unresolvable = createColorSystem([{ name: 'themed', value: 'var(--primary)' }]);
    expect(unresolvable.tokens[0]?.hex).toBeNull();
    expect(unresolvable.tokens[0]?.value).toBe('var(--primary)');
  });
});

describe('findColorTokensByHex', () => {
  const system = createColorSystem([
    { name: 'gray-500', value: '#6b7280' },
    { name: 'text-secondary', value: '#6B7280' },
    { name: 'retired', value: '#6b7280', deprecated: true },
  ]);

  it('matches across notation and case', () => {
    expect(findColorTokensByHex(system, '#6B7280').map((t) => t.name)).toEqual([
      'gray-500',
      'text-secondary',
    ]);
  });

  it('excludes deprecated tokens', () => {
    expect(findColorTokensByHex(system, '#6b7280').map((t) => t.name)).not.toContain('retired');
  });
});

describe('findSemanticAlternatives', () => {
  it('finds a semantic token that aliases the palette token by name', () => {
    const system = createColorSystem([
      { name: 'gray-500', value: '#6b7280' },
      { name: 'text-secondary', value: 'var(--gray-500)', reference: 'gray-500' },
    ]);
    const palette = system.tokens[0];
    expect(palette).toBeDefined();
    expect(findSemanticAlternatives(system, palette!).map((t) => t.name)).toEqual([
      'text-secondary',
    ]);
  });

  it('finds a semantic token that duplicates the hex instead of aliasing', () => {
    const system = createColorSystem([
      { name: 'gray-500', value: '#6b7280' },
      { name: 'text-secondary', value: '#6b7280' },
    ]);
    const palette = system.tokens[0];
    expect(findSemanticAlternatives(system, palette!).map((t) => t.name)).toEqual([
      'text-secondary',
    ]);
  });

  it('does not suggest other palette tokens', () => {
    const system = createColorSystem([
      { name: 'gray-500', value: '#6b7280' },
      { name: 'slate-500', value: '#6b7280' },
    ]);
    expect(findSemanticAlternatives(system, system.tokens[0]!)).toEqual([]);
  });
});

describe('normalizeShadow', () => {
  it('expands the underscores Tailwind arbitrary values use', () => {
    expect(normalizeShadow('0_4px_8px_rgba(0,0,0,0.1)')).toBe('0 4px 8px rgba(0, 0, 0, 0.1)');
  });

  it('collapses irregular whitespace', () => {
    expect(normalizeShadow('0   4px    8px  #000')).toBe('0 4px 8px #000');
  });

  it('is case-insensitive', () => {
    expect(normalizeShadow('0 4PX 8px #ABC')).toBe('0 4px 8px #abc');
  });
});

describe('findShadowToken', () => {
  const system = createShadowSystem([
    { name: 'md', value: '0 4px 8px rgba(0, 0, 0, 0.1)' },
    { name: 'lg', value: '0 10px 20px rgba(0, 0, 0, 0.2)' },
  ]);

  it('matches a Tailwind arbitrary value against the equivalent token', () => {
    expect(findShadowToken(system, '0_4px_8px_rgba(0,0,0,0.1)')?.name).toBe('md');
  });

  it('returns null for a genuinely custom shadow', () => {
    expect(findShadowToken(system, '0 1px 2px #123456')).toBeNull();
  });
});

describe('createScaleTokens', () => {
  const radius = createScaleTokens([
    { name: 'none', value: '0px' },
    { name: 'sm', value: '0.125rem' },
    { name: 'md', value: '0.375rem' },
    { name: 'full', value: '9999px' },
  ]);

  it('normalizes lengths to pixels', () => {
    expect(radius.tokens.map((t) => t.px)).toEqual([0, 2, 6, 9999]);
  });

  it('supports nearest lookups for fix suggestions', () => {
    expect(nearestScaleToken(radius, 3)?.name).toBe('sm');
    expect(isOnScale(radius, 6)).toBe(true);
    expect(isOnScale(radius, 7)).toBe(false);
  });
});
