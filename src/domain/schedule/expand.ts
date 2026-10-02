/**
 * Dependencies as the person states them, turned into the activity edges the engine plans.
 *
 * A dependency joins two endpoints, each an activity or a stage. A stage stands for all its
 * activities: `stage S → X` is an edge from every activity of S to X; `X → stage S` is an edge from
 * X to every activity of S; `stage → stage` is both. So "the tiling cannot start until the
 * plumbing stage is done" is said once and stays true as activities are added to either stage.
 *
 * A dependency that expands to nothing is **inert**, and it is reported, never dropped in silence:
 * an endpoint stage with no activities yet, an endpoint that is not in the plan, or a lag that is
 * not a whole number of working days from zero. The interface lists inert dependencies so the
 * person sees a link that is not doing anything.
 *
 * Two dependencies that expand to the same pair of activities become one edge with the longer lag,
 * which is what both of them together mean. A dependency whose expansion joins an activity to
 * itself (an activity linked to its own stage) is kept as a self-edge: that is a cycle, and the
 * engine must see it to report it.
 *
 * What this module is not: a judge of cycles (`graph.ts` is), and not storage.
 */

import { compareText, type Endpoint, type WorkSnapshot } from '../plan';
import { cycleThrough, type Edge } from './graph';

/** Why a dependency produces no edge. */
export type InertReason = 'empty-stage' | 'unknown-endpoint' | 'invalid-lag';

export interface InertDependency {
  readonly dependencyId: string;
  readonly reason: InertReason;
}

export interface Expansion {
  /** Activity edges, in the order of the dependencies that produced them. */
  readonly edges: readonly Edge[];
  /** Dependencies that produce no edge, and why, in the order they were given. */
  readonly inert: readonly InertDependency[];
}

/**
 * The activities an endpoint stands for, in plan order: the activity itself, or every activity of
 * the stage. `null` when the endpoint is not in the plan. An activity whose stage is not in the
 * plan is not in the plan either.
 */
export function endpointActivities(
  snapshot: WorkSnapshot,
  endpoint: Endpoint,
  index: PlanIndex = indexOf(snapshot),
): readonly string[] | null {
  if (endpoint.kind === 'activity') {
    return index.activityIds.has(endpoint.id) ? [endpoint.id] : null;
  }
  return index.byStage.get(endpoint.id) ?? null;
}

/** What expansion needs to look up, built once per snapshot. */
export interface PlanIndex {
  /** Activities whose stage is in the plan. */
  readonly activityIds: ReadonlySet<string>;
  /** Stage id → its activities' ids, in position order. Every stage of the plan is a key. */
  readonly byStage: ReadonlyMap<string, readonly string[]>;
}

export function indexOf(snapshot: WorkSnapshot): PlanIndex {
  const byStage = new Map<string, string[]>(snapshot.stages.map((stage) => [stage.id, []]));
  const activityIds = new Set<string>();
  const ordered = [...snapshot.activities].sort(
    (a, b) => a.position - b.position || compareText(a.id, b.id),
  );
  for (const activity of ordered) {
    const list = byStage.get(activity.stageId);
    if (list === undefined) continue;
    list.push(activity.id);
    activityIds.add(activity.id);
  }
  return { activityIds, byStage };
}

function validLag(lagDays: number): boolean {
  return Number.isInteger(lagDays) && lagDays >= 0;
}

/** Expand every dependency of the plan into activity edges, reporting the inert ones. */
export function expandDependencies(snapshot: WorkSnapshot): Expansion {
  const index = indexOf(snapshot);
  const edges: Edge[] = [];
  const byPair = new Map<string, Edge>();
  const inert: InertDependency[] = [];

  for (const dependency of snapshot.dependencies) {
    if (!validLag(dependency.lagDays)) {
      inert.push({ dependencyId: dependency.id, reason: 'invalid-lag' });
      continue;
    }
    const blockers = endpointActivities(snapshot, dependency.blocker, index);
    const blocked = endpointActivities(snapshot, dependency.blocked, index);
    if (blockers === null || blocked === null) {
      inert.push({ dependencyId: dependency.id, reason: 'unknown-endpoint' });
      continue;
    }
    if (blockers.length === 0 || blocked.length === 0) {
      inert.push({ dependencyId: dependency.id, reason: 'empty-stage' });
      continue;
    }
    for (const blockerId of blockers) {
      for (const blockedId of blocked) {
        const key = `${blockerId}\u0000${blockedId}`;
        const existing = byPair.get(key);
        if (existing !== undefined) {
          existing.lagDays = Math.max(existing.lagDays, dependency.lagDays);
          continue;
        }
        const edge: Edge = { blockerId, blockedId, lagDays: dependency.lagDays };
        byPair.set(key, edge);
        edges.push(edge);
      }
    }
  }
  return { edges, inert };
}

/**
 * The loop that adding `blocker → blocked` would close, as a chain of activity ids, or `null`.
 *
 * Checked over the expanded graph, so a stage endpoint is judged by the activities it stands for:
 * an activity made to wait on its own stage waits on itself (`Walls → Walls`). The chain has the
 * shape of the host's refusal (`cycleThrough`), so the interface can name it with `describeCycle`
 * before asking the host, and the host, refusing the same link as the second guard, says the same
 * thing. A dependency that would be inert closes no loop.
 */
export function cycleIfAdded(
  snapshot: WorkSnapshot,
  blocker: Endpoint,
  blocked: Endpoint,
): string[] | null {
  const index = indexOf(snapshot);
  const blockers = endpointActivities(snapshot, blocker, index) ?? [];
  const blockedIds = endpointActivities(snapshot, blocked, index) ?? [];
  if (blockers.length === 0 || blockedIds.length === 0) return null;
  return cycleThrough(expandDependencies(snapshot).edges, blockers, blockedIds);
}
