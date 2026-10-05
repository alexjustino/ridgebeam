/**
 * The lookahead: the next two weeks of the work, as the owner's snapshot shows them (slice D4,
 * decision 2).
 *
 * **The window** is `days` calendar days (14 by default) from today, today included: `from` is
 * today, `to` is today + `days` − 1. Fourteen days from a Friday end on the Thursday thirteen days
 * later; the Friday after it (day 14) is outside. Every day of the window is listed, saying whether
 * the site works it and whether it is a holiday, so a Gantt can shade them.
 *
 * Everything is read off the schedule — the plan — as of today, with three facts taken into account:
 *
 * - **a closed stage is done**: nothing of it is starting, running, expected, coming up at a gate,
 *   or falling due by the schedule, and its open decisions are not asked for;
 * - **an activity the diary says is finished** (on or before today) is neither starting nor running,
 *   and nobody is expected for it;
 * - **what is already earned** is not "falling due": it is earned, and, when unpaid, it is in "due
 *   now".
 *
 * The figures, each carrying its rows:
 *
 * - **starting**: activities whose scheduled start is in the window;
 * - **running**: activities that started before the window and finish in it or after it (an
 *   activity finishing today is running). Starting and running never share an activity;
 * - **people**: who is expected, by the front door's rule (`peopleExpectedFigure`, slice F10) applied
 *   to the window — whoever answers for an activity that is starting or running, and whoever is put
 *   on a stage that is started (and not closed);
 * - **decisions**: by the product's one rule (`decisionsDueWithin`, the weekly report's too), open
 *   decisions overdue, or whose deadline (the day to order by: the stage's first start less the
 *   lead time) is on or before today + `WEEKLY_DECISION_WINDOW_DAYS` calendar days — day 14
 *   included, one day past the window, and whatever `days` is — most urgent first, each with its
 *   lead time and the day its stage needs it;
 * - **gates**: the start gate of every planned stage whose first activity is scheduled to start in
 *   the window, and the close gate of every stage not closed whose last activity is scheduled to
 *   finish in it, each with the items that hold it (unanswered, or answered no) — a gate already
 *   passed is still listed, with none. A gate with no checks asks nothing and is not coming up: it
 *   is left out, of the rows and of the count;
 * - **payments**: what **falls due** in the window — a milestone of a payment plan not earned yet
 *   whose fact the schedule expects in the window (an activity's scheduled finish for
 *   `activity_finished`; the stage's first activity start for `stage_started`; its last activity's
 *   finish for `stage_closed` and for a `retention` nothing holds; the day agreed for an `advance`
 *   agreed after today; a retention **held** by open snags is money held, never falling due) — each
 *   with what
 *   money already paid ahead on its commitment covers of it; and what is **earned and not paid now**
 *   (`dueFigure`, slice D2);
 * - **to order** (slice G2): every purchase still to order whose day to order by (`purchaseRows`:
 *   the day its activity starts **as things stand** — the forecast — less its lead time in calendar
 *   days) is in the window or has passed, the most urgent first; a purchase whose activity is
 *   finished, or whose stage is closed, is not listed. Unlike the rest of the lookahead, this reads
 *   the forecast, as the Dashboard does: the day to order by has one rule in the product.
 *
 * And the **bars** of a Gantt of the window: every activity starting or running, in breakdown
 * order, as a first column and a length in calendar-day columns from `from`, cut at the window's
 * edges (and saying so), critical or not.
 *
 * `placed` says whether the schedule placed anything at all: with nothing placed, every
 * schedule-driven figure is empty because there is no schedule, not because the two weeks are quiet,
 * and the page says so.
 *
 * What this module is not: text. Days are `YYYY-MM-DD`; the interface says them in the owner's
 * words. No I/O, no clock.
 */

