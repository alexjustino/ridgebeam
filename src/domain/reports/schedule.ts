/**
 * The schedule printed: a Gantt and the table under it (slice F10, decision 6).
 *
 * The Gantt is the screen's (`ganttLayout`), not a second geometry: its columns are the calendar
 * days from the first day anything is drawn (day 0 of the chart: the schedule's first start, or the
 * baseline's when that is earlier) to the last, every one, weekends and holidays included, so a bar
 * that spans a weekend spans it on the page as on the screen. Each bar is an offset from day 0 and a
 * length in columns; the baseline, when there is one, is the same pair for where it had the
 * activity, or `null` when it did not place it. The diary's progress is not printed: the page is the
 * plan.
 *
 * The table holds **every** activity of the plan once, in breakdown order: number, name, stage,
 * start, finish, duration, float and responsible — an activity the schedule could not place is a
 * row with no dates and its reason, never left out. Float is the working days it can slip without
 * moving the finish.
 *
 * When nothing can be drawn — the calendar cannot be counted on, the start is not a day, the links
 * make a loop, or no activity has a duration — there is no Gantt and `blocked` says why; the table
 * is still printed.
 *
 * What this module is not: text or drawing. No I/O.
 */

import { breakdown } from '../arrangements';
import { latestBaseline, type Baseline, type WorkSnapshot } from '../plan';
import type { Schedule, UnplacedReason } from '../schedule';
import { ganttLayout, type GanttDay } from '../schedule/gantt';

/** Why there is no Gantt to print. */
export type ScheduleBlocked = 'invalid-calendar' | 'invalid-start' | 'cyclic' | 'nothing-placed';

export const SCHEDULE_BLOCKED_KEYS = {
  'invalid-calendar': 'reports.schedule.blocked.invalidCalendar',
  'invalid-start': 'reports.schedule.blocked.invalidStart',
  cyclic: 'reports.schedule.blocked.cyclic',
  'nothing-placed': 'reports.schedule.blocked.nothingPlaced',
} as const satisfies Record<ScheduleBlocked, string>;

/** One bar of the printed Gantt, in columns from day 0 of the chart. */
export interface ScheduleGanttRow {
  readonly activityId: string;
  readonly number: string | null;
  readonly name: string;
  readonly stageId: string;
  /** Always a stage of the plan: an activity whose stage is gone is never placed. */
  readonly stageName: string;
  /** The first column, from 0. */
  readonly start: number;
  /** How many columns, calendar days, first and last included. */
  readonly length: number;
  readonly critical: boolean;
  /** Where the baseline had it; both `null` when there is no baseline or it did not place it. */
  readonly baselineStart: number | null;
  readonly baselineLength: number | null;
}

export interface ScheduleGantt {
  /** How many columns: calendar days from day 0 to the last day drawn. */
  readonly days: number;
  /** The columns, day 0 first, each saying whether it is a working day and a holiday. */
  readonly columns: readonly GanttDay[];
  readonly rows: readonly ScheduleGanttRow[];
}

/** One row of the printed table: an activity of the plan. */
export interface ScheduleTableRow {
  readonly activityId: string;
  /** The breakdown number (`1.2`); `null` when its stage is not in the plan. */
  readonly number: string | null;
  readonly name: string;
  readonly stageId: string;
  /** `null` when its stage is not in the plan. */
  readonly stageName: string | null;
  /** First and last working day; `null` when unplaced. */
  readonly start: string | null;
  readonly finish: string | null;
  /** Working days, as the plan has it; `null` until known. */
  readonly durationDays: number | null;
  /** Working days it can slip without moving the finish; `null` when unplaced. */
  readonly float: number | null;
  readonly critical: boolean;
  readonly responsibleId: string | null;
  /** `null` when nobody answers for it, or the person is no longer in the plan. */
  readonly responsibleName: string | null;
  /** Why it has no dates; `null` when placed. */
  readonly unplaced: UnplacedReason | null;
}

export interface ScheduleReport {
  /** The first working day on or after the start; `null` when there is none to count. */
  readonly day0: string | null;
  readonly finishDate: string | null;
  /** The baseline drawn beneath the bars; `null` when there is none. */
  readonly baselineNumber: number | null;
  /** The Gantt; `null` when nothing can be drawn, and `blocked` says why. */
  readonly gantt: ScheduleGantt | null;
  readonly blocked: ScheduleBlocked | null;
  /** Every activity of the plan, in breakdown order. */
  readonly table: readonly ScheduleTableRow[];
}

/** Why the schedule placed nothing, as the page says it. */
function blockedOf(scheduled: Schedule): ScheduleBlocked | null {
  if (scheduled.dates.size > 0) return null;
  if (scheduled.calendar === null) return 'invalid-calendar';
  if (scheduled.day0 === null) return 'invalid-start';
  if (scheduled.cyclic) return 'cyclic';
  return 'nothing-placed';
}

/**
 * The printed schedule of the plan now, with `baseline` beneath the bars (the latest by default;
 * `null` for none).
 */
export function scheduleReport(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  baseline: Baseline | null = latestBaseline(snapshot),
): ScheduleReport {
  const stageNames = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  const people = new Map(snapshot.people.map((person) => [person.id, person.name]));
  const unplaced = new Map(scheduled.unplaced.map((row) => [row.activityId, row.reason]));
  const blocked = blockedOf(scheduled);

  let gantt: ScheduleGantt | null = null;
  if (blocked === null) {
    const layout = ganttLayout(scheduled, snapshot, scheduled.calendar!, baseline);
    const rows: ScheduleGanttRow[] = [];
    for (const row of layout.rows) {
      if (row.kind !== 'bar') continue;
      rows.push({
        activityId: row.activityId,
        number: row.number,
        name: row.name,
        stageId: row.stageId,
        stageName: stageNames.get(row.stageId)!,
        start: row.x,
        length: row.width,
        critical: row.critical,
        baselineStart: row.ghost?.x ?? null,
        baselineLength: row.ghost?.width ?? null,
      });
    }
    gantt = { days: layout.columns.length, columns: layout.columns, rows };
  }

  const table: ScheduleTableRow[] = [];
  for (const row of breakdown(snapshot)) {
    if (row.kind !== 'activity') continue;
    const dates = scheduled.dates.get(row.id);
    const timing = dates === undefined ? undefined : scheduled.plan.timing.get(row.id);
    table.push({
      activityId: row.id,
      number: row.number,
      name: row.name,
      stageId: row.stageId,
      stageName: stageNames.get(row.stageId) ?? null,
      start: dates?.start ?? null,
      finish: dates?.finish ?? null,
      durationDays: row.durationDays,
      float: timing?.slack ?? null,
      critical: scheduled.critical.has(row.id),
      responsibleId: row.responsibleId,
      responsibleName: row.responsibleId === null ? null : (people.get(row.responsibleId) ?? null),
      unplaced: unplaced.get(row.id) ?? null,
    });
  }

  return {
    day0: scheduled.day0,
    finishDate: scheduled.finishDate,
    baselineNumber: baseline?.number ?? null,
    gantt,
    blocked,
    table,
  };
}
