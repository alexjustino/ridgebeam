/**
 * Will the money last? The cash runway of a work, week by week from today to the finish (slice E2,
 * ADR-042, decision 2).
 *
 * **The weeks** are calendar weeks, Monday to Sunday (`weekOf`, the weekly report's), from the week
 * today falls in to the week of the schedule's finish — `RUNWAY_DEFAULT_WEEKS` weeks when the plan
 * has no finish yet, never more than `RUNWAY_MAX_WEEKS`, and at least the current week.
 *
 * **The opening balance** is the money received to date less the money paid to date: both ledgers,
 * reversals included (`receiptRows`, the payments ledger).
 *
 * **Out**, each where it falls:
 *
 * - every commitment **with a payment plan**: what is earned and not paid now (`due`) in the current
 *   week; each **milestone not earned yet** on the day the schedule expects its fact (`expectedOn`,
 *   the lookahead's rule, shared), net of what money paid ahead on its commitment covers of it, the
 *   earliest first, as the lookahead covers; and the part of its amount **not in the plan** (a plan
 *   below 100 %) spread like a commitment without a plan;
 * - every commitment **without a plan**: its unpaid rest spread evenly over the remaining working
 *   days of its stage's span (from today, or the stage's first start when later, to its last finish);
 * - every stage's **planned money not yet committed** (priced cost lines less commitments less what
 *   was paid on the stage on no commitment, when above zero), spread the same way. A cost line not
 *   priced yet contributes nothing and is counted (`notPriced`).
 *
 * Money **already owed** is never pushed into the future: a day already past, a span already over,
 * and the whole rest of a **closed stage** count in the current week. Money the schedule gives no
 * day (nothing of the stage is placed, or the calendar cannot be counted on) counts in the current
 * week too, and its row says so (`undated`): a projection that cannot say when must not say "later".
 *
 * **In**: each funding row's part not received yet, on its expected day. A day already past with the
 * money not received is **not counted** — money that has not come is not money — and the row is
 * listed as late (`late`). Money expected, or owed, after the last week is listed (`beyond`), not
 * counted.
 *
 * **E1**: a change order waiting for its decision is not projected (it is not decided); an approved
 * one is already in the plan — its cost line, its activities — and is projected like any planned
 * money.
 *
 * Every number carries its rows: each week's rows are what came in and went out that week, signed;
 * "Money at the end" opens onto the opening's rows and every week's; "Runs short in" onto the week
 * the balance first goes below zero; "Funding late" onto the late rows.
 *
 * **The chance** (`runwayChance`, D1's ranges): the same projection made on every simulated run of
 * the schedule (`finishProbability`'s per-run hook, which changes none of its results), counting
 * the runs whose balance goes below zero in any week up to that run's finish week — said as a
 * natural frequency. Without a range there is nothing to vary, and the result says so.
 *
 * What this module is not: text, storage or a clock. No I/O.
 */

import {
  addCalendarDays,
  calendarDaysBetween,
  isIsoDay,
  nextWorkingDay,
  workingDaysBetween,
  type WorkingCalendar,
} from './calendar';
import { weekOf } from './dashboard';
import type { DiaryEntry } from './diary';
import {
  chanceFigure,
  counted,
  daysFigure,
  moneyFigure,
  type AmountRow,
  type ChanceFigure,
  type ChanceRow,
  type DaysRow,
  type Figure,
  type ReportRow,
} from './figure';
import { fundingStatuses, receiptRows } from './funding';
import { expectedOn, paymentPlans, scheduledFacts, type FactDays } from './milestones';
import { paidRowsByCommitment, spreadSum, stageOfLine } from './money';
import { isPriced, stagesInOrder, type Milestone, type WorkSnapshot } from './plan';
import type { Schedule } from './schedule';
import {
  finishProbability,
  naturalFrequency,
  PROBABILITY_MESSAGE_KEYS,
  type FinishProbabilityOptions,
  type NaturalFrequency,
  type ProbabilityProblem,
  type SimulatedRun,
} from './schedule/probability';

// ── Constants and message keys ───────────────────────────────────────────────

/** The weeks shown when the plan has no finish date yet, the current week included. */
export const RUNWAY_DEFAULT_WEEKS = 8;

/** The most weeks a runway runs to: five years. A finish later than that is cut, and said so. */
export const RUNWAY_MAX_WEEKS = 260;

/** The figures' names. */
export const RUNWAY_LABEL_KEYS = {
  /** "Money on hand": received to date less paid to date. */
  opening: 'money.runway.figure.opening',
  /** "Money at the end". */
  end: 'money.runway.figure.end',
  /** "Runs short in". */
  short: 'money.runway.figure.short',
  /** "Funding late". */
  late: 'money.runway.figure.late',
  /** "Cost lines not priced". */
  notPriced: 'money.runway.figure.notPriced',
  /** "Chance it runs short". */
  chance: 'money.runway.figure.chance',
} as const;

/**
 * The one sentence (`RunwaySentence`), params in braces, money in cents and days `YYYY-MM-DD`:
 *
 * - `lasts`: `{spare}` — "The money lasts to the end, with {spare} to spare."
 * - `short`: `{week}` (the Monday), `{short}` — "Money runs short in the week of {week} — {short}
 *   short."
 * - `noFunding`: `{needed}` — "Where the money comes from is not written down yet: {needed} is still
 *   to be paid."
 * - `nothing` — "Nothing is planned to be paid or received yet."
 */
export const RUNWAY_SENTENCE_KEYS = {
  lasts: 'money.runway.sentence.lasts',
  short: 'money.runway.sentence.short',
  noFunding: 'money.runway.sentence.noFunding',
  nothing: 'money.runway.sentence.nothing',
} as const;

