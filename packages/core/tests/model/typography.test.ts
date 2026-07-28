import { describe, expect, it } from 'vitest';

import {
  createNamedTokens,
  createScaleTokens,
  emptyNamedTokens,
} from '../../src/model/tokens/scale.js';
import {
  createTypographySystem,
  emptyTypographySystem,
  TypographySystemSchema,
} from '../../src/model/tokens/typography.js';

describe('createNamedTokens', () => {
  it('keeps values as authored without inventing a pixel equivalent', () => {
    const weights = createNamedTokens([
      { name: 'normal', value: 400 },
      { name: 'semibold', value: '600' },
    ]);
    expect(weights.tokens).toEqual([
      { name: 'normal', value: '400' },
      { name: 'semibold', value: '600' },
    ]);
    expect(weights.tokens[0]).not.toHaveProperty('px');
  });

  it('preserves token metadata', () => {
    const fonts = createNamedTokens([
      { name: 'sans', value: 'Inter, system-ui', description: 'Primary UI face' },
    ]);
    expect(fonts.tokens[0]?.description).toBe('Primary UI face');
  });

  it('produces an empty group for empty input', () => {
    expect(createNamedTokens([])).toEqual(emptyNamedTokens());
  });
});

describe('emptyTypographySystem', () => {
  it('satisfies the schema, so it is safe as a default', () => {
    expect(TypographySystemSchema.safeParse(emptyTypographySystem()).success).toBe(true);
  });

  it('has every group present and empty', () => {
    const system = emptyTypographySystem();
    expect(system.fontFamilies.tokens).toEqual([]);
    expect(system.fontSizes.tokens).toEqual([]);
    expect(system.fontWeights.tokens).toEqual([]);
    expect(system.lineHeights.tokens).toEqual([]);
    expect(system.letterSpacings.tokens).toEqual([]);
    expect(system.textStyles).toEqual([]);
  });
});

describe('createTypographySystem', () => {
  it('fills in the groups a parser did not produce', () => {
    const system = createTypographySystem({
      fontSizes: createScaleTokens([
        { name: 'sm', value: '0.875rem' },
        { name: 'base', value: '1rem' },
      ]),
    });

    expect(system.fontSizes.tokens.map((t) => t.px)).toEqual([14, 16]);
    expect(system.fontFamilies.tokens).toEqual([]);
    expect(system.textStyles).toEqual([]);
  });

  it('carries composite text styles through', () => {
    const system = createTypographySystem({
      textStyles: [{ name: 'heading-1', fontSize: 'xl', fontWeight: 'bold' }],
    });
    expect(system.textStyles[0]?.name).toBe('heading-1');
    expect(TypographySystemSchema.safeParse(system).success).toBe(true);
  });

  it('produces an empty system when given nothing', () => {
    expect(createTypographySystem({})).toEqual(emptyTypographySystem());
  });
});
