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
  /**
   * Where the plan came from: the template's id, version and title (in the language the work was
   * started in), or `null` for a work started empty. Provenance, not a tie: nothing links back.
   */
  readonly templateId: string | null;
  readonly templateVersion: number | null;
  readonly templateTitle: string | null;
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
  /** What they do (tiler, electrician …), as the person wrote it; `null` until said. */
  readonly trade: string | null;
  /** As typed. Never dialled or checked by the product. */
  readonly phone: string | null;
  /** As typed. Nothing is ever sent to it: the product has no network. */
  readonly email: string | null;
  readonly note: string | null;
  /** When they can come, in their own words: "mornings only", "from October". */
  readonly availability: string | null;
  /** The stages they are expected on. Who was actually on site comes from the diary. */
  readonly stageIds: readonly string[];
}

/**
 * What a document is, as the person files it. `warranty` and `manual` (slice D3) are what the owner
 * keeps for the years after the work: the handover book lists them by name.
 */
export type DocumentKind =
  | 'photo'
  | 'quote'
  | 'drawing'
  | 'permit'
  | 'receipt'
  | 'contract'
  | 'warranty'
  | 'manual'
  | 'other';

/** What a document can be attached to. */
export type TargetKind =
  'work' | 'stage' | 'activity' | 'decision' | 'entry' | 'commitment' | 'payment';

/**
 * One attachment of a document. `targetId` is the row's id, or, for a diary entry and a payment,
 * its seq written as text; for the work, the work's id.
 */
export interface DocumentLink {
  readonly targetKind: TargetKind;
  readonly targetId: string;
}

/**
 * A file the work owns: copied into its folder by the host, typed by its bytes, named by its hash.
 * The domain never sees the bytes; it files, counts and describes.
 */
export interface Document {
  readonly id: string;
  readonly fileHash: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: number;
  /** For an image; `null` for a PDF. */
  readonly width: number | null;
  readonly height: number | null;
  readonly kind: DocumentKind;
  readonly title: string;
  /** `YYYY-MM-DD`. */
  readonly addedOn: string;
  readonly authorName: string;
  readonly createdAt: string;
  readonly links: readonly DocumentLink[];
}

/**
 * Money planned: a cost line on a stage, or on one of its activities. Amounts are whole numbers
 * of the currency's minor unit (cents): money is never a float.
 */
export interface CostLine {
  readonly id: string;
  readonly stageId: string;
  /** The activity it belongs to, or `null` for a line on the stage itself. */
  readonly activityId: string | null;
  readonly label: string;
  /** `null`: not priced yet (a line from a template is a label until somebody prices it). */
  readonly amountCents: number | null;
}

/**
 * The fact of the work a milestone is earned by (slice D2): never a date, never a tick. `advance`:
 * the day the commitment was agreed (a "sinal", paid before any work); `stage_started`: the stage's
 * start gate passed; `activity_finished`: an effective diary entry finished the activity;
 * `stage_closed`: the close gate passed (a reopened stage un-earns it).
 */
export type MilestoneTrigger = 'advance' | 'stage_started' | 'activity_finished' | 'stage_closed';

/**
 * One step of a commitment's payment plan (slice D2): a share of the commitment's amount, earned by
 * a fact of the work. The shares of a commitment sum to at most 10 000 basis points (100 %).
 */
export interface Milestone {
  readonly id: string;
  /** Order inside the commitment's plan. */
  readonly position: number;
  readonly label: string;
  /** Basis points of the commitment's amount, 1 to 10 000: "30 %" is 3 000. */
  readonly shareBp: number;
  readonly trigger: MilestoneTrigger;
  /** The activity whose finish earns it: set exactly when `trigger` is `activity_finished`. */
  readonly activityId: string | null;
}

/** Money committed: a quote or contract accepted, for a stage, usually with one trade. */
export interface Commitment {
  readonly id: string;
  readonly stageId: string;
  /** The contractor or trade it is with; `null` when not said. */
  readonly personId: string | null;
  readonly label: string;
  readonly amountCents: number;
  /** `YYYY-MM-DD`. */
  readonly agreedOn: string;
  readonly documentHash: string | null;
  /**
   * Its payment plan, in position order (slice D2); empty when it has none, which is "no payment
   * plan", never "nothing earned".
   */
  readonly milestones: readonly Milestone[];
}