import { breakdown } from '../arrangements';
import { addCalendarDays, isIsoDay, isWorkingDay } from '../calendar';
import { gateStatus, holdingItems, stageState, type GateItem } from '../checks';
import { peopleExpectedFigure, type ExpectedRow } from '../dashboard';
import {
  decisionRows,
  decisionsDueWithin,
  stageFinish,
  stageStart,
  type DecisionDueRow,
} from '../decisions';
import { progress, type DiaryEntry } from '../diary';
import { counted, moneyFigure, type AmountRow, type Figure, type ReportRow } from '../figure';
import {
  dueFigure,
  milestoneExpectation,
  paymentPlans,
  scheduledFacts,
  type MilestoneTarget,
  type MilestoneTrigger,
  type PlanRow,
} from '../milestones';
import { compareText, stagesInOrder, type Gate, type WorkSnapshot } from '../plan';
import { purchaseRows, type PurchaseRow } from '../purchases';
import type { Schedule, ScheduledDates } from '../schedule';
import { WEEKLY_DECISION_WINDOW_DAYS } from './weekly';

// ── Constants and message keys ───────────────────────────────────────────────

/** How far the lookahead looks, in calendar days, today included. */
export const LOOKAHEAD_DAYS = 14;

/** The figures' labels. "Due now" is D2's own (`MILESTONE_LABEL_KEYS.dueNow`). */
export const LOOKAHEAD_LABEL_KEYS = {
  starting: 'reports.lookahead.figure.starting',
  running: 'reports.lookahead.figure.running',
  people: 'reports.lookahead.figure.people',
  decisions: 'reports.lookahead.figure.decisions',
  gates: 'reports.lookahead.figure.gates',
  fallingDue: 'reports.lookahead.figure.fallingDue',
  toOrder: 'reports.lookahead.figure.toOrder',
} as const;

/**
 * A gate coming up, said of its stage: `{stage}`, `{day}` — "{stage} starts on {day}: its start
 * gate", "{stage} ends on {day}: its close gate".
 */
export const LOOKAHEAD_GATE_KEYS = {
  start: 'reports.lookahead.gate.start',
  close: 'reports.lookahead.gate.close',
} as const satisfies Record<Gate, string>;

/** Every message key this module adds, for the dictionaries' completeness test. */
export const LOOKAHEAD_MESSAGE_KEYS: readonly string[] = [
  ...Object.values(LOOKAHEAD_LABEL_KEYS),
  ...Object.values(LOOKAHEAD_GATE_KEYS),
];

// ── Types ────────────────────────────────────────────────────────────────────

/** One calendar day of the window. */
export interface LookaheadDay {
  readonly date: string;
  /** A day the site works; `null` when the calendar cannot be counted on. */
  readonly working: boolean | null;
  readonly holiday: boolean;
}

/** The days looked at: `from` (today) to `to`, both included. */
export interface LookaheadWindow {
  readonly from: string;
  readonly to: string;
  /** Every calendar day of it, `from` first. */
  readonly days: readonly LookaheadDay[];
}

/** A row of the starting and running figures: one activity, as the schedule places it. */
export interface LookaheadActivityRow extends ReportRow {
  readonly activityId: string;
  readonly stageId: string;
  readonly stageName: string;
  /** Its breakdown number (`1.2`). */
  readonly number: string | null;
  /** Its scheduled first and last working day. */
  readonly start: string;
  readonly finish: string;
  readonly responsibleId: string | null;
  /** `null` when nobody answers for it, or the person is no longer in the plan. */
  readonly responsibleName: string | null;
  /** It decides the finish date. */
  readonly critical: boolean;
}

/** A row of the decisions figure: an open decision, overdue or to make in the window. */
export interface LookaheadDecisionRow extends DecisionDueRow {
  readonly stageId: string;
  readonly stageName: string;
  /** Working days between deciding and having: why the deadline is before `neededBy`. */
  readonly leadTimeDays: number;
  /** The first day its stage is scheduled to start: the day it must be there. */
  readonly neededBy: string;
}

/** A row of the gates figure: one gate of one stage, coming up in the window. */
export interface LookaheadGateRow extends ReportRow {
  readonly stageId: string;
  readonly gate: Gate;
  /** The day it comes up: the stage's first scheduled start, or its last scheduled finish. */
  readonly day: string;
  /** No item holds it. */
  readonly passed: boolean;
  /** How many checks the gate has: at least one (a gate with none is not listed). */
  readonly checks: number;
  /** The items that hold it (unanswered, or answered no), in position order. */
  readonly holding: readonly GateItem[];
  /** The sentence that names it (`LOOKAHEAD_GATE_KEYS`). */
  readonly messageKey: (typeof LOOKAHEAD_GATE_KEYS)[Gate];
}

