/**
 * The three arrangements of a plan: the same rows, never a copy.
 *
 * - **Breakdown**: stages numbered `1`, `2` …, each followed by its activities numbered `1.1`,
 *   `1.2` …, the engineer's work breakdown and the table the plan is edited in.
 * - **By room**: the rooms in order, each with the activities that touch it; an activity in two
 *   rooms appears under each, and the ones that touch no room are gathered last.
 * - **Checklist**: one line per activity in the order the schedule places them, each saying what
 *   the plan still lacks for it. The owner's list of what happens next.
 *
 * The invariant this module exists for: **every arrangement holds exactly the activities of the
 * plan**. None is dropped, none invented, whatever is wrong with the rows. An activity whose
 * stage is gone is still in the breakdown (unnumbered, last); one that names a room the plan does
 * not have is still under a room or under "no room", and the reference is reported by
 * `unknownRoomReferences` rather than silently ignored.
 *
 * What this module is not: vocabulary. Which arrangement a lens opens first, and what each noun
 * is called in it, is the interface's and the i18n tables' business (ADR-014); the rows here are
 * the same whoever looks at them. Nor is it progress: a checklist line has no "done". Done comes
 * from the diary (slice F4).
 */

import {
  activitiesInOrder,
  compareText,
  roomsInOrder,
  stagesInOrder,
  type Activity,
  type Room,
  type WorkSnapshot,
} from './plan';
import { RULES, type RuleId } from './readiness/rules';
import type { Schedule } from './schedule';

// ── Breakdown ────────────────────────────────────────────────────────────────

export interface BreakdownStageRow {
  readonly kind: 'stage';
  readonly id: string;
  /** `1`, `2` … in the plan's order. */
  readonly number: string;
  readonly name: string;
}

export interface BreakdownActivityRow {
  readonly kind: 'activity';
  readonly id: string;
  readonly stageId: string;
  /** `1.1`, `1.2` … under its stage's number; `null` for an activity whose stage is not in the plan. */
  readonly number: string | null;
  readonly name: string;
  readonly durationDays: number | null;
  readonly responsibleId: string | null;
  readonly roomIds: readonly string[];
  readonly quantity: number | null;
  readonly unit: string | null;
}

export type BreakdownRow = BreakdownStageRow | BreakdownActivityRow;

function activityRow(activity: Activity, number: string | null): BreakdownActivityRow {
  return {
    kind: 'activity',
    id: activity.id,
    stageId: activity.stageId,
    number,
    name: activity.name,
    durationDays: activity.durationDays,
    responsibleId: activity.responsibleId,
    roomIds: activity.roomIds,
    quantity: activity.quantity,
    unit: activity.unit,
  };
}

/**
 * The work breakdown: each stage, numbered by its place in the plan, followed by its activities
 * numbered under it. A stage with no activities is still a numbered row. Activities whose stage is
 * not in the plan come last, unnumbered, so they are shown rather than lost.
 */
export function breakdown(snapshot: WorkSnapshot): BreakdownRow[] {
  const rows: BreakdownRow[] = [];
  const ordered = activitiesInOrder(snapshot);
  const stages = stagesInOrder(snapshot);
  const stageIds = new Set(stages.map((stage) => stage.id));

  stages.forEach((stage, stageIndex) => {
    const stageNumber = String(stageIndex + 1);
    rows.push({ kind: 'stage', id: stage.id, number: stageNumber, name: stage.name });
    ordered
      .filter((activity) => activity.stageId === stage.id)
      .forEach((activity, index) =>
        rows.push(activityRow(activity, `${stageNumber}.${index + 1}`)),
      );
  });
  for (const activity of ordered) {
    if (!stageIds.has(activity.stageId)) rows.push(activityRow(activity, null));
  }
  return rows;
}

// ── By room ──────────────────────────────────────────────────────────────────

export interface RoomGroup {
  /** The room, or `null` for the activities that touch no room the plan has. */
  readonly roomId: string | null;
  readonly name: string | null;
  /** In plan order. */
  readonly activities: readonly Activity[];
}

