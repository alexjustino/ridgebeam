/**
 * What to order this week (slice G2, decision 2, pt "compras"): the materials an activity needs that
 * take time to arrive — a worktop, the windows, the tiles — each with how long the supplier takes.
 *
 * **The day to order by is computed, never stored.** A purchase is needed on the day the activity
 * that needs it starts **as things stand**: E3's `forecast` (the diary against the plan), so the day
 * moves when the work slips or gets ahead; the plan's own schedule when there is no forecast. A
 * purchase on a stage (no activity named, or one no longer in the plan) is needed by the stage's
 * **first activity**: the one the dates start first, in plan order when two start together — the
 * same reading as a decision's "stage's first start" (`stageStart`). Then:
 *
 * - `orderBy` = `neededOn` − `leadDays` **calendar** days (suppliers quote calendar days; their
 *   working weeks are not modelled);
 * - `expectedOn` = the day it was ordered + `leadDays` calendar days.
 *
 * **Its state is read from its events**, in seq order: `to-order` until it is `ordered`, then
 * `delivered`; an order that fell through (`cancelled`) puts it back to `to-order`. An event the
 * host's rules would refuse (it never stores one) is passed over, so a broken record never reads as
 * something it is not.
 *
 * **The flags**, as of `today`:
 *
 * - `lateToOrder` — to order, and the order-by day has passed (`orderBy < today`);
 * - `orderThisWeek` — to order, and the order-by day is in the current Monday–Sunday week or has
 *   passed (late is always this week's business): `orderBy ≤ Sunday`;
 * - `lateToArrive` — ordered, and the expected day has passed (`expectedOn < today`);
 * - `arrivesAfterNeeded` — ordered, and it is expected after the day it is needed: the order will
 *   make the activity wait.
 *
 * **What is done is not flagged**: a purchase whose activity the diary says is finished, or whose
 * stage is closed (as the lookahead reads "done"), carries no flag — the work went on without it.
 *
 * **Readiness is left alone.** A purchase late to order is an execution fact, not something the
 * plan does not know; readiness measures what the plan knows (ADR, slice G2).
 *
 * The forecast is computed only when the work has a purchase: a work without any pays nothing.
 *
 * What this module is not: storage, text or a clock. `today` is an input. No I/O. It never orders
 * anything: it says when.
 */

import { addCalendarDays, calendarDaysBetween, isIsoDay } from './calendar';
import { stageState } from './checks';
import { weekOf } from './dashboard';
import type { DiaryEntry, ProgressState } from './diary';
import { counted, type Figure, type ReportRow } from './figure';
import {
  compareText,
  type Purchase,
  type PurchaseEvent,
  type PurchaseEventKind,
  type WorkSnapshot,
} from './plan';
import type { Schedule, ScheduledDates } from './schedule';
import { forecast } from './schedule/forecast';

export type { Purchase, PurchaseEvent, PurchaseEventKind } from './plan';

// ── Limits and words ─────────────────────────────────────────────────────────

/** What the host accepts: characters (code points, as the host counts them) and calendar days. */
export const PURCHASE_LIMITS = {
  name: 200,
  quantity: 60,
  supplier: 120,
  note: 2_000,
  eventNote: 500,
  /** The longest lead time, in calendar days; the shortest is 0. */
  leadDays: 365,
} as const;

/** Where a purchase stands, read from its events. */
export type PurchaseState = 'to-order' | 'ordered' | 'delivered';

export const PURCHASE_STATES = [
  'to-order',
  'ordered',
  'delivered',
] as const satisfies readonly PurchaseState[];

export const PURCHASE_EVENT_KINDS = [
  'ordered',
  'delivered',
  'cancelled',
] as const satisfies readonly PurchaseEventKind[];

/** How each state is said on a row: "To order", "Ordered", "Delivered". */
export const PURCHASE_STATE_KEYS = {
  'to-order': 'purchases.state.toOrder',
  ordered: 'purchases.state.ordered',
  delivered: 'purchases.state.delivered',
} as const satisfies Record<PurchaseState, string>;

/** How each event is said in the story: "Ordered", "Delivered", "The order fell through". */
export const PURCHASE_EVENT_KEYS = {
  ordered: 'purchases.event.ordered',
  delivered: 'purchases.event.delivered',
  cancelled: 'purchases.event.cancelled',
} as const satisfies Record<PurchaseEventKind, string>;

