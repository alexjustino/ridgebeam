/**
 * The schedule of a work: every activity on the working calendar, the finish date and the
 * critical path, from the plan's rows and dependencies.
 *
 * `schedule(snapshot)` expands the dependencies (`expand.ts`), plans them in working-day offsets
 * (`criticalPath.ts`, Tessera's engine extended) and maps the offsets to dates on the work's
 * calendar (`toDates`). Day 0 is the first working day on or after the work's start date. An
 * activity with no dependency starts on day 0: parallel work is the honest reading of "nothing
 * constrains it", and readiness says the activity is not linked.
 *
 * Nothing is dropped. An activity the schedule cannot put on the calendar is listed in `unplaced`
 * with its reason; a dependency that does nothing is listed in `inert`. A plan whose stored
 * dependencies hold a cycle (the host refuses one, so only a corrupted file can) is `cyclic`: its
 * dates are not to be trusted, so none are given, and the screen says so instead of drawing.
 *
 * This replaced slice F0's sequential placement. What this module is not: the Gantt's geometry
 * (`gantt.ts`) or the slip against a baseline (`slip.ts`), and it performs no I/O.
 */

import { isIsoDay, nextWorkingDay, workingDaysFrom, type WorkingCalendar } from '../calendar';
import {
  activitiesInOrder,
  hasDuration,
  workingCalendarOf,
  type Activity,
  type BaselineRow,
  type WorkSnapshot,
} from '../plan';
import { plan, type Plan } from './criticalPath';
import { expandDependencies, type InertReason } from './expand';
import type { Edge } from './graph';

export { cycleIfAdded, endpointActivities, expandDependencies } from './expand';
export type { Expansion, InertDependency, InertReason } from './expand';
export { cycleFrom, cycleThrough, describeCycle, type Edge } from './graph';
export type { Plan, Timing } from './criticalPath';

/** Why an activity has no place on the calendar. */
export type UnplacedReason =
  /** It has no duration, or one that is not a whole number of working days above zero. */
  | 'no-duration'
  /** Its stage is not in the plan. */
  | 'no-stage'
  /** The work's calendar cannot be counted on (no working day, bad hours, bad holiday). */
  | 'invalid-calendar'
  /** The work's start date is not a real `YYYY-MM-DD` day. */
  | 'invalid-start'
  /** The dependencies hold a cycle, so no date can be trusted. */
  | 'cyclic';

export interface Unplaced {
  readonly activityId: string;
  readonly reason: UnplacedReason;
}

/** An activity's first and last working day. */
export interface ScheduledDates {
  readonly start: string;
  readonly finish: string;
}

export interface Schedule {
  /** The plan in working-day offsets from day 0. */
  readonly plan: Plan;
  /** The work's calendar, or `null` when it cannot be counted on. */
  readonly calendar: WorkingCalendar | null;
  /** The first working day on or after the start date, or `null` when there is none to count. */
  readonly day0: string | null;
  /** Every activity of the plan, in plan (breakdown) order. */
  readonly activities: readonly Activity[];
  /** The dependencies as activity edges, stage endpoints expanded. */
  readonly edges: readonly Edge[];
  /** Start and finish of every placed activity. */
  readonly dates: ReadonlyMap<string, ScheduledDates>;
  /** The last finish of any placed activity, or `null` when nothing is placed. */
  readonly finishDate: string | null;
  /** Placed activities with no float: the ones that decide the finish date. */
  readonly critical: ReadonlySet<string>;
  /** One chain through the critical activities, in order. */
  readonly longestChain: readonly string[];
  /** Activities with no place on the calendar, in plan order, each with its reason. */
  readonly unplaced: readonly Unplaced[];
  /** Ids of the dependencies that produce no edge. */
  readonly inert: readonly string[];
  /** Why each inert dependency is inert. */
  readonly inertReasons: ReadonlyMap<string, InertReason>;
  /** The dependencies hold a cycle: nothing is placed, and the screen must say so. */
  readonly cyclic: boolean;
}

