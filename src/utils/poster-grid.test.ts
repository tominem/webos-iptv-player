import { describe, expect, it } from 'vitest';
import { columnOf, itemRangeForRows, rowCount, rowOf, stepInGrid } from './poster-grid';

describe('poster grid math', () => {
  it('counts the rows a list needs', () => {
    expect(rowCount(0, 4)).toBe(0);
    expect(rowCount(4, 4)).toBe(1);
    expect(rowCount(5, 4)).toBe(2);
  });

  it('places an item in a row and a column, filling left to right', () => {
    expect([0, 3, 4, 9].map(i => rowOf(i, 4))).toEqual([0, 0, 1, 2]);
    expect([0, 3, 4, 9].map(i => columnOf(i, 4))).toEqual([0, 3, 0, 1]);
  });

  it('turns a window of rows into the items on it, clipped to the list', () => {
    expect(itemRangeForRows(1, 3, 4, 20)).toEqual({ start: 4, end: 12 });
    expect(itemRangeForRows(2, 5, 4, 10)).toEqual({ start: 8, end: 10 });
  });

  describe('stepInGrid', () => {
    it('moves along a row and stops at its ends', () => {
      expect(stepInGrid(5, 'right', 4, 10)).toBe(6);
      expect(stepInGrid(5, 'left', 4, 10)).toBe(4);
      expect(stepInGrid(4, 'left', 4, 10)).toBeNull();
      expect(stepInGrid(7, 'right', 4, 10)).toBeNull();
    });

    it('does not run past the last poster of a short row', () => {
      expect(stepInGrid(9, 'right', 4, 10)).toBeNull();
    });

    it('moves down and up by a row', () => {
      expect(stepInGrid(1, 'down', 4, 10)).toBe(5);
      expect(stepInGrid(5, 'up', 4, 10)).toBe(1);
      expect(stepInGrid(1, 'up', 4, 10)).toBeNull();
    });

    it('lands on the last poster when the row below is short', () => {
      expect(stepInGrid(7, 'down', 4, 10)).toBe(9);
      expect(stepInGrid(9, 'down', 4, 10)).toBeNull();
    });

    it('stops at the bottom row', () => {
      expect(stepInGrid(8, 'down', 4, 10)).toBeNull();
      expect(stepInGrid(3, 'down', 4, 4)).toBeNull();
    });
  });
});