/**
 * What the sentence leaves out, said under it (`Runway.notes`), in this order:
 *
 * - `late`: `{count}`, `{amount}` — "{count} expected funds have not arrived: {amount} is not
 *   counted."
 * - `undated`: `{count}`, `{amount}` — "{amount} has no day in the schedule yet and is counted this
 *   week."
 * - `notPriced`: `{count}` — "{count} cost lines are not priced and count as nothing."
 * - `beyond`: `{count}`, `{amount}` — "{count} sums fall after the last week and are not counted."
 * - `noFinish`: `{weeks}` — "The plan has no finish date yet: {weeks} weeks are shown."
 * - `truncated`: `{weeks}` — "The finish is far away: only the first {weeks} weeks are shown."
 */
export const RUNWAY_NOTE_KEYS = {
  late: 'money.runway.note.late',
  undated: 'money.runway.note.undated',
  notPriced: 'money.runway.note.notPriced',
  beyond: 'money.runway.note.beyond',
  noFinish: 'money.runway.note.noFinish',
  truncated: 'money.runway.note.truncated',
} as const;

/** Where a row's money comes from or goes to. */
export type RunwaySource =
  /** Money received, in the opening. */
  | 'receipt'
  /** Money paid, in the opening. */
  | 'payment'
  /** A funding row's part not received yet. */
  | 'funding'
  /** A commitment's earned and unpaid money. */
  | 'due'
  /** A milestone not earned yet. */
  | 'milestone'
  /** The part of a commitment's amount its payment plan does not hold. */
  | 'plan-rest'
  /** A commitment without a payment plan, its unpaid rest. */
  | 'commitment'
  /** A stage's planned money not yet committed. */
  | 'uncommitted';

/** What each row is, said on the row: "{title}: a milestone of {commitment}". */
export const RUNWAY_ROW_KEYS = {
  receipt: 'money.runway.row.receipt',
  payment: 'money.runway.row.payment',
  funding: 'money.runway.row.funding',
  due: 'money.runway.row.due',
  milestone: 'money.runway.row.milestone',
  'plan-rest': 'money.runway.row.planRest',
  commitment: 'money.runway.row.commitment',
  uncommitted: 'money.runway.row.uncommitted',
} as const satisfies Record<RunwaySource, string>;

/**
 * Why a row falls where it does: `to-date` (the opening's ledgers); `on-day` (its expected day);
 * `spread` (evenly over its stage's remaining working days); `past` (its day or its span is already
 * over, or it is earned and not paid: still owed, counted now; for a funding row, late: not
 * counted); `closed` (its stage is closed: counted now); `undated` (the schedule gives it no day:
 * counted now). Said on the row: "expected on {day}, still owed".
 */
export type RunwayWhen = 'to-date' | 'on-day' | 'spread' | 'past' | 'closed' | 'undated';

export const RUNWAY_WHEN_KEYS = {
  'to-date': 'money.runway.when.toDate',
  'on-day': 'money.runway.when.onDay',
  spread: 'money.runway.when.spread',
  past: 'money.runway.when.past',
  closed: 'money.runway.when.closed',
  undated: 'money.runway.when.undated',
} as const satisfies Record<RunwayWhen, string>;

/**
 * The chance, said (`RunwayChance`): `short`: `{chance}` (a natural frequency, said) — "about
 * {chance} that the money runs short before the work ends"; `allCertain` — "Every duration is taken
 * as certain, so the weeks above are the only answer. Give activities a range to see the chance.";
 * `method`: `{runs}` — "{runs} runs of the schedule with the ranges given".
 */
export const RUNWAY_CHANCE_KEYS = {
  short: 'money.runway.chance.short',
  allCertain: 'money.runway.chance.allCertain',
  method: 'money.runway.chance.method',
} as const;

/** Every message key this module adds, for the dictionaries' completeness test. */
export const RUNWAY_MESSAGE_KEYS: readonly string[] = [
  ...Object.values(RUNWAY_LABEL_KEYS),
  ...Object.values(RUNWAY_SENTENCE_KEYS),
  ...Object.values(RUNWAY_NOTE_KEYS),
  ...Object.values(RUNWAY_ROW_KEYS),
  ...Object.values(RUNWAY_WHEN_KEYS),
  ...Object.values(RUNWAY_CHANCE_KEYS),
];

// ── Types ────────────────────────────────────────────────────────────────────

/** A row of the runway: money in (positive) or out (negative), where it falls and why. */
export interface RunwayRow extends AmountRow {
  readonly source: RunwaySource;
  /** The receipt's or payment's seq as text, or the funding row's, milestone's, commitment's or stage's id. */
  readonly sourceId: string;
  readonly stageId: string | null;
  readonly commitmentId: string | null;
  readonly fundingId: string | null;
  readonly when: RunwayWhen;
  /** The day it was expected (a milestone's fact, a funding row's day); `null` when none. */
  readonly expectedOn: string | null;
  /** A milestone's money paid ahead on its commitment covered: `amountCents` is the rest, negated. */
  readonly coveredCents: number;
  readonly messageKey: (typeof RUNWAY_ROW_KEYS)[RunwaySource];
  readonly whenKey: (typeof RUNWAY_WHEN_KEYS)[RunwayWhen];
}

/** One calendar week of the runway. Money in cents; `in` and `out` from zero. */
export interface RunwayWeek {
  /** From 0, the current week. */
  readonly index: number;
  /** The Monday. */
  readonly from: string;
  /** The Sunday. */
  readonly to: string;
  readonly opening: number;
  readonly in: number;
  readonly out: number;
  /** `opening + in − out`. */
  readonly closing: number;
  /** The closing is below zero. */
  readonly short: boolean;
  /** What came in (positive) and went out (negative): they sum to `in − out`. */
  readonly rows: readonly RunwayRow[];
}

/** The row of "Runs short in": the week the balance first goes below zero. */
export interface RunwayShortRow extends DaysRow {
  /** The week's Monday and Sunday. */
  readonly from: string;
  readonly to: string;
  /** How far below zero its closing is, in cents, above zero. */
  readonly shortByCents: number;
}

