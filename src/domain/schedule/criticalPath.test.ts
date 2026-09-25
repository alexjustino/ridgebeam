// Copied from Tessera (github.com/alexjustino/tessera) src/domain/criticalPath.test.ts at commit
// bdbfc4a, under the Apache License 2.0, same author, and moved to working days with lags for
// Ridgebeam. The minutes helpers and their tests are gone with them.

import { describe, expect, it } from 'vitest';

import { hasCycle, plan, type Planned } from './criticalPath';
import type { Edge } from './graph';

const edge = (blockerId: string, blockedId: string, lagDays = 0): Edge => ({
  blockerId,
  blockedId,
  lagDays,
});
const task = (id: string, durationDays: number | null, isMilestone = false): Planned => ({
  id,
  durationDays,
  isMilestone,
});

/**
 * The graph the tests reason about, drawn so a person can check the answers by hand.
 *
 *              ┌── b (4 d) ──┐
 *   a (1 d) ───┤             ├──── d (2 d)
 *              └── c (1 d) ──┘
 *
 * a→b→d is 7 working days. a→c→d is 4. So the work takes 7, a, b and d are critical, and c has
 * 3 working days of float.
 */
const DIAMOND: Planned[] = [task('a', 1), task('b', 4), task('c', 1), task('d', 2)];
const DIAMOND_EDGES = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];

describe('the plan on a graph you can check by hand', () => {
  const result = plan(DIAMOND, DIAMOND_EDGES);

  it('takes as long as its longest route', () => {
    expect(result.durationDays).toBe(7);
    expect(result.unplanned).toBe(false);
    expect(result.cyclic).toBe(false);
  });

  it('starts each activity when everything blocking it has finished', () => {
    expect(result.timing.get('a')!.earliestStart).toBe(0);
    expect(result.timing.get('b')!.earliestStart).toBe(1);
    expect(result.timing.get('c')!.earliestStart).toBe(1);
    // d waits for the slower of the two, not for c.
    expect(result.timing.get('d')!.earliestStart).toBe(5);
    expect(result.timing.get('d')!.earliestFinish).toBe(7);
  });

  it('gives the short branch exactly the float the long one costs it', () => {
    expect(result.timing.get('c')!.slack).toBe(3);
    expect(result.timing.get('c')!.latestStart).toBe(4);
    expect(result.timing.get('c')!.latestFinish).toBe(5);
    expect(result.timing.get('c')!.critical).toBe(false);
  });

  it('marks only what decides the end', () => {
    expect([...result.critical].sort()).toEqual(['a', 'b', 'd']);
    expect(result.timing.get('a')!.slack).toBe(0);
    expect(result.timing.get('b')!.slack).toBe(0);
  });

  it('reports the path as a chain in order, not a bag of ids', () => {
    expect(result.longestChain).toEqual(['a', 'b', 'd']);
  });
});

describe('lag: waiting, in working days', () => {
  it('delays the blocked activity after the blocker finishes', () => {
    // a (3 d), then 2 days of curing, then b (1 d): b starts at offset 5.
    const result = plan([task('a', 3), task('b', 1)], [edge('a', 'b', 2)]);
    expect(result.timing.get('b')!.earliestStart).toBe(5);
    expect(result.durationDays).toBe(6);
  });

  it('is taken off the latest finish on the way back', () => {
    // a → b with 2 days of lag; c → b with none. a's latest finish is b's latest start less 2.
    const result = plan(
      [task('a', 1), task('b', 1), task('c', 1)],
      [edge('a', 'b', 2), edge('c', 'b')],
    );
    const b = result.timing.get('b')!;
    expect(b.earliestStart).toBe(3);
    expect(result.timing.get('a')!.latestFinish).toBe(b.latestStart - 2);
    expect(result.timing.get('a')!.slack).toBe(0);
    // c could finish as late as b's start: two days of float.
    expect(result.timing.get('c')!.slack).toBe(2);
    expect([...result.critical].sort()).toEqual(['a', 'b']);
  });

  it('makes the lagged route the critical one when the lag is what makes it longest', () => {
    const result = plan(
      [task('a', 1), task('b', 3), task('c', 1)],
      [edge('a', 'c', 5), edge('b', 'c')],
    );
    expect(result.durationDays).toBe(7);
    expect(result.longestChain).toEqual(['a', 'c']);
    expect(result.timing.get('b')!.slack).toBe(3);
  });

  it('still schedules when it is longer than all the work in the plan', () => {
    // Waiting is not work: a lag of 100 days after a single day is a 101-day wait, and then b.
    const result = plan([task('a', 1), task('b', 1)], [edge('a', 'b', 100)]);
    expect(result.timing.get('b')!.earliestStart).toBe(101);
    expect(result.durationDays).toBe(102);
    expect(result.longestChain).toEqual(['a', 'b']);
  });

  it('only walks a critical chain along links that are tight', () => {
    //   a (1) ── c (6)                 a, c, z, b and e are all critical (7 days each way),
    //    └──────────┐                  and a → b is a real link, but b starts on day 5, long
    //   z (5) ───── b (1) ── e (1)     after a finishes: a chain through a → b is not a path
    //                                  that decides anything. The one that does is z → b → e.
    const result = plan(
      [task('a', 1), task('c', 6), task('z', 5), task('b', 1), task('e', 1)],
      [edge('a', 'c'), edge('a', 'b'), edge('z', 'b'), edge('b', 'e')],
    );
    expect(result.durationDays).toBe(7);
    expect([...result.critical].sort()).toEqual(['a', 'b', 'c', 'e', 'z']);
    expect(result.longestChain).toEqual(['z', 'b', 'e']);
  });
});