/** A row of the falling-due figure: one milestone the schedule expects to be earned in the window. */
export interface FallingDueRow extends AmountRow {
  readonly milestoneId: string;
  readonly commitmentId: string;
  /** The commitment's label, as the person wrote it. */
  readonly commitmentLabel: string;
  readonly stageId: string;
  readonly personId: string | null;
  readonly trigger: MilestoneTrigger;
  readonly shareBp: number;
  readonly target: MilestoneTarget;
  /** The day its fact is expected: what the schedule says, or the day agreed for an advance. */
  readonly day: string;
  /** The milestone's whole cents. */
  readonly milestoneCents: number;
  /** What money already paid ahead on the commitment covers of it; `amountCents` is the rest. */
  readonly coveredCents: number;
}

/** A bar of the window's Gantt, in calendar-day columns from `from`. */
export interface LookaheadBar {
  readonly activityId: string;
  readonly number: string | null;
  readonly name: string;
  readonly stageId: string;
  readonly stageName: string;
  /** The first column, from 0. */
  readonly start: number;
  /** How many columns, first and last included. */
  readonly length: number;
  readonly critical: boolean;
  /** It started before the window: the bar is cut at column 0. */
  readonly startsBefore: boolean;
  /** It finishes after the window: the bar is cut at the last column. */
  readonly endsAfter: boolean;
}

export interface Lookahead {
  readonly today: string;
  readonly window: LookaheadWindow;
  /** The schedule placed at least one activity. Without it, the schedule's figures are empty. */
  readonly placed: boolean;
  readonly starting: Figure<LookaheadActivityRow>;
  readonly running: Figure<LookaheadActivityRow>;
  readonly people: Figure<ExpectedRow>;
  readonly decisions: Figure<LookaheadDecisionRow>;
  readonly gates: Figure<LookaheadGateRow>;
  readonly payments: {
    /** What falls due in the window by a fact the schedule expects, a row per milestone. */
    readonly fallingDue: Figure<FallingDueRow>;
    /** What is earned and not paid now, a row per commitment (slice D2). */
    readonly dueNow: Figure<PlanRow>;
  };
  /**
   * Purchases still to order whose day to order by is in the window or has passed, the earliest
   * first (slice G2). The rows are `purchaseRows`' own.
   */
  readonly toOrder: Figure<PurchaseRow>;
  /** The window's Gantt: every activity starting or running, in breakdown order. */
  readonly bars: readonly LookaheadBar[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const inWindow = (window: LookaheadWindow, day: string | null): day is string =>
  day !== null && day >= window.from && day <= window.to;

function windowOf(scheduled: Schedule, today: string, days: number): LookaheadWindow {
  const calendar = scheduled.calendar;
  const list: LookaheadDay[] = [];
  for (let n = 0; n < days; n += 1) {
    const date = addCalendarDays(today, n);
    list.push({
      date,
      working: calendar === null ? null : isWorkingDay(calendar, date),
      holiday: calendar?.holidays.has(date) ?? false,
    });
  }
  return { from: today, to: list.at(-1)!.date, days: list };
}

// ── The lookahead ────────────────────────────────────────────────────────────

/**
 * The next `days` calendar days of the work from `today` (today included), as of `today`.
 *
 * `today` must be a `YYYY-MM-DD` day and `days` a whole number from 1: anything else is a
 * programming error, and throws a `RangeError`, as the calendar's arithmetic does.
 */
export function lookahead(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  entries: readonly DiaryEntry[],
  today: string,
  days: number = LOOKAHEAD_DAYS,
): Lookahead {
  if (!isIsoDay(today)) throw new RangeError(`Not a YYYY-MM-DD day: ${JSON.stringify(today)}`);
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`A lookahead is a whole number of days from 1, not ${days}`);
  }

