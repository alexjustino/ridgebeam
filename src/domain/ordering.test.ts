import { describe, expect, it } from 'vitest';

import { DIRECTIONS, moved } from './ordering';

const IDS = ['a', 'b', 'c', 'd'] as const;

describe('moving one row', () => {
  it('swaps it with the row above when it moves up', () => {
    expect(moved(IDS, 'c', 'up')).toEqual(['a', 'c', 'b', 'd']);
  });

  it('swaps it with the row below when it moves down', () => {
    expect(moved(IDS, 'b', 'down')).toEqual(['a', 'c', 'b', 'd']);
  });

  it('does nothing to the first row moved up or the last row moved down, and is not an error', () => {
    expect(moved(IDS, 'a', 'up')).toEqual([...IDS]);
    expect(moved(IDS, 'd', 'down')).toEqual([...IDS]);
  });

  it('leaves the list as it was for a row that is not in it', () => {
    expect(moved(IDS, 'z', 'up')).toEqual([...IDS]);
    expect(moved([], 'a', 'down')).toEqual([]);
  });

  it('does nothing to a list of one', () => {
    for (const direction of DIRECTIONS) expect(moved(['a'], 'a', direction)).toEqual(['a']);
  });

  it('returns a new list and never changes the one it was given', () => {
    const ids = ['a', 'b', 'c'];
    const result = moved(ids, 'a', 'down');
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(result).not.toBe(ids);
    expect(moved(ids, 'a', 'up')).not.toBe(ids);
  });

  it('is undone by the opposite move', () => {
    for (const id of IDS.slice(1, -1)) {
      expect(moved(moved(IDS, id, 'up'), id, 'down')).toEqual([...IDS]);
      expect(moved(moved(IDS, id, 'down'), id, 'up')).toEqual([...IDS]);
    }
  });

  it('keeps every id exactly once, whatever is moved', () => {
    for (const id of IDS) {
      for (const direction of DIRECTIONS) {
        expect([...moved(IDS, id, direction)].sort()).toEqual([...IDS]);
      }
    }
  });
});