/**
 * Money paid: one row of the payments ledger. A fact: never edited. A mistake is a new payment
 * that reverses it (`reversesSeq`), the only kind of payment whose amount is negative.
 */
export interface Payment {
  readonly id: string;
  /** 1, 2, 3 …: the order payments were recorded in. */
  readonly seq: number;
  /** `YYYY-MM-DD`, never in the future. */
  readonly day: string;
  readonly personId: string | null;
  readonly stageId: string;
  readonly commitmentId: string | null;
  /** Above zero; below zero only for a reversal. */
  readonly amountCents: number;
  readonly whatFor: string;
  readonly receiptHash: string | null;
  /** The seq of the payment this one reverses; `null` for an ordinary payment. */
  readonly reversesSeq: number | null;
  readonly authorName: string;
  readonly createdAt: string;
}

export interface Stage {
  readonly id: string;
  /** Order among stages. */
  readonly position: number;
  readonly name: string;
  /**
   * When the person started it, its start gate passed; `null` while planned. Intent, not progress:
   * progress comes from the diary. Never cleared once set.
   */
  readonly startedAt: string | null;
  /** When the person closed it, its close gate passed; `null` while open (or reopened). */
  readonly closedAt: string | null;
}

/** The two moments a stage must answer for: before it starts, and before it closes. */
export type Gate = 'start' | 'close';

/** A yes-or-no question a stage must answer at one gate. */
export interface Check {
  readonly id: string;
  readonly stageId: string;
  readonly gate: Gate;
  /** Order inside its stage and gate. */
  readonly position: number;
  readonly name: string;
  /**
   * Hidden work (slice D3): a `yes` needs its photo, taken before the work is covered — the pipes
   * before the wall is closed. The host refuses a `yes` without one; `no` and `na` need none.
   */
  readonly needsPhoto: boolean;
}

/** `na` is "not applicable", and always carries its reason. */
export type Answer = 'yes' | 'no' | 'na';

/** One answer to a check: a fact, appended, never changed. The latest answer counts. */
export interface CheckAnswer {
  readonly id: string;
  readonly checkId: string;
  /** 1, 2, 3 … per check: the order it was answered in. */
  readonly seq: number;
  readonly answer: Answer;
  /** Required for `na`; optional otherwise. */
  readonly reason: string | null;
  /** The photo that goes with it (the inspection), by the hash of the copy the work owns. */
  readonly photoHash: string | null;
  readonly authorName: string;
  readonly answeredAt: string;
}

export interface Activity {
  readonly id: string;
  readonly stageId: string;
  /** Order inside the stage. */
  readonly position: number;
  readonly name: string;
  /** Working days; `null` until known. */
  readonly durationDays: number | null;
  /**
   * The range of working days a template gave it, both or neither, `min ≤ max`; `null` when it came
   * from no template. Shown until a person picks a duration; never a duration itself.
   */
  readonly durationMinDays: number | null;
  readonly durationMaxDays: number | null;
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
  /**
   * The range of lead time a template gave it, both or neither; `leadTimeDays` took its upper end
   * (the earlier deadline). `null` when it came from no template.
   */
  readonly leadMinDays: number | null;
  readonly leadMaxDays: number | null;
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
  /**
   * The money planned on the activity then (its cost lines, in cents); `null` when the baseline did
   * not record money (taken before slice F8): "not recorded", never 0.
   */
  readonly plannedCents: number | null;
}

/** One stage as a baseline recorded it. A stage renamed later is the same stage: same `stageId`. */
export interface BaselineStage {
  readonly stageId: string;
  readonly position: number;
  readonly name: string;
  /** The money planned on the stage then, in cents; `null` when not recorded. */
  readonly plannedCents: number | null;
}

/** A photograph of the plan, taken when it was approved. Insert-only; never overwritten. */
export interface Baseline {
  readonly id: string;
  /** 1 for the approval, then 2, 3 … */
  readonly number: number;
  /** UTC, milliseconds, trailing `Z`. */
  readonly takenAt: string;
  /**
   * Why the approved plan was changed: the reason of the replanning the baseline closed. `null` for
   * baseline 1, the approval itself.
   */
  readonly reason: string | null;
  readonly finishDate: string | null;
  /**
   * The work's planned total then (every cost line, in cents); `null` when the baseline did not
   * record money (taken before slice F8): "not recorded", never 0.
   */
  readonly plannedCents: number | null;
  readonly stages: readonly BaselineStage[];
  readonly rows: readonly BaselineRow[];
}

