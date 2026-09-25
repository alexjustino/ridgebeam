// Copied from Tessera (github.com/alexjustino/tessera) src/domain/graph.ts at commit bdbfc4a,
// under the Apache License 2.0, same author, and extended for Ridgebeam: an edge carries a lag in
// working days, adjacency is built once into maps, and the topological tie-break reads a position
// map instead of scanning the list (ADR-015).

/**
 * What must come first: the dependency graph over activities.
 *
 * One edge, one meaning: `blockerId` must be finished before `blockedId` can start, and then
 * `lagDays` more working days must pass (the concrete curing before the next activity). Finish-to-
 * start is the only kind in 1.0. The critical path is this graph's longest chain, and the Gantt
 * draws its arrows from it. So the graph is decided here, once, in a module that never touches a
 * database or a screen.
 *
 * The rule that shapes the rest: **the graph is acyclic, always**. A cycle is not a strange state
 * to render carefully: it is work that can never start, and the honest thing is to refuse the edge
 * that would close it and say which chain it closed.
 *
 * Stages are not here. A dependency onto a stage is expanded into activity edges first
 * (`expand.ts`); this module only knows activities.
 */

/** `blocker` must finish, and `lagDays` working days pass, before `blocked` may start. */
export interface Edge {
  blockerId: string;
  blockedId: string;
  /** Working days of waiting after the blocker finishes; zero or more. */
  lagDays: number;
}

/** Both directions of the graph, built once per question and then only read. */
export interface Adjacency {
  /** Blocker → its outgoing edges. */
  readonly successors: ReadonlyMap<string, readonly Edge[]>;
  /** Blocked → its incoming edges. */
  readonly predecessors: ReadonlyMap<string, readonly Edge[]>;
}

const NONE: readonly Edge[] = [];

/** Index the edges both ways, once. */
export function adjacency(edges: readonly Edge[]): Adjacency {
  const successors = new Map<string, Edge[]>();
  const predecessors = new Map<string, Edge[]>();
  for (const edge of edges) {
    const out = successors.get(edge.blockerId);
    if (out === undefined) successors.set(edge.blockerId, [edge]);
    else out.push(edge);
    const into = predecessors.get(edge.blockedId);
    if (into === undefined) predecessors.set(edge.blockedId, [edge]);
    else into.push(edge);
  }
  return { successors, predecessors };
}

/** The edges leaving an id, or none. */
export function edgesOut(graph: Adjacency, id: string): readonly Edge[] {
  return graph.successors.get(id) ?? NONE;
}

/** The edges arriving at an id, or none. */
export function edgesInto(graph: Adjacency, id: string): readonly Edge[] {
  return graph.predecessors.get(id) ?? NONE;
}

/** The activities that must finish before this one may start. A one-off question: it scans. */
export function blockersOf(edges: readonly Edge[], id: string): string[] {
  return edges.filter((edge) => edge.blockedId === id).map((edge) => edge.blockerId);
}

/** The activities waiting on this one. A one-off question: it scans. */
export function blockedBy(edges: readonly Edge[], id: string): string[] {
  return edges.filter((edge) => edge.blockerId === id).map((edge) => edge.blockedId);
}

/**
 * Everything reachable from `from` by following the arrows, `from` excluded.
 *
 * Breadth-first with a seen set, so a diamond (two paths to the same activity) is visited once
 * rather than twice, and a graph that already holds a cycle (which storage refuses, but a
 * corrupted file could carry) terminates instead of hanging the screen.
 */
export function reachableFrom(edges: readonly Edge[], from: string): Set<string> {
  const graph = adjacency(edges);
  const seen = new Set<string>();
  const queue = edgesOut(graph, from).map((edge) => edge.blockedId);

  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of edgesOut(graph, id)) {
      if (!seen.has(edge.blockedId)) queue.push(edge.blockedId);
    }
  }
  return seen;
}

/**
 * The loop that adding edges from every one of `blockerIds` to every one of `blockedIds` would
 * close, or null when it would close none.
 *
 * Returned as a path rather than a boolean because "that would make a loop" is not a useful thing
 * to tell somebody. The path is what lets the interface say *which* loop, and it has the shape the
 * host's refusal has, so the two sentences agree: it starts at the blocker the new link leaves,
 * crosses the new link, and follows the existing links back to where it started —
 * `Plaster → Foundations → Walls → Plaster`. An activity on both sides waits on itself:
 * `Walls → Walls`.
 *
 * The search is the host's: first an id on both sides (the first of `blockedIds` that is also a
 * blocker), then breadth-first from every blocked id at once, in order, to the first blocker
 * reached, so the shortest loop is the one named.
 */
