/**
 * The slip: how far the finish date has moved against the baseline, with every activity that moved.
 *
 * A figure that carries its rows (`figure.ts`, unit `days`). The value is the work's finish slip in
 * working days, counted on the work's calendar as it is now: positive when the finish moved later,
 * negative when earlier (the interface says "N days early"), 0 when it did not move. The rows are
 * every activity whose finish is not what the baseline recorded, each with its own days and both
 * finishes:
 *
 * - **moved**: placed then and now, finishing on a different day;
 * - **added**: not in the baseline; it did not move, so its own days are 0;
 * - **removed**: in the baseline, no longer in the plan; listed with its baseline finish, and it
 *   contributes nothing to the value;
 * - **unplaced**: placed then, not now (its duration was cleared); **placed**: the other way round.
 *
 * Why the value is not simply the largest row: an activity with float can slip without moving the
 * finish at all. The rule that does hold, and that `traceable` checks, is about the finish itself:
 * each row says how far its finish now lies from the baseline's finish, and a later finish is
 * exactly the furthest of those.
 *
 * Slice F2 compares the latest baseline with the schedule now; comparing any two baselines, and the
 * reasons between them, is slice F8. What this module is not: storage, and not text.
 */

import { workingDaysDiff } from '../calendar';
import { daysFigure, type DaysRow, type Figure } from '../figure';
import type { Baseline } from '../plan';
import type { Schedule } from './index';

/** How an activity's finish differs from the baseline's. */
export type SlipChange = 'moved' | 'added' | 'removed' | 'unplaced' | 'placed';

export interface SlipRow extends DaysRow {
  readonly activityId: string;
  readonly name: string;
  readonly change: SlipChange;
  readonly added: boolean;
  readonly removed: boolean;
  readonly baselineFinish: string | null;
  readonly currentFinish: string | null;
}

/** The slip figure's own name, as a message key. */
export const SLIP_LABEL_KEY = 'schedule.slip.label';

/** Compare the schedule now with a baseline. Never throws. */
export function slip(scheduled: Schedule, baseline: Baseline): Figure<SlipRow> {
  const calendar = scheduled.calendar;
  const reference = baseline.finishDate;
  const diff = (from: string | null, to: string | null): number | null =>
    calendar === null || from === null || to === null ? null : workingDaysDiff(calendar, from, to);

  const recorded = new Map(baseline.rows.map((row) => [row.activityId, row]));
  const rows: SlipRow[] = [];

  const row = (
    activityId: string,
    name: string,
    change: SlipChange,
    baselineFinish: string | null,
    currentFinish: string | null,
    days: number,
  ): SlipRow => ({
    key: `activity:${activityId}`,
    itemId: activityId,
    title: name,
    day: currentFinish ?? baselineFinish,
    minutes: 0,
    days,
    againstFinish: diff(reference, currentFinish),
    activityId,
    name,
    change,
    added: change === 'added',
    removed: change === 'removed',
    baselineFinish,
    currentFinish,
  });

  for (const activity of scheduled.activities) {
    const now = scheduled.dates.get(activity.id)?.finish ?? null;
    const then = recorded.get(activity.id);
    if (then === undefined) {
      rows.push(row(activity.id, activity.name, 'added', null, now, 0));
      continue;
    }
    if (then.finish === now) continue;
    if (then.finish !== null && now !== null) {
      rows.push(
        row(activity.id, activity.name, 'moved', then.finish, now, diff(then.finish, now)!),
      );
    } else {
      const change: SlipChange = now === null ? 'unplaced' : 'placed';
      rows.push(row(activity.id, activity.name, change, then.finish, now, 0));
    }
  }

  const present = new Set(scheduled.activities.map((activity) => activity.id));
  for (const then of baseline.rows) {
    if (!present.has(then.activityId)) {
      rows.push(row(then.activityId, then.name, 'removed', then.finish, null, 0));
    }
  }

  return daysFigure('slip', SLIP_LABEL_KEY, diff(reference, scheduled.finishDate) ?? 0, rows);
}