/** A row of the not-priced figure: a cost line with no amount yet. */
export interface NotPricedRow extends ReportRow {
  readonly costLineId: string;
  readonly stageId: string;
}

/** A sentence as data: a message key and its params (money in cents, days `YYYY-MM-DD`). */
export interface RunwaySentence {
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
}

export type RunwayState = 'lasts' | 'short' | 'no-funding' | 'nothing';

export interface Runway {
  readonly today: string;
  readonly weeks: readonly RunwayWeek[];
  /** Received to date less paid to date, with the receipts and the payments as rows. */
  readonly opening: Figure<RunwayRow>;
  /** The first week whose closing is below zero; `null` when none is. */
  readonly shortWeek: RunwayWeek | null;
  /** How far below zero that week's closing is, in cents; `null` with `shortWeek`. */
  readonly shortBy: number | null;
  /** The closing of the last week: what is left at the end (below zero when it does not last). */
  readonly spare: number;
  readonly state: RunwayState;
  /** The sentence that says it. */
  readonly sentence: RunwaySentence;
  /** What the sentence leaves out, in `RUNWAY_NOTE_KEYS` order; empty when nothing is. */
  readonly notes: readonly RunwaySentence[];
  /** The plan has no finish date: `RUNWAY_DEFAULT_WEEKS` weeks are shown. */
  readonly noFinish: boolean;
  /** The finish lies beyond `RUNWAY_MAX_WEEKS` weeks: the weeks are cut there. */
  readonly truncated: boolean;
  /** Money expected or owed after the last week: listed, not counted. */
  readonly beyond: readonly RunwayRow[];
  /** Money counted this week because the schedule gives it no day. */
  readonly undated: readonly RunwayRow[];
  readonly figures: {
    /** "Money at the end": the opening's rows and every week's; its value is `spare`. */
    readonly end: Figure<RunwayRow>;
    /**
     * "Runs short in": calendar days from today to the short week's Monday (0 for the current
     * week), its one row the week; 0 and no row when the money lasts.
     */
    readonly short: Figure<RunwayShortRow>;
    /** "Funding late": funding rows past their day with money not received, not counted. */
    readonly late: Figure<RunwayRow>;
    /** Cost lines not priced yet: they count as nothing. */
    readonly notPriced: Figure<NotPricedRow>;
  };
}

// ── The obligations: what is still to pay, before the schedule says when ─────

interface OutItem {
  readonly source: Exclude<RunwaySource, 'receipt' | 'payment' | 'funding'>;
  readonly sourceId: string;
  readonly stageId: string;
  readonly commitmentId: string | null;
  readonly title: string;
}

interface PlanObligation {
  readonly commitment: { readonly stageId: string; readonly agreedOn: string };
  readonly closed: boolean;
  /** Money paid ahead of the work on it: covers what comes, the earliest first. */
  readonly aheadCents: number;
  readonly milestones: ReadonlyArray<{
    readonly item: OutItem;
    readonly milestone: Milestone;
    readonly cents: number;
  }>;
  /** The amount its plan does not hold, before any cover. */
  readonly rest: { readonly item: OutItem; readonly cents: number } | null;
}

interface SpreadObligation {
  readonly item: OutItem;
  readonly cents: number;
  readonly closed: boolean;
}

interface Obligations {
  /** Owed now: counted in the current week whatever the schedule says. */
  readonly dues: ReadonlyArray<{ readonly item: OutItem; readonly cents: number }>;
  readonly plans: readonly PlanObligation[];
  readonly spreads: readonly SpreadObligation[];
}

function obligationsOf(
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
  today: string,
): Obligations {
  const stages = new Map(snapshot.stages.map((stage) => [stage.id, stage]));
  const closed = (stageId: string) => (stages.get(stageId)?.closedAt ?? null) !== null;
  const agreed = new Map(snapshot.commitments.map((each) => [each.id, each.agreedOn]));
  const paid = paidRowsByCommitment(snapshot);
  const sum = (rows: readonly AmountRow[] | undefined) =>
    (rows ?? []).reduce((total, row) => total + row.amountCents, 0);

  const dues: Array<{ item: OutItem; cents: number }> = [];
  const plans: PlanObligation[] = [];
  const spreads: SpreadObligation[] = [];

  for (const plan of paymentPlans(snapshot, entries, today).commitments) {
    const about = { stageId: plan.stageId, commitmentId: plan.commitmentId, title: plan.label };
    if (!plan.hasPlan) {
      const rest = plan.amountCents - plan.paid.value;
      if (rest > 0) {
        spreads.push({
          item: { source: 'commitment', sourceId: plan.commitmentId, ...about },
          cents: rest,
          closed: closed(plan.stageId),
        });
      }
      continue;
    }
    if (plan.due.value > 0) {
      dues.push({
        item: { source: 'due', sourceId: plan.commitmentId, ...about },
        cents: plan.due.value,
      });
    }
    const inPlan = plan.milestones.reduce((total, status) => total + status.cents, 0);
    const restCents = plan.amountCents - inPlan;
    plans.push({
      commitment: { stageId: plan.stageId, agreedOn: agreed.get(plan.commitmentId)! },
      closed: closed(plan.stageId),
      aheadCents: plan.ahead.value,
      milestones: plan.milestones
        .filter((status) => !status.earned && status.cents > 0)
        .map((status) => ({
          item: {
            source: 'milestone',
            sourceId: status.milestone.id,
            stageId: plan.stageId,
            commitmentId: plan.commitmentId,
            title: status.milestone.label,
          },
          milestone: status.milestone,
          cents: status.cents,
        })),
      rest:
        restCents > 0
          ? {
              item: { source: 'plan-rest', sourceId: plan.commitmentId, ...about },
              cents: restCents,
            }
          : null,
    });
  }

  // Planned money not yet committed, per stage: what was paid on the stage on no commitment is
  // already spent, so it is not projected again.
  const outside = paid.get(null) ?? [];
  for (const stage of stagesInOrder(snapshot)) {
    const planned = snapshot.costLines
      .filter((line) => isPriced(line) && stageOfLine(snapshot, line) === stage.id)
      .reduce((total, line) => total + line.amountCents!, 0);
    const committed = snapshot.commitments
      .filter((commitment) => commitment.stageId === stage.id)
      .reduce((total, commitment) => total + commitment.amountCents, 0);
    const spentOutside = sum(outside.filter((row) => row.stageId === stage.id));
    const rest = planned - committed - spentOutside;
    if (rest <= 0) continue;
    spreads.push({
      item: {
        source: 'uncommitted',
        sourceId: stage.id,
        stageId: stage.id,
        commitmentId: null,
        title: stage.name,
      },
      cents: rest,
      closed: stage.closedAt !== null,
    });
  }
  return { dues, plans, spreads };
}