describe('what the number is worth', () => {
  it('says when nothing has a duration, rather than calling everything critical', () => {
    // Every duration is zero, so every activity has zero float. A naive reading marks the whole
    // work critical and means nothing by it.
    const result = plan([task('a', null), task('b', null)], [edge('a', 'b')]);
    expect(result.unplanned).toBe(true);
    expect(result.durationDays).toBe(0);
    expect(result.longestChain).toEqual([]);
    expect(result.noDurationOnPath).toEqual([]);
    expect(result.withDuration).toBe(0);
  });

  it('names the holes when some of the path has no duration, and passes the chain through them', () => {
    // a and c have a duration; b does not, and is on the path. c still waits for a.
    const result = plan(
      [task('a', 2), task('b', null), task('c', 1)],
      [edge('a', 'b', 1), edge('b', 'c')],
    );
    expect(result.durationDays).toBe(4);
    expect(result.timing.get('c')!.earliestStart).toBe(3);
    expect(result.withDuration).toBe(2);
    expect(result.noDurationOnPath).toEqual(['b']);
  });

  it.each([[0], [-2], [1.5]])('counts a duration of %o as none', (days) => {
    const result = plan([task('a', days)], []);
    expect(result.timing.get('a')!.durationDays).toBe(0);
    expect(result.withDuration).toBe(0);
  });

  it('does not count a milestone as a hole: it is meant to take no time', () => {
    const result = plan(
      [task('a', 1), task('gate', null, true), task('c', 1)],
      [edge('a', 'gate'), edge('gate', 'c')],
    );
    expect(result.durationDays).toBe(2);
    expect(result.timing.get('gate')!.durationDays).toBe(0);
    expect(result.noDurationOnPath).toEqual([]);
  });

  it('a milestone with a duration is still zero: the flag wins', () => {
    const result = plan([task('gate', 9, true)], []);
    expect(result.timing.get('gate')!.durationDays).toBe(0);
    expect(result.durationDays).toBe(0);
  });
});

describe('shapes that are not a diamond', () => {
  it('a straight chain is entirely critical', () => {
    const result = plan(
      [task('a', 1), task('b', 1), task('c', 1)],
      [edge('a', 'b'), edge('b', 'c')],
    );
    expect(result.durationDays).toBe(3);
    expect(result.longestChain).toEqual(['a', 'b', 'c']);
    expect(result.critical.size).toBe(3);
  });

  it('unconnected work runs in parallel from day 0, and only the longest is critical', () => {
    const result = plan([task('long', 4), task('short', 1)], []);
    expect(result.durationDays).toBe(4);
    expect(result.timing.get('short')!.earliestStart).toBe(0);
    expect([...result.critical]).toEqual(['long']);
    expect(result.timing.get('short')!.slack).toBe(3);
  });

  it('two independent chains of the same length are both critical', () => {
    const result = plan(
      [task('a', 1), task('b', 1), task('x', 1), task('y', 1)],
      [edge('a', 'b'), edge('x', 'y')],
    );
    expect(result.durationDays).toBe(2);
    expect([...result.critical].sort()).toEqual(['a', 'b', 'x', 'y']);
    // The chain returned is one real path, not the four ids run together.
    expect(result.longestChain).toEqual(['a', 'b']);
  });

  it('a single activity is its own critical path', () => {
    const result = plan([task('only', 3)], []);
    expect(result.durationDays).toBe(3);
    expect(result.longestChain).toEqual(['only']);
  });

  it('an empty plan is empty rather than an error', () => {
    const result = plan([], []);
    expect(result.durationDays).toBe(0);
    expect(result.timing.size).toBe(0);
    expect(result.unplanned).toBe(true);
  });
});

describe('edges that point elsewhere', () => {
  it('are ignored, so a part of the plan can be planned without the rest leaking in', () => {
    const result = plan(
      [task('a', 1), task('b', 1)],
      [edge('a', 'b'), edge('outside', 'a', 5), edge('b', 'outside')],
    );
    expect(result.durationDays).toBe(2);
    expect(result.timing.get('a')!.earliestStart).toBe(0);
    expect(result.timing.size).toBe(2);
  });
});

describe('a graph that should not exist', () => {
  it('is reported rather than trusted', () => {
    const looped = [edge('a', 'b'), edge('b', 'a')];
    expect(hasCycle(['a', 'b'], looped)).toBe(true);
    expect(hasCycle(['a', 'b'], [edge('a', 'b')])).toBe(false);
    expect(hasCycle(['a'], [edge('a', 'a')])).toBe(true);

    const result = plan([task('a', 1), task('b', 1)], looped);
    expect(result.cyclic).toBe(true);
    // It still returns something for everything, rather than hanging or dropping activities a
    // view would then fail to draw.
    expect(result.timing.size).toBe(2);
  });
});
