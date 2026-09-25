/**
 * The plan of a work, as the host hands it over, and where its activities fall on the calendar.
 *
 * The types mirror the host's contract (the `work_get` command, docs/DATA_MODEL.md) field for
 * field, in camelCase, so that the data layer passes a snapshot through unchanged.
 *
 * The placement here is **deliberately simple, and temporary**. Slice F0 has no dependencies:
 * stages are taken in position order, activities in position order inside each stage, and each
 * activity starts on the working day after the previous one finishes, the first on the work's
 * start date. That is enough to put one stage with one activity on a working calendar and to
 * give the work a finish date. It is not a schedule: slice F2 replaces it with the critical-path
 * engine (dependencies with lag, float, the critical path, baselines), and nothing should be
 * built on the sequential order it assumes.
 *
 * What this module is not: storage, and not a judge of readiness. It performs no I/O, and an
 * activity it cannot place is reported with the reason, not hidden.
 */

import { addWorkingDays, isIsoDay, readCalendar, type WorkingCalendar } from './calendar';

// ── The host's contract ──────────────────────────────────────────────────────

/** The work itself: one row. */
export interface Work {
  readonly workId: string;
  readonly name: string;
  readonly place: string;
  /** `YYYY-MM-DD`, the first day the schedule may use. */
  readonly startDate: string;
  /** ISO 4217, three letters. */
  readonly currency: string;
  /** UTC, milliseconds, trailing `Z`. */
  readonly createdAt: string;
}

/** The working calendar as stored: the mask text and the hours. */
export interface Calendar {
  /** Seven characters, Monday first, `1` working: `1111100`. */
  readonly workingDays: string;
  readonly hoursPerDay: number;
}

export interface Holiday {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly name: string;
}

/** A person is a row, not a user. */
export interface Person {
  readonly id: string;
  readonly name: string;
}

export interface Stage {
  readonly id: string;
  /** Order among stages. */
  readonly position: number;
  readonly name: string;
}

export interface Activity {
  readonly id: string;
  readonly stageId: string;
  /** Order inside the stage. */
  readonly position: number;
  readonly name: string;
  /** Working days; `null` until known. */
  readonly durationDays: number | null;
  /** The person who answers for it; `null` until known. */
  readonly responsibleId: string | null;
}

/** The whole plan of one work, as `work_get` returns it. */
export interface WorkSnapshot {
  readonly work: Work;
  readonly calendar: Calendar;
  readonly holidays: readonly Holiday[];
  readonly people: readonly Person[];
  readonly stages: readonly Stage[];
  readonly activities: readonly Activity[];
}

// ── Reading the plan ─────────────────────────────────────────────────────────

/**
 * Does this activity have a duration the schedule can use: a whole number of working days
 * above zero? Zero, a negative number and a fraction are not a duration. Readiness and
 * placement both ask this one question, so they can never disagree about it.
 */
export function hasDuration(activity: Activity): boolean {
  const days = activity.durationDays;
  return days !== null && Number.isInteger(days) && days > 0;
}

/** Stages in the order the plan shows them: by position, then by id when positions tie. */
export function stagesInOrder(snapshot: WorkSnapshot): Stage[] {
  return [...snapshot.stages].sort((a, b) => a.position - b.position || compareText(a.id, b.id));
}

/**
 * Every activity in the order the plan shows it: stage by stage, by position inside each, then
 * the activities whose stage is not in the plan, last, in their own position order.
 */
export function activitiesInOrder(snapshot: WorkSnapshot): Activity[] {
  const byPosition = (a: Activity, b: Activity) =>
    a.position - b.position || compareText(a.id, b.id);
  const stageIds = new Set(snapshot.stages.map((stage) => stage.id));
  const ordered = stagesInOrder(snapshot).flatMap((stage) =>
    snapshot.activities.filter((activity) => activity.stageId === stage.id).sort(byPosition),
  );
  const orphans = snapshot.activities
    .filter((activity) => !stageIds.has(activity.stageId))
    .sort(byPosition);
  return [...ordered, ...orphans];
}

