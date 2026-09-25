/**
 * Order as the person sets it: one row moved one place up or down among its siblings.
 *
 * The host stores the order (`stage_move`, `activity_move`, `room_move`) and renumbers the
 * positions; this is the same rule as a pure function, so the interface can show the new order
 * before the host answers, and a test can say what a move must do.
 *
 * At an edge a move does nothing and is not an error: the first row moved up stays first. A row
 * that is not in the list leaves the list as it was.
 *
 * What this module is not: storage, and not a sort. It never reorders anything but the one row.
 */

export const DIRECTIONS = ['up', 'down'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * The ids in their new order after `id` moves one place in `direction`. Always a new array; the
 * one it was given is never changed.
 */
export function moved(ids: readonly string[], id: string, direction: Direction): string[] {
  const result = [...ids];
  const from = result.indexOf(id);
  if (from === -1) return result;
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= result.length) return result;
  result[from] = result[to]!;
  result[to] = id;
  return result;
}