// ── The frame: weeks and working-day offsets ─────────────────────────────────

/** Days, weeks and working-day offsets, from today. Offsets are the schedule's: day 0 is offset 0. */
class Frame {
  readonly today: string;
  /** The current week's Monday: week 0. */
  readonly monday: string;
  readonly calendar: WorkingCalendar | null;
  readonly day0: string | null;
  /** The first offset on or after today. */
  readonly todayOffset: number;
  private readonly days: string[] = [];
  private readonly ends: Array<number | undefined> = [];

  constructor(today: string, calendar: WorkingCalendar | null, day0: string | null) {
    this.today = today;
    this.monday = weekOf(today)!.from;
    this.calendar = calendar;
    this.day0 = day0;
    this.todayOffset =
      calendar === null || day0 === null || today <= day0
        ? 0
        : workingDaysBetween(calendar, day0, addCalendarDays(today, -1));
  }

  /** The week a day is counted in: a day already past is still owed, so it counts now (week 0). */
  weekOfDay(day: string): number {
    if (day < this.today) return 0;
    return Math.floor(calendarDaysBetween(this.monday, day) / 7);
  }

  /** The working day at an offset (the calendar is walked once, as far as asked). */
  dayAt(offset: number): string {
    if (this.days.length === 0) this.days.push(this.day0!);
    while (this.days.length <= offset) {
      this.days.push(nextWorkingDay(this.calendar!, addCalendarDays(this.days.at(-1)!, 1)));
    }
    return this.days[offset]!;
  }

  /** The Monday of a week. */
  mondayOf(week: number): string {
    return addCalendarDays(this.monday, 7 * week);
  }

  /** The offset just after a week: how many working days there are from day 0 to its Sunday. */
  weekEnd(week: number): number {
    let end = this.ends[week];
    if (end === undefined) {
      const sunday = addCalendarDays(this.monday, 7 * week + 6);
      end = sunday < this.day0! ? 0 : workingDaysBetween(this.calendar!, this.day0!, sunday);
      this.ends[week] = end;
    }
    return end;
  }

  /**
   * The week an offset falls in, or `limit` when it falls after week `limit − 1`: found among the
   * weeks' ends, never by walking the calendar to it (a run may place money years away).
   */
  weekOfOffset(offset: number, limit: number): number {
    let low = 0;
    let high = limit;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (offset < this.weekEnd(middle)) high = middle;
      else low = middle + 1;
    }
    return low;
  }
}

/** Where a schedule (the plan's, or one run's) puts the facts and the stages' spans. */
interface Placement {
  readonly facts: FactDays;
  /** A stage's first and last working-day offsets, or `null` when nothing of it is placed. */
  span(stageId: string): { readonly first: number; readonly last: number } | null;
}

/** The plan's own schedule, as a placement. */
function scheduledPlacement(scheduled: Schedule): Placement {
  const spans = new Map<string, { first: number; last: number }>();
  for (const activity of scheduled.activities) {
    const timing = scheduled.plan.timing.get(activity.id);
    if (timing === undefined || !scheduled.dates.has(activity.id)) continue;
    const span = spans.get(activity.stageId);
    const last = timing.earliestFinish - 1;
    if (span === undefined) spans.set(activity.stageId, { first: timing.earliestStart, last });
    else {
      span.first = Math.min(span.first, timing.earliestStart);
      span.last = Math.max(span.last, last);
    }
  }
  return { facts: scheduledFacts(scheduled), span: (stageId) => spans.get(stageId) ?? null };
}

interface Placed {
  readonly day: string;
  readonly when: RunwayWhen;
  readonly expectedOn: string | null;
  readonly coveredCents: number;
}

/** Where money goes. */
interface Sink {
  /** A sum in one week (from 0, unbounded): its cents, what it is and why it falls there. */
  put(week: number, cents: number, item: OutItem, placed: Placed): void;
  /**
   * A whole spread at once, when the sink wants only the weeks' totals: `cents` over the working
   * days `first` to `last` (offsets, both included) by `spread`'s rule. Without it, each week's part
   * is `put` with its row.
   */
  readonly spread?: (first: number, last: number, cents: number) => void;
}

/**
 * Place every obligation on a schedule, handing each week's part to the sink. Money falling in week
 * `horizon` or later is handed over whole, as week `horizon`: nothing after it is counted.
 */
