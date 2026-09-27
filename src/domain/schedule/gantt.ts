/**
 * The Gantt's geometry: which day is which column, which activity is which row, where each bar,
 * ghost and arrow goes. Pure, so the component only draws.
 *
 * Columns are calendar days, every one, from the first day anything starts (the schedule or the
 * baseline) to the last day anything finishes, each saying whether it is a working day and whether
 * it is a holiday, so weekends and holidays can be shaded and a bar visibly spans them. Rows follow
 * the breakdown: a band per stage, then a bar per placed activity of that stage, numbered as the
 * breakdown numbers it. An activity the schedule could not place has no bar; the screen lists it
 * below with its reason (`schedule.unplaced`).
 *
 * The critical path is carried as data on each bar and arrow (`critical`), never as a colour: the
 * design system draws it with colour **and** a stroke mark. The baseline, when there is one, is a
 * ghost under each bar, never over it.
 *
 * What this module is not: drawing, text or dates arithmetic beyond the calendar's. No I/O.
 */

import { addCalendarDays, isWorkingDay, type WorkingCalendar } from '../calendar';
import { breakdown } from '../arrangements';
import {
  progress as progressOf,
  type ActivityProgress,
  type DiaryEntry,
  type ProgressState,
} from '../diary';
import type { Baseline, WorkSnapshot } from '../plan';
import type { Schedule } from './index';

/** One calendar day of the axis. */
export interface GanttDay {
  readonly date: string;
  /** A day the site works: a working weekday that is not a holiday. */
  readonly working: boolean;
  readonly holiday: boolean;
}

/** A stage's band: the heading row its activities sit under. */
export interface GanttBand {
  readonly kind: 'band';
  readonly stageId: string;
  readonly number: string;
  readonly name: string;
  /** Row index, from 0. */
  readonly y: number;
}

/** A span of columns: the first column and how many. */
export interface GanttSpan {
  readonly x: number;
  readonly width: number;
  readonly start: string;
  readonly finish: string;
}

/** What the diary says of an activity, laid over its planned bar. */
export interface GanttProgress {
  readonly state: ProgressState;
  /**
   * How much of the bar to fill, 0 to 1: all of it once finished, none before it starts, the share
   * of quantities done while started, and `null` while started with no quantities to measure (the
   * bar shows a mark, not an invented fill).
   */
  readonly fill: number | null;
  readonly actualStart: string | null;
  readonly actualFinish: string | null;
  /** The span the diary says it ran, first entry to finish (or to the last entry so far). */
  readonly actual: { readonly x: number; readonly width: number } | null;
}

/** An activity's bar. */
export interface GanttBar extends GanttSpan {
  readonly kind: 'bar';
  readonly activityId: string;
  readonly stageId: string;
  readonly number: string | null;
  readonly name: string;
  readonly y: number;
  readonly durationDays: number;
  /** Working days it can slip without moving the finish. */
  readonly slack: number;
  readonly critical: boolean;
  /** Where the baseline had it, when the baseline placed it. */
  readonly ghost: GanttSpan | null;
  /** What the diary says of it; the planned bar stays as it is. */
  readonly progress: GanttProgress;
}

/** A dependency arrow from the end of one bar to the start of another. */
export interface GanttArrow {
  readonly fromId: string;
  readonly toId: string;
  readonly lagDays: number;
  /** Both ends critical and the link tight: this arrow is part of the critical path. */
  readonly critical: boolean;
  /** Column just after the blocker's last day, and its row. */
  readonly fromX: number;
  readonly fromY: number;
  /** The blocked activity's first column, and its row. */
  readonly toX: number;
  readonly toY: number;
}

export interface GanttLayout {
  readonly columns: readonly GanttDay[];
  readonly rows: ReadonlyArray<GanttBand | GanttBar>;
  readonly arrows: readonly GanttArrow[];
}

/**
 * Lay the schedule out, with the baseline's ghosts when one is given and the diary's progress over
 * each bar when entries are given.
 */