/**
 * A replanning: somebody said why an approved plan must change. While one is open the plan may be
 * edited; it is closed only by taking the next baseline, which records its reason. A row, not a mode
 * of the interface: it survives a restart. At most one is open.
 */
export interface Replanning {
  readonly id: string;
  /** Why the plan changes, as the person wrote it; never blank. */
  readonly reason: string;
  /** UTC, milliseconds, trailing `Z`. */
  readonly openedAt: string;
  readonly authorName: string;
}

/** What a care note is about: the whole work, one room, or one stage. */
export type CareTargetKind = 'work' | 'room' | 'stage';

/** The same type under the name the care-note commands use. */
export type CareNoteTargetKind = CareTargetKind;

/**
 * What the owner must know to look after the work once it is done (slice D3): "Reseal the shower
 * grout once a year", "The stopcock is under the sink". Not the plan: editable any time, never
 * locked by approval; removed by the host with the room or stage it names.
 */
export interface CareNote {
  readonly id: string;
  readonly targetKind: CareTargetKind;
  /** The room's or the stage's id; for the work, the work's id. */
  readonly targetId: string;
  /** Order among the notes of one target. */
  readonly position: number;
  /** At most 1 000 characters, as the person wrote it. */
  readonly text: string;
  /** UTC, milliseconds, trailing `Z`. */
  readonly createdAt: string;
}

/** Who asked for a change: the owner, a person of the plan, or somebody named on the record. */
export type ChangeAskedBy = 'owner' | 'person' | 'other';

/**
 * What a change does to the plan (slice E1), as data the schedule can compute: an activity added to
 * the change's stage, finish-to-start after `after` (or after nothing); an existing activity's
 * duration; an activity dropped. Durations are whole working days, 1 to 3 650.
 */
export type ChangeEffect =
  | {
      readonly kind: 'add';
      readonly name: string;
      readonly durationDays: number;
      readonly after: string | null;
    }
  | { readonly kind: 'duration'; readonly activityId: string; readonly durationDays: number }
  | { readonly kind: 'remove'; readonly activityId: string };

/** How a change order was decided. Once, for good. */
export type ChangeOrderOutcome = 'approved' | 'declined' | 'withdrawn';

/**
 * The decision on a change order: insert-only, one per change. The impact is **frozen** here as it
 * was computed the moment it was decided (the plan may move later for other reasons).
 */
export interface ChangeOrderDecision {
  readonly outcome: ChangeOrderOutcome;
  /** `YYYY-MM-DD`. */
  readonly decidedOn: string;
  readonly note: string | null;
  /** The finish before the change, and with it, as the schedule said that day. */
  readonly finishBefore: string | null;
  readonly finishAfter: string | null;
  /** Working days the change moved the finish, signed; `null` when it could not be counted. */
  readonly daysDelta: number | null;
  /** The change's money, copied from it; `null` when it was not priced. */
  readonly costCents: number | null;
  /** The replanning the approval opened or joined; `null` unless approved. */
  readonly replanningId: string | null;
  readonly authorName: string;
  /** UTC, milliseconds, trailing `Z`. */
  readonly createdAt: string;
}

/**
 * A change order (slice E1, pt "aditivo"): somebody asked for the work to change, on the record, with
 * a price and the effects the schedule computes. Insert-only: a mistake is withdrawn and raised again.
 */
export interface ChangeOrder {
  readonly id: string;
  /** 1, 2, 3 …: the order changes were raised in. */
  readonly number: number;
  /** `YYYY-MM-DD`. */
  readonly raisedOn: string;
  readonly title: string;
  readonly description: string | null;
  readonly askedBy: ChangeAskedBy;
  /** Set exactly when `askedBy` is `person`; not a tie: a person removed leaves the record. */
  readonly askedByPersonId: string | null;
  /** Set exactly when `askedBy` is `other`. */
  readonly askedByName: string | null;
  /** The stage it lands in. */
  readonly stageId: string;
  /** Signed (a change can save money); `null` when not priced. */
  readonly costCents: number | null;
  readonly effects: readonly ChangeEffect[];
  readonly authorName: string;
  /** UTC, milliseconds, trailing `Z`. */
  readonly createdAt: string;
  /** `null` while it waits for a decision. */
  readonly decision: ChangeOrderDecision | null;
}