function placeOut(
  obligations: Obligations,
  frame: Frame,
  placement: Placement,
  horizon: number,
  sink: Sink,
): void {
  const now = (when: RunwayWhen, expected: string | null, covered = 0): Placed => ({
    day: frame.today,
    when,
    expectedOn: expected,
    coveredCents: covered,
  });

  const spreadOut = (item: OutItem, cents: number, closed: boolean): void => {
    if (cents <= 0) return;
    if (closed) return sink.put(0, cents, item, now('closed', null));
    const span = frame.calendar === null ? null : placement.span(item.stageId);
    if (span === null) return sink.put(0, cents, item, now('undated', null));
    const first = Math.max(frame.todayOffset, span.first);
    if (span.last < first) return sink.put(0, cents, item, now('past', null));
    if (sink.spread !== undefined) return sink.spread(first, span.last, cents);
    // Evenly over the working days left (`spread`), summed week by week.
    const days = span.last - first + 1;
    const part = (from: number, to: number) => spreadSum(cents, days, from - first, to - first);
    const on = (day: string): Placed => ({ ...now('spread', null), day });
    let offset = first;
    for (let week = frame.weekOfOffset(first, horizon); offset <= span.last; week += 1) {
      if (week >= horizon) {
        sink.put(horizon, part(offset, span.last + 1), item, on(frame.mondayOf(horizon)));
        return;
      }
      const end = Math.min(span.last + 1, frame.weekEnd(week));
      if (end <= offset) continue;
      const sum = part(offset, end);
      if (sum !== 0) sink.put(week, sum, item, on(frame.dayAt(offset)));
      offset = end;
    }
  };

  for (const due of obligations.dues) sink.put(0, due.cents, due.item, now('past', null));

  for (const plan of obligations.plans) {
    const coming = plan.milestones
      .map((each) => {
        if (plan.closed) return { each, expected: null, when: 'closed' as const, day: frame.today };
        const expected = expectedOn(placement.facts, plan.commitment, each.milestone);
        if (expected === null)
          return { each, expected, when: 'undated' as const, day: frame.today };
        if (expected < frame.today) return { each, expected, when: 'past' as const, day: expected };
        return { each, expected, when: 'on-day' as const, day: expected };
      })
      // Position order already; by day first, the sort being stable: the earliest is covered first.
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    let ahead = plan.aheadCents;
    for (const { each, expected, when, day } of coming) {
      const covered = Math.min(ahead, each.cents);
      ahead -= covered;
      if (each.cents - covered <= 0) continue;
      sink.put(frame.weekOfDay(day), each.cents - covered, each.item, {
        day: when === 'on-day' ? day : frame.today,
        when,
        expectedOn: expected,
        coveredCents: covered,
      });
    }
    if (plan.rest !== null) {
      spreadOut(plan.rest.item, plan.rest.cents - Math.min(ahead, plan.rest.cents), plan.closed);
    }
  }

  for (const each of obligations.spreads) spreadOut(each.item, each.cents, each.closed);
}

// ── The runway ───────────────────────────────────────────────────────────────

/** The week the runway ends in, from 0, before the cap; `null` when the plan has no finish. */
function finishWeek(frame: Frame, finishDate: string | null): number | null {
  return finishDate === null ? null : frame.weekOfDay(finishDate);
}

function outRow(item: OutItem, week: string, cents: number, placed: Placed): RunwayRow {
  return {
    key: `${week}:${item.source}:${item.sourceId}`,
    itemId: item.sourceId,
    title: item.title,
    day: placed.day,
    minutes: 0,
    amountCents: -cents,
    source: item.source,
    sourceId: item.sourceId,
    stageId: item.stageId,
    commitmentId: item.commitmentId,
    fundingId: null,
    when: placed.when,
    expectedOn: placed.expectedOn,
    coveredCents: placed.coveredCents,
    messageKey: RUNWAY_ROW_KEYS[item.source],
    whenKey: RUNWAY_WHEN_KEYS[placed.when],
  };
}

const byDay = (a: RunwayRow, b: RunwayRow): number =>
  (a.day ?? '') < (b.day ?? '') ? -1 : (a.day ?? '') > (b.day ?? '') ? 1 : 0;

/**
 * Will the money last: week by week from the week of `today` to the week of the schedule's finish.
 * `scheduled` is `schedule(snapshot)`; the diary says what is earned. `today` must be a `YYYY-MM-DD`
 * day: anything else is a programming error, and throws a `RangeError`.
 */