/** The work's calendar with its holidays, checked, or `null` when it cannot be counted on. */
export function workingCalendarOf(snapshot: WorkSnapshot): WorkingCalendar | null {
  const result = readCalendar({
    workingDays: snapshot.calendar.workingDays,
    hoursPerDay: snapshot.calendar.hoursPerDay,
    holidays: snapshot.holidays.map((holiday) => holiday.date),
  });
  return result.ok ? result.calendar : null;
}

// ── The F0 placement ─────────────────────────────────────────────────────────

/** Why an activity has no place on the calendar. */
export type UnplacedReason =
  /** It has no duration, or one that is not a whole number of working days above zero. */
  | 'no-duration'
  /** Its stage is not in the plan. */
  | 'no-stage'
  /** The work's calendar cannot be counted on (no working day, bad hours, bad holiday). */
  | 'invalid-calendar'
  /** The work's start date is not a real `YYYY-MM-DD` day. */
  | 'invalid-start';

export type PlacedActivity =
  | { readonly activityId: string; readonly start: string; readonly finish: string }
  | { readonly activityId: string; readonly unplaced: UnplacedReason };

/** Every activity of the plan, in placement order, each placed or said not to be. */
export type Placement = readonly PlacedActivity[];

/**
 * Place every activity on the work's calendar, one after another (see the module header: this
 * is F0's sequential placement, replaced in F2).
 *
 * The first placed activity starts on the work's start date, moved to the next working day when
 * that is not one; each later one starts on the working day after the previous placed one
 * finishes. An activity with no duration is reported as unplaced and takes no days, so the ones
 * after it are still placed. Never throws: a calendar or start date that cannot be counted on
 * leaves every activity unplaced, with that reason.
 */
export function placeActivities(snapshot: WorkSnapshot): Placement {
  const ordered = activitiesInOrder(snapshot);
  const calendar = workingCalendarOf(snapshot);
  if (calendar === null) {
    return ordered.map((activity) => ({ activityId: activity.id, unplaced: 'invalid-calendar' }));
  }
  if (!isIsoDay(snapshot.work.startDate)) {
    return ordered.map((activity) => ({ activityId: activity.id, unplaced: 'invalid-start' }));
  }

  const stageIds = new Set(snapshot.stages.map((stage) => stage.id));
  let cursor = snapshot.work.startDate;
  let placedAny = false;
  const placement: PlacedActivity[] = [];

  for (const activity of ordered) {
    if (!stageIds.has(activity.stageId)) {
      placement.push({ activityId: activity.id, unplaced: 'no-stage' });
      continue;
    }
    if (!hasDuration(activity)) {
      placement.push({ activityId: activity.id, unplaced: 'no-duration' });
      continue;
    }
    // The first activity starts on the first working day on or after the start date; each
    // later one on the working day after the previous finish.
    const start = addWorkingDays(calendar, cursor, placedAny ? 1 : 0);
    const finish = addWorkingDays(calendar, start, activity.durationDays! - 1);
    placement.push({ activityId: activity.id, start, finish });
    cursor = finish;
    placedAny = true;
  }
  return placement;
}

/** Is this activity on the calendar? */
export function isPlaced(
  row: PlacedActivity,
): row is { readonly activityId: string; readonly start: string; readonly finish: string } {
  return 'start' in row;
}

/**
 * The finish date of the work: the latest finish of any placed activity, or `null` when nothing
 * is placed. Computed, never typed (glossary: "finish date").
 */
export function finishDate(placement: Placement): string | null {
  let latest: string | null = null;
  for (const row of placement) {
    if (isPlaced(row) && (latest === null || row.finish > latest)) latest = row.finish;
  }
  return latest;
}

/** Code-point order, the same on every machine whatever its locale. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
