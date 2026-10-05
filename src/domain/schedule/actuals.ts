/**
 * Planned and actual: how long each activity took, from what the diary says, against what the plan
 * gave it (slice G3).
 *
 * The plan says how many working days an activity should take (`durationDays`), and a template may
 * have given it a range (`durationMinDays`…`durationMaxDays`). The diary says when it was first
 * worked on and when it was said finished (`progress`). This module puts the two side by side:
 *
 * - **took** (finished only): the working days from the first day the diary says it was worked on
 *   to the day it was said finished, **both included**, on the work's calendar. Elapsed, not effort:
 *   waiting days and lost days in between are counted, and an activity worked on in two stretches
 *   counts the gap between them. A finish on the start day is 1;
 * - **so far** (started, not finished): from the day it started to today, both included, today
 *   counted only when it is a working day;
 * - the **difference** (took − planned), whether it fell **inside the range** it was given, and
 *   whether a running one is **already longer** than planned (`overrunning`).
 *
 * Days the diary names off the calendar (a Saturday, a holiday) are not working days and are not
 * counted, but an activity the diary says was worked on took at least one day: work done only on a
 * Saturday took 1, never 0.
 *
 * The figures open onto their rows: finished, took longer than planned (the most days over first),
 * took less, and outside the range it was given; and the days over, the sum of the positive
 * differences, carried by the same rows as "took longer".
 *
 * What it assumes, and says it assumes: the diary is the only source of what happened, so an
 * activity never said finished has taken nothing yet, and one never said worked on has not started.
 * With no calendar to count on, no day is counted: every row says why (`problem`) and nothing is
 * invented. `today` is an input. What this module is not: the forecast (`forecast.ts`), the export
 * that learns from these numbers (`templates/export.ts`), storage, or text.
 */

import { isIsoDay, workingDaysBetween, type WorkingCalendar } from '../calendar';
import { progress, type DiaryEntry, type ProgressState } from '../diary';
import { counted, daysFigure, type DaysRow, type Figure, type ReportRow } from '../figure';
import {
  activitiesInOrder,
  durationRangeOf,
  hasDuration,
  workingCalendarOf,
  type WorkSnapshot,
} from '../plan';

/** Why a number of days could not be counted. */
export type ActualsProblem =
  /** The work's calendar cannot be counted on: no day is counted. */
  | 'no-calendar'
  /** `today` is not a `YYYY-MM-DD` day: what is running has no "so far". */
  | 'invalid-today'
  /** A day the diary gives for this activity is not a real `YYYY-MM-DD` day. */
  | 'invalid-day';

/** How the interface says each problem. */
export const ACTUALS_PROBLEM_KEYS = {
  'no-calendar': 'schedule.actuals.problem.noCalendar',
  'invalid-today': 'schedule.actuals.problem.invalidToday',
  'invalid-day': 'schedule.actuals.problem.invalidDay',
} as const satisfies Record<ActualsProblem, string>;

/** The card's and the figures' names, as message keys. */
export const ACTUALS_LABEL_KEYS = {
  /** "Planned and actual". */
  title: 'schedule.actuals.title',
  /** Activities the diary says finished. */
  finished: 'schedule.actuals.finished',
  /** Finished, and took longer than planned. */
  longer: 'schedule.actuals.longer',
  /** Finished, and took less than planned. */
  less: 'schedule.actuals.less',
  /** Finished, and outside the range it was given. */
  outside: 'schedule.actuals.outside',
  /** Working days over plan, added up over the ones that took longer. */
  daysOver: 'schedule.actuals.daysOver',
} as const;

/** Every message key this module adds, for the dictionaries' completeness test. */
export const ACTUALS_MESSAGE_KEYS: readonly string[] = [
  ...Object.values(ACTUALS_LABEL_KEYS),
  ...Object.values(ACTUALS_PROBLEM_KEYS),
];

/** One activity, planned against actual. A row of every figure here. */
export interface ActualRow extends ReportRow {
  readonly activityId: string;
  readonly stageId: string;
  /** The planned duration in working days, when it has one (`hasDuration`); `null` otherwise. */
  readonly planned: number | null;
  /** The range a template gave it (`durationRangeOf`); `null` when it has none. */
  readonly range: { readonly min: number; readonly max: number } | null;
  /** What the diary says of it. */
  readonly state: ProgressState;
  /** The first day the diary says it was worked on; `null` when not started. */
  readonly startedOn: string | null;
  /** The day the diary says it finished; `null` when not finished. */
  readonly finishedOn: string | null;
  /** Finished only: working days from `startedOn` to `finishedOn`, both included, at least 1. */
  readonly tookDays: number | null;
  /** Started, not finished: working days from `startedOn` to today, both included, at least 1. */
  readonly soFarDays: number | null;
  /** `tookDays − planned`, when both are known; `null` otherwise. */
  readonly differenceDays: number | null;
  /** Finished with a range: whether `range.min ≤ tookDays ≤ range.max`; `null` otherwise. */
  readonly inRange: boolean | null;
  /** Started, not finished, planned, and `soFarDays > planned`: it already took longer. */
  readonly overrunning: boolean;
  /** Why a number of days this row should have is missing; `null` when nothing is. */
  readonly problem: ActualsProblem | null;
}

/** A row of the days-over figure: a row that took longer, with its days over. */
export interface ActualDaysRow extends ActualRow, DaysRow {}