  const window = windowOf(scheduled, today, days);
  const stages = new Map(snapshot.stages.map((stage) => [stage.id, stage]));
  const closed = new Set(
    snapshot.stages.filter((stage) => stageState(stage) === 'closed').map((stage) => stage.id),
  );
  const people = new Map(snapshot.people.map((person) => [person.id, person.name]));

  // ── Starting and running ──
  const done = new Set<string>();
  for (const [id, each] of progress(snapshot, entries)) {
    if (each.finishedOn !== null && each.finishedOn <= today) done.add(id);
  }
  const starting: LookaheadActivityRow[] = [];
  const running: LookaheadActivityRow[] = [];
  const bars: LookaheadBar[] = [];
  const listed = new Map<string, ScheduledDates>();
  for (const row of breakdown(snapshot)) {
    if (row.kind !== 'activity') continue;
    const dates = scheduled.dates.get(row.id);
    if (dates === undefined || closed.has(row.stageId) || done.has(row.id)) continue;
    const startsIn = inWindow(window, dates.start);
    const runsInto = dates.start < window.from && dates.finish >= window.from;
    if (!startsIn && !runsInto) continue;
    listed.set(row.id, dates);
    const stageName = stages.get(row.stageId)!.name;
    const critical = scheduled.critical.has(row.id);
    (startsIn ? starting : running).push({
      key: `activity:${row.id}`,
      itemId: row.id,
      title: row.name,
      day: dates.start,
      minutes: 0,
      activityId: row.id,
      stageId: row.stageId,
      stageName,
      number: row.number,
      start: dates.start,
      finish: dates.finish,
      responsibleId: row.responsibleId,
      responsibleName: row.responsibleId === null ? null : (people.get(row.responsibleId) ?? null),
      critical,
    });
    const startsBefore = dates.start < window.from;
    const endsAfter = dates.finish > window.to;
    const first = startsBefore ? 0 : window.days.findIndex((day) => day.date === dates.start);
    const last = endsAfter
      ? window.days.length - 1
      : window.days.findIndex((day) => day.date === dates.finish);
    bars.push({
      activityId: row.id,
      number: row.number,
      name: row.name,
      stageId: row.stageId,
      stageName,
      start: first,
      length: last - first + 1,
      critical,
      startsBefore,
      endsAfter,
    });
  }
  // Breakdown order already; by start first, the sort being stable.
  const byStart = (a: LookaheadActivityRow, b: LookaheadActivityRow): number =>
    compareText(a.start, b.start);
  starting.sort(byStart);
  running.sort(byStart);

  // ── People: the front door's rule, over what is starting or running ──
  const expected = peopleExpectedFigure(
    snapshot,
    { ...scheduled, dates: listed },
    { from: window.from, to: window.to, days: window.days.map((day) => day.date) },
  );

  // ── Decisions ──
  const decisionsOpen = decisionRows(snapshot, scheduled, today).filter(
    (row) => !closed.has(row.stageId),
  );
  const leads = new Map(decisionsOpen.map((row) => [row.decisionId, row]));
  const decisions: LookaheadDecisionRow[] =
    scheduled.calendar === null
      ? []
      : decisionsDueWithin(
          decisionsOpen,
          scheduled.calendar,
          today,
          WEEKLY_DECISION_WINDOW_DAYS,
        ).map((row) => {
          const source = leads.get(row.decisionId)!;
          return {
            ...row,
            stageId: source.stageId,
            stageName: source.stageName!,
            leadTimeDays: source.leadTimeDays,
            neededBy: stageStart(scheduled, source.stageId)!,
          };
        });