/** The flags: what a row says is wrong, or due, with it. */
export type PurchaseFlag = 'lateToOrder' | 'orderThisWeek' | 'lateToArrive' | 'arrivesAfterNeeded';

/**
 * How each flag is said on a row: "Late to order", "Order this week", "Late to arrive", "Arrives
 * after it is needed".
 */
export const PURCHASE_FLAG_KEYS = {
  lateToOrder: 'purchases.flag.lateToOrder',
  orderThisWeek: 'purchases.flag.orderThisWeek',
  lateToArrive: 'purchases.flag.lateToArrive',
  arrivesAfterNeeded: 'purchases.flag.arrivesAfterNeeded',
} as const satisfies Record<PurchaseFlag, string>;

/**
 * The figures' names: "To order this week", "Late to order", "Ordered, late to arrive", "Arrives
 * after it is needed".
 */
export const PURCHASE_LABEL_KEYS = {
  toOrderThisWeek: 'purchases.figure.toOrderThisWeek',
  lateToOrder: 'purchases.figure.lateToOrder',
  lateToArrive: 'purchases.figure.lateToArrive',
  arrivesAfterNeeded: 'purchases.figure.arrivesAfterNeeded',
} as const;

/** Why a purchase, or one of its events, is refused before the host is asked. */
export const PURCHASE_PROBLEM_KEYS = {
  'unknown-purchase': 'purchases.problem.unknownPurchase',
  'frozen-after-order': 'purchases.problem.frozenAfterOrder',
  'name-empty': 'purchases.problem.nameEmpty',
  'name-too-long': 'purchases.problem.nameTooLong',
  'name-not-one-line': 'purchases.problem.nameNotOneLine',
  'quantity-too-long': 'purchases.problem.quantityTooLong',
  'quantity-not-one-line': 'purchases.problem.quantityNotOneLine',
  'supplier-too-long': 'purchases.problem.supplierTooLong',
  'supplier-not-one-line': 'purchases.problem.supplierNotOneLine',
  'invalid-lead-days': 'purchases.problem.invalidLeadDays',
  'note-too-long': 'purchases.problem.noteTooLong',
  'unknown-stage': 'purchases.problem.unknownStage',
  'unknown-activity': 'purchases.problem.unknownActivity',
  'activity-of-another-stage': 'purchases.problem.activityOfAnotherStage',
  'invalid-kind': 'purchases.problem.invalidKind',
  'invalid-day': 'purchases.problem.invalidDay',
  'day-in-future': 'purchases.problem.dayInFuture',
  'day-before-last-event': 'purchases.problem.dayBeforeLastEvent',
  'already-ordered': 'purchases.problem.alreadyOrdered',
  'not-ordered': 'purchases.problem.notOrdered',
  'already-delivered': 'purchases.problem.alreadyDelivered',
  'event-note-too-long': 'purchases.problem.eventNoteTooLong',
} as const;

export type PurchaseProblemCode = keyof typeof PURCHASE_PROBLEM_KEYS;

/** A refusal, with the key the interface says it with. */
export interface PurchaseProblem {
  readonly code: PurchaseProblemCode;
  readonly messageKey: (typeof PURCHASE_PROBLEM_KEYS)[PurchaseProblemCode];
}

/** Every message key this module adds, for the dictionaries' completeness test. */
export const PURCHASE_MESSAGE_KEYS: readonly string[] = [
  ...Object.values(PURCHASE_STATE_KEYS),
  ...Object.values(PURCHASE_EVENT_KEYS),
  ...Object.values(PURCHASE_FLAG_KEYS),
  ...Object.values(PURCHASE_LABEL_KEYS),
  ...Object.values(PURCHASE_PROBLEM_KEYS),
];

// ── The record, read ─────────────────────────────────────────────────────────

/** The purchases by position, then by id. */
export function purchasesInOrder(snapshot: WorkSnapshot): Purchase[] {
  return [...snapshot.purchases].sort((a, b) => a.position - b.position || compareText(a.id, b.id));
}

/** A purchase's story, read: where it stands and on which days. */
export interface PurchaseStory {
  readonly state: PurchaseState;
  /** The day of the open (or delivered) order; `null` while to order. */
  readonly orderedOn: string | null;
  readonly deliveredOn: string | null;
  /** How many orders fell through. */
  readonly fellThrough: number;
  /** The day the last order fell through; `null` when none did. */
  readonly lastFellThroughOn: string | null;
  /** The last event that counted; `null` before any. */
  readonly last: PurchaseEvent | null;
}

