/**
 * Decisions: what a person must choose before a stage can go ahead, and the last day they can.
 *
 * A decision belongs to a stage and carries a lead time: the working days between deciding and
 * having (the tile arriving, the contractor free). Its **deadline is computed, never stored**: the
 * stage's earliest scheduled start, less the lead time, counted back in working days on the work's
 * calendar (a lead of 0 is the start itself). So it moves when the schedule moves, and nobody keeps
 * it up to date. A stage with nothing scheduled gives no deadline, and the row says so instead of
 * inventing one. In 1.0 a decision is needed by its whole stage, so the stage's first start is what
 * it must beat (ADR-017).
 *
 * **Today is an input.** The domain never reads the clock: every question about "overdue" or
 * "days left" is asked against a `today` the caller passes, an ISO day.
 *
 * A decision is `made` (whatever its dates), `unknown` (no deadline yet), `overdue` (the deadline
 * is before today) or `due` (on or after today). A decision whose lead time is longer than the time
 * the stage leaves is overdue the moment it is written down, and the interface says so then
 * (`overdueOnCreation`); it is not refused, because the plan must be able to say the truth.
 *
 * What this module is not: storage, and not text. It returns rows, codes and figures.
 */

import { isIsoDay, subtractWorkingDays, workingDaysUntil, type WorkingCalendar } from './calendar';
import { counted, type Figure, type ReportRow } from './figure';
import { decisionsInOrder, type WorkSnapshot } from './plan';
import type { Schedule } from './schedule';

export type DecisionStatus = 'made' | 'unknown' | 'overdue' | 'due';

export interface DecisionRow {
  readonly decisionId: string;
  readonly stageId: string;
  /** `null` for a decision whose stage is not in the plan. */
  readonly stageName: string | null;
  readonly name: string;
  readonly leadTimeDays: number;
  /** The last day it can be made without delaying the stage; `null` while not yet known. */
  readonly deadline: string | null;
  readonly status: DecisionStatus;
  /**
   * Working days from today to the deadline: 0 when it is today, positive while due, negative
   * (at least one) once overdue; `null` for a made decision or one with no deadline.
   */
  readonly daysLeft: number | null;
  readonly madeAt: string | null;
  readonly answer: string | null;
}

/** A whole number of working days from zero, or nothing the calendar can count. */
function validLead(leadTimeDays: number): boolean {
  return Number.isInteger(leadTimeDays) && leadTimeDays >= 0;
}

/**
 * The first day anything in the stage is scheduled to start, or `null` when nothing in it is
 * (no duration, no activity, or a schedule that could not place anything).
 */
export function stageStart(scheduled: Schedule, stageId: string): string | null {
  let first: string | null = null;
  for (const activity of scheduled.activities) {
    if (activity.stageId !== stageId) continue;
    const start = scheduled.dates.get(activity.id)?.start;
    if (start !== undefined && (first === null || start < first)) first = start;
  }
  return first;
}

/**
 * The deadline of a decision with this lead time in this stage: the stage's first start less the
 * lead time, in working days. `null` when the stage has nothing scheduled, the calendar cannot be
 * counted on, or the lead time is not a whole number of working days from zero.
 */
export function deadlineOf(
  scheduled: Schedule,
  stageId: string,
  leadTimeDays: number,
): string | null {
  const start = stageStart(scheduled, stageId);
  if (start === null || scheduled.calendar === null || !validLead(leadTimeDays)) return null;
  return subtractWorkingDays(scheduled.calendar, start, leadTimeDays);
}

/**
 * Working days from today to a deadline, signed. A deadline that has passed is at least one
 * working day late: the day after a Friday deadline is a Saturday, and a decision made then still
 * reaches the site on Monday, a working day after it should have.
 */
function daysLeftUntil(calendar: WorkingCalendar, today: string, deadline: string): number {
  const days = workingDaysUntil(calendar, today, deadline);
  return deadline < today ? Math.min(-1, days) : days;
}