export interface Actuals {
  /** The first problem the whole work has (`no-calendar`, then `invalid-today`); `null` if none. */
  readonly problem: ActualsProblem | null;
  /** The day it was asked on. */
  readonly today: string;
  /** Every activity, in plan order, whatever its state. */
  readonly rows: readonly ActualRow[];
  /** The activities the diary says finished, in plan order. */
  readonly finished: Figure<ActualRow>;
  /** Finished and took longer than planned: the most days over first, then plan order. */
  readonly longer: Figure<ActualRow>;
  /** Finished and took less than planned: the most days under first, then plan order. */
  readonly less: Figure<ActualRow>;
  /** Finished and outside the range it was given, in plan order. */
  readonly outside: Figure<ActualRow>;
  /**
   * The working days over plan, added up: a `days` figure whose rows are `longer`'s, each with its
   * own days over (`days`) and the total as the figure's reference (`againstFinish`).
   */
  readonly daysOver: Figure<ActualDaysRow>;
}

/** Working days from `from` to `to`, both included, on the calendar; at least 1 (it was worked). */
function workedDays(calendar: WorkingCalendar, from: string, to: string): number {
  return Math.max(1, workingDaysBetween(calendar, from, to));
}

/**
 * Planned against actual for every activity of the work (plan order), as the diary says on
 * `today`, with the figures that open onto them. Only effective entries speak (`progress`). Never
 * throws.
 */
export function activityActuals(
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
  today: string,
): Actuals {
  const calendar = workingCalendarOf(snapshot);
  const todayValid = isIsoDay(today);
  const progressById = progress(snapshot, entries);

  const rows = activitiesInOrder(snapshot).map((activity): ActualRow => {
    const said = progressById.get(activity.id);
    const state: ProgressState = said?.state ?? 'not-started';
    const startedOn = said?.startedOn ?? null;
    const finishedOn = said?.finishedOn ?? null;
    const planned = hasDuration(activity) ? activity.durationDays : null;
    const range = durationRangeOf(activity);

    let problem: ActualsProblem | null = null;
    let tookDays: number | null = null;
    let soFarDays: number | null = null;
    if (calendar === null) {
      problem = 'no-calendar';
    } else if (state === 'finished') {
      if (isIsoDay(startedOn) && isIsoDay(finishedOn)) {
        tookDays = workedDays(calendar, startedOn, finishedOn);
      } else {
        problem = 'invalid-day';
      }
    } else if (state === 'started') {
      if (!isIsoDay(startedOn)) problem = 'invalid-day';
      else if (!todayValid) problem = 'invalid-today';
      else soFarDays = workedDays(calendar, startedOn, today);
    }

    const differenceDays = tookDays !== null && planned !== null ? tookDays - planned : null;
    return {
      key: `activity:${activity.id}`,
      itemId: activity.id,
      title: activity.name,
      day: finishedOn ?? startedOn,
      minutes: 0,
      activityId: activity.id,
      stageId: activity.stageId,
      planned,
      range,
      state,
      startedOn,
      finishedOn,
      tookDays,
      soFarDays,
      differenceDays,
      inRange:
        tookDays !== null && range !== null ? range.min <= tookDays && tookDays <= range.max : null,
      overrunning: soFarDays !== null && planned !== null && soFarDays > planned,
      problem,
    };
  });

  const position = new Map(rows.map((row, index) => [row.activityId, index]));
  const inPlanOrder = (a: ActualRow, b: ActualRow) =>
    position.get(a.activityId)! - position.get(b.activityId)!;
  const difference = (row: ActualRow): number => row.differenceDays ?? 0;

  const longer = rows
    .filter((row) => difference(row) > 0)
    .sort((a, b) => difference(b) - difference(a) || inPlanOrder(a, b));
  const less = rows
    .filter((row) => difference(row) < 0)
    .sort((a, b) => difference(a) - difference(b) || inPlanOrder(a, b));
  const total = longer.reduce((sum, row) => sum + difference(row), 0);

  return {
    problem: calendar === null ? 'no-calendar' : !todayValid ? 'invalid-today' : null,
    today,
    rows,
    finished: counted(
      'actuals:finished',
      ACTUALS_LABEL_KEYS.finished,
      rows.filter((row) => row.state === 'finished'),
    ),
    longer: counted('actuals:longer', ACTUALS_LABEL_KEYS.longer, longer),
    less: counted('actuals:less', ACTUALS_LABEL_KEYS.less, less),
    outside: counted(
      'actuals:outside',
      ACTUALS_LABEL_KEYS.outside,
      rows.filter((row) => row.inRange === false),
    ),
    daysOver: daysFigure(
      'actuals:days-over',
      ACTUALS_LABEL_KEYS.daysOver,
      total,
      longer.map((row): ActualDaysRow => ({ ...row, days: difference(row), againstFinish: total })),
    ),
  };
}

/** What "Learned from this work" can learn from: how many activities finished, of how many. */
export interface LearnedCounts {
  /** Activities of the plan's stages whose actual duration could be counted (finished, `tookDays`). */
  readonly finished: number;
  /** Activities of the plan's stages: the ones a template holds. */
  readonly total: number;
}

/**
 * How many of the activities a template would hold (those whose stage is in the plan) finished
 * with a duration that could be counted, of how many: what the Export dialog's hint says. Never
 * throws.
 */
export function learnedCounts(
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
  today: string,
): LearnedCounts {
  const stageIds = new Set(snapshot.stages.map((stage) => stage.id));
  const held = activityActuals(snapshot, entries, today).rows.filter((row) =>
    stageIds.has(row.stageId),
  );
  return {
    finished: held.filter((row) => row.tookDays !== null).length,
    total: held.length,
  };
}