/** May an event of `kind` follow a purchase standing at `state`? The host's order of things. */
function follows(state: PurchaseState, kind: PurchaseEventKind): boolean {
  if (kind === 'ordered') return state === 'to-order';
  return state === 'ordered';
}

/**
 * Where a purchase stands, from its events in seq order: to order, ordered, delivered; an order
 * that fell through puts it back to order. An event that could not follow (the host never stores
 * one) is passed over.
 */
export function purchaseStory(purchase: Purchase): PurchaseStory {
  let state: PurchaseState = 'to-order';
  let orderedOn: string | null = null;
  let deliveredOn: string | null = null;
  let fellThrough = 0;
  let lastFellThroughOn: string | null = null;
  let last: PurchaseEvent | null = null;
  for (const event of [...purchase.events].sort((a, b) => a.seq - b.seq)) {
    if (!follows(state, event.kind)) continue;
    last = event;
    if (event.kind === 'ordered') {
      state = 'ordered';
      orderedOn = event.day;
    } else if (event.kind === 'delivered') {
      state = 'delivered';
      deliveredOn = event.day;
    } else {
      state = 'to-order';
      orderedOn = null;
      fellThrough += 1;
      lastFellThroughOn = event.day;
    }
  }
  return { state, orderedOn, deliveredOn, fellThrough, lastFellThroughOn, last };
}

/** Can the purchase be removed: no event names it. The refusal itself is the host's. */
export function purchaseRemovable(snapshot: WorkSnapshot, purchaseId: string): boolean {
  const purchase = snapshot.purchases.find((each) => each.id === purchaseId);
  return purchase !== undefined && purchase.events.length === 0;
}

// ── The rule ─────────────────────────────────────────────────────────────────

/** Where the day it is needed came from. */
export type NeededFrom = 'forecast' | 'plan';

/** One purchase as the list, the Dashboard, the lookahead, the agenda and the reports read it. */
export interface PurchaseRow extends ReportRow {
  readonly purchaseId: string;
  readonly position: number;
  readonly name: string;
  readonly stageId: string;
  /** `null` when its stage is not in the plan. */
  readonly stageName: string | null;
  /** The activity it names, as stored; `null` for the stage's first. */
  readonly activityId: string | null;
  /**
   * The activity that needs it: the one named, or, when none is named (or the one named is no
   * longer in the plan), the stage's first; `null` when the stage has none the dates place.
   */
  readonly neededActivityId: string | null;
  readonly neededActivityName: string | null;
  readonly quantity: string | null;
  readonly supplier: string | null;
  readonly leadDays: number;
  readonly note: string | null;
  readonly state: PurchaseState;
  readonly orderedOn: string | null;
  readonly deliveredOn: string | null;
  /** How many orders fell through; the last one's day. */
  readonly fellThrough: number;
  readonly lastFellThroughOn: string | null;
  /** The first day of the activity that needs it, as things stand; `null` when not placed. */
  readonly neededOn: string | null;
  /** Whether `neededOn` is the forecast's, or the plan's (no forecast); `null` with no `neededOn`. */
  readonly neededFrom: NeededFrom | null;
  /** `neededOn` − `leadDays` calendar days; `null` without `neededOn`. */
  readonly orderBy: string | null;
  /** The order's day + `leadDays` calendar days; `null` while to order. */
  readonly expectedOn: string | null;
  /** The activity that needs it is finished, or its stage closed: nothing is flagged. */
  readonly done: boolean;
  readonly lateToOrder: boolean;
  readonly orderThisWeek: boolean;
  readonly lateToArrive: boolean;
  readonly arrivesAfterNeeded: boolean;
  /**
   * Calendar days late, from 1: past the order-by day while late to order, past the expected day
   * while late to arrive; `null` otherwise.
   */
  readonly daysLate: number | null;
  /** Calendar days it is expected after the day it is needed, from 1, while it arrives after it. */
  readonly daysAfterNeeded: number | null;
}

/** The first activity of a stage on the dates: the earliest start, plan order on a tie. */
function firstOfStage(
  scheduled: Schedule,
  dates: ReadonlyMap<string, ScheduledDates>,
  stageId: string,
): string | null {
  let first: { id: string; start: string } | null = null;
  for (const activity of scheduled.activities) {
    if (activity.stageId !== stageId) continue;
    const start = dates.get(activity.id)?.start;
    if (start !== undefined && (first === null || start < first.start)) {
      first = { id: activity.id, start };
    }
  }
  return first?.id ?? null;
}

