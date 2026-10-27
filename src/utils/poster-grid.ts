export type GridMove = 'left' | 'right' | 'up' | 'down';

// A poster grid scrolled vertically: `columns` posters a row, filled left to
// right, so every full row spans the whole screen.
export function rowCount(items: number, columns: number): number {
  return Math.ceil(items / columns);
}

export function rowOf(index: number, columns: number): number {
  return Math.floor(index / columns);
}

export function columnOf(index: number, columns: number): number {
  return index % columns;
}

// The items on rows [startRow, endRow), clipped to the list.
export function itemRangeForRows(
  startRow: number,
  endRow: number,
  columns: number,
  items: number,
): { start: number; end: number } {
  return { start: startRow * columns, end: Math.min(endRow * columns, items) };
}

// Where a key moves the focus, or null at an edge. Down from a full row into a
// short last row lands on that row's last poster.
export function stepInGrid(index: number, move: GridMove, columns: number, items: number): number | null {
  if (move === 'left') return columnOf(index, columns) > 0 ? index - 1 : null;
  if (move === 'right') return columnOf(index, columns) < columns - 1 && index + 1 < items ? index + 1 : null;
  if (move === 'up') return index - columns >= 0 ? index - columns : null;
  if (index + columns < items) return index + columns;
  return rowOf(index, columns) < rowCount(items, columns) - 1 ? items - 1 : null;
}