export function ganttLayout(
  scheduled: Schedule,
  snapshot: WorkSnapshot,
  calendar: WorkingCalendar,
  baseline: Baseline | null = null,
  entries: readonly DiaryEntry[] = [],
): GanttLayout {
  const said = progressOf(snapshot, entries);
  const recorded = new Map(
    (baseline?.rows ?? [])
      .filter((row) => row.start !== null && row.finish !== null)
      .map((row) => [row.activityId, { start: row.start!, finish: row.finish! }]),
  );

  // ── Columns ──────────────────────────────────────────────────────────────
  const starts: string[] = [];
  const finishes: string[] = [];
  for (const { start, finish } of [...scheduled.dates.values(), ...recorded.values()]) {
    starts.push(start);
    finishes.push(finish);
  }
  // The diary's dates too, for the bars that will show them.
  for (const [id, known] of said) {
    if (!scheduled.dates.has(id) || known.startedOn === null) continue;
    starts.push(known.startedOn);
    finishes.push(known.finishedOn ?? known.lastOn!);
  }
  const first = starts.reduce<string | null>((a, b) => (a === null || b < a ? b : a), null);
  const last = finishes.reduce<string | null>((a, b) => (a === null || b > a ? b : a), null);

  const columns: GanttDay[] = [];
  const column = new Map<string, number>();
  if (first !== null && last !== null) {
    for (let day: string = first; day <= last; day = addCalendarDays(day, 1)) {
      column.set(day, columns.length);
      columns.push({
        date: day,
        working: isWorkingDay(calendar, day),
        holiday: calendar.holidays.has(day),
      });
    }
  }
  const span = (start: string, finish: string): GanttSpan => {
    const x = column.get(start)!;
    return { x, width: column.get(finish)! - x + 1, start, finish };
  };

  // ── Rows ─────────────────────────────────────────────────────────────────
  const rows: Array<GanttBand | GanttBar> = [];
  const rowOf = new Map<string, number>();
  for (const row of breakdown(snapshot)) {
    if (row.kind === 'stage') {
      rows.push({
        kind: 'band',
        stageId: row.id,
        number: row.number,
        name: row.name,
        y: rows.length,
      });
      continue;
    }
    const dates = scheduled.dates.get(row.id);
    if (dates === undefined) continue;
    const timing = scheduled.plan.timing.get(row.id)!;
    const ghost = recorded.get(row.id);
    rowOf.set(row.id, rows.length);
    rows.push({
      kind: 'bar',
      activityId: row.id,
      stageId: row.stageId,
      number: row.number,
      name: row.name,
      y: rows.length,
      ...span(dates.start, dates.finish),
      durationDays: timing.durationDays,
      slack: timing.slack,
      critical: scheduled.critical.has(row.id),
      ghost: ghost === undefined ? null : span(ghost.start, ghost.finish),
      progress: barProgress(said.get(row.id)!, span),
    });
  }

  // ── Arrows ───────────────────────────────────────────────────────────────
  const arrows: GanttArrow[] = [];
  for (const edge of scheduled.edges) {
    const from = scheduled.dates.get(edge.blockerId);
    const to = scheduled.dates.get(edge.blockedId);
    if (from === undefined || to === undefined || edge.blockerId === edge.blockedId) continue;
    const blocker = scheduled.plan.timing.get(edge.blockerId)!;
    const blocked = scheduled.plan.timing.get(edge.blockedId)!;
    const tight = blocked.earliestStart === blocker.earliestFinish + edge.lagDays;
    arrows.push({
      fromId: edge.blockerId,
      toId: edge.blockedId,
      lagDays: edge.lagDays,
      critical:
        tight && scheduled.critical.has(edge.blockerId) && scheduled.critical.has(edge.blockedId),
      fromX: column.get(from.finish)! + 1,
      fromY: rowOf.get(edge.blockerId)!,
      toX: column.get(to.start)!,
      toY: rowOf.get(edge.blockedId)!,
    });
  }

  return { columns, rows, arrows };
}

function barProgress(
  known: ActivityProgress,
  span: (start: string, finish: string) => GanttSpan,
): GanttProgress {
  let fill: number | null;
  if (known.state === 'finished') fill = 1;
  else if (known.state === 'not-started') fill = 0;
  else fill = known.share === null ? null : known.share / 100;

  const last = known.finishedOn ?? known.lastOn;
  let actual: GanttProgress['actual'] = null;
  if (known.startedOn !== null && last !== null) {
    const { x, width } = span(known.startedOn, last);
    actual = { x, width };
  }
  return {
    state: known.state,
    fill,
    actualStart: known.startedOn,
    actualFinish: known.finishedOn,
    actual,
  };
}