export function runway(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  entries: readonly DiaryEntry[],
  today: string,
): Runway {
  if (!isIsoDay(today)) throw new RangeError(`Not a YYYY-MM-DD day: ${JSON.stringify(today)}`);
  const frame = new Frame(today, scheduled.calendar, scheduled.day0);

  // ── The weeks ──
  const last = finishWeek(frame, scheduled.finishDate);
  const wanted = last === null ? RUNWAY_DEFAULT_WEEKS : last + 1;
  const count = Math.min(RUNWAY_MAX_WEEKS, wanted);
  const froms = Array.from({ length: count }, (_, index) =>
    addCalendarDays(frame.monday, 7 * index),
  );
  const rowsOf: Array<Map<string, RunwayRow>> = froms.map(() => new Map());
  const beyond: RunwayRow[] = [];

  const put = (week: number, row: RunwayRow): void => {
    if (week >= count) {
      beyond.push({ ...row, key: `beyond:${row.source}:${row.sourceId}:${beyond.length}` });
      return;
    }
    const rows = rowsOf[week]!;
    const same = rows.get(row.key);
    rows.set(
      row.key,
      same === undefined ? row : { ...same, amountCents: same.amountCents + row.amountCents },
    );
  };
  const weekLabel = (week: number): string =>
    week < count ? froms[week]! : addCalendarDays(frame.monday, 7 * week);

  // ── The opening ──
  const openingRows: RunwayRow[] = [];
  const fundingLabels = new Map(snapshot.funding.map((funding) => [funding.id, funding.label]));
  for (const receipt of receiptRows(snapshot, today)) {
    openingRows.push({
      key: `opening:receipt:${receipt.seq}`,
      itemId: receipt.fundingId,
      title:
        receipt.title !== ''
          ? receipt.title
          : (fundingLabels.get(receipt.fundingId ?? '') ?? receipt.title),
      day: receipt.day,
      minutes: 0,
      amountCents: receipt.amountCents,
      source: 'receipt',
      sourceId: String(receipt.seq),
      stageId: null,
      commitmentId: null,
      fundingId: receipt.fundingId,
      when: 'to-date',
      expectedOn: null,
      coveredCents: 0,
      messageKey: RUNWAY_ROW_KEYS.receipt,
      whenKey: RUNWAY_WHEN_KEYS['to-date'],
    });
  }
  const paid = [...paidRowsByCommitment(snapshot).entries()]
    .flatMap(([commitmentId, rows]) => rows.map((row) => ({ commitmentId, row })))
    .filter(({ row }) => row.day !== null && row.day <= today)
    .sort((a, b) => Number(a.row.sourceId) - Number(b.row.sourceId));
  for (const { commitmentId, row } of paid) {
    openingRows.push({
      key: `opening:payment:${row.sourceId}`,
      itemId: row.itemId,
      title: row.title,
      day: row.day,
      minutes: 0,
      amountCents: row.amountCents === 0 ? 0 : -row.amountCents,
      source: 'payment',
      sourceId: row.sourceId,
      stageId: row.stageId,
      commitmentId,
      fundingId: null,
      when: 'to-date',
      expectedOn: null,
      coveredCents: 0,
      messageKey: RUNWAY_ROW_KEYS.payment,
      whenKey: RUNWAY_WHEN_KEYS['to-date'],
    });
  }
  const opening = moneyFigure('runway.opening', RUNWAY_LABEL_KEYS.opening, openingRows);

  // ── In ──
  const late: RunwayRow[] = [];
  for (const status of fundingStatuses(snapshot, today)) {
    if (status.remainingCents <= 0) continue;
    const funding = status.funding;
    const row: RunwayRow = {
      key: `funding:${funding.id}`,
      itemId: funding.id,
      title: funding.label,
      day: funding.expectedOn,
      minutes: 0,
      amountCents: status.remainingCents,
      source: 'funding',
      sourceId: funding.id,
      stageId: null,
      commitmentId: null,
      fundingId: funding.id,
      when: status.late ? 'past' : 'on-day',
      expectedOn: funding.expectedOn,
      coveredCents: 0,
      messageKey: RUNWAY_ROW_KEYS.funding,
      whenKey: RUNWAY_WHEN_KEYS[status.late ? 'past' : 'on-day'],
    };
    if (status.late) {
      late.push({ ...row, key: `late:${row.key}` });
      continue;
    }
    const week = frame.weekOfDay(funding.expectedOn);
    put(week, { ...row, key: `${weekLabel(week)}:${row.key}` });
  }

  // ── Out ──
  const undated: RunwayRow[] = [];
  placeOut(obligationsOf(snapshot, entries, today), frame, scheduledPlacement(scheduled), count, {
    put: (week, cents, item, placed) => {
      const row = outRow(item, weekLabel(week), cents, placed);
      if (placed.when === 'undated') undated.push(row);
      put(week, row);
    },
  });

  // ── The weeks, in order ──
  const weeks: RunwayWeek[] = [];
  let balance = opening.value;
  froms.forEach((from, index) => {
    const rows = [...rowsOf[index]!.values()];
    // In before out, each by day: the sort is stable, so equals keep the order they were placed in.
    rows.sort(byDay).sort((a, b) => Number(b.amountCents > 0) - Number(a.amountCents > 0));
    const income = rows
      .filter((row) => row.amountCents > 0)
      .reduce((sum, row) => sum + row.amountCents, 0);
    const outgo = rows
      .filter((row) => row.amountCents < 0)
      .reduce((sum, row) => sum - row.amountCents, 0);
    const closing = balance + income - outgo;
    weeks.push({
      index,
      from,
      to: addCalendarDays(from, 6),
      opening: balance,
      in: income,
      out: outgo,
      closing,
      short: closing < 0,
      rows,
    });
    balance = closing;
  });

  const shortWeek = weeks.find((week) => week.short) ?? null;
  const shortBy = shortWeek === null ? null : -shortWeek.closing;
  const spare = weeks.at(-1)!.closing;

  // ── The figures ──
  const end = moneyFigure('runway.end', RUNWAY_LABEL_KEYS.end, [
    ...openingRows,
    ...weeks.flatMap((week) => week.rows),
  ]);
  const shortDays =
    shortWeek === null ? 0 : Math.max(0, calendarDaysBetween(today, shortWeek.from));
  const short = daysFigure<RunwayShortRow>(
    'runway.short',
    RUNWAY_LABEL_KEYS.short,
    shortDays,
    shortWeek === null
      ? []
      : [
          {
            key: `week:${shortWeek.from}`,
            itemId: null,
            title: shortWeek.from,
            day: shortWeek.from,
            minutes: 0,
            days: shortDays,
            againstFinish: shortDays,
            from: shortWeek.from,
            to: shortWeek.to,
            shortByCents: shortBy!,
          },
        ],
  );
  const notPriced = counted<NotPricedRow>(
    'runway.not-priced',
    RUNWAY_LABEL_KEYS.notPriced,
    snapshot.costLines
      .filter((line) => !isPriced(line))
      .map((line) => ({
        key: `cost-line:${line.id}`,
        itemId: line.activityId ?? line.stageId,
        title: line.label,
        day: null,
        minutes: 0,
        costLineId: line.id,
        stageId: stageOfLine(snapshot, line),
      })),
  );
  const lateFigure = counted('runway.late', RUNWAY_LABEL_KEYS.late, late);

  // ── The sentence ──
  const noFunding = snapshot.funding.length === 0 && snapshot.fundingReceipts.length === 0;
  const totalOut = weeks.reduce((sum, week) => sum + week.out, 0);
  const moved =
    totalOut > 0 || openingRows.length > 0 || weeks.some((week) => week.in > 0) || late.length > 0;
  const state: RunwayState = !moved
    ? 'nothing'
    : noFunding
      ? 'no-funding'
      : shortWeek === null
        ? 'lasts'
        : 'short';
  const sentence: RunwaySentence =
    state === 'nothing'
      ? { key: RUNWAY_SENTENCE_KEYS.nothing, params: {} }
      : state === 'no-funding'
        ? { key: RUNWAY_SENTENCE_KEYS.noFunding, params: { needed: Math.max(0, -spare) } }
        : state === 'lasts'
          ? { key: RUNWAY_SENTENCE_KEYS.lasts, params: { spare } }
          : { key: RUNWAY_SENTENCE_KEYS.short, params: { week: shortWeek!.from, short: shortBy! } };

  const amountOf = (rows: readonly RunwayRow[]) =>
    rows.reduce((sum, row) => sum + Math.abs(row.amountCents), 0);
  const notes: RunwaySentence[] = [];
  if (late.length > 0) {
    notes.push({
      key: RUNWAY_NOTE_KEYS.late,
      params: { count: late.length, amount: amountOf(late) },
    });
  }
  if (undated.length > 0) {
    notes.push({
      key: RUNWAY_NOTE_KEYS.undated,
      params: { count: undated.length, amount: amountOf(undated) },
    });
  }
  if (notPriced.value > 0) {
    notes.push({ key: RUNWAY_NOTE_KEYS.notPriced, params: { count: notPriced.value } });
  }
  if (beyond.length > 0) {
    notes.push({
      key: RUNWAY_NOTE_KEYS.beyond,
      params: { count: beyond.length, amount: amountOf(beyond) },
    });
  }
  if (last === null) notes.push({ key: RUNWAY_NOTE_KEYS.noFinish, params: { weeks: count } });
  if (wanted > count) notes.push({ key: RUNWAY_NOTE_KEYS.truncated, params: { weeks: count } });

  return {
    today,
    weeks,
    opening,
    shortWeek,
    shortBy,
    spare,
    state,
    sentence,
    notes,
    noFinish: last === null,
    truncated: wanted > count,
    beyond,
    undated,
    figures: { end, short, late: lateFigure, notPriced },
  };
}