const validLead = (days: number): boolean =>
  Number.isInteger(days) && days >= 0 && days <= PURCHASE_LIMITS.leadDays;

/**
 * Every purchase of the work, by position, as of `today`: its state from its events, the day it is
 * needed (the forecast's start of the activity that needs it, the plan's when there is no
 * forecast), the day to order by, the day it is expected, and its flags. A `today` that is not a day
 * flags nothing and reads the plan. Never throws.
 */
export function purchaseRows(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  entries: readonly DiaryEntry[],
  today: string,
): PurchaseRow[] {
  if (snapshot.purchases.length === 0) return [];
  const todayKnown = isIsoDay(today);
  const asThingsStand = todayKnown ? forecast(snapshot, scheduled, entries, today) : null;
  const fromForecast = asThingsStand !== null && asThingsStand.problem === null;
  const dates: ReadonlyMap<string, ScheduledDates> = fromForecast
    ? asThingsStand.dates
    : scheduled.dates;
  const states = asThingsStand?.progress;
  const stateOf = (id: string): ProgressState => states?.get(id)?.state ?? 'not-started';
  const week = todayKnown ? weekOf(today) : null;

  const stages = new Map(snapshot.stages.map((stage) => [stage.id, stage]));
  const activities = new Map(snapshot.activities.map((activity) => [activity.id, activity]));

  return purchasesInOrder(snapshot).map((purchase): PurchaseRow => {
    const stage = stages.get(purchase.stageId);
    const named = purchase.activityId === null ? undefined : activities.get(purchase.activityId);
    const neededActivityId =
      named !== undefined && named.stageId === purchase.stageId
        ? named.id
        : firstOfStage(scheduled, dates, purchase.stageId);
    const neededOn =
      neededActivityId === null ? null : (dates.get(neededActivityId)?.start ?? null);
    const lead = validLead(purchase.leadDays) ? purchase.leadDays : null;
    const story = purchaseStory(purchase);

    const orderBy = neededOn === null || lead === null ? null : addCalendarDays(neededOn, -lead);
    const expectedOn =
      story.orderedOn === null || lead === null || !isIsoDay(story.orderedOn)
        ? null
        : addCalendarDays(story.orderedOn, lead);

    const done =
      (stage !== undefined && stageState(stage) === 'closed') ||
      (neededActivityId !== null && stateOf(neededActivityId) === 'finished');
    const flagging = todayKnown && !done;
    let lateToOrder = false;
    let orderThisWeek = false;
    let lateToArrive = false;
    let arrivesAfterNeeded = false;
    let daysLate: number | null = null;
    let daysAfterNeeded: number | null = null;
    if (flagging && story.state === 'to-order' && orderBy !== null) {
      lateToOrder = orderBy < today;
      orderThisWeek = week !== null && orderBy <= week.to;
      if (lateToOrder) daysLate = calendarDaysBetween(orderBy, today);
    }
    if (flagging && story.state === 'ordered' && expectedOn !== null) {
      lateToArrive = expectedOn < today;
      arrivesAfterNeeded = neededOn !== null && expectedOn > neededOn;
      if (lateToArrive) daysLate = calendarDaysBetween(expectedOn, today);
      if (arrivesAfterNeeded) daysAfterNeeded = calendarDaysBetween(neededOn!, expectedOn);
    }

    const day =
      story.state === 'to-order'
        ? orderBy
        : story.state === 'ordered'
          ? expectedOn
          : story.deliveredOn;

    return {
      key: `purchase:${purchase.id}`,
      itemId: purchase.id,
      title: purchase.name,
      day,
      minutes: 0,
      purchaseId: purchase.id,
      position: purchase.position,
      name: purchase.name,
      stageId: purchase.stageId,
      stageName: stage?.name ?? null,
      activityId: purchase.activityId,
      neededActivityId,
      neededActivityName:
        neededActivityId === null ? null : (activities.get(neededActivityId)?.name ?? null),
      quantity: purchase.quantity,
      supplier: purchase.supplier,
      leadDays: purchase.leadDays,
      note: purchase.note,
      state: story.state,
      orderedOn: story.orderedOn,
      deliveredOn: story.deliveredOn,
      fellThrough: story.fellThrough,
      lastFellThroughOn: story.lastFellThroughOn,
      neededOn,
      neededFrom: neededOn === null ? null : fromForecast ? 'forecast' : 'plan',
      orderBy,
      expectedOn,
      done,
      lateToOrder,
      orderThisWeek,
      lateToArrive,
      arrivesAfterNeeded,
      daysLate,
      daysAfterNeeded,
    };
  });
}