/** The rooms of the plan an activity touches, in the rooms' order, each once. */
export function roomsOf(snapshot: WorkSnapshot, activity: Activity): Room[] {
  const touched = new Set(activity.roomIds);
  return roomsInOrder(snapshot).filter((room) => touched.has(room.id));
}

/**
 * The plan by room: every room in order with the activities that touch it (an empty room is still
 * a group), then one group with no room for the activities that touch none of the plan's rooms,
 * present only when it has something in it.
 */
export function byRoom(snapshot: WorkSnapshot): RoomGroup[] {
  const ordered = activitiesInOrder(snapshot);
  const groups: RoomGroup[] = roomsInOrder(snapshot).map((room) => ({
    roomId: room.id,
    name: room.name,
    activities: ordered.filter((activity) => activity.roomIds.includes(room.id)),
  }));
  const roomless = ordered.filter((activity) => roomsOf(snapshot, activity).length === 0);
  if (roomless.length > 0) groups.push({ roomId: null, name: null, activities: roomless });
  return groups;
}

/** An activity naming a room the plan does not have. */
export interface UnknownRoomReference {
  readonly activityId: string;
  readonly roomId: string;
}

/**
 * Every room an activity names that is not in the plan, in plan order. The host refuses such a
 * reference, so this is empty for a healthy work; when it is not, the arrangements still show the
 * activity, and this says why it may be under "no room".
 */
export function unknownRoomReferences(snapshot: WorkSnapshot): UnknownRoomReference[] {
  const known = new Set(snapshot.rooms.map((room) => room.id));
  return activitiesInOrder(snapshot).flatMap((activity) =>
    [...new Set(activity.roomIds)]
      .filter((roomId) => !known.has(roomId))
      .map((roomId) => ({ activityId: activity.id, roomId })),
  );
}

// ── Checklist ────────────────────────────────────────────────────────────────

/** What a checklist line can say the plan lacks: the readiness rules, by their short name. */
export type ChecklistMissing = 'duration' | 'responsible' | 'linked';

const MISSING_OF: Record<RuleId, ChecklistMissing> = {
  'activity.duration': 'duration',
  'activity.responsible': 'responsible',
  'activity.linked': 'linked',
};

export interface ChecklistLine {
  readonly activityId: string;
  readonly stageId: string;
  /** The line's place in the checklist, from 1. */
  readonly order: number;
  /** Where the calendar placed it; `null` when it is not placed. */
  readonly start: string | null;
  readonly finish: string | null;
  /** What the plan lacks for it, in the readiness rules' order; empty when nothing. */
  readonly missing: readonly ChecklistMissing[];
}

/**
 * The checklist: one line per activity in the order the schedule has them happen: the placed ones
 * by start date, ties in breakdown order, then the unplaced ones in breakdown order. Each line lists
 * what the plan lacks for it, tested by the same rules readiness counts, so the two never disagree.
 *
 * Built from the plan's activities, not from the schedule's: an activity the schedule has no dates
 * for is an unplaced line, and dates for an activity that is gone make no line.
 */
export function checklist(snapshot: WorkSnapshot, scheduled: Schedule): ChecklistLine[] {
  const ordered = activitiesInOrder(snapshot);
  const placed = ordered.filter((activity) => scheduled.dates.has(activity.id));
  const unplaced = ordered.filter((activity) => !scheduled.dates.has(activity.id));
  // `Array.prototype.sort` is stable, so equal starts keep breakdown order.
  placed.sort((a, b) =>
    compareText(scheduled.dates.get(a.id)!.start, scheduled.dates.get(b.id)!.start),
  );

  return [...placed, ...unplaced].map((activity, index) => {
    const dates = scheduled.dates.get(activity.id);
    return {
      activityId: activity.id,
      stageId: activity.stageId,
      order: index + 1,
      start: dates?.start ?? null,
      finish: dates?.finish ?? null,
      missing: RULES.filter(
        (rule) => rule.applies(activity, snapshot) && !rule.holds(activity, snapshot),
      ).map((rule) => MISSING_OF[rule.id]),
    };
  });
}