// ── The chance (D1) ──────────────────────────────────────────────────────────

/** The simulation's own options; the diary is the runway's, and the per-run hook is this module's. */
export type RunwayChanceOptions = Omit<FinishProbabilityOptions, 'entries' | 'onRun'>;

export type RunwayChance =
  | {
      readonly ok: true;
      readonly kind: 'chance';
      readonly runs: number;
      /** Runs whose balance went below zero in some week up to their own finish week. */
      readonly hits: number;
      /** `hits / runs`. */
      readonly chance: number;
      /** The chance said: "3 in 10", floored, as every frequency is. */
      readonly frequency: NaturalFrequency;
      readonly seed: number;
      /** Fewer runs than usual, because the plan is large (D1's rule). */
      readonly capped: boolean;
      /** The chance, its rows what it depends on (D1's: the drivers, the activities taken as certain). */
      readonly figure: ChanceFigure<ChanceRow>;
      /** `RUNWAY_CHANCE_KEYS.short`; `{chance}` is `frequency` said. */
      readonly sentence: RunwaySentence;
      /** `RUNWAY_CHANCE_KEYS.method`: how many runs. */
      readonly method: RunwaySentence;
    }
  | {
      readonly ok: true;
      /** No activity has a range: every run is the plan, and the weeks above are the answer. */
      readonly kind: 'all-certain';
      readonly sentence: RunwaySentence;
    }
  | {
      readonly ok: false;
      readonly code: ProbabilityProblem;
      readonly messageKey: (typeof PROBABILITY_MESSAGE_KEYS.problem)[ProbabilityProblem];
    };

/** One run as a placement: its offsets, read through the stages and activities it holds. */
class RunPlacement implements Placement {
  readonly facts: FactDays;
  private readonly stageIndex = new Map<string, number>();
  private readonly activityIndex = new Map<string, number>();
  private readonly stageOfActivity: Int32Array;
  private readonly first: Int32Array;
  private readonly last: Int32Array;
  private run: SimulatedRun | null = null;

  constructor(snapshot: WorkSnapshot, activityIds: readonly string[], frame: Frame) {
    const stageOf = new Map(snapshot.activities.map((activity) => [activity.id, activity.stageId]));
    snapshot.stages.forEach((stage, index) => this.stageIndex.set(stage.id, index));
    this.stageOfActivity = Int32Array.from(
      activityIds.map((id, index) => {
        this.activityIndex.set(id, index);
        return this.stageIndex.get(stageOf.get(id) ?? '') ?? -1;
      }),
    );
    this.first = new Int32Array(snapshot.stages.length);
    this.last = new Int32Array(snapshot.stages.length);
    const dayOf = (offset: number): string | null => (offset < 0 ? null : frame.dayAt(offset));
    this.facts = {
      stageStart: (stageId) => {
        const at = this.stageIndex.get(stageId);
        return at === undefined ? null : dayOf(this.first[at]!);
      },
      stageFinish: (stageId) => {
        const at = this.stageIndex.get(stageId);
        return at === undefined ? null : dayOf(this.last[at]!);
      },
      activityFinish: (activityId) => {
        const at = this.activityIndex.get(activityId);
        const run = this.run!;
        return at === undefined || run.placed[at] === 0 ? null : dayOf(run.finish[at]! - 1);
      },
    };
  }

  /** Read a run: every stage's first and last offset (−1 when nothing of it takes days). */
  read(run: SimulatedRun): void {
    this.run = run;
    this.first.fill(-1);
    this.last.fill(-1);
    for (let at = 0; at < run.activityIds.length; at += 1) {
      const stage = this.stageOfActivity[at]!;
      if (stage < 0 || run.placed[at] === 0) continue;
      const start = run.start[at]!;
      const end = run.finish[at]! - 1;
      if (this.first[stage]! < 0 || start < this.first[stage]!) this.first[stage] = start;
      if (end > this.last[stage]!) this.last[stage] = end;
    }
  }

  span(stageId: string): { first: number; last: number } | null {
    const at = this.stageIndex.get(stageId);
    if (at === undefined || this.first[at]! < 0) return null;
    return { first: this.first[at]!, last: this.last[at]! };
  }
}