/**
 * The flags a row says, in `PURCHASE_FLAG_KEYS` order. A purchase late to order is also to order
 * this week — the figure counts it there — but the row says it once: "Late to order" already says
 * when.
 */
export function purchaseFlags(row: PurchaseRow): PurchaseFlag[] {
  return (Object.keys(PURCHASE_FLAG_KEYS) as PurchaseFlag[]).filter(
    (flag) => row[flag] && !(flag === 'orderThisWeek' && row.lateToOrder),
  );
}

// ── The figures ──────────────────────────────────────────────────────────────

export interface PurchaseFigures {
  /** How many purchases the work has: the Dashboard's card is hidden at 0. */
  readonly total: number;
  /** To order this week, the late ones included: the most urgent first (order-by day). */
  readonly toOrderThisWeek: Figure<PurchaseRow>;
  /** To order, the order-by day passed: the most days late first. */
  readonly lateToOrder: Figure<PurchaseRow>;
  /** Ordered, the expected day passed: the most days late first. */
  readonly lateToArrive: Figure<PurchaseRow>;
  /** Ordered, expected after it is needed: the soonest needed first. */
  readonly arrivesAfterNeeded: Figure<PurchaseRow>;
}

const byDay =
  (pick: (row: PurchaseRow) => string | null) =>
  (a: PurchaseRow, b: PurchaseRow): number =>
    compareText(pick(a) ?? '', pick(b) ?? '') || a.position - b.position;

/** The figures of the rows `purchaseRows` gives: each one's rows are exactly what it counts. */
export function purchaseFiguresOf(rows: readonly PurchaseRow[]): PurchaseFigures {
  return {
    total: rows.length,
    toOrderThisWeek: counted(
      'purchases:week',
      PURCHASE_LABEL_KEYS.toOrderThisWeek,
      rows.filter((row) => row.orderThisWeek).sort(byDay((row) => row.orderBy)),
    ),
    lateToOrder: counted(
      'purchases:late',
      PURCHASE_LABEL_KEYS.lateToOrder,
      rows.filter((row) => row.lateToOrder).sort(byDay((row) => row.orderBy)),
    ),
    lateToArrive: counted(
      'purchases:arriving-late',
      PURCHASE_LABEL_KEYS.lateToArrive,
      rows.filter((row) => row.lateToArrive).sort(byDay((row) => row.expectedOn)),
    ),
    arrivesAfterNeeded: counted(
      'purchases:after-needed',
      PURCHASE_LABEL_KEYS.arrivesAfterNeeded,
      rows.filter((row) => row.arrivesAfterNeeded).sort(byDay((row) => row.neededOn)),
    ),
  };
}

/** What to order this week, what is late to order and what is late to arrive, as of `today`. */
export function purchaseFigures(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  entries: readonly DiaryEntry[],
  today: string,
): PurchaseFigures {
  return purchaseFiguresOf(purchaseRows(snapshot, scheduled, entries, today));
}

// ── Checking before the host is asked ────────────────────────────────────────

/** A purchase as the interface asks the host to add it, or (with its `id`) to write it whole. */
export interface PurchaseDraft {
  /** The purchase written whole; absent or `null` for a new one. */
  readonly id?: string | null;
  readonly stageId: string;
  readonly activityId: string | null;
  readonly name: string;
  readonly quantity: string | null;
  readonly supplier: string | null;
  readonly leadDays: number;
  readonly note: string | null;
}

/** One event as the interface asks the host to record it. */
export interface PurchaseEventDraft {
  readonly purchaseId: string;
  readonly kind: PurchaseEventKind;
  readonly day: string;
  readonly note: string | null;
}

function problem(code: PurchaseProblemCode): PurchaseProblem {
  return { code, messageKey: PURCHASE_PROBLEM_KEYS[code] };
}

/** The host trims, and keeps an empty text as none; it counts code points. */
const length = (text: string): number => [...text.trim()].length;

/** A control character the host refuses: any, in a line; any but a line break or a tab, in a note. */
// eslint-disable-next-line no-control-regex
const CONTROL_IN_LINE = /[\u0000-\u001f\u007f-\u009f]/u;

