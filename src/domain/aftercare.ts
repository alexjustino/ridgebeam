/**
 * After the handover (slice G4, decision 2, pt "depois da entrega"): the warranties the work came
 * with and the maintenance it needs, read as of a day — when each warranty ends, when each task is
 * next due, what comes due month by month, and the same as an `.ics` file any calendar can read.
 *
 * **Months are calendar months**, never working days. `addMonths` moves a day to the same day
 * `n` months later; a day the month does not have clamps to its last day (2026-01-31 + 1 month is
 * 2026-02-28, and 2028-02-29 in a leap year). Every month step of this module goes through it.
 *
 * - **A warranty** ends on `endsOn(startsOn, months)`, as a warranty paper says "valid until": a
 *   12-month warranty from 2026-03-15 ends on 2027-03-15 and covers that day too. As of `today` it
 *   is `ended` once that day has passed, `ending-soon` while it ends within
 *   `AFTERCARE_WINDOWS.endingSoonDays` calendar days (its last day included), `active` otherwise.
 * - **A maintenance task** is next due on its `firstDueOn` while nothing is recorded done, and then
 *   `everyMonths` calendar months after the day it was **last** recorded done (by seq): doing it late
 *   moves the cycle, and that is the intended reading. It is `overdue` once that day has passed
 *   (due today is still in time), `due-soon` while it is due within `AFTERCARE_WINDOWS.dueSoonDays`.
 * - **The calendar** is the next months from today's month, each with what comes due in it in day
 *   order: every due day of a task inside the window (from its next due day, stepping `everyMonths`
 *   from that day, so the 31st comes back as the 31st whenever the month has one), and the end day
 *   of every warranty not ended. An overdue task is told in the current month, marked overdue; the
 *   steps of it that already passed are not told again.
 * - **The `.ics` file** (RFC 5545) is a snapshot: one all-day event per task on its next due day,
 *   repeating every `everyMonths` months, and one per warranty not ended on its end day, with an
 *   alarm 30 days before. Each event's UID is `<id>@ridgebeam`, so the same file written again
 *   updates a calendar instead of duplicating it. The text comes from `words`, already in the
 *   person's language; this module escapes it, folds it at 75 octets and ends every line with CRLF.
 *
 * **The order** is the care notes' (`aftercareOrder`): a `position` orders the warranties (or tasks)
 * of one work, room or stage, so rows go by target — the work, the rooms, the stages, then targets
 * gone — and by position inside a target. A tie on a day keeps that order.
 *
 * It assumes the host's contract: the records of a task are by seq, never on a day before the one
 * they follow; a warranty's months are 1 to 600 and a task's 1 to 120. A row the host would refuse
 * (it never stores one) reads as nothing it is not: a warranty whose end cannot be read is active
 * with no end, left out of the calendar and the file; a task with no readable due day is scheduled
 * with none.
 *
 * Aftercare is not plan scope: readiness, the plan and the handover gaps are left alone.
 *
 * What this module is not: storage, text, a clock or a reminder. `today` and `now` are inputs; it
 * performs no I/O and sends nothing: the calendar of the person's phone does the reminding.
 */

import { addCalendarDays, calendarDaysBetween, isIsoDay } from './calendar';
import { counted, type Figure, type ReportRow } from './figure';
import {
  compareText,
  roomsInOrder,
  stagesInOrder,
  type AftercareTargetKind,
  type MaintenanceDone,
  type MaintenanceTask,
  type Warranty,
  type WorkSnapshot,
} from './plan';

export type { AftercareTargetKind, MaintenanceDone, MaintenanceTask, Warranty } from './plan';

// ── Limits and words ─────────────────────────────────────────────────────────

/** What the host accepts: characters (code points, as the host counts them) and calendar months. */
export const AFTERCARE_LIMITS = {
  title: 200,
  givenBy: 120,
  note: 1_000,
  doneNote: 500,
  /** A warranty's length, 1 to 600 months (fifty years). */
  months: 600,
  /** A task's interval, 1 to 120 months (ten years). */
  everyMonths: 120,
} as const;

/** How far ahead "soon" looks, in calendar days. */
export const AFTERCARE_WINDOWS = {
  /** A warranty ending within this many days, its last day included, is ending soon. */
  endingSoonDays: 90,
  /** A task due within this many days, today included, is due soon. */
  dueSoonDays: 30,
  /** How many months the calendar shows when not told. */
  calendarMonths: 12,
} as const;

export const AFTERCARE_TARGET_KINDS = [
  'work',
  'room',
  'stage',
] as const satisfies readonly AftercareTargetKind[];

/** Where a warranty stands, as of a day. */
export type WarrantyState = 'active' | 'ending-soon' | 'ended';

export const WARRANTY_STATES = [
  'active',
  'ending-soon',
  'ended',
] as const satisfies readonly WarrantyState[];

/** How each warranty state is said on a row: "Active", "Ending soon", "Ended". */
export const AFTERCARE_WARRANTY_STATE_KEYS = {
  active: 'aftercare.warranty.state.active',
  'ending-soon': 'aftercare.warranty.state.endingSoon',
  ended: 'aftercare.warranty.state.ended',
} as const satisfies Record<WarrantyState, string>;

