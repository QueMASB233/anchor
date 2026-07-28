import { describe, expect, it } from 'vitest';

import { colorsEqual, normalizeColor } from '../../src/model/tokens/color-value.js';

describe('normalizeColor', () => {
  describe('hex notation', () => {
    it.each([
      ['#fff', '#ffffff', 1],
      ['#FFF', '#ffffff', 1],
      ['#ffffff', '#ffffff', 1],
      ['#2D3748', '#2d3748', 1],
      ['#000', '#000000', 1],
    ])('normalizes %s', (input, hex, alpha) => {
      expect(normalizeColor(input)).toEqual({ hex, alpha });
    });

    it('splits alpha out of 8-digit hex', () => {
      expect(normalizeColor('#ff000080')).toEqual({ hex: '#ff0000', alpha: 128 / 255 });
    });

    it('splits alpha out of 4-digit hex', () => {
      expect(normalizeColor('#f00f')).toEqual({ hex: '#ff0000', alpha: 1 });
    });

    it('rejects hex lengths that are not valid CSS', () => {
      expect(normalizeColor('#12345')).toBeNull();
      expect(normalizeColor('#1234567')).toBeNull();
    });

    it('rejects non-hex characters', () => {
      expect(normalizeColor('#gggggg')).toBeNull();
    });
  });

  describe('rgb notation', () => {
    it('parses legacy comma syntax', () => {
      expect(normalizeColor('rgb(45, 55, 72)')).toEqual({ hex: '#2d3748', alpha: 1 });
    });

    it('parses modern space syntax', () => {
      expect(normalizeColor('rgb(45 55 72)')).toEqual({ hex: '#2d3748', alpha: 1 });
    });

    it('parses rgba with a decimal alpha', () => {
      expect(normalizeColor('rgba(0, 0, 0, 0.5)')).toEqual({ hex: '#000000', alpha: 0.5 });
    });

    it('parses modern slash alpha as a percentage', () => {
      expect(normalizeColor('rgb(0 0 0 / 50%)')).toEqual({ hex: '#000000', alpha: 0.5 });
    });

    it('parses percentage channels', () => {
      expect(normalizeColor('rgb(100%, 0%, 0%)')).toEqual({ hex: '#ff0000', alpha: 1 });
    });

    it('clamps out-of-range channels rather than producing invalid hex', () => {
      expect(normalizeColor('rgb(300, -20, 0)')).toEqual({ hex: '#ff0000', alpha: 1 });
    });
  });

  describe('hsl notation', () => {
    it('parses the shadcn-style hsl triplet inside a function', () => {
      expect(normalizeColor('hsl(0 0% 100%)')).toEqual({ hex: '#ffffff', alpha: 1 });
    });

    it('parses legacy comma syntax', () => {
      expect(normalizeColor('hsl(0, 100%, 50%)')).toEqual({ hex: '#ff0000', alpha: 1 });
    });

    it('parses a deg-suffixed hue', () => {
      expect(normalizeColor('hsl(120deg, 100%, 50%)')).toEqual({ hex: '#00ff00', alpha: 1 });
    });

    it('parses hsla', () => {
      expect(normalizeColor('hsla(240, 100%, 50%, 0.25)')).toEqual({ hex: '#0000ff', alpha: 0.25 });
    });

    it('wraps hue angles beyond 360', () => {
      expect(normalizeColor('hsl(480, 100%, 50%)')).toEqual(normalizeColor('hsl(120, 100%, 50%)'));
    });
  });

  describe('keywords', () => {
    it('resolves transparent to fully transparent black', () => {
      expect(normalizeColor('transparent')).toEqual({ hex: '#000000', alpha: 0 });
    });

    it('resolves common named colours', () => {
      expect(normalizeColor('white')).toEqual({ hex: '#ffffff', alpha: 1 });
      expect(normalizeColor('RED')).toEqual({ hex: '#ff0000', alpha: 1 });
    });

    it('refuses keywords that are not a concrete colour', () => {
      expect(normalizeColor('currentColor')).toBeNull();
      expect(normalizeColor('inherit')).toBeNull();
    });
  });

  describe('values it must not guess at', () => {
    it.each([
      ['var(--primary)'],
      ['linear-gradient(to right, #fff, #000)'],
      [''],
      ['   '],
      ['rgb(0, 0)'],
      ['not-a-color'],
    ])('returns null for %s', (input) => {
      expect(normalizeColor(input)).toBeNull();
    });
  });
});

describe('colorsEqual', () => {
  it('matches the same colour across notations', () => {
    expect(colorsEqual('#2D3748', 'rgb(45, 55, 72)')).toBe(true);
    expect(colorsEqual('#fff', 'hsl(0 0% 100%)')).toBe(true);
  });

  it('distinguishes colours that differ only in opacity', () => {
    expect(colorsEqual('rgba(0,0,0,0.5)', '#000000')).toBe(false);
  });

  it('is false when either side is not a concrete colour', () => {
    expect(colorsEqual('var(--x)', '#000')).toBe(false);
  });
});