/**
 * Map a plan's offsets to dates on a calendar: offset `k` is the `k`-th working day from the first
 * working day on or after `startDate` (the same day as `addWorkingDays(calendar, startDate, k)`).
 * Activities that take no days get no dates. The calendar is walked once, as far as the plan goes.
 */
export function toDates(
  planned: Plan,
  calendar: WorkingCalendar,
  startDate: string,
): Map<string, ScheduledDates> {
  let span = 0;
  for (const timing of planned.timing.values()) {
    if (timing.durationDays > 0) span = Math.max(span, timing.earliestFinish);
  }
  const days = workingDaysFrom(calendar, startDate, span);
  const dates = new Map<string, ScheduledDates>();
  for (const [id, timing] of planned.timing) {
    if (timing.durationDays <= 0) continue;
    dates.set(id, {
      start: days[timing.earliestStart]!,
      finish: days[timing.earliestFinish - 1]!,
    });
  }
  return dates;
}

/** Schedule the plan: expand, plan in working days, and put it on the work's calendar. */
export function schedule(snapshot: WorkSnapshot): Schedule {
  const activities = activitiesInOrder(snapshot);
  const stageIds = new Set(snapshot.stages.map((stage) => stage.id));
  const plannable = activities.filter((activity) => stageIds.has(activity.stageId));

  const { edges, inert } = expandDependencies(snapshot);
  const planned = plan(
    plannable.map((activity) => ({
      id: activity.id,
      durationDays: activity.durationDays,
      isMilestone: false,
    })),
    edges,
  );

  const calendar = workingCalendarOf(snapshot);
  const startValid = isIsoDay(snapshot.work.startDate);
  const blocked: UnplacedReason | null =
    calendar === null
      ? 'invalid-calendar'
      : !startValid
        ? 'invalid-start'
        : planned.cyclic
          ? 'cyclic'
          : null;

  const dates =
    blocked === null
      ? toDates(planned, calendar!, snapshot.work.startDate)
      : new Map<string, ScheduledDates>();

  const unplaced: Unplaced[] = [];
  for (const activity of activities) {
    if (!stageIds.has(activity.stageId)) {
      unplaced.push({ activityId: activity.id, reason: 'no-stage' });
    } else if (blocked !== null) {
      unplaced.push({ activityId: activity.id, reason: blocked });
    } else if (!hasDuration(activity)) {
      unplaced.push({ activityId: activity.id, reason: 'no-duration' });
    }
  }

  let finishDate: string | null = null;
  for (const { finish } of dates.values()) {
    if (finishDate === null || finish > finishDate) finishDate = finish;
  }

  return {
    plan: planned,
    calendar,
    day0:
      calendar !== null && startValid ? nextWorkingDay(calendar, snapshot.work.startDate) : null,
    activities,
    edges,
    dates,
    finishDate,
    critical: new Set([...planned.critical].filter((id) => dates.has(id))),
    longestChain: planned.longestChain.filter((id) => dates.has(id)),
    unplaced,
    inert: inert.map((row) => row.dependencyId),
    inertReasons: new Map(inert.map((row) => [row.dependencyId, row.reason])),
    cyclic: planned.cyclic,
  };
}

/**
 * The rows of a new baseline: every activity of the plan exactly once, in plan order, as the
 * schedule places it now, with the finish date. What the interface sends to `baseline_take`.
 */
export function baselineDraft(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
): { rows: BaselineRow[]; finishDate: string | null } {
  const stageNames = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  return {
    rows: scheduled.activities.map((activity) => {
      const dates = scheduled.dates.get(activity.id);
      return {
        activityId: activity.id,
        name: activity.name,
        stageName: stageNames.get(activity.stageId) ?? '',
        durationDays: activity.durationDays,
        start: dates?.start ?? null,
        finish: dates?.finish ?? null,
      };
    }),
    finishDate: scheduled.finishDate,
  };
}