/** Where a maintenance task stands, as of a day. */
export type MaintenanceState = 'overdue' | 'due-soon' | 'scheduled';

export const MAINTENANCE_STATES = [
  'overdue',
  'due-soon',
  'scheduled',
] as const satisfies readonly MaintenanceState[];

/** How each task state is said on a row: "Overdue", "Due soon", "Scheduled". */
export const AFTERCARE_TASK_STATE_KEYS = {
  overdue: 'aftercare.task.state.overdue',
  'due-soon': 'aftercare.task.state.dueSoon',
  scheduled: 'aftercare.task.state.scheduled',
} as const satisfies Record<MaintenanceState, string>;

/**
 * The figures' names: "Overdue", "Due in the next 30 days", "Warranties ending in the next 90 days",
 * "Warranties active".
 */
export const AFTERCARE_LABEL_KEYS = {
  overdue: 'aftercare.figure.overdue',
  dueSoon: 'aftercare.figure.dueSoon',
  endingSoon: 'aftercare.figure.endingSoon',
  active: 'aftercare.figure.active',
} as const;

/** What a calendar item is. */
export type AftercareItemKind = 'task-due' | 'warranty-ends';

/**
 * How the calendar says things: "Maintenance due", "Warranty ends", "Overdue", and a month with
 * nothing in it ("Nothing comes due this month").
 */
export const AFTERCARE_CALENDAR_KEYS = {
  'task-due': 'aftercare.calendar.taskDue',
  'warranty-ends': 'aftercare.calendar.warrantyEnds',
  overdue: 'aftercare.calendar.overdue',
  empty: 'aftercare.calendar.empty',
} as const satisfies Record<AftercareItemKind | 'overdue' | 'empty', string>;

/** Why a warranty, a task or a record done is refused before the host is asked. */
export const AFTERCARE_PROBLEM_KEYS = {
  'unknown-warranty': 'aftercare.problem.unknownWarranty',
  'unknown-task': 'aftercare.problem.unknownTask',
  'title-empty': 'aftercare.problem.titleEmpty',
  'title-too-long': 'aftercare.problem.titleTooLong',
  'title-not-one-line': 'aftercare.problem.titleNotOneLine',
  'invalid-target-kind': 'aftercare.problem.invalidTargetKind',
  'unknown-target': 'aftercare.problem.unknownTarget',
  'given-by-too-long': 'aftercare.problem.givenByTooLong',
  'given-by-not-one-line': 'aftercare.problem.givenByNotOneLine',
  'invalid-starts-on': 'aftercare.problem.invalidStartsOn',
  'invalid-months': 'aftercare.problem.invalidMonths',
  'unknown-document': 'aftercare.problem.unknownDocument',
  'document-not-warranty': 'aftercare.problem.documentNotWarranty',
  'note-too-long': 'aftercare.problem.noteTooLong',
  'invalid-every-months': 'aftercare.problem.invalidEveryMonths',
  'invalid-first-due-on': 'aftercare.problem.invalidFirstDueOn',
  'invalid-done-on': 'aftercare.problem.invalidDoneOn',
  'done-in-future': 'aftercare.problem.doneInFuture',
  'done-out-of-order': 'aftercare.problem.doneOutOfOrder',
  'done-note-too-long': 'aftercare.problem.doneNoteTooLong',
  'task-has-history': 'aftercare.problem.taskHasHistory',
} as const;

export type AftercareProblemCode = keyof typeof AFTERCARE_PROBLEM_KEYS;

/** A refusal, with the key the interface says it with. */
export interface AftercareProblem {
  readonly code: AftercareProblemCode;
  readonly messageKey: (typeof AFTERCARE_PROBLEM_KEYS)[AftercareProblemCode];
}

/** Every message key this module adds, for the dictionaries' completeness test. */
export const AFTERCARE_MESSAGE_KEYS: readonly string[] = [
  ...Object.values(AFTERCARE_WARRANTY_STATE_KEYS),
  ...Object.values(AFTERCARE_TASK_STATE_KEYS),
  ...Object.values(AFTERCARE_LABEL_KEYS),
  ...Object.values(AFTERCARE_CALENDAR_KEYS),
  ...Object.values(AFTERCARE_PROBLEM_KEYS),
];

// ── Calendar months ──────────────────────────────────────────────────────────

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * The same day `n` calendar months after `day` (before it, for a negative `n`); a day the month
 * does not have clamps to its last day: 2026-01-31 + 1 is 2026-02-28, 2028-01-31 + 1 is 2028-02-29.
 * Throws a `RangeError` for a `day` that is not a `YYYY-MM-DD` day, an `n` that is not whole, or a
 * result outside the years 0 to 9999.
 */
