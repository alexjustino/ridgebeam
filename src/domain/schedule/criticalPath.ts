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
 * The graph a plan is computed over, indexed and ordered once: the part of `plan` that does not
 * depend on any duration. `plan` builds it on every call; the finish probability (`probability.ts`,
 * slice D1) builds it once and passes over it thousands of times with other durations, so both
 * walk the same edges in the same order and the simulation cannot disagree with the schedule about
 * what comes first.
 */
export interface Network {
  /** The ids given, in the order given: the order that breaks ties. */
  readonly ids: readonly string[];
  /** Both directions, over the edges whose two ends are among the ids; the rest are ignored. */
  readonly graph: Adjacency;
  /** A topological order of the ids; ids a cycle swallowed come last, in their given order. */
  readonly ordered: readonly string[];
  /** The edges given close a loop among the ids: no timing over them can be trusted. */
  readonly cyclic: boolean;
}

/** Index and order the graph over `ids`, ignoring edges that point outside them. */
export function network(ids: readonly string[], edges: readonly Edge[]): Network {
  const present = new Set(ids);
  const relevant = edges.filter(
    (edge) => present.has(edge.blockerId) && present.has(edge.blockedId),
  );
  const graph = adjacency(relevant);
  const { ordered, cyclic } = order(ids, graph);
  return { ids, graph, ordered, cyclic };
}

/** Where an activity lies, in working-day offsets: its first day, and the day just after its last. */
export interface Span {
  readonly start: number;
  readonly finish: number;
}

/**
 * The forward pass over a network: every activity, in topological order, given the earliest offset
 * its blockers allow (the largest `finish(blocker) + lagDays`, and 0 when nothing blocks it), and
 * placed by `place`. The plan places it there for its duration; the forecast (`forecast.ts`, slice
 * E3) places what the diary says happened where it happened. One pass, two readings, so the two
 * cannot disagree about what comes first.
 */
export function forwardPass(
  net: Network,
  place: (id: string, earliest: number) => Span,
): Map<string, Span> {
  const spans = new Map<string, Span>();
  for (const id of net.ordered) {
    let earliest = 0;
    for (const edge of edgesInto(net.graph, id)) {
      earliest = Math.max(earliest, (spans.get(edge.blockerId)?.finish ?? 0) + edge.lagDays);
    }
    spans.set(id, place(id, earliest));
  }
  return spans;
}

/** What the backward pass makes of a forward one. */
export interface Settled {
  readonly timing: Map<string, Timing>;
  readonly critical: Set<string>;
  readonly longestChain: string[];
}

/**
 * The backward pass over placed spans, and what follows from it: every activity's latest start and
 * finish, its slack, which activities are critical, and one longest chain through them. `end` is the
 * offset the last activities must finish by. Each activity keeps the span it was placed with: its
 * duration here is `finish − start`.
 */
export function settle(net: Network, spans: ReadonlyMap<string, Span>, end: number): Settled {
  const { graph, ordered } = net;
  const latestFinish = new Map<string, number>();
  const latestStart = new Map<string, number>();

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const id = ordered[index]!;
    const span = spans.get(id)!;
    let finish = end;
    for (const edge of edgesOut(graph, id)) {
      finish = Math.min(finish, (latestStart.get(edge.blockedId) ?? end) - edge.lagDays);
    }
    latestFinish.set(id, finish);
    latestStart.set(id, finish - (span.finish - span.start));
  }

  const timing = new Map<string, Timing>();
  const critical = new Set<string>();
  for (const id of net.ids) {
    const span = spans.get(id)!;
    const slack = latestStart.get(id)! - span.start;
    const isCritical = slack === 0;
    if (isCritical) critical.add(id);
    timing.set(id, {
      earliestStart: span.start,
      earliestFinish: span.finish,
      latestStart: latestStart.get(id)!,
      latestFinish: latestFinish.get(id)!,
      slack,
      critical: isCritical,
      durationDays: span.finish - span.start,
    });
  }
  return { timing, critical, longestChain: chainThrough(ordered, graph, critical, timing) };
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
  const net = network(
    activities.map((activity) => activity.id),
    edges,
  );

  const duration = new Map(activities.map((activity) => [activity.id, durationOf(activity)]));

  // ── Forward ──────────────────────────────────────────────────────────────
  const spans = forwardPass(net, (id, earliest) => ({
    start: earliest,
    finish: earliest + duration.get(id)!,
  }));

  let durationDays = 0;
  for (const span of spans.values()) durationDays = Math.max(durationDays, span.finish);

  // ── Backward ─────────────────────────────────────────────────────────────
  const { timing, critical, longestChain } = settle(net, spans, durationDays);

  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const withDuration = activities.filter(
    (activity) => !activity.isMilestone && knownDuration(activity) !== null,
  ).length;
  const unplanned = durationDays === 0;

  return {
    timing,
    durationDays,
    critical,
    longestChain: unplanned ? [] : longestChain,
    withDuration,
    noDurationOnPath: unplanned
      ? []
      : [...critical].filter((id) => {
          const activity = byId.get(id)!;
          return !activity.isMilestone && knownDuration(activity) === null;
        }),
    unplanned,
    cyclic: net.cyclic,
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
