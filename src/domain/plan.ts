/**
 * The plan of a work, as the host hands it over, and the plain questions asked of it.
 *
 * The types mirror the host's contract (the `work_get` command, docs/DATA_MODEL.md) field for
 * field, in camelCase, so that the data layer passes a snapshot through unchanged.
 *
 * Where the activities fall on the calendar is not decided here: that is the schedule
 * (`schedule/`), which replaced slice F0's sequential placement in slice F2.
 *
 * What this module is not: storage, a scheduler or a judge of readiness. It performs no I/O.
 */

import { readCalendar, type WorkingCalendar } from './calendar';

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
  /** When the plan was first approved (baseline 1 taken); `null` until then. */
  readonly approvedAt: string | null;
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

/** A room or area of the work: the architect's and the owner's map of it. */
export interface Room {
  readonly id: string;
  /** Order among rooms. */
  readonly position: number;
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
  /** The rooms it touches, none or several. Order carries no meaning; the rooms' own does. */
  readonly roomIds: readonly string[];
  /** How much of it there is, in `unit`, zero or more; `null` when not given. Optional. */
  readonly quantity: number | null;
  /** What `quantity` is counted in, as the person writes it: `m²`, `m`, `un`. */
  readonly unit: string | null;
}

/**
 * Something a person has to choose before a stage can go ahead: which tile, where the outlets go.
 * It belongs to a stage and carries a lead time; its deadline is computed, never stored
 * (`decisions.ts`). It is made or it is not.
 */
export interface Decision {
  readonly id: string;
  readonly stageId: string;
  /** Order inside the stage. */
  readonly position: number;
  readonly name: string;
  /** Working days between deciding and having, zero or more. */
  readonly leadTimeDays: number;
  /** When it was made, UTC; `null` while it is open. */
  readonly madeAt: string | null;
  /** What was decided, as the person wrote it; only ever set on a made decision. */
  readonly answer: string | null;
}

/** One end of a dependency: an activity, or a stage standing for all its activities. */
export interface Endpoint {
  readonly kind: 'activity' | 'stage';
  readonly id: string;
}

/**
 * `blocker` must finish, and `lagDays` working days pass, before `blocked` may start.
 * Finish-to-start is the only kind in 1.0.
 */
export interface Dependency {
  readonly id: string;
  readonly blocker: Endpoint;
  readonly blocked: Endpoint;
  /** Working days of waiting, zero or more. Waiting, not work: nobody is on site for it. */
  readonly lagDays: number;
}

/** One activity as a baseline recorded it. */
export interface BaselineRow {
  readonly activityId: string;
  readonly name: string;
  readonly stageName: string;
  readonly durationDays: number | null;
  /** `YYYY-MM-DD`, or `null` when the schedule could not place it. */
  readonly start: string | null;
  readonly finish: string | null;
}

/** A photograph of the plan, taken when it was approved. Insert-only; never overwritten. */
export interface Baseline {
  readonly id: string;
  /** 1 for the approval, then 2, 3 … */
  readonly number: number;
  /** UTC, milliseconds, trailing `Z`. */
  readonly takenAt: string;
  /** Why the approved plan was changed; `null` for baseline 1 (and until slice F8 asks). */
  readonly reason: string | null;
  readonly finishDate: string | null;
  readonly rows: readonly BaselineRow[];
}

/** The whole plan of one work, as `work_get` returns it. */
export interface WorkSnapshot {
  readonly work: Work;
  readonly calendar: Calendar;
  readonly holidays: readonly Holiday[];
  readonly people: readonly Person[];
  readonly rooms: readonly Room[];
  readonly stages: readonly Stage[];
  readonly activities: readonly Activity[];
  readonly dependencies: readonly Dependency[];
  readonly baselines: readonly Baseline[];
  readonly decisions: readonly Decision[];
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

/** Rooms in the order the plan shows them: by position, then by id when positions tie. */
export function roomsInOrder(snapshot: WorkSnapshot): Room[] {
  return [...snapshot.rooms].sort((a, b) => a.position - b.position || compareText(a.id, b.id));
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

/**
 * Every decision in the order the plan shows it: stage by stage, by position inside each, then the
 * decisions whose stage is not in the plan, last, in their own position order.
 */
export function decisionsInOrder(snapshot: WorkSnapshot): Decision[] {
  const byPosition = (a: Decision, b: Decision) =>
    a.position - b.position || compareText(a.id, b.id);
  const stageIds = new Set(snapshot.stages.map((stage) => stage.id));
  const ordered = stagesInOrder(snapshot).flatMap((stage) => decisionsOf(snapshot, stage.id));
  const orphans = snapshot.decisions
    .filter((decision) => !stageIds.has(decision.stageId))
    .sort(byPosition);
  return [...ordered, ...orphans];
}

/** A stage's decisions, by position. */
export function decisionsOf(snapshot: WorkSnapshot, stageId: string): Decision[] {
  return snapshot.decisions
    .filter((decision) => decision.stageId === stageId)
    .sort((a, b) => a.position - b.position || compareText(a.id, b.id));
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

/** The latest baseline, by number, or `null` before the plan is approved. */
export function latestBaseline(snapshot: WorkSnapshot): Baseline | null {
  let latest: Baseline | null = null;
  for (const baseline of snapshot.baselines) {
    if (latest === null || baseline.number > latest.number) latest = baseline;
  }
  return latest;
}

/** Code-point order, the same on every machine whatever its locale. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
