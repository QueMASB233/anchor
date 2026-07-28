import { describe, expect, it } from 'vitest';

import { formatPx, isMultipleOf, roundPx, toPx } from '../../src/model/units.js';

describe('toPx', () => {
  describe('units it can resolve', () => {
    it.each([
      ['16px', 16],
      ['0', 0],
      ['0px', 0],
      ['1rem', 16],
      ['0.75rem', 12],
      ['.5rem', 8],
      ['1em', 16],
      ['12.5px', 12.5],
      ['-4px', -4],
      ['1pt', 96 / 72],
      ['1in', 96],
      ['1pc', 16],
    ])('resolves %s to %s', (input, expected) => {
      expect(toPx(input)).toBeCloseTo(expected, 4);
    });

    it('treats a bare number as pixels, as token files do', () => {
      expect(toPx(16)).toBe(16);
      expect(toPx('16')).toBe(16);
    });

    it('respects a custom root font size', () => {
      expect(toPx('1rem', 10)).toBe(10);
      expect(toPx('2rem', 10)).toBe(20);
    });

    it('is case-insensitive about units', () => {
      expect(toPx('1REM')).toBe(16);
      expect(toPx('16PX')).toBe(16);
    });

    it('tolerates surrounding whitespace', () => {
      expect(toPx('  16px  ')).toBe(16);
    });
  });

  describe('values it must refuse to guess at', () => {
    it.each([
      ['auto'],
      ['100%'],
      ['calc(100% - 16px)'],
      ['50vh'],
      ['2ch'],
      ['var(--spacing-4)'],
      ['inherit'],
      [''],
      ['   '],
      ['16 px'],
      ['px'],
      ['abc'],
    ])('returns null for %s rather than coercing it', (input) => {
      expect(toPx(input)).toBeNull();
    });

    it('returns null for non-finite numbers', () => {
      expect(toPx(Number.NaN)).toBeNull();
      expect(toPx(Number.POSITIVE_INFINITY)).toBeNull();
    });
  });

  it('avoids float drift on values that are not representable in binary', () => {
    // 0.1rem is 1.6000000000000001px in naive float arithmetic.
    expect(toPx('0.1rem')).toBe(1.6);
  });
});

describe('roundPx', () => {
  it('normalizes negative zero', () => {
    expect(Object.is(roundPx(-0), 0)).toBe(true);
  });

  it('rounds to four decimal places', () => {
    expect(roundPx(1.000005)).toBe(1);
    expect(roundPx(1.23456789)).toBe(1.2346);
  });
});

describe('formatPx', () => {
  it('renders a token-friendly length', () => {
    expect(formatPx(16)).toBe('16px');
    expect(formatPx(12.5)).toBe('12.5px');
  });
});

describe('isMultipleOf', () => {
  it('handles exact integer multiples', () => {
    expect(isMultipleOf(12, 4)).toBe(true);
    expect(isMultipleOf(13, 4)).toBe(false);
  });

  it('handles fractional steps without float error', () => {
    expect(isMultipleOf(1.5, 0.5)).toBe(true);
    expect(isMultipleOf(0.3, 0.1)).toBe(true);
  });

  it('treats a zero step as matching only zero', () => {
    expect(isMultipleOf(0, 0)).toBe(true);
    expect(isMultipleOf(4, 0)).toBe(false);
  });
});
