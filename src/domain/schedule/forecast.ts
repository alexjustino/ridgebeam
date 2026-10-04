/**
 * As things stand: when the work will finish, from what the diary says happened (slice E3).
 *
 * The plan's own schedule (`schedule()`) reads only the plan: it says when the work finishes if
 * everything goes as planned from the start date. The forecast reads the diary too. It is an
 * **as-built forward pass** over the same activities and the same links, on the same working
 * calendar, through the same pass (`forwardPass`, `settle`):
 *
 * - a **finished** activity lies where the diary put it, from the first day it was worked on to the
 *   day it was said finished, whatever its links say: that is a fact now;
 * - a **started** one keeps the day it started, and finishes no earlier than its planned duration
 *   from that start, and **no earlier than today**: it is not done;
 * - a **not started** one starts when its blockers allow, as planned, and **no earlier than today**
 *   (nor before the work's start date, as in the plan), and takes its planned duration.
 *
 * A link into an activity that has started is spent: the activity started, whatever was before it.
 * So it constrains nothing in the forecast, and an activity that is still running after its
 * successor began is not held critical by a successor that is already history.
 *
 * The forecast then says how far its finish lies from the latest baseline's (`daysAgainstBaseline`,
 * signed working days; `null` before approval) and from the plan's own date (`daysAgainstPlan`).
 * Two different questions, and the screen says which is which: the slip (`slip.ts`) is the plan
 * against the plan, the forecast is the diary against the plan.
 *
 * What it assumes, and says it assumes: every unfinished activity takes its planned duration from
 * the day it can go on. An activity with no duration is not placed, as in the schedule, unless the
 * diary says it started. With the diary empty and today on or before the start, the forecast is
 * the schedule, day for day.
 *
 * Today is an input. What this module is not: the ledger of why (`delay.ts`), storage, or text.
 */

import {
  isIsoDay,
  nextWorkingDay,
  previousWorkingDay,
  subtractWorkingDays,
  workingDaysFrom,
  workingDaysUntil,
  type WorkingCalendar,
} from '../calendar';
import { progress, type ActivityProgress, type DiaryEntry, type ProgressState } from '../diary';
import { hasDuration, latestBaseline, type WorkSnapshot } from '../plan';
import { forwardPass, network, settle, type Span } from './criticalPath';
import type { Schedule, ScheduledDates } from './index';

/** Why there is no forecast. */
export type ForecastProblem =
  /** The plan itself cannot be scheduled (a calendar, a start date or a cycle). */
  | 'no-schedule'
  /** `today` is not a `YYYY-MM-DD` day. */
  | 'invalid-today';

/** How the interface says each problem. */
export const FORECAST_PROBLEM_KEYS = {
  'no-schedule': 'schedule.forecast.problem.noSchedule',
  'invalid-today': 'schedule.forecast.problem.invalidToday',
} as const satisfies Record<ForecastProblem, string>;

/** The forecast's own names, as message keys. */
export const FORECAST_LABEL_KEYS = {
  /** "As things stand". */
  title: 'schedule.forecast.title',
  /** The forecast finish. */
  finish: 'schedule.forecast.finish',
  /** Working days against the latest baseline's finish. */
  againstBaseline: 'schedule.forecast.againstBaseline',
  /** Working days against the plan's own finish. */
  againstPlan: 'schedule.forecast.againstPlan',
  /** Before approval there is no baseline to stand against. */
  noBaseline: 'schedule.forecast.noBaseline',
} as const;

/** Where an activity lies in the forecast, and why there. */
export interface ForecastDates extends ScheduledDates {
  /** What the diary says of it: `finished` is pinned, `started` keeps its start. */
  readonly state: ProgressState;
}

export interface Forecast {
  /** `null` when there is a forecast; otherwise why there is none, and nothing else is given. */
  readonly problem: ForecastProblem | null;
  /** The day it was asked on. */
  readonly today: string;
  /** Progress of every activity, as the diary says (`progress`). */
  readonly progress: ReadonlyMap<string, ActivityProgress>;
  /** Every activity the forecast places, with its dates. */
  readonly dates: ReadonlyMap<string, ForecastDates>;
  /** The last forecast finish; `null` when nothing is placed. */
  readonly finishDate: string | null;
  /** Placed activities with no float in the forecast: the ones that decide its finish. */
  readonly critical: ReadonlySet<string>;
  /** One chain through them, in order. */
  readonly longestChain: readonly string[];
  /** The latest baseline's finish; `null` before approval, or when it recorded none. */
  readonly baselineFinish: string | null;
  /** Forecast finish against the baseline's, signed working days; `null` when either is missing. */
  readonly daysAgainstBaseline: number | null;
  /** The plan's own finish (`schedule()`). */
  readonly planFinish: string | null;
  /** Forecast finish against the plan's, signed working days; `null` when either is missing. */
  readonly daysAgainstPlan: number | null;
}

const NO_DATES: ReadonlyMap<string, ForecastDates> = new Map();