export function cycleThrough(
  edges: readonly Edge[],
  blockerIds: readonly string[],
  blockedIds: readonly string[],
): string[] | null {
  const blockers = new Set(blockerIds);
  const both = blockedIds.find((id) => blockers.has(id));
  if (both !== undefined) return [both, both];

  const graph = adjacency(edges);
  const cameFrom = new Map<string, string | null>();
  const queue: string[] = [];
  for (const id of blockedIds) {
    if (cameFrom.has(id)) continue;
    cameFrom.set(id, null);
    queue.push(id);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head]!;
    if (blockers.has(at)) {
      // Walk back to the blocked id the search left from, then close the loop with the new link.
      const path: string[] = [];
      let step: string | null | undefined = at;
      while (typeof step === 'string') {
        path.unshift(step);
        step = cameFrom.get(step);
      }
      return [at, ...path];
    }
    for (const edge of edgesOut(graph, at)) {
      if (!cameFrom.has(edge.blockedId)) {
        cameFrom.set(edge.blockedId, at);
        queue.push(edge.blockedId);
      }
    }
  }
  return null;
}

/**
 * The loop that adding `blocker → blocked` would close, or null: `cycleThrough` for one edge.
 * An activity cannot block itself: `[id, id]`.
 */
export function cycleFrom(
  edges: readonly Edge[],
  blockerId: string,
  blockedId: string,
): string[] | null {
  return cycleThrough(edges, [blockerId], [blockedId]);
}

/** Whether adding this edge would close a cycle. */
export function wouldCycle(edges: readonly Edge[], blockerId: string, blockedId: string): boolean {
  return cycleFrom(edges, blockerId, blockedId) !== null;
}

/**
 * `Pour the slab → Cure → Pour the slab`, from a chain of ids and their names. An id with no name
 * is shown as `?`; the interface passes names, so this is only what a gap looks like.
 */
export function describeCycle(chain: readonly string[], nameOf: (id: string) => string): string {
  return chain.map((id) => nameOf(id) || '?').join(' → ');
}

/** Whether an activity is waiting on something that has not been finished. */
export function isBlocked(
  edges: readonly Edge[],
  id: string,
  isComplete: (id: string) => boolean,
): boolean {
  return blockersOf(edges, id).some((blocker) => !isComplete(blocker));
}

/**
 * The activities nothing is holding up: incomplete, and with every blocker finished.
 *
 * What "what can start" means once work has an order. Completion comes from the diary (slice F4);
 * until then nothing calls this with anything but "nothing is complete".
 */
export function readyToStart(
  ids: readonly string[],
  edges: readonly Edge[],
  isComplete: (id: string) => boolean,
): string[] {
  return ids.filter((id) => !isComplete(id) && !isBlocked(edges, id, isComplete));
}

/** The result of ordering: the order, and whether a cycle kept some ids out of it. */
export interface Ordering {
  readonly ordered: string[];
  readonly cyclic: boolean;
}

/**
 * Kahn's algorithm over an adjacency built once, with ties broken by position in `ids`.
 *
 * The ready set is a binary heap keyed by position, so the smallest position always leaves first
 * and a list sorted by position stays as close to that as the dependencies allow, without scanning
 * the list. Ids caught in a cycle come last, in their original order, rather than vanishing.
 */
export function order(ids: readonly string[], graph: Adjacency): Ordering {
  const position = new Map<string, number>();
  ids.forEach((id, index) => {
    if (!position.has(id)) position.set(id, index);
  });
  const present = (edge: Edge) => position.has(edge.blockerId) && position.has(edge.blockedId);

  const remaining = new Map<string, number>();
  for (const id of position.keys()) {
    remaining.set(id, edgesInto(graph, id).filter(present).length);
  }

  const heap: number[] = [];
  for (const [id, count] of remaining) if (count === 0) push(heap, position.get(id)!);

  const ordered: string[] = [];
  while (heap.length > 0) {
    const id = ids[pop(heap)]!;
    ordered.push(id);
    for (const edge of edgesOut(graph, id)) {
      if (!present(edge)) continue;
      const left = remaining.get(edge.blockedId)! - 1;
      remaining.set(edge.blockedId, left);
      if (left === 0) push(heap, position.get(edge.blockedId)!);
    }
  }

  const cyclic = ordered.length < position.size;
  if (!cyclic) return { ordered, cyclic };
  // Whatever a cycle swallowed, in the order it came.
  const placed = new Set(ordered);
  return {
    ordered: [...ordered, ...[...position.keys()].filter((id) => !placed.has(id))],
    cyclic,
  };
}

/**
 * Every activity in an order where each comes after everything blocking it.
 *
 * Ties are broken by the order the ids arrived, so the result is stable. Ids caught in a cycle
 * come last, in their original order, rather than vanishing: a view must draw what is there.
 */
export function topologicalOrder(ids: readonly string[], edges: readonly Edge[]): string[] {
  return order(ids, adjacency(edges)).ordered;
}

// ── A binary min-heap of positions ───────────────────────────────────────────

function push(heap: number[], value: number): void {
  heap.push(value);
  let at = heap.length - 1;
  while (at > 0) {
    const parent = (at - 1) >> 1;
    if (heap[parent]! <= value) break;
    heap[at] = heap[parent]!;
    at = parent;
  }
  heap[at] = value;
}

function pop(heap: number[]): number {
  const top = heap[0]!;
  const last = heap.pop()!;
  if (heap.length === 0) return top;
  let at = 0;
  for (;;) {
    const left = 2 * at + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && heap[right]! < heap[left]! ? right : left;
    if (heap[child]! >= last) break;
    heap[at] = heap[child]!;
    at = child;
  }
  heap[at] = last;
  return top;
}