/**
 * One run's money out, week by week, and nothing else: no rows. A spread is taken whole, as a rate
 * over working-day offsets (a difference array), and summed into weeks once all is placed, so a
 * run costs the obligations plus the days of the weeks counted, however long a span is.
 */
class RunLedger implements Sink {
  private readonly outgo = new Float64Array(RUNWAY_MAX_WEEKS + 1);
  /** The offset just after the last week counted, and the week of every offset before it. */
  private readonly end: number;
  private readonly weekOf: Int16Array;
  private readonly rate: Float64Array;
  private readonly frame: Frame;

  constructor(frame: Frame) {
    this.frame = frame;
    this.end = frame.calendar === null ? 0 : frame.weekEnd(RUNWAY_MAX_WEEKS - 1);
    this.weekOf = new Int16Array(this.end);
    for (let week = 0, offset = 0; week < RUNWAY_MAX_WEEKS; week += 1) {
      for (const until = frame.weekEnd(week); offset < until; offset += 1)
        this.weekOf[offset] = week;
    }
    this.rate = new Float64Array(this.end + 1);
  }

  reset(): void {
    this.outgo.fill(0);
    this.rate.fill(0);
  }

  put(week: number, cents: number): void {
    const at = Math.min(week, RUNWAY_MAX_WEEKS);
    this.outgo[at] = this.outgo[at]! + cents;
  }

  /** `spread`'s rule as rates: every day its share, the first `odd` days a cent more (or less). */
  readonly spread = (first: number, last: number, cents: number): void => {
    const days = last - first + 1;
    const share = Math.trunc(cents / days);
    const odd = Math.abs(cents - share * days);
    const sign = Math.sign(cents - share * days);
    const add = (from: number, to: number, value: number) => {
      if (from >= this.end || to <= from) return;
      this.rate[from] = this.rate[from]! + value;
      this.rate[Math.min(to, this.end)] = this.rate[Math.min(to, this.end)]! - value;
    };
    add(first, last + 1, share);
    add(first, first + odd, sign);
  };

  /** The weeks' totals: what was put, and every spread summed day by day into its week. */
  weeks(): Float64Array {
    let rate = 0;
    for (let offset = this.frame.todayOffset; offset < this.end; offset += 1) {
      rate += this.rate[offset]!;
      if (rate !== 0) this.outgo[this.weekOf[offset]!] = this.outgo[this.weekOf[offset]!]! + rate;
    }
    return this.outgo;
  }
}

/**
 * The chance the money runs short before the work ends, from D1's ranges: the runway's projection
 * placed on every simulated run of the schedule (money in and the opening are the same in every
 * run; money out follows each run's dates), counting the runs whose balance goes below zero in any
 * week up to that run's finish week. Refused as `finishProbability` refuses; `all-certain` when no
 * activity has a range. Seeded as D1 is: the same plan gives the same chance.
 */
export function runwayChance(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  entries: readonly DiaryEntry[],
  today: string,
  options: RunwayChanceOptions = {},
): RunwayChance {
  if (!isIsoDay(today)) throw new RangeError(`Not a YYYY-MM-DD day: ${JSON.stringify(today)}`);
  const frame = new Frame(today, scheduled.calendar, scheduled.day0);
  const obligations = obligationsOf(snapshot, entries, today);

  // The same in every run: the opening, and the money coming in, week by week.
  const opening =
    receiptRows(snapshot, today).reduce((sum, row) => sum + row.amountCents, 0) -
    snapshot.payments
      .filter((payment) => payment.day <= today)
      .reduce((sum, payment) => sum + payment.amountCents, 0);
  const income = new Float64Array(RUNWAY_MAX_WEEKS);
  for (const status of fundingStatuses(snapshot, today)) {
    if (status.remainingCents <= 0 || status.late) continue;
    const week = frame.weekOfDay(status.funding.expectedOn);
    if (week < RUNWAY_MAX_WEEKS) income[week] = income[week]! + status.remainingCents;
  }

  const ledger = new RunLedger(frame);
  let placement: RunPlacement | null = null;
  let hits = 0;
  const result = finishProbability(snapshot, scheduled, {
    ...options,
    entries,
    onRun: (run) => {
      placement ??= new RunPlacement(snapshot, run.activityIds, frame);
      placement.read(run);
      // Weeks after the run's finish week are not asked about: money placed there is not counted.
      const finish = Math.min(
        RUNWAY_MAX_WEEKS - 1,
        frame.weekOfOffset(run.end - 1, RUNWAY_MAX_WEEKS),
      );
      ledger.reset();
      placeOut(obligations, frame, placement, finish + 1, ledger);
      const outgo = ledger.weeks();
      let balance = opening;
      for (let week = 0; week <= finish; week += 1) {
        balance += income[week]! - outgo[week]!;
        if (balance < 0) {
          hits += 1;
          break;
        }
      }
    },
  });
  if (!result.ok) return { ok: false, code: result.code, messageKey: result.messageKey };
  if (result.allCertain) {
    return {
      ok: true,
      kind: 'all-certain',
      sentence: { key: RUNWAY_CHANCE_KEYS.allCertain, params: {} },
    };
  }
  const chance = hits / result.runs;
  const frequency = naturalFrequency(chance);
  return {
    ok: true,
    kind: 'chance',
    runs: result.runs,
    hits,
    chance,
    frequency,
    seed: result.seed,
    capped: result.capped,
    figure: chanceFigure(
      'runway.chance',
      RUNWAY_LABEL_KEYS.chance,
      hits,
      result.runs,
      null,
      result.figures.p80.rows,
    ),
    sentence: {
      key: RUNWAY_CHANCE_KEYS.short,
      params: { n: frequency.n, hits, runs: result.runs },
    },
    method: { key: RUNWAY_CHANCE_KEYS.method, params: { runs: result.runs } },
  };
}