/**
 * Every decision of the plan, in plan order (stage by stage, by position), with its deadline and
 * status as of `today`. A decision whose stage is not in the plan is listed, with no stage name and
 * no deadline, never dropped.
 */
export function decisionRows(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  today: string,
): DecisionRow[] {
  const stageNames = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  const calendar = scheduled.calendar;
  const todayKnown = isIsoDay(today);

  return decisionsInOrder(snapshot).map((decision) => {
    const deadline = deadlineOf(scheduled, decision.stageId, decision.leadTimeDays);
    let status: DecisionStatus;
    let daysLeft: number | null = null;
    if (decision.madeAt !== null) {
      status = 'made';
    } else if (deadline === null || calendar === null || !todayKnown) {
      status = 'unknown';
    } else {
      status = deadline < today ? 'overdue' : 'due';
      daysLeft = daysLeftUntil(calendar, today, deadline);
    }
    return {
      decisionId: decision.id,
      stageId: decision.stageId,
      stageName: stageNames.get(decision.stageId) ?? null,
      name: decision.name,
      leadTimeDays: decision.leadTimeDays,
      deadline,
      status,
      daysLeft,
      madeAt: decision.madeAt,
      answer: decision.answer,
    };
  });
}

const URGENCY: Record<DecisionStatus, number> = { overdue: 0, due: 1, unknown: 2, made: 3 };

/**
 * The owner's order of what to decide: overdue first, then due, then those with no deadline yet,
 * made last; by deadline inside each, then in plan order.
 */
export function byUrgency(rows: readonly DecisionRow[]): DecisionRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const status = URGENCY[a.row.status] - URGENCY[b.row.status];
      if (status !== 0) return status;
      const left = a.row.deadline ?? '';
      const right = b.row.deadline ?? '';
      if (left !== right) return left < right ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

/** A row of the decisions-due figure. */
export interface DecisionDueRow extends ReportRow {
  readonly decisionId: string;
  readonly status: 'overdue' | 'due';
  readonly deadline: string;
  readonly daysLeft: number;
}

/** The decisions-due figure's own name, as a message key. */
export const DECISIONS_DUE_LABEL_KEY = 'decisions.due.label';

/**
 * Decisions due: every open decision that is overdue, or due within the next `horizon` working
 * days (today counting as 0), as a counted figure whose rows are those decisions, most urgent
 * first. The days are counted again from each row's deadline against this `today`, so rows built
 * yesterday are not trusted for today.
 */
export function decisionsDue(
  rows: readonly DecisionRow[],
  calendar: WorkingCalendar,
  today: string,
  horizon = 5,
): Figure<DecisionDueRow> {
  const due: DecisionDueRow[] = [];
  for (const row of byUrgency(rows)) {
    if (row.madeAt !== null || row.deadline === null) continue;
    const daysLeft = daysLeftUntil(calendar, today, row.deadline);
    const status = row.deadline < today ? 'overdue' : 'due';
    if (status === 'due' && daysLeft > horizon) continue;
    due.push({
      key: `decision:${row.decisionId}`,
      itemId: row.decisionId,
      title: row.name,
      day: row.deadline,
      minutes: 0,
      decisionId: row.decisionId,
      status,
      deadline: row.deadline,
      daysLeft,
    });
  }
  return counted('decisions-due', DECISIONS_DUE_LABEL_KEY, due);
}

/**
 * What the interface warns about the moment a decision is added, or its lead time raised: is it
 * already overdue? Returns the deadline and how many working days the stage leaves before it
 * starts (`left`, from today; negative once it has started), or `null` when the decision is in
 * time or its deadline is not yet known.
 */
export function overdueOnCreation(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  today: string,
  stageId: string,
  leadTimeDays: number,
): { deadline: string; left: number } | null {
  if (!snapshot.stages.some((stage) => stage.id === stageId) || !isIsoDay(today)) return null;
  const deadline = deadlineOf(scheduled, stageId, leadTimeDays);
  if (deadline === null || deadline >= today) return null;
  const start = stageStart(scheduled, stageId)!;
  return { deadline, left: workingDaysUntil(scheduled.calendar!, today, start) };
}
