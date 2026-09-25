// Copied from Tessera (github.com/alexjustino/tessera) src/domain/criticalPath.ts at commit
// bdbfc4a, under the Apache License 2.0, same author, and extended for Ridgebeam: the unit is the
// working day (integer offsets from day 0), edges carry a lag, the passes read adjacency maps built
// once, and the minutes helpers are gone (ADR-015).

/**
 * The critical path: which work decides when the work finishes.
 *
 * The classical method, over the dependency graph, in **working days**. Day 0 is the first working
 * day on or after the work's start date; an activity of `d` days starting at offset `s` occupies
 * offsets `s` to `s + d − 1` and finishes, exclusively, at `s + d`. Two passes:
 *
 * 1. **Forward.** An activity can start when everything blocking it has finished and its lag has
 *    passed, so `earliestStart` is the largest `earliestFinish(blocker) + lagDays` among its
 *    blockers, and 0 when nothing blocks it: parallel work is the honest reading of "nothing
 *    constrains it".
 * 2. **Backward.** An activity must finish before anything it blocks may start, less the lag, so
 *    `latestFinish` is the smallest `latestStart(successor) − lagDays` among its successors, and
 *    the last activities must finish by the end of the work.
 *
 * **Slack** (the glossary's *float*) is the difference: how many working days an activity could
 * slip without moving the finish. Zero means it decides the finish, which is what "critical"
 * means. Not "important": a critical activity can be trivial. The word is about the arithmetic.
 *
 * ## Where duration comes from, and what it costs to be honest
 *
 * From `durationDays`. An activity without one contributes no days but still passes its blockers'
 * finish on to what it blocks, so a missing duration never breaks a chain in two. That is a real
 * hole in the answer, so `plan` reports it: `withDuration` and `noDurationOnPath` are what let a
 * screen say "the path has an activity with no duration" instead of showing a confident date.
 *
 * Milestones exist in the shape (`isMilestone`) and are not used in 1.0.
 */

import { adjacency, edgesInto, edgesOut, order, type Adjacency, type Edge } from './graph';

/** What the plan needs to know about one activity. */
export interface Planned {
  id: string;
  /** Working days. Null, zero, negative or fractional when nobody has said: it counts as none. */
  durationDays: number | null;
  /** A marker rather than work: zero duration, always. Unused in 1.0. */
  isMilestone: boolean;
}

export interface Timing {
  /** Offset of the first working day, from day 0. */
  earliestStart: number;
  /** Offset just after the last working day: `earliestStart + durationDays`. */
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  /** Working days this activity could slip without moving the finish. */
  slack: number;
  /** Zero slack: this activity decides when the work finishes. */
  critical: boolean;
  durationDays: number;
}

export interface Plan {
  /** Timing per activity id. Every activity given is present. */
  timing: Map<string, Timing>;
  /** How long the whole thing takes, in working days, lags included. */
  durationDays: number;
  /** Every activity with zero slack. */
  critical: Set<string>;
  /**
   * One longest chain through the critical activities, in order: the path the Gantt draws and a
   * person reads. Others of equal length may exist.
   */
  longestChain: string[];
  /** How many activities carried a duration. */
  withDuration: number;
  /** Critical activities with no duration: the holes in the number above. */
  noDurationOnPath: string[];
  /**
   * True when nothing takes any time at all. The timings are then all zero and "critical" means
   * nothing; a screen must say so rather than show them.
   */
  unplanned: boolean;
  /**
   * Set when the edges given hold a cycle, which the host refuses but a corrupted file could
   * carry. The timings are then not to be trusted.
   */
  cyclic: boolean;
}

/** A whole number of working days above zero, or nothing. */
function knownDuration(activity: Planned): number | null {
  const days = activity.durationDays;
  return days !== null && Number.isInteger(days) && days > 0 ? days : null;
}

/** A milestone marks a moment; work takes time; an unknown duration takes none. */
function durationOf(activity: Planned): number {
  if (activity.isMilestone) return 0;
  return knownDuration(activity) ?? 0;
}

/**
 * Compute the plan.
 *
 * Activities arrive in whatever order (that order breaks ties); the passes run over a topological
 * one, so an activity is always reached after everything blocking it. Edges pointing outside the
 * given set are ignored. The adjacency is built once and every pass reads it: nothing here scans
 * the edge list per activity.
 */