/** An optional line: `null` or blank is none; otherwise at most `max`, one line. */
function lineProblem(
  value: string | null,
  max: number,
  tooLong: PurchaseProblemCode,
  notOneLine: PurchaseProblemCode,
): PurchaseProblemCode | null {
  if (value === null || value.trim() === '') return null;
  if (length(value) > max) return tooLong;
  return CONTROL_IN_LINE.test(value.trim()) ? notOneLine : null;
}

/**
 * Check a purchase before it is added or written whole: when written whole, a purchase of the work,
 * whose lead time, stage and activity no longer change once anything has happened to it (an event
 * names it: the order was placed on those terms — its name, quantity, supplier and note stay
 * editable); a name (1–200 characters, one line); a quantity of at most 60 and a supplier of at most 120, one
 * line each (blank is none); a lead time of 0 to 365 whole calendar days; a note of at most 2 000; a
 * stage of the plan; an activity, when named, of the plan and of that stage. Every problem, in that
 * order; `[]` when none. Never throws.
 */
export function validatePurchaseDraft(
  snapshot: WorkSnapshot,
  draft: PurchaseDraft,
): PurchaseProblem[] {
  const problems: PurchaseProblem[] = [];
  const add = (code: PurchaseProblemCode | null) => {
    if (code !== null) problems.push(problem(code));
  };
  const id = draft.id ?? null;
  if (id !== null) {
    const stored = snapshot.purchases.find((each) => each.id === id);
    if (stored === undefined) add('unknown-purchase');
    else if (
      stored.events.length > 0 &&
      (draft.leadDays !== stored.leadDays ||
        draft.stageId !== stored.stageId ||
        draft.activityId !== stored.activityId)
    ) {
      add('frozen-after-order');
    }
  }
  if (draft.name.trim() === '') add('name-empty');
  else add(lineProblem(draft.name, PURCHASE_LIMITS.name, 'name-too-long', 'name-not-one-line'));
  add(
    lineProblem(
      draft.quantity,
      PURCHASE_LIMITS.quantity,
      'quantity-too-long',
      'quantity-not-one-line',
    ),
  );
  add(
    lineProblem(
      draft.supplier,
      PURCHASE_LIMITS.supplier,
      'supplier-too-long',
      'supplier-not-one-line',
    ),
  );
  if (!validLead(draft.leadDays)) add('invalid-lead-days');
  if (draft.note !== null && length(draft.note) > PURCHASE_LIMITS.note) add('note-too-long');
  if (!snapshot.stages.some((stage) => stage.id === draft.stageId)) add('unknown-stage');
  if (draft.activityId !== null) {
    const activity = snapshot.activities.find((each) => each.id === draft.activityId);
    if (activity === undefined) add('unknown-activity');
    else if (activity.stageId !== draft.stageId) add('activity-of-another-stage');
  }
  return problems;
}

/**
 * Check an event before it is recorded: a purchase of the work; `ordered`, `delivered` or
 * `cancelled`, in the order things can happen — `ordered` only while it is to order (first, or after
 * an order fell through), `delivered` and `cancelled` only on an open order, nothing after
 * `delivered`; a day that is a day, not after today and not before the event it follows; a note of
 * at most 500 characters. Every problem; `[]` when none. Never throws.
 */
export function validatePurchaseEvent(
  snapshot: WorkSnapshot,
  draft: PurchaseEventDraft,
  today: string,
): PurchaseProblem[] {
  const purchase = snapshot.purchases.find((each) => each.id === draft.purchaseId);
  if (purchase === undefined) return [problem('unknown-purchase')];
  const problems: PurchaseProblem[] = [];
  const story = purchaseStory(purchase);
  const kind: string = draft.kind;
  if (!(PURCHASE_EVENT_KINDS as readonly string[]).includes(kind)) {
    problems.push(problem('invalid-kind'));
  } else if (story.state === 'delivered') {
    problems.push(problem('already-delivered'));
  } else if (!follows(story.state, draft.kind)) {
    problems.push(problem(draft.kind === 'ordered' ? 'already-ordered' : 'not-ordered'));
  }
  if (!isIsoDay(draft.day)) problems.push(problem('invalid-day'));
  else {
    if (isIsoDay(today) && draft.day > today) problems.push(problem('day-in-future'));
    const latest = purchase.events.reduce<string | null>(
      (most, event) => (most === null || event.day > most ? event.day : most),
      null,
    );
    if (latest !== null && draft.day < latest) problems.push(problem('day-before-last-event'));
  }
  if (draft.note !== null && length(draft.note) > PURCHASE_LIMITS.eventNote) {
    problems.push(problem('event-note-too-long'));
  }
  return problems;
}