  // ── Gates ──
  const gates: LookaheadGateRow[] = [];
  for (const stage of stagesInOrder(snapshot)) {
    const state = stageState(stage);
    if (state === 'closed') continue;
    const coming: Array<[Gate, string | null]> = [
      ['start', state === 'planned' ? stageStart(scheduled, stage.id) : null],
      ['close', stageFinish(scheduled, stage.id)],
    ];
    for (const [gate, day] of coming) {
      if (!inWindow(window, day)) continue;
      const status = gateStatus(stage, snapshot.checks, snapshot.checkAnswers, gate);
      // A gate with no checks asks nothing: it is not something coming up.
      if (status.items.length === 0) continue;
      gates.push({
        key: `gate:${stage.id}:${gate}`,
        itemId: stage.id,
        title: stage.name,
        day,
        minutes: 0,
        stageId: stage.id,
        gate,
        passed: status.passed,
        checks: status.items.length,
        holding: holdingItems(status),
        messageKey: LOOKAHEAD_GATE_KEYS[gate],
      });
    }
  }
  // Stage order, start before close, already; by day first, the sort being stable.
  gates.sort((a, b) => compareText(a.day, b.day));

  // ── Payments falling due ──
  const plans = paymentPlans(snapshot, entries, today);
  const agreed = new Map(snapshot.commitments.map((each) => [each.id, each.agreedOn]));
  const facts = scheduledFacts(scheduled);
  const falling: FallingDueRow[] = [];
  for (const plan of plans.commitments) {
    if (!plan.hasPlan || closed.has(plan.stageId)) continue;
    const commitment = { stageId: plan.stageId, agreedOn: agreed.get(plan.commitmentId)! };
    const coming = plan.milestones
      .filter((status) => !status.earned)
      .map((status) => ({
        status,
        expectation: milestoneExpectation(facts, commitment, status),
      }))
      // A retention held by open snags is money held, not falling due (slice E4).
      .flatMap(({ status, expectation }) =>
        expectation.held ? [] : [{ status, day: expectation.day }],
      )
      .filter((each): each is typeof each & { day: string } => inWindow(window, each.day))
      // Position order already (`milestonesInOrder`); by day first, the sort being stable.
      .sort((a, b) => compareText(a.day, b.day));
    // Money paid ahead of the work on this commitment pays the first of what comes, in order.
    let ahead = plan.ahead.value;
    for (const { status, day } of coming) {
      const covered = Math.min(ahead, status.cents);
      ahead -= covered;
      falling.push({
        key: `milestone:${status.milestone.id}`,
        itemId: status.milestone.id,
        title: status.milestone.label,
        day,
        minutes: 0,
        amountCents: status.cents - covered,
        milestoneId: status.milestone.id,
        commitmentId: plan.commitmentId,
        commitmentLabel: plan.label,
        stageId: plan.stageId,
        personId: plan.personId,
        trigger: status.milestone.trigger,
        shareBp: status.milestone.shareBp,
        target: status.target,
        milestoneCents: status.cents,
        coveredCents: covered,
      });
    }
  }
  // Stable: commitments stay in plan order within a day.
  falling.sort((a, b) => compareText(a.day, b.day));

  // ── To order: the purchases' one rule, the order-by day in the window or passed ──
  const toOrder = purchaseRows(snapshot, scheduled, entries, today)
    .filter(
      (row) =>
        row.state === 'to-order' && !row.done && row.orderBy !== null && row.orderBy <= window.to,
    )
    .sort((a, b) => compareText(a.orderBy!, b.orderBy!) || a.position - b.position);

  return {
    today,
    window,
    placed: scheduled.dates.size > 0,
    starting: counted('lookahead-starting', LOOKAHEAD_LABEL_KEYS.starting, starting),
    running: counted('lookahead-running', LOOKAHEAD_LABEL_KEYS.running, running),
    people: counted('lookahead-people', LOOKAHEAD_LABEL_KEYS.people, expected.rows),
    decisions: counted('lookahead-decisions', LOOKAHEAD_LABEL_KEYS.decisions, decisions),
    gates: counted('lookahead-gates', LOOKAHEAD_LABEL_KEYS.gates, gates),
    payments: {
      fallingDue: moneyFigure('lookahead-falling-due', LOOKAHEAD_LABEL_KEYS.fallingDue, falling),
      dueNow: dueFigure(snapshot, entries, today),
    },
    toOrder: counted('lookahead-to-order', LOOKAHEAD_LABEL_KEYS.toOrder, toOrder),
    bars,
  };
}