export function addMonths(day: string, n: number): string {
  if (!isIsoDay(day)) throw new RangeError(`Not a YYYY-MM-DD day: ${JSON.stringify(day)}`);
  if (!Number.isInteger(n)) throw new RangeError(`Not a whole number of months: ${n}`);
  const index = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + n;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  if (year < 0 || year > 9999) throw new RangeError(`Out of the calendar: ${day} + ${n} months`);
  const date = Math.min(Number(day.slice(8, 10)), daysInMonth(year, month));
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(date, 2)}`;
}

/**
 * The last day a warranty of `months` calendar months starting on `startsOn` covers: the same day
 * `months` later, as the paper says "valid until" (clamped like `addMonths`). Throws as `addMonths`.
 */
export function endsOn(startsOn: string, months: number): string {
  return addMonths(startsOn, months);
}

const wholeIn = (value: number, max: number): boolean =>
  Number.isInteger(value) && value >= 1 && value <= max;

/** A warranty's end day, or `null` when its start or length cannot be read. Never throws. */
export function warrantyEndsOn(warranty: Warranty): string | null {
  if (!isIsoDay(warranty.startsOn) || !wholeIn(warranty.months, AFTERCARE_LIMITS.months)) {
    return null;
  }
  return endsOn(warranty.startsOn, warranty.months);
}

/** A task's records, read: how many, the last one's day, and the day it is next due. */
export interface MaintenanceStory {
  /** The records with a readable day, by seq. */
  readonly records: readonly MaintenanceDone[];
  readonly timesDone: number;
  /** The day of the last record by seq; `null` while nothing is recorded done. */
  readonly lastDoneOn: string | null;
  /**
   * `firstDueOn` while nothing is done; then `lastDoneOn` + `everyMonths` calendar months. `null`
   * when that day cannot be read.
   */
  readonly nextDueOn: string | null;
}

/** Where a task stands, from its records by seq. A record whose day cannot be read is passed over. */
export function maintenanceStory(task: MaintenanceTask): MaintenanceStory {
  const records = [...task.done]
    .filter((record) => isIsoDay(record.doneOn))
    .sort((a, b) => a.seq - b.seq);
  const last = records.at(-1) ?? null;
  let nextDueOn: string | null;
  if (last === null) nextDueOn = isIsoDay(task.firstDueOn) ? task.firstDueOn : null;
  else if (!wholeIn(task.everyMonths, AFTERCARE_LIMITS.everyMonths)) nextDueOn = null;
  else nextDueOn = addMonths(last.doneOn, task.everyMonths);
  return { records, timesDone: records.length, lastDoneOn: last?.doneOn ?? null, nextDueOn };
}

// ── The record, read ─────────────────────────────────────────────────────────

/** What the target order reads of a warranty or a task. */
interface Targeted {
  readonly id: string;
  readonly position: number;
  readonly targetKind: AftercareTargetKind;
  readonly targetId: string;
}

/**
 * The order warranties and tasks are listed in. `position` is an order among those of **one
 * target** (the host keeps it unique per work, room or stage, as for care notes), so they are
 * sorted as care notes are: by target — the work first, then the rooms in room order, then the
 * stages in stage order, then any target no longer in the plan (by kind, then id) — and inside a
 * target by position, then by id. Never by position alone across targets.
 */
export function aftercareOrder(snapshot: WorkSnapshot): (a: Targeted, b: Targeted) => number {
  const rank = new Map<string, number>([[`work:${snapshot.work.workId}`, 0]]);
  for (const room of roomsInOrder(snapshot)) rank.set(`room:${room.id}`, rank.size);
  for (const stage of stagesInOrder(snapshot)) rank.set(`stage:${stage.id}`, rank.size);
  const gone = rank.size;
  const rankOf = (each: Targeted) => rank.get(`${each.targetKind}:${each.targetId}`) ?? gone;
  return (a, b) =>
    rankOf(a) - rankOf(b) ||
    compareText(a.targetKind, b.targetKind) ||
    compareText(a.targetId, b.targetId) ||
    a.position - b.position ||
    compareText(a.id, b.id);
}

/** The warranties in target order, then by position inside a target, then by id. */
export function warrantiesInOrder(snapshot: WorkSnapshot): Warranty[] {
  return [...snapshot.warranties].sort(aftercareOrder(snapshot));
}

/** The maintenance tasks in target order, then by position inside a target, then by id. */
export function maintenanceInOrder(snapshot: WorkSnapshot): MaintenanceTask[] {
  return [...snapshot.maintenance].sort(aftercareOrder(snapshot));
}

/** What a warranty or a task covers, ready to be said: the work's, room's or stage's name. */
export interface AftercareTarget {
  readonly targetKind: AftercareTargetKind;
  readonly targetId: string;
  /** The work's, room's or stage's name; `null` when the target is not in the plan. */
  readonly targetName: string | null;
  /** The room or stage it names is not in the plan (the host removes both together). */
  readonly detached: boolean;
}

/** What a warranty or a task covers, described as care notes are. Never throws. */
export function describeAftercareTarget(
  snapshot: WorkSnapshot,
  targetKind: AftercareTargetKind,
  targetId: string,
): AftercareTarget {
  let name: string | null = null;
  if (targetKind === 'work') {
    name = targetId === snapshot.work.workId ? snapshot.work.name : null;
  } else if (targetKind === 'room') {
    name = snapshot.rooms.find((room) => room.id === targetId)?.name ?? null;
  } else if (targetKind === 'stage') {
    name = snapshot.stages.find((stage) => stage.id === targetId)?.name ?? null;
  }
  return { targetKind, targetId, targetName: name, detached: name === null };
}

/** The filed warranty document a warranty names, as a row shows it. */
export interface AftercareDocument {
  readonly documentId: string;
  readonly title: string;
  readonly fileName: string;
}

/** The document a warranty names, or `null` when it names none or one not in the work. */
export function aftercareDocumentOf(
  snapshot: WorkSnapshot,
  documentId: string | null,
): AftercareDocument | null {
  if (documentId === null) return null;
  const document = snapshot.documents.find((each) => each.id === documentId);
  return document === undefined
    ? null
    : { documentId: document.id, title: document.title, fileName: document.fileName };
}

/** Can the task be removed: nothing is recorded done. The refusal itself is the host's. */
export function maintenanceRemovable(snapshot: WorkSnapshot, taskId: string): boolean {
  const task = snapshot.maintenance.find((each) => each.id === taskId);
  return task !== undefined && task.done.length === 0;
}

/**
 * The tasks with a history (something recorded done) on a room or a stage, in order: while any
 * is there, the host refuses to remove that room or stage. Empty when nothing holds it.
 */
export function maintenanceHolding(
  snapshot: WorkSnapshot,
  targetKind: AftercareTargetKind,
  targetId: string,
): MaintenanceTask[] {
  return maintenanceInOrder(snapshot).filter(
    (task) => task.targetKind === targetKind && task.targetId === targetId && task.done.length > 0,
  );
}

// ── The rule ─────────────────────────────────────────────────────────────────

/** One warranty as the Handover tab, the Dashboard and the calendar read it. */
export interface WarrantyRow extends ReportRow, AftercareTarget {
  readonly warrantyId: string;
  /** Order among the warranties of the same work, room or stage. */
  readonly position: number;
  readonly givenBy: string | null;
  readonly startsOn: string;
  readonly months: number;
  /** The last day it covers; `null` when it cannot be read. */
  readonly endsOn: string | null;
  readonly state: WarrantyState;
  /**
   * Calendar days from today to its end: 0 on its last day, negative once ended; `null` when the
   * end or today cannot be read.
   */
  readonly daysLeft: number | null;
  /** Its filed document; `null` when none is filed (or it is not in the work). */
  readonly document: AftercareDocument | null;
  readonly note: string | null;
}

/** One maintenance task as the Handover tab, the Dashboard and the calendar read it. */
export interface MaintenanceRow extends ReportRow, AftercareTarget {
  readonly taskId: string;
  /** Order among the tasks of the same work, room or stage. */
  readonly position: number;
  readonly everyMonths: number;
  readonly firstDueOn: string;
  readonly note: string | null;
  /** How many times it was recorded done. */
  readonly timesDone: number;
  readonly lastDoneOn: string | null;
  readonly nextDueOn: string | null;
  readonly state: MaintenanceState;
  /** Its next due day has passed (due today is still in time). */
  readonly overdue: boolean;
  /** Calendar days past its due day, from 1, while overdue; `null` otherwise. */
  readonly daysOverdue: number | null;
  /** Not overdue, and due within `AFTERCARE_WINDOWS.dueSoonDays` days. */
  readonly dueSoon: boolean;
  /** Calendar days until it is due, 0 when due today, while not overdue; `null` otherwise. */
  readonly daysUntilDue: number | null;
}

/**
 * Every warranty of the work, in target order (`aftercareOrder`), as of `today`: its end, its state and the days left,
 * what it covers and its document. A `today` that is not a day reads every warranty as active, with
 * no days left. Never throws.
 */
export function warrantyRows(snapshot: WorkSnapshot, today: string): WarrantyRow[] {
  const todayKnown = isIsoDay(today);
  return warrantiesInOrder(snapshot).map((warranty): WarrantyRow => {
    const ends = warrantyEndsOn(warranty);
    const daysLeft = ends !== null && todayKnown ? calendarDaysBetween(today, ends) : null;
    const state: WarrantyState =
      daysLeft === null
        ? 'active'
        : daysLeft < 0
          ? 'ended'
          : daysLeft <= AFTERCARE_WINDOWS.endingSoonDays
            ? 'ending-soon'
            : 'active';
    return {
      key: `warranty:${warranty.id}`,
      itemId: warranty.id,
      title: warranty.title,
      day: ends,
      minutes: 0,
      ...describeAftercareTarget(snapshot, warranty.targetKind, warranty.targetId),
      warrantyId: warranty.id,
      position: warranty.position,
      givenBy: warranty.givenBy,
      startsOn: warranty.startsOn,
      months: warranty.months,
      endsOn: ends,
      state,
      daysLeft,
      document: aftercareDocumentOf(snapshot, warranty.documentId),
      note: warranty.note,
    };
  });
}

/**
 * Every maintenance task of the work, in target order (`aftercareOrder`), as of `today`: the day it was last done, the
 * day it is next due, whether it is overdue (and by how many days) or due soon, and how many times
 * it was done. A `today` that is not a day marks nothing overdue or due soon. Never throws.
 */
export function maintenanceRows(snapshot: WorkSnapshot, today: string): MaintenanceRow[] {
  const todayKnown = isIsoDay(today);
  return maintenanceInOrder(snapshot).map((task): MaintenanceRow => {
    const story = maintenanceStory(task);
    const next = story.nextDueOn;
    const until = next !== null && todayKnown ? calendarDaysBetween(today, next) : null;
    const overdue = until !== null && until < 0;
    const dueSoon = until !== null && until >= 0 && until <= AFTERCARE_WINDOWS.dueSoonDays;
    return {
      key: `maintenance:${task.id}`,
      itemId: task.id,
      title: task.title,
      day: next,
      minutes: 0,
      ...describeAftercareTarget(snapshot, task.targetKind, task.targetId),
      taskId: task.id,
      position: task.position,
      everyMonths: task.everyMonths,
      firstDueOn: task.firstDueOn,
      note: task.note,
      timesDone: story.timesDone,
      lastDoneOn: story.lastDoneOn,
      nextDueOn: next,
      state: overdue ? 'overdue' : dueSoon ? 'due-soon' : 'scheduled',
      overdue,
      daysOverdue: overdue ? -until : null,
      dueSoon,
      daysUntilDue: until !== null && !overdue ? until : null,
    };
  });
}

// ── The figures ──────────────────────────────────────────────────────────────

export interface AftercareFigures {
  /** How many warranties and tasks the work has: the Dashboard's card is hidden when both are 0. */
  readonly warranties: number;
  readonly tasks: number;
  /** Tasks past their due day: the most days overdue first. */
  readonly overdue: Figure<MaintenanceRow>;
  /** Tasks due in the next 30 days, today included: the soonest first. */
  readonly dueSoon: Figure<MaintenanceRow>;
  /** Warranties ending in the next 90 days, their last day included: the soonest first. */
  readonly endingSoon: Figure<WarrantyRow>;
  /** Warranties that still cover today — active or ending soon: the soonest end first. */
  readonly active: Figure<WarrantyRow>;
}

/** By day; a tie keeps the rows' own order (target order: the sort is stable). */
const byDay = (a: ReportRow, b: ReportRow): number => compareText(a.day ?? '', b.day ?? '');

/** The figures of the rows `warrantyRows` and `maintenanceRows` give: each one's rows are its count. */
export function aftercareFiguresOf(
  warranties: readonly WarrantyRow[],
  tasks: readonly MaintenanceRow[],
): AftercareFigures {
  return {
    warranties: warranties.length,
    tasks: tasks.length,
    overdue: counted(
      'aftercare:overdue',
      AFTERCARE_LABEL_KEYS.overdue,
      tasks
        .filter((row) => row.overdue)
        .sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0) || byDay(a, b)),
    ),
    dueSoon: counted(
      'aftercare:due-soon',
      AFTERCARE_LABEL_KEYS.dueSoon,
      tasks.filter((row) => row.dueSoon).sort(byDay),
    ),
    endingSoon: counted(
      'aftercare:ending-soon',
      AFTERCARE_LABEL_KEYS.endingSoon,
      warranties.filter((row) => row.state === 'ending-soon').sort(byDay),
    ),
    active: counted(
      'aftercare:active',
      AFTERCARE_LABEL_KEYS.active,
      warranties.filter((row) => row.state !== 'ended').sort(byDay),
    ),
  };
}

/** What is overdue, due soon, ending soon and still covering, as of `today`. Never throws. */
export function aftercareFigures(snapshot: WorkSnapshot, today: string): AftercareFigures {
  return aftercareFiguresOf(warrantyRows(snapshot, today), maintenanceRows(snapshot, today));
}

// ── The calendar ─────────────────────────────────────────────────────────────

/** One thing that comes due in a month of the calendar. */
export interface AftercareCalendarItem extends AftercareTarget {
  /** Unique in the calendar: `task:<id>:<day>` or `warranty:<id>`. */
  readonly key: string;
  readonly kind: AftercareItemKind;
  readonly messageKey: (typeof AFTERCARE_CALENDAR_KEYS)[AftercareItemKind];
  /** The task's or the warranty's id. */
  readonly id: string;
  readonly title: string;
  /** The day it comes due (a task) or ends (a warranty); an overdue task's past due day. */
  readonly day: string;
  /** A task past its due day, told in the current month. */
  readonly overdue: boolean;
  readonly daysOverdue: number | null;
  /** A task's interval in months; `null` for a warranty. */
  readonly everyMonths: number | null;
}

/** One calendar month and what comes due in it, in day order. */
export interface AftercareMonth {
  /** `YYYY-MM`. */
  readonly month: string;
  /** `YYYY-MM-01`, for the interface to name the month. */
  readonly firstDay: string;
  readonly items: readonly AftercareCalendarItem[];
  /** Nothing comes due: the month says so (`AFTERCARE_CALENDAR_KEYS.empty`). */
  readonly empty: boolean;
}

const KIND_ORDER: Record<AftercareItemKind, number> = { 'task-due': 0, 'warranty-ends': 1 };

/**
 * The next `months` calendar months from today's month, each with its items in day order: every
 * due day of each task inside the window and the end day of each warranty not ended. An overdue
 * task is told in the current month, marked overdue, once. A `today` that is not a day, or a
 * `months` that is not a whole number from 1, gives no month. Never throws.
 */
export function aftercareCalendar(
  snapshot: WorkSnapshot,
  today: string,
  months: number = AFTERCARE_WINDOWS.calendarMonths,
): AftercareMonth[] {
  if (!isIsoDay(today) || !Number.isInteger(months) || months < 1) return [];
  const windowStart = `${today.slice(0, 7)}-01`;
  let windowEnd: string;
  try {
    windowEnd = addCalendarDays(addMonths(windowStart, months), -1);
  } catch {
    return [];
  }

  const byMonth = new Map<string, AftercareCalendarItem[]>();
  const place = (month: string, item: AftercareCalendarItem) => {
    const list = byMonth.get(month) ?? [];
    list.push(item);
    byMonth.set(month, list);
  };
  // A tie on a day keeps the target order the rows came in.
  const order = new Map<string, number>();

  for (const row of maintenanceRows(snapshot, today)) {
    const next = row.nextDueOn;
    if (next === null) continue;
    order.set(`task-due:${row.taskId}`, order.size);
    const item = (day: string, overdue: boolean): AftercareCalendarItem => ({
      key: `task:${row.taskId}:${day}`,
      kind: 'task-due',
      messageKey: AFTERCARE_CALENDAR_KEYS['task-due'],
      id: row.taskId,
      title: row.title,
      day,
      overdue,
      daysOverdue: overdue ? row.daysOverdue : null,
      everyMonths: row.everyMonths,
      targetKind: row.targetKind,
      targetId: row.targetId,
      targetName: row.targetName,
      detached: row.detached,
    });
    if (row.overdue) place(today.slice(0, 7), item(next, true));
    else if (next <= windowEnd) place(next.slice(0, 7), item(next, false));
    if (!wholeIn(row.everyMonths, AFTERCARE_LIMITS.everyMonths)) continue;
    for (let step = 1; ; step += 1) {
      let day: string;
      try {
        day = addMonths(next, step * row.everyMonths);
      } catch {
        break;
      }
      if (day > windowEnd) break;
      // The steps an overdue task has already passed are not told again.
      if (day >= today) place(day.slice(0, 7), item(day, false));
    }
  }

  for (const row of warrantyRows(snapshot, today)) {
    const ends = row.endsOn;
    if (ends === null || row.state === 'ended' || ends > windowEnd) continue;
    order.set(`warranty-ends:${row.warrantyId}`, order.size);
    place(ends.slice(0, 7), {
      key: `warranty:${row.warrantyId}`,
      kind: 'warranty-ends',
      messageKey: AFTERCARE_CALENDAR_KEYS['warranty-ends'],
      id: row.warrantyId,
      title: row.title,
      day: ends,
      overdue: false,
      daysOverdue: null,
      everyMonths: null,
      targetKind: row.targetKind,
      targetId: row.targetId,
      targetName: row.targetName,
      detached: row.detached,
    });
  }

  const result: AftercareMonth[] = [];
  for (let index = 0; index < months; index += 1) {
    const firstDay = addMonths(windowStart, index);
    const month = firstDay.slice(0, 7);
    const items = (byMonth.get(month) ?? []).sort(
      (a, b) =>
        compareText(a.day, b.day) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (order.get(`${a.kind}:${a.id}`) ?? 0) - (order.get(`${b.kind}:${b.id}`) ?? 0) ||
        compareText(a.key, b.key),
    );
    result.push({ month, firstDay, items, empty: items.length === 0 });
  }
  return result;
}

// ── The .ics file ────────────────────────────────────────────────────────────

/** The product's identifier in the file: no version, nothing that says more. */
export const AFTERCARE_ICS_PRODID = '-//Ridgebeam//Aftercare//EN';

/**
 * The words of the `.ics` file, already in the person's language: the interface passes them, the
 * domain stays textless. A description that is `null` or blank is left out.
 */
export interface AftercareIcsWords {
  /** The calendar's name (`X-WR-CALNAME`), e.g. the work's name; blank leaves it out. */
  readonly calendarName: string;
  /** A task's event title, e.g. "Maintenance: {title}". */
  readonly taskSummary: (title: string) => string;
  /** A task's event text, e.g. what it covers and how often. */
  readonly taskDescription: (row: MaintenanceRow) => string | null;
  /** A warranty's event title, e.g. "Warranty ends: {title}". */
  readonly warrantySummary: (title: string) => string;
  /** A warranty's event text, e.g. who gives it and from when. */
  readonly warrantyDescription: (row: WarrantyRow) => string | null;
  /** The text of the alarm 30 days before a warranty ends, e.g. "{title} ends in 30 days". */
  readonly warrantyAlarm: (title: string) => string;
}

/** Octets of one code point in UTF-8 (a lone surrogate is written as U+FFFD, three octets). */
function utf8Octets(char: string): number {
  const point = char.codePointAt(0)!;
  if (point < 0x80) return 1;
  if (point < 0x800) return 2;
  return point < 0x10000 ? 3 : 4;
}

/**
 * A content line folded as RFC 5545 §3.1 asks: at most 75 octets a line, CRLF and one space before
 * each continuation (the space counts), never inside a UTF-8 sequence.
 */
export function foldIcsLine(line: string): string {
  const lines: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = utf8Octets(char);
    if (octets + size > 75) {
      lines.push(current);
      current = ' ';
      octets = 1;
    }
    current += char;
    octets += size;
  }
  lines.push(current);
  return lines.join('\r\n');
}

/**
 * A TEXT value escaped as RFC 5545 §3.3.11 asks: `\` `;` `,` escaped, every line break (CRLF, CR
 * or LF) written `\n`; any other control character but the tab is dropped (TEXT may not hold one).
 */
export function escapeIcsText(text: string): string {
  return (
    text
      .replace(/\r\n|\r|\n/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n')
  );
}

const icsDate = (day: string): string => day.replace(/-/g, '');

const UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

/** `now` as a UTC DATE-TIME (`20261005T120000Z`). Throws a `RangeError` for anything else. */
function icsStamp(now: string): string {
  const match = UTC_INSTANT.exec(now);
  if (match === null) throw new RangeError(`Not a UTC instant: ${JSON.stringify(now)}`);
  const [, year, month, date, hours, minutes, seconds] = match;
  return `${year}${month}${date}T${hours}${minutes}${seconds}Z`;
}

/**
 * How a task repeats: every `everyMonths` months. When its day is the 29th, 30th or 31st, the
 * month-day set with `BYSETPOS=-1` makes a month without that day fall on its last day — the same
 * clamp `addMonths` applies — instead of being skipped, as a plain monthly rule would.
 */
function repeatRule(day: string, everyMonths: number): string {
  const date = Number(day.slice(8, 10));
  const base = `RRULE:FREQ=MONTHLY;INTERVAL=${everyMonths}`;
  if (date < 29) return base;
  const days = Array.from({ length: date - 27 }, (_, index) => 28 + index).join(',');
  return `${base};BYMONTHDAY=${days};BYSETPOS=-1`;
}

/**
 * The work's aftercare as an RFC 5545 calendar (`.ics`), every line folded and ended with CRLF:
 * one all-day event per task on its next due day, repeating every `everyMonths` months; one per
 * warranty not ended as of `today`, on its end day, with an alarm 30 days before. UIDs are
 * `<id>@ridgebeam`; `DTSTAMP` is `now`, a UTC instant (`2026-10-05T12:00:00.000Z`). `today`
 * defaults to the day of `now`; the interface passes the person's own day. A task or a warranty
 * whose day cannot be read is left out. Throws a `RangeError` only for a `now` that is not a UTC
 * instant.
 */
export function aftercareIcs(
  snapshot: WorkSnapshot,
  words: AftercareIcsWords,
  now: string,
  today: string = now.slice(0, 10),
): string {
  const stamp = icsStamp(now);
  const text = (name: string, value: string) => `${name}:${escapeIcsText(value)}`;
  const described = (value: string | null): string[] =>
    value === null || value.trim() === '' ? [] : [text('DESCRIPTION', value)];
  const allDay = (day: string): string[] => [
    `DTSTART;VALUE=DATE:${icsDate(day)}`,
    `DTEND;VALUE=DATE:${icsDate(addCalendarDays(day, 1))}`,
  ];

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${AFTERCARE_ICS_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (words.calendarName.trim() !== '') lines.push(text('X-WR-CALNAME', words.calendarName));

  for (const row of maintenanceRows(snapshot, today)) {
    if (row.nextDueOn === null) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${row.taskId}@ridgebeam`,
      `DTSTAMP:${stamp}`,
      ...allDay(row.nextDueOn),
      ...(wholeIn(row.everyMonths, AFTERCARE_LIMITS.everyMonths)
        ? [repeatRule(row.nextDueOn, row.everyMonths)]
        : []),
      text('SUMMARY', words.taskSummary(row.title)),
      ...described(words.taskDescription(row)),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }

  for (const row of warrantyRows(snapshot, today)) {
    if (row.endsOn === null || row.state === 'ended') continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${row.warrantyId}@ridgebeam`,
      `DTSTAMP:${stamp}`,
      ...allDay(row.endsOn),
      text('SUMMARY', words.warrantySummary(row.title)),
      ...described(words.warrantyDescription(row)),
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      text('DESCRIPTION', words.warrantyAlarm(row.title)),
      'TRIGGER:-P30D',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

// ── Checking before the host is asked ────────────────────────────────────────

/** A warranty as the interface asks the host to add it, or (with its `id`) to write it whole. */
export interface WarrantyDraft {
  /** The warranty written whole; absent or `null` for a new one. */
  readonly id?: string | null;
  readonly title: string;
  readonly targetKind: AftercareTargetKind;
  readonly targetId: string;
  readonly givenBy: string | null;
  readonly startsOn: string;
  readonly months: number;
  readonly documentId: string | null;
  readonly note: string | null;
}

/** A maintenance task as the interface asks the host to add it, or (with its `id`) to write it. */
export interface MaintenanceDraft {
  readonly id?: string | null;
  readonly title: string;
  readonly targetKind: AftercareTargetKind;
  readonly targetId: string;
  readonly everyMonths: number;
  readonly firstDueOn: string;
  readonly note: string | null;
}

/** One time a task was done, as the interface asks the host to record it. */
export interface MaintenanceDoneDraft {
  readonly taskId: string;
  readonly doneOn: string;
  readonly note: string | null;
}

function problem(code: AftercareProblemCode): AftercareProblem {
  return { code, messageKey: AFTERCARE_PROBLEM_KEYS[code] };
}

/** The host trims, and keeps an empty text as none; it counts code points. */
const length = (text: string): number => [...text.trim()].length;

/** A control character the host refuses in a line. */
// eslint-disable-next-line no-control-regex
const CONTROL_IN_LINE = /[\u0000-\u001f\u007f-\u009f]/u;

/** The title (1–200, one line) and the target (a kind, and a work, room or stage of the plan). */
function titleAndTarget(
  snapshot: WorkSnapshot,
  draft: {
    readonly title: string;
    readonly targetKind: AftercareTargetKind;
    readonly targetId: string;
  },
  add: (code: AftercareProblemCode) => void,
): void {
  if (draft.title.trim() === '') add('title-empty');
  else if (length(draft.title) > AFTERCARE_LIMITS.title) add('title-too-long');
  else if (CONTROL_IN_LINE.test(draft.title.trim())) add('title-not-one-line');
  const kind: string = draft.targetKind;
  if (!(AFTERCARE_TARGET_KINDS as readonly string[]).includes(kind)) add('invalid-target-kind');
  else if (describeAftercareTarget(snapshot, draft.targetKind, draft.targetId).detached) {
    add('unknown-target');
  }
}

/**
 * Check a warranty before it is added or written whole: when written whole, a warranty of the work;
 * a title (1–200 characters, one line); a target of the plan (the work, a room or a stage); who
 * gives it, at most 120 characters, one line (blank is none); a start day; 1 to 600 whole months; a
 * document, when named, of the work and filed as a warranty; a note of at most 1 000. Every problem,
 * in that order; `[]` when none. Never throws.
 */
export function validateWarrantyDraft(
  snapshot: WorkSnapshot,
  draft: WarrantyDraft,
): AftercareProblem[] {
  const problems: AftercareProblem[] = [];
  const add = (code: AftercareProblemCode) => problems.push(problem(code));
  const id = draft.id ?? null;
  if (id !== null && !snapshot.warranties.some((each) => each.id === id)) add('unknown-warranty');
  titleAndTarget(snapshot, draft, add);
  if (draft.givenBy !== null && draft.givenBy.trim() !== '') {
    if (length(draft.givenBy) > AFTERCARE_LIMITS.givenBy) add('given-by-too-long');
    else if (CONTROL_IN_LINE.test(draft.givenBy.trim())) add('given-by-not-one-line');
  }
  if (!isIsoDay(draft.startsOn)) add('invalid-starts-on');
  if (!wholeIn(draft.months, AFTERCARE_LIMITS.months)) add('invalid-months');
  if (draft.documentId !== null) {
    const document = snapshot.documents.find((each) => each.id === draft.documentId);
    if (document === undefined) add('unknown-document');
    else if (document.kind !== 'warranty') add('document-not-warranty');
  }
  if (draft.note !== null && length(draft.note) > AFTERCARE_LIMITS.note) add('note-too-long');
  return problems;
}

/**
 * Check a maintenance task before it is added or written whole: when written whole, a task of the
 * work; a title (1–200, one line); a target of the plan; every 1 to 120 whole months; a first due
 * day; a note of at most 1 000. Every problem, in that order; `[]` when none. Never throws.
 */
export function validateMaintenanceDraft(
  snapshot: WorkSnapshot,
  draft: MaintenanceDraft,
): AftercareProblem[] {
  const problems: AftercareProblem[] = [];
  const add = (code: AftercareProblemCode) => problems.push(problem(code));
  const id = draft.id ?? null;
  if (id !== null && !snapshot.maintenance.some((each) => each.id === id)) add('unknown-task');
  titleAndTarget(snapshot, draft, add);
  if (!wholeIn(draft.everyMonths, AFTERCARE_LIMITS.everyMonths)) add('invalid-every-months');
  if (!isIsoDay(draft.firstDueOn)) add('invalid-first-due-on');
  if (draft.note !== null && length(draft.note) > AFTERCARE_LIMITS.note) add('note-too-long');
  return problems;
}

/**
 * Check a record done before it is appended: a task of the work; a day that is a day, not after
 * today and not before the task's last record (`done-out-of-order`); a note of at most 500
 * characters. Every problem; `[]` when none. Never throws.
 */
export function validateMaintenanceDone(
  snapshot: WorkSnapshot,
  draft: MaintenanceDoneDraft,
  today: string,
): AftercareProblem[] {
  const task = snapshot.maintenance.find((each) => each.id === draft.taskId);
  if (task === undefined) return [problem('unknown-task')];
  const problems: AftercareProblem[] = [];
  if (!isIsoDay(draft.doneOn)) problems.push(problem('invalid-done-on'));
  else {
    if (isIsoDay(today) && draft.doneOn > today) problems.push(problem('done-in-future'));
    const last = maintenanceStory(task).lastDoneOn;
    if (last !== null && draft.doneOn < last) problems.push(problem('done-out-of-order'));
  }
  if (draft.note !== null && length(draft.note) > AFTERCARE_LIMITS.doneNote) {
    problems.push(problem('done-note-too-long'));
  }
  return problems;
}

/**
 * Check a task's removal: a task of the work with nothing recorded done (it has a history
 * otherwise). `[]` when it may be removed. Never throws.
 */
export function validateMaintenanceRemoval(
  snapshot: WorkSnapshot,
  taskId: string,
): AftercareProblem[] {
  const task = snapshot.maintenance.find((each) => each.id === taskId);
  if (task === undefined) return [problem('unknown-task')];
  return task.done.length > 0 ? [problem('task-has-history')] : [];
}
