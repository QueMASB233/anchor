import { describe, expect, it } from 'vitest';

import { inferBaseUnit } from '../../src/model/base-unit.js';

/**
 * The full default Tailwind spacing scale in pixels, including the `px` token
 * (1px) and the half-steps (0.5 -> 2px). This is the scale that breaks a naive
 * GCD implementation, so it is the most important case in this file.
 */
const TAILWIND_SPACING_PX = [
  0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 80, 96, 112, 128, 144,
  160, 176, 192, 208, 224, 240, 256, 288, 320, 384,
];

describe('inferBaseUnit', () => {
  describe('the cases named in the spec', () => {
    it('infers 4 from a 4px grid', () => {
      const result = inferBaseUnit([0, 4, 8, 16, 24, 32]);
      expect(result.baseUnit).toBe(4);
      expect(result.coverage).toBe(1);
      expect(result.confidence).toBe('high');
      expect(result.outliers).toEqual([]);
    });

    it('infers 5 from a 5px grid', () => {
      const result = inferBaseUnit([0, 5, 10, 20, 40]);
      expect(result.baseUnit).toBe(5);
      expect(result.coverage).toBe(1);
      expect(result.outliers).toEqual([]);
    });
  });

  describe('outlier resistance', () => {
    it('ignores a 1px hairline token instead of collapsing to a base unit of 1', () => {
      // A plain GCD would return 1 here and be useless.
      const result = inferBaseUnit(TAILWIND_SPACING_PX);
      expect(result.baseUnit).toBe(2);
      expect(result.outliers).toEqual([1]);
      expect(result.coverage).toBeGreaterThan(0.9);
      expect(result.coverage).toBeLessThan(1);
    });

    it('caps confidence at medium while any value sits off the grid', () => {
      expect(inferBaseUnit(TAILWIND_SPACING_PX).confidence).toBe('medium');
    });

    it('does not let a single off-grid value dictate the result', () => {
      const result = inferBaseUnit([4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 13]);
      expect(result.baseUnit).toBe(4);
      expect(result.outliers).toEqual([13]);
    });

    it('falls back to the GCD when values are too scattered to share a large step', () => {
      const result = inferBaseUnit([3, 5, 7, 11]);
      expect(result.baseUnit).toBe(1);
      expect(result.coverage).toBe(1);
    });
  });

  describe('grids whose step is never itself a token', () => {
    it('infers 3 from [6, 9, 12, 15] even though 3 is not in the scale', () => {
      const result = inferBaseUnit([6, 9, 12, 15]);
      expect(result.baseUnit).toBe(3);
      expect(result.coverage).toBe(1);
    });
  });

  describe('fractional pixel values', () => {
    it('handles half-pixel steps without float drift', () => {
      const result = inferBaseUnit([0.5, 1, 1.5, 2, 2.5, 3]);
      expect(result.baseUnit).toBe(0.5);
      expect(result.coverage).toBe(1);
    });

    it('treats values equal within rounding precision as one value', () => {
      const result = inferBaseUnit([4, 4.00001, 8, 12, 16]);
      expect(result.sampleSize).toBe(4);
      expect(result.baseUnit).toBe(4);
    });
  });

  describe('degenerate input', () => {
    it('reports no inference for an empty scale', () => {
      expect(inferBaseUnit([])).toEqual({
        baseUnit: null,
        coverage: 0,
        confidence: 'none',
        sampleSize: 0,
        outliers: [],
      });
    });

    it('reports no inference when every value is zero', () => {
      expect(inferBaseUnit([0, 0, 0]).baseUnit).toBeNull();
    });

    it('ignores negative values', () => {
      const result = inferBaseUnit([-8, -4, 4, 8, 12]);
      expect(result.sampleSize).toBe(3);
      expect(result.baseUnit).toBe(4);
    });

    it('ignores non-finite values', () => {
      const result = inferBaseUnit([Number.NaN, Number.POSITIVE_INFINITY, 4, 8]);
      expect(result.sampleSize).toBe(2);
      expect(result.baseUnit).toBe(4);
    });

    it('reports low confidence from a single value', () => {
      const result = inferBaseUnit([8]);
      expect(result.baseUnit).toBe(8);
      expect(result.confidence).toBe('low');
      expect(result.sampleSize).toBe(1);
    });

    it('reports low confidence from two values', () => {
      expect(inferBaseUnit([4, 8]).confidence).toBe('low');
    });

    it('reports medium confidence from a small but clean scale', () => {
      expect(inferBaseUnit([4, 8, 12]).confidence).toBe('medium');
    });
  });

  describe('determinism', () => {
    it('is independent of input ordering', () => {
      const ascending = inferBaseUnit([4, 8, 12, 16, 20]);
      const shuffled = inferBaseUnit([16, 4, 20, 12, 8]);
      expect(shuffled).toEqual(ascending);
    });

    it('is independent of duplicates', () => {
      const unique = inferBaseUnit([4, 8, 12, 16, 20]);
      const duplicated = inferBaseUnit([4, 4, 8, 8, 8, 12, 16, 20, 20]);
      expect(duplicated).toEqual(unique);
    });
  });
});
