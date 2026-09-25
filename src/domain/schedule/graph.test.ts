// Copied from Tessera (github.com/alexjustino/tessera) src/domain/graph.test.ts at commit bdbfc4a,
// under the Apache License 2.0, same author, and extended for Ridgebeam: edges carry a lag, the
// loop is named the way the host names it, and the adjacency and ordering are tested directly.

import { describe, expect, it } from 'vitest';

import {
  adjacency,
  blockedBy,
  blockersOf,
  cycleFrom,
  cycleThrough,
  describeCycle,
  edgesInto,
  edgesOut,
  order,
  isBlocked,
  reachableFrom,
  readyToStart,
  topologicalOrder,
  wouldCycle,
  type Edge,
} from './graph';

const edge = (blockerId: string, blockedId: string, lagDays = 0): Edge => ({
  blockerId,
  blockedId,
  lagDays,
});

/** design → build → test → ship, a straight chain. */
const chain = [edge('design', 'build'), edge('build', 'test'), edge('test', 'ship')];

describe('reading the graph', () => {
  it('says what blocks a task and what waits on it', () => {
    expect(blockersOf(chain, 'test')).toEqual(['build']);
    expect(blockedBy(chain, 'build')).toEqual(['test']);
    expect(blockersOf(chain, 'design')).toEqual([]);
    expect(blockedBy(chain, 'ship')).toEqual([]);
  });

  it('follows the arrows to the end', () => {
    expect([...reachableFrom(chain, 'design')].sort()).toEqual(['build', 'ship', 'test']);
    expect([...reachableFrom(chain, 'test')]).toEqual(['ship']);
    expect([...reachableFrom(chain, 'ship')]).toEqual([]);
    expect([...reachableFrom(chain, 'nobody')]).toEqual([]);
  });

  it('visits a diamond once', () => {
    const diamond = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
    expect([...reachableFrom(diamond, 'a')].sort()).toEqual(['b', 'c', 'd']);
  });

  it('terminates on a graph that already holds a cycle', () => {
    // Storage refuses these; a corrupted file could still carry one, and a
    // screen that hangs is worse than a screen that draws something odd.
    const looped = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];
    expect([...reachableFrom(looped, 'a')].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('refusing a cycle', () => {
  it('names the chain the new edge would close, starting where the new link leaves', () => {
    // ship → design would mean design waits on ship, which waits on design. The loop reads the
    // way the host says it: across the new link first, then back round.
    expect(cycleFrom(chain, 'ship', 'design')).toEqual(['ship', 'design', 'build', 'test', 'ship']);
    expect(wouldCycle(chain, 'ship', 'design')).toBe(true);
  });

  it('refuses a task blocking itself', () => {
    expect(cycleFrom(chain, 'build', 'build')).toEqual(['build', 'build']);
    expect(wouldCycle([], 'alone', 'alone')).toBe(true);
  });

  it('allows an edge that only shortens an existing route', () => {
    // design already reaches ship through build and test; saying so directly
    // is redundant, not circular.
    expect(cycleFrom(chain, 'design', 'ship')).toBeNull();
    expect(wouldCycle(chain, 'design', 'ship')).toBe(false);
  });

  it('allows an edge into a branch that never comes back', () => {
    expect(wouldCycle(chain, 'ship', 'party')).toBe(false);
    expect(wouldCycle(chain, 'unrelated', 'build')).toBe(false);
  });

  it('finds the shortest chain when there are two ways round', () => {
    const two = [edge('a', 'b'), edge('b', 'z'), edge('a', 'z')];
    // a already reaches z twice over, so saying it again is redundant, not
    // circular. It is the reverse that closes the loop, and the message takes
    // the short way round rather than through b.
    expect(cycleFrom(two, 'a', 'z')).toBeNull();
    expect(cycleFrom(two, 'z', 'a')).toEqual(['z', 'a', 'z']);
  });

  it('reads as a sentence a person can act on', () => {
    const titles: Record<string, string> = {
      design: 'Ship it',
      build: 'Test it',
      test: 'Fix it',
    };
    expect(describeCycle(['design', 'build', 'test', 'design'], (id) => titles[id] ?? '')).toBe(
      'Ship it → Test it → Fix it → Ship it',
    );
    // The domain holds no words: a gap is a mark, and the interface always passes names.
    expect(describeCycle(['ghost'], () => '')).toBe('?');
  });
});

describe('what is waiting and what can start', () => {
  const none = () => false;

  it('a task is blocked while any blocker is unfinished', () => {
    expect(isBlocked(chain, 'build', none)).toBe(true);
    expect(isBlocked(chain, 'design', none)).toBe(false);
    expect(isBlocked(chain, 'build', (id) => id === 'design')).toBe(false);
  });

  it('what can be started is what nothing unfinished is holding', () => {
    const ids = ['design', 'build', 'test', 'ship'];
    expect(readyToStart(ids, chain, none)).toEqual(['design']);
    expect(readyToStart(ids, chain, (id) => id === 'design')).toEqual(['build']);
    expect(readyToStart(ids, chain, (id) => id !== 'ship')).toEqual(['ship']);
    expect(readyToStart(ids, chain, () => true)).toEqual([]);
  });

  it('a task with no dependencies at all is always ready', () => {
    expect(readyToStart(['alone'], [], none)).toEqual(['alone']);
  });
});

describe('ordering', () => {
  it('puts every task after everything blocking it', () => {
    expect(topologicalOrder(['ship', 'test', 'build', 'design'], chain)).toEqual([
      'design',
      'build',
      'test',
      'ship',
    ]);
  });

  it('keeps the original order between tasks that do not block each other', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(topologicalOrder(ids, [])).toEqual(ids);
    // Only c → a is stated; b and d keep their places relative to the rest.
    expect(topologicalOrder(ids, [edge('c', 'a')])).toEqual(['b', 'c', 'a', 'd']);
  });

  it('ignores edges that point outside the list it was given', () => {
    expect(topologicalOrder(['build', 'test'], chain)).toEqual(['build', 'test']);
  });

  it('still returns everything when a cycle is present', () => {
    const looped = [edge('a', 'b'), edge('b', 'a'), edge('c', 'd')];
    const ordered = topologicalOrder(['a', 'b', 'c', 'd'], looped);
    expect(ordered.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is stable: the same input gives the same order', () => {
    const ids = ['ship', 'test', 'build', 'design'];
    expect(topologicalOrder(ids, chain)).toEqual(topologicalOrder(ids, chain));
  });
});

describe('the host’s loop, over many links at once', () => {
  // Foundations → Walls → Plaster, as in the host's own test.
  const built = [edge('foundations', 'walls'), edge('walls', 'plaster')];
  const names: Record<string, string> = {
    foundations: 'Foundations',
    walls: 'Walls',
    plaster: 'Plaster',
  };

  it('reads exactly as the host’s refusal does', () => {
    const chain = cycleFrom(built, 'plaster', 'foundations')!;
    expect(describeCycle(chain, (id) => names[id] ?? '')).toBe(
      'Plaster → Foundations → Walls → Plaster',
    );
    expect(describeCycle(cycleFrom(built, 'walls', 'walls')!, (id) => names[id] ?? '')).toBe(
      'Walls → Walls',
    );
  });

  it('names an activity on both sides as waiting on itself, the first of the blocked side', () => {
    expect(cycleThrough(built, ['a', 'walls', 'b'], ['x', 'b', 'walls'])).toEqual(['b', 'b']);
  });

  it('searches from every blocked id at once and names the shortest loop', () => {
    // From x the way back to a blocker is long; from y it is one step.
    const edges = [edge('x', 'm'), edge('m', 'n'), edge('n', 'a'), edge('y', 'a')];
    expect(cycleThrough(edges, ['a'], ['x', 'y'])).toEqual(['a', 'y', 'a']);
  });

  it('is nothing when no blocked id reaches a blocker', () => {
    expect(cycleThrough(built, ['foundations'], ['plaster'])).toBeNull();
    expect(cycleThrough(built, [], ['plaster'])).toBeNull();
    expect(cycleThrough(built, ['plaster'], [])).toBeNull();
  });

  it('starts once from a blocked id listed twice', () => {
    expect(cycleThrough(built, ['plaster'], ['foundations', 'foundations'])).toEqual([
      'plaster',
      'foundations',
      'walls',
      'plaster',
    ]);
  });
});

describe('the adjacency, built once', () => {
  const edges = [edge('a', 'b', 2), edge('a', 'c'), edge('c', 'b')];
  const graph = adjacency(edges);

  it('reads the edges out of and into an id, lag included', () => {
    expect(edgesOut(graph, 'a')).toEqual([edge('a', 'b', 2), edge('a', 'c')]);
    expect(edgesInto(graph, 'b')).toEqual([edge('a', 'b', 2), edge('c', 'b')]);
  });

  it('is empty for an id with no edges, rather than undefined', () => {
    expect(edgesOut(graph, 'b')).toEqual([]);
    expect(edgesInto(graph, 'a')).toEqual([]);
    expect(edgesOut(graph, 'nobody')).toEqual([]);
  });
});

describe('ordering by position', () => {
  it('says whether a cycle kept anything out, and still returns every id', () => {
    const looped = adjacency([edge('b', 'c'), edge('c', 'b')]);
    expect(order(['a', 'b', 'c', 'd'], looped)).toEqual({
      ordered: ['a', 'd', 'b', 'c'],
      cyclic: true,
    });
    expect(order(['a', 'b'], adjacency([edge('a', 'b')]))).toEqual({
      ordered: ['a', 'b'],
      cyclic: false,
    });
  });

  it('keeps an id given twice once, at its first place', () => {
    expect(order(['a', 'b', 'a'], adjacency([]))).toEqual({ ordered: ['a', 'b'], cyclic: false });
  });

  it('breaks every tie by position, however the edges release the ids', () => {
    // Everything waits on `root`; once it is done, all twelve are ready at the same moment and
    // must leave in the order they were given, not the order the edges named them.
    const ids = ['root', ...Array.from({ length: 12 }, (_, i) => `n${String(i).padStart(2, '0')}`)];
    const edges = [...ids.slice(1)].reverse().map((id) => edge('root', id));
    expect(topologicalOrder(ids, edges)).toEqual(ids);
  });

  it('agrees with a plain stable Kahn over a generated graph', () => {
    // The heap must give exactly the order the copied algorithm gave: the smallest position
    // among the ready ids, every time.
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ids = Array.from({ length: 60 }, (_, i) => `t${i}`);
    const edges: Edge[] = [];
    for (let i = 0; i < 120; i += 1) {
      const from = Math.floor(next() * 60);
      const to = Math.floor(next() * 60);
      if (from < to) edges.push(edge(ids[to]!, ids[from]!));
    }
    expect(edges.length).toBeGreaterThan(30);
    const expected: string[] = [];
    const remaining = new Map(ids.map((id) => [id, 0]));
    for (const e of edges) remaining.set(e.blockedId, remaining.get(e.blockedId)! + 1);
    const done = new Set<string>();
    while (expected.length < ids.length) {
      const id = ids.find((candidate) => !done.has(candidate) && remaining.get(candidate) === 0)!;
      done.add(id);
      expected.push(id);
      for (const e of edges) {
        if (e.blockerId === id) remaining.set(e.blockedId, remaining.get(e.blockedId)! - 1);
      }
    }
    expect(expected).not.toEqual(ids);
    expect(topologicalOrder(ids, edges)).toEqual(expected);
  });
});