function empty(
  problem: ForecastProblem,
  today: string,
  progressById: ReadonlyMap<string, ActivityProgress>,
  scheduled: Schedule,
  baselineFinish: string | null,
): Forecast {
  return {
    problem,
    today,
    progress: progressById,
    dates: NO_DATES,
    finishDate: null,
    critical: new Set(),
    longestChain: [],
    baselineFinish,
    daysAgainstBaseline: null,
    planFinish: scheduled.finishDate,
    daysAgainstPlan: null,
  };
}

/**
 * Offsets on the work's calendar from day 0: a working day's offset is how many working days it
 * lies after day 0 (negative before it). A day that is not a working day starts on the next working
 * day and ends on the previous one, so a Saturday's work neither starts nor ends a span early.
 */
function offsets(calendar: WorkingCalendar, day0: string) {
  const offsetOf = (workingDay: string): number => workingDaysUntil(calendar, day0, workingDay);
  return {
    /** The offset of the first working day on or after `day`. */
    startOf: (day: string): number => offsetOf(nextWorkingDay(calendar, day)),
    /** The offset just after the last working day on or before `day`. */
    finishOf: (day: string): number => offsetOf(previousWorkingDay(calendar, day)) + 1,
  };
}

/** The working day at each offset up to `last`, walked once; before day 0, counted back. */
function daysUpTo(calendar: WorkingCalendar, day0: string, last: number) {
  const ahead = workingDaysFrom(calendar, day0, Math.max(0, last + 1));
  return (offset: number): string =>
    offset < 0 ? subtractWorkingDays(calendar, day0, -offset) : ahead[offset]!;
}

/**
 * The forecast of a work, as things stand on `today`, from its plan, its schedule (`schedule()` of
 * the same snapshot) and every diary entry (only the effective ones speak). Never throws.
 */
export function forecast(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  entries: readonly DiaryEntry[],
  today: string,
): Forecast {
  const progressById = progress(snapshot, entries);
  const baselineFinish = latestBaseline(snapshot)?.finishDate ?? null;
  const calendar = scheduled.calendar;
  const day0 = scheduled.day0;
  if (calendar === null || day0 === null || scheduled.cyclic) {
    return empty('no-schedule', today, progressById, scheduled, baselineFinish);
  }
  if (!isIsoDay(today)) {
    return empty('invalid-today', today, progressById, scheduled, baselineFinish);
  }

  const at = offsets(calendar, day0);
  const todayStart = at.startOf(today);
  const ids = [...scheduled.plan.timing.keys()];
  const stateOf = (id: string): ProgressState => progressById.get(id)?.state ?? 'not-started';

  // A link into an activity that has started is history: it constrains nothing now.
  const net = network(
    ids,
    scheduled.edges.filter((edge) => stateOf(edge.blockedId) === 'not-started'),
  );
  const duration = (id: string): number => scheduled.plan.timing.get(id)!.durationDays;

  const spans = forwardPass(net, (id, earliest): Span => {
    const said = progressById.get(id);
    if (said?.state === 'finished') {
      return { start: at.startOf(said.startedOn!), finish: at.finishOf(said.finishedOn!) };
    }
    if (said?.state === 'started') {
      const start = at.startOf(said.startedOn!);
      return { start, finish: Math.max(start + duration(id), todayStart + 1) };
    }
    const start = Math.max(earliest, todayStart);
    return { start, finish: start + duration(id) };
  });

  let end = Number.NEGATIVE_INFINITY;
  for (const span of spans.values()) end = Math.max(end, span.finish);
  const dayAt = daysUpTo(calendar, day0, end - 1);

  const activities = new Map(scheduled.activities.map((activity) => [activity.id, activity]));
  const dates = new Map<string, ForecastDates>();
  for (const id of ids) {
    const span = spans.get(id)!;
    const said = progressById.get(id);
    const state = stateOf(id);
    if (state === 'finished') {
      dates.set(id, { start: said!.startedOn!, finish: said!.finishedOn!, state });
    } else if (state === 'started') {
      dates.set(id, { start: said!.startedOn!, finish: dayAt(span.finish - 1), state });
    } else if (hasDuration(activities.get(id)!)) {
      dates.set(id, { start: dayAt(span.start), finish: dayAt(span.finish - 1), state });
    }
  }

  const settled = settle(net, spans, end);

  let finishDate: string | null = null;
  for (const { finish } of dates.values()) {
    if (finishDate === null || finish > finishDate) finishDate = finish;
  }
  const against = (reference: string | null): number | null =>
    reference === null || finishDate === null || !isIsoDay(reference)
      ? null
      : workingDaysUntil(calendar, reference, finishDate);

  return {
    problem: null,
    today,
    progress: progressById,
    dates,
    finishDate,
    critical: new Set([...settled.critical].filter((id) => dates.has(id))),
    longestChain: dates.size === 0 ? [] : settled.longestChain.filter((id) => dates.has(id)),
    baselineFinish,
    daysAgainstBaseline: against(baselineFinish),
    planFinish: scheduled.finishDate,
    daysAgainstPlan: against(scheduled.finishDate),
  };
}