/**
 * Money the work expects to receive (slice E2, pt "recursos"): savings on hand, a loan's tranche, a
 * client's instalment — from where, how much and on what day. Plan, not fact: editable like a
 * commitment and never locked by approval (funding is not the plan's scope); the host removes one
 * only while no receipt names it.
 */
export interface Funding {
  readonly id: string;
  /** Order among the funding rows. */
  readonly position: number;
  /** 1 to 200 characters, as the person wrote it. */
  readonly label: string;
  /** Where it comes from ("the bank", "my savings"), at most 200 characters; `null` when not said. */
  readonly source: string | null;
  /** Above zero, whole cents. */
  readonly amountCents: number;
  /** `YYYY-MM-DD`: the day it is expected. */
  readonly expectedOn: string;
  readonly note: string | null;
}

/**
 * Money received: one row of the receipts ledger (slice E2), append-only exactly as the payments
 * ledger is. A fact: never edited; a mistake is a new receipt that reverses it, the only kind whose
 * amount is negative.
 */
export interface FundingReceipt {
  /** 1, 2, 3 …: the order receipts were recorded in. */
  readonly seq: number;
  /** The funding row it was expected as; `null` for money that arrived unplanned. */
  readonly fundingId: string | null;
  /** Above zero; below zero only for a reversal. */
  readonly amountCents: number;
  /** `YYYY-MM-DD`, never in the future. */
  readonly day: string;
  readonly note: string | null;
  /** The seq of the receipt this one reverses; `null` for an ordinary receipt. */
  readonly reversesSeq: number | null;
  readonly authorName: string;
  /** UTC, milliseconds, trailing `Z`. */
  readonly createdAt: string;
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
  /** The open replanning, or `null` when none is open. */
  readonly replanning: Replanning | null;
  readonly decisions: readonly Decision[];
  readonly checks: readonly Check[];
  readonly checkAnswers: readonly CheckAnswer[];
  readonly costLines: readonly CostLine[];
  readonly commitments: readonly Commitment[];
  readonly payments: readonly Payment[];
  readonly documents: readonly Document[];
  /** Every care note of the work, any target (slice D3). */
  readonly careNotes: readonly CareNote[];
  /** Every change order of the work, each with its decision or `null` (slice E1). */
  readonly changeOrders: readonly ChangeOrder[];
  /** Every funding row of the work, by position (slice E2). */
  readonly funding: readonly Funding[];
  /** The receipts ledger, by seq, reversals included (slice E2). */
  readonly fundingReceipts: readonly FundingReceipt[];
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

/**
 * Does this activity have a responsible: a person who is in the plan? A responsible that names
 * nobody in the plan is not a responsible. Readiness and the plan's questions (slice F11) both ask
 * this one question, so they can never disagree about it.
 */
export function hasResponsible(activity: Activity, snapshot: WorkSnapshot): boolean {
  return (
    activity.responsibleId !== null &&
    snapshot.people.some((person) => person.id === activity.responsibleId)
  );
}

/**
 * The range of working days an activity carries from its template, or `null` when it has none (or
 * one that is not a whole-number range from 1 with `min ≤ max`, which the host never stores).
 */
export function durationRangeOf(activity: Activity): { min: number; max: number } | null {
  const min = activity.durationMinDays;
  const max = activity.durationMaxDays;
  if (min === null || max === null) return null;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || min > max) return null;
  return { min, max };
}

/**
 * Is this cost line priced? A `null` amount is not priced yet (a line from a template); any number,
 * 0 included, is a price. Every line before slice F9 is priced.
 */
export function isPriced(line: CostLine): line is CostLine & { readonly amountCents: number } {
  return line.amountCents !== null;
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

/** The care notes of one target (the work, a room or a stage), by position, then by id. */
export function careNotesOf(
  snapshot: WorkSnapshot,
  targetKind: CareTargetKind,
  targetId: string,
): CareNote[] {
  return snapshot.careNotes
    .filter((note) => note.targetKind === targetKind && note.targetId === targetId)
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

/**
 * Is the plan locked: approved, with no replanning open? Then every edit to what a baseline records
 * (stages, activities, durations, links, the calendar, the start date, the cost lines) is refused by
 * the host until somebody says why the plan changes. Facts (the diary, answers, payments …) are never
 * locked. The interface asks this to offer the way out; the refusal itself is the host's.
 */
export function isLocked(snapshot: WorkSnapshot): boolean {
  return snapshot.work.approvedAt !== null && snapshot.replanning === null;
}

/** Code-point order, the same on every machine whatever its locale. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