export function plan(activities: readonly Planned[], edges: readonly Edge[]): Plan {
  const ids = activities.map((activity) => activity.id);
  const present = new Set(ids);
  const relevant = edges.filter(
    (edge) => present.has(edge.blockerId) && present.has(edge.blockedId),
  );
  const graph = adjacency(relevant);
  const { ordered, cyclic } = order(ids, graph);

  const duration = new Map(activities.map((activity) => [activity.id, durationOf(activity)]));
  const earliestStart = new Map<string, number>();
  const earliestFinish = new Map<string, number>();

  // ── Forward ──────────────────────────────────────────────────────────────
  for (const id of ordered) {
    let start = 0;
    for (const edge of edgesInto(graph, id)) {
      start = Math.max(start, (earliestFinish.get(edge.blockerId) ?? 0) + edge.lagDays);
    }
    earliestStart.set(id, start);
    earliestFinish.set(id, start + duration.get(id)!);
  }

  let durationDays = 0;
  for (const finish of earliestFinish.values()) durationDays = Math.max(durationDays, finish);

  // ── Backward ─────────────────────────────────────────────────────────────
  const latestFinish = new Map<string, number>();
  const latestStart = new Map<string, number>();

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const id = ordered[index]!;
    let finish = durationDays;
    for (const edge of edgesOut(graph, id)) {
      finish = Math.min(finish, (latestStart.get(edge.blockedId) ?? durationDays) - edge.lagDays);
    }
    latestFinish.set(id, finish);
    latestStart.set(id, finish - duration.get(id)!);
  }

  const timing = new Map<string, Timing>();
  const critical = new Set<string>();
  for (const id of ids) {
    const slack = latestStart.get(id)! - earliestStart.get(id)!;
    const isCritical = slack === 0;
    if (isCritical) critical.add(id);
    timing.set(id, {
      earliestStart: earliestStart.get(id)!,
      earliestFinish: earliestFinish.get(id)!,
      latestStart: latestStart.get(id)!,
      latestFinish: latestFinish.get(id)!,
      slack,
      critical: isCritical,
      durationDays: duration.get(id)!,
    });
  }

  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const withDuration = activities.filter(
    (activity) => !activity.isMilestone && knownDuration(activity) !== null,
  ).length;
  const unplanned = durationDays === 0;

  return {
    timing,
    durationDays,
    critical,
    longestChain: unplanned ? [] : chainThrough(ordered, graph, critical, timing),
    withDuration,
    noDurationOnPath: unplanned
      ? []
      : [...critical].filter((id) => {
          const activity = byId.get(id)!;
          return !activity.isMilestone && knownDuration(activity) === null;
        }),
    unplanned,
    cyclic,
  };
}

/** Whether the edges given close a loop among the ids given. */
export function hasCycle(ids: readonly string[], edges: readonly Edge[]): boolean {
  return order(ids, adjacency(edges)).cyclic;
}

/**
 * One chain through the critical activities, longest first.
 *
 * Zero-slack activities can form several parallel chains: two independent runs of work of the
 * same length both decide the finish. Walking from every critical activity with no critical
 * blocker and keeping the longest result gives one real path rather than a set that looks like a
 * path and is not. A step is only taken along an edge that is itself tight (the successor starts
 * exactly when this one finishes plus the lag), so the chain is one that really decides the end.
 */
function chainThrough(
  ordered: readonly string[],
  graph: Adjacency,
  critical: ReadonlySet<string>,
  timing: ReadonlyMap<string, Timing>,
): string[] {
  const criticalOrdered = ordered.filter((id) => critical.has(id));
  const longestFrom = new Map<string, string[]>();

  // In reverse topological order, the longest chain from an activity is itself plus the longest
  // chain from its best critical successor.
  for (let index = criticalOrdered.length - 1; index >= 0; index -= 1) {
    const id = criticalOrdered[index]!;
    const finish = timing.get(id)!.earliestFinish;
    let best: string[] = [];
    for (const edge of edgesOut(graph, id)) {
      if (!critical.has(edge.blockedId)) continue;
      if (timing.get(edge.blockedId)!.earliestStart !== finish + edge.lagDays) continue;
      const chain = longestFrom.get(edge.blockedId) ?? [];
      if (chain.length > best.length) best = chain;
    }
    longestFrom.set(id, [id, ...best]);
  }

  let longest: string[] = [];
  for (const id of criticalOrdered) {
    const chain = longestFrom.get(id)!;
    if (chain.length > longest.length) longest = chain;
  }
  return longest;
}
