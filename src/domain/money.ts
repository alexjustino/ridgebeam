/**
 * Money: planned, committed and paid, per stage, per trade and for the work, every figure carrying
 * its rows.
 *
 * Three amounts, three sources. **Planned** is typed as cost lines on a stage or its activities.
 * **Committed** comes from commitments (a quote or contract accepted). **Paid** comes from the
 * payments ledger, which is append-only: a payment is a fact, and a mistake is a new payment that
 * reverses it, the only kind whose amount is negative. **Remaining** is planned less paid, and
 * **variance** is committed less planned; their rows are the two sets, signed.
 *
 * Amounts are whole numbers of the currency's minor unit (cents): **money is never a float**. The
 * interface formats them in the work's currency.
 *
 * **Paid over committed is flagged, not refused**: a stage or a commitment paid beyond what was
 * committed is listed with the excess. Paying without a commitment is paying over one of zero.
 *
 * A cost line has no trade, so planned exists per stage and for the work, not per trade; per trade
 * there is what was committed to it, what was paid to it, and what is still owed.
 *
 * **Today is an input**, as everywhere in the domain. What this module is not: storage or text.
 */

import { addCalendarDays, isIsoDay, isWorkingDay, workingDaysBetween } from './calendar';
import { counted, moneyFigure, type AmountRow, type Figure } from './figure';
import {
  compareText,
  stagesInOrder,
  type Commitment,
  type CostLine,
  type Payment,
  type WorkSnapshot,
} from './plan';
import type { Schedule } from './schedule';

export type { Commitment, CostLine, Payment } from './plan';

// ── Rows ─────────────────────────────────────────────────────────────────────

export type MoneySource = 'cost-line' | 'commitment' | 'payment';

/** A row of a money figure: one cost line, commitment or payment, signed as the figure counts it. */
export interface MoneyRow extends AmountRow {
  readonly source: MoneySource;
  /** The cost line's or commitment's id, or the payment's seq as text. */
  readonly sourceId: string;
  readonly stageId: string;
  readonly personId: string | null;
  readonly label: string;
}

/**
 * The stage a cost line counts for: its activity's stage when the activity is in the plan (a
 * stage's planned money is its own lines and its activities' lines), otherwise the stage it names.
 */
export function stageOfLine(snapshot: WorkSnapshot, line: CostLine): string {
  if (line.activityId === null) return line.stageId;
  return snapshot.activities.find((a) => a.id === line.activityId)?.stageId ?? line.stageId;
}

/**
 * What a payment is about: a reversal counts against the stage, person and commitment of the payment
 * it reverses, so a pair nets out where the original was counted.
 */
function attributionOf(
  snapshot: WorkSnapshot,
  payment: Payment,
): { stageId: string; personId: string | null; commitmentId: string | null } {
  const original =
    payment.reversesSeq === null
      ? undefined
      : snapshot.payments.find((each) => each.seq === payment.reversesSeq);
  const source = original ?? payment;
  const commitment = snapshot.commitments.find((each) => each.id === source.commitmentId);
  return {
    stageId: source.stageId,
    personId: source.personId ?? commitment?.personId ?? null,
    commitmentId: source.commitmentId,
  };
}

function lineRow(snapshot: WorkSnapshot, line: CostLine, sign: 1 | -1): MoneyRow {
  return {
    key: `cost-line:${line.id}`,
    itemId: line.activityId ?? line.stageId,
    title: line.label,
    day: null,
    minutes: 0,
    amountCents: sign * line.amountCents,
    source: 'cost-line',
    sourceId: line.id,
    stageId: stageOfLine(snapshot, line),
    personId: null,
    label: line.label,
  };
}

function commitmentRow(commitment: Commitment, sign: 1 | -1): MoneyRow {
  return {
    key: `commitment:${commitment.id}`,
    itemId: commitment.id,
    title: commitment.label,
    day: commitment.agreedOn,
    minutes: 0,
    amountCents: sign * commitment.amountCents,
    source: 'commitment',
    sourceId: commitment.id,
    stageId: commitment.stageId,
    personId: commitment.personId,
    label: commitment.label,
  };
}

function paymentRow(snapshot: WorkSnapshot, payment: Payment, sign: 1 | -1): MoneyRow {
  const about = attributionOf(snapshot, payment);
  return {
    key: `payment:${payment.seq}`,
    itemId: payment.id,
    title: payment.whatFor,
    day: payment.day,
    minutes: 0,
    amountCents: sign * payment.amountCents,
    source: 'payment',
    sourceId: String(payment.seq),
    stageId: about.stageId,
    personId: about.personId,
    label: payment.whatFor,
  };
}

// ── Scopes ───────────────────────────────────────────────────────────────────

/** What a figure is about: the whole work, one stage, or one trade (`null`: no trade yet). */
export type MoneyScope =
  | { readonly kind: 'work' }
  | { readonly kind: 'stage'; readonly stageId: string }
  | { readonly kind: 'trade'; readonly trade: string | null };

/** A trade as written, trimmed; empty is no trade. */
function normalTrade(trade: string | null | undefined): string | null {
  const trimmed = (trade ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/** The trade of a person, or `null` for no person, an unknown one, or one with no trade yet. */
export function tradeOf(snapshot: WorkSnapshot, personId: string | null): string | null {
  if (personId === null) return null;
  return normalTrade(snapshot.people.find((person) => person.id === personId)?.trade);
}

function inScope(snapshot: WorkSnapshot, row: MoneyRow, scope: MoneyScope): boolean {
  if (scope.kind === 'work') return true;
  if (scope.kind === 'stage') return row.stageId === scope.stageId;
  // A cost line has no trade: it belongs to no trade's figures, not to "no trade yet".
  return row.source !== 'cost-line' && tradeOf(snapshot, row.personId) === scope.trade;
}

function scopeId(scope: MoneyScope): string {
  if (scope.kind === 'work') return 'work';
  if (scope.kind === 'stage') return `stage:${scope.stageId}`;
  return `trade:${scope.trade ?? ''}`;
}

export const MONEY_LABEL_KEYS = {
  planned: 'money.figure.planned',
  committed: 'money.figure.committed',
  paid: 'money.figure.paid',
  remaining: 'money.figure.remaining',
  variance: 'money.figure.variance',
  owed: 'money.figure.owed',
} as const;

function plannedRows(snapshot: WorkSnapshot, sign: 1 | -1): MoneyRow[] {
  return snapshot.costLines.map((line) => lineRow(snapshot, line, sign));
}
function committedRows(snapshot: WorkSnapshot, sign: 1 | -1): MoneyRow[] {
  return snapshot.commitments.map((commitment) => commitmentRow(commitment, sign));
}
function paidRows(snapshot: WorkSnapshot, sign: 1 | -1): MoneyRow[] {
  return [...snapshot.payments]
    .sort((a, b) => a.seq - b.seq)
    .map((payment) => paymentRow(snapshot, payment, sign));
}

function figure(
  snapshot: WorkSnapshot,
  scope: MoneyScope,
  name: keyof typeof MONEY_LABEL_KEYS,
  rows: MoneyRow[],
): Figure<MoneyRow> {
  return moneyFigure(
    `${name}:${scopeId(scope)}`,
    MONEY_LABEL_KEYS[name],
    rows.filter((row) => inScope(snapshot, row, scope)),
  );
}

/**
 * Planned: the cost lines. Per trade it is empty: a cost line has no trade (see the module header).
 */
export function plannedOf(snapshot: WorkSnapshot, scope: MoneyScope): Figure<MoneyRow> {
  return figure(snapshot, scope, 'planned', plannedRows(snapshot, 1));
}

/** Committed: the commitments. */
export function committedOf(snapshot: WorkSnapshot, scope: MoneyScope): Figure<MoneyRow> {
  return figure(snapshot, scope, 'committed', committedRows(snapshot, 1));
}

/** Paid: the payments, reversals included, so a reversed payment nets to nothing. */
export function paidOf(snapshot: WorkSnapshot, scope: MoneyScope): Figure<MoneyRow> {
  return figure(snapshot, scope, 'paid', paidRows(snapshot, 1));
}

/** Remaining: planned less paid. Rows: the cost lines, and the payments negated. */
export function remainingOf(snapshot: WorkSnapshot, scope: MoneyScope): Figure<MoneyRow> {
  return figure(snapshot, scope, 'remaining', [
    ...plannedRows(snapshot, 1),
    ...paidRows(snapshot, -1),
  ]);
}

/** Variance: committed less planned. Rows: the commitments, and the cost lines negated. */
export function varianceOf(snapshot: WorkSnapshot, scope: MoneyScope): Figure<MoneyRow> {
  return figure(snapshot, scope, 'variance', [
    ...committedRows(snapshot, 1),
    ...plannedRows(snapshot, -1),
  ]);
}

/** Owed: committed less paid, what is still due on the commitments. Rows: both, signed. */
export function owedOf(snapshot: WorkSnapshot, scope: MoneyScope): Figure<MoneyRow> {
  return figure(snapshot, scope, 'owed', [
    ...committedRows(snapshot, 1),
    ...paidRows(snapshot, -1),
  ]);
}

// ── Tables ───────────────────────────────────────────────────────────────────

export interface StageMoney {
  readonly stageId: string;
  readonly planned: Figure<MoneyRow>;
  readonly committed: Figure<MoneyRow>;
  readonly paid: Figure<MoneyRow>;
  readonly remaining: Figure<MoneyRow>;
  readonly variance: Figure<MoneyRow>;
  /** How far paid is over committed, in cents; `null` when it is not. */
  readonly overCommittedCents: number | null;
}

/** The By stage table: every stage in plan order, with its five figures. */
export function moneyByStage(snapshot: WorkSnapshot): StageMoney[] {
  return stagesInOrder(snapshot).map((stage) => {
    const scope: MoneyScope = { kind: 'stage', stageId: stage.id };
    const committed = committedOf(snapshot, scope);
    const paid = paidOf(snapshot, scope);
    return {
      stageId: stage.id,
      planned: plannedOf(snapshot, scope),
      committed,
      paid,
      remaining: remainingOf(snapshot, scope),
      variance: varianceOf(snapshot, scope),
      overCommittedCents: paid.value > committed.value ? paid.value - committed.value : null,
    };
  });
}

export interface TradeMoney {
  /** The trade, or `null` for "no trade yet". */
  readonly trade: string | null;
  readonly committed: Figure<MoneyRow>;
  readonly paid: Figure<MoneyRow>;
  readonly owed: Figure<MoneyRow>;
}

/**
 * The By trade table: every trade of the people, in alphabetical order, then "no trade yet" when
 * anything was committed or paid without one.
 */
export function moneyByTrade(snapshot: WorkSnapshot): TradeMoney[] {
  const trades = new Set<string>();
  for (const person of snapshot.people) {
    const trade = normalTrade(person.trade);
    if (trade !== null) trades.add(trade);
  }
  const named = [...trades].sort(compareText);
  const rows = (trade: string | null): TradeMoney => {
    const scope: MoneyScope = { kind: 'trade', trade };
    return {
      trade,
      committed: committedOf(snapshot, scope),
      paid: paidOf(snapshot, scope),
      owed: owedOf(snapshot, scope),
    };
  };
  const result = named.map(rows);
  const none = rows(null);
  if (none.committed.rows.length > 0 || none.paid.rows.length > 0) result.push(none);
  return result;
}

export interface WorkMoney {
  readonly planned: Figure<MoneyRow>;
  readonly committed: Figure<MoneyRow>;
  readonly paid: Figure<MoneyRow>;
  readonly remaining: Figure<MoneyRow>;
  readonly variance: Figure<MoneyRow>;
}

/** The work's five figures. The stages' figures add up to these. */
export function moneyOfWork(snapshot: WorkSnapshot): WorkMoney {
  const scope: MoneyScope = { kind: 'work' };
  return {
    planned: plannedOf(snapshot, scope),
    committed: committedOf(snapshot, scope),
    paid: paidOf(snapshot, scope),
    remaining: remainingOf(snapshot, scope),
    variance: varianceOf(snapshot, scope),
  };
}

// ── Paid over committed ──────────────────────────────────────────────────────

/** A stage or a commitment paid beyond what was committed: allowed, and flagged with the excess. */
export interface OverCommittedRow extends AmountRow {
  readonly scope: 'stage' | 'commitment';
  /** The stage's or commitment's id. */
  readonly id: string;
  readonly stageId: string;
  readonly committedCents: number;
  readonly paidCents: number;
}

/**
 * Everything paid over what was committed: stages (in plan order), then commitments (in the order
 * given). Each row's amount is the excess.
 */
export function overCommitted(snapshot: WorkSnapshot): {
  stages: OverCommittedRow[];
  commitments: OverCommittedRow[];
} {
  const stages: OverCommittedRow[] = [];
  for (const each of moneyByStage(snapshot)) {
    if (each.overCommittedCents === null) continue;
    const stage = snapshot.stages.find((candidate) => candidate.id === each.stageId)!;
    stages.push({
      key: `stage:${stage.id}`,
      itemId: stage.id,
      title: stage.name,
      day: null,
      minutes: 0,
      amountCents: each.overCommittedCents,
      scope: 'stage',
      id: stage.id,
      stageId: stage.id,
      committedCents: each.committed.value,
      paidCents: each.paid.value,
    });
  }

  const commitments: OverCommittedRow[] = [];
  for (const commitment of snapshot.commitments) {
    const paid = snapshot.payments
      .filter((payment) => attributionOf(snapshot, payment).commitmentId === commitment.id)
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    if (paid <= commitment.amountCents) continue;
    commitments.push({
      key: `commitment:${commitment.id}`,
      itemId: commitment.id,
      title: commitment.label,
      day: commitment.agreedOn,
      minutes: 0,
      amountCents: paid - commitment.amountCents,
      scope: 'commitment',
      id: commitment.id,
      stageId: commitment.stageId,
      committedCents: commitment.amountCents,
      paidCents: paid,
    });
  }
  return { stages, commitments };
}

export const OVER_COMMITTED_LABEL_KEY = 'money.figure.overCommitted';

/** The stages paid over what was committed, as a counted figure: "2 stages paid over …". */
export function overCommittedFigure(snapshot: WorkSnapshot): Figure<OverCommittedRow> {
  return counted('over-committed', OVER_COMMITTED_LABEL_KEY, overCommitted(snapshot).stages);
}

// ── The S-curve ──────────────────────────────────────────────────────────────

export interface SCurveDay {
  readonly day: string;
  /** Planned money spent by the end of this day, cumulative, cents. */
  readonly planned: number;
  /** Money paid by the end of this day, cumulative, cents. */
  readonly paid: number;
  /** After today: nothing has been paid yet on it. The chart stops the paid line at today. */
  readonly future: boolean;
}

export interface SCurve {
  readonly days: readonly SCurveDay[];
  readonly totals: { readonly planned: number; readonly paid: number };
  /** Cost lines that could not be put on the schedule and were placed on the work's start. */
  readonly unscheduled: readonly string[];
}

/** Split whole cents over n days as evenly as whole cents allow, the odd cents first. */
function spread(amount: number, n: number): number[] {
  const share = Math.trunc(amount / n);
  const rest = amount - share * n;
  return Array.from(
    { length: n },
    (_, index) => share + (index < Math.abs(rest) ? Math.sign(rest) : 0),
  );
}

/**
 * Planned against paid, cumulative, calendar day by calendar day.
 *
 * Each cost line is spread evenly over the working days its activity is scheduled on; a stage's own
 * line over the working days of the stage's span (its first start to its last finish). A line that
 * cannot be scheduled (no duration, nothing scheduled in its stage, no calendar) is placed on the
 * work's start day and listed in `unscheduled`: the chart says what it put where. Payments count on
 * their day, and a reversal on the day of the payment it reverses, so paid never runs backwards.
 * The days run from the earliest to the latest day anything falls on, and to today; both lines end
 * at the totals.
 */
export function sCurve(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  payments: readonly Payment[],
  today: string,
): SCurve {
  const plannedOn = new Map<string, number>();
  const paidOn = new Map<string, number>();
  const add = (map: Map<string, number>, day: string, cents: number) =>
    map.set(day, (map.get(day) ?? 0) + cents);
  const unscheduled: string[] = [];
  const calendar = scheduled.calendar;

  const anchor = isIsoDay(snapshot.work.startDate)
    ? snapshot.work.startDate
    : isIsoDay(today)
      ? today
      : null;

  for (const line of snapshot.costLines) {
    let span: { start: string; finish: string } | undefined;
    if (line.activityId !== null) {
      span = scheduled.dates.get(line.activityId);
    } else {
      const stageId = stageOfLine(snapshot, line);
      const dates = scheduled.activities
        .filter((activity) => activity.stageId === stageId)
        .map((activity) => scheduled.dates.get(activity.id))
        .filter((each): each is { start: string; finish: string } => each !== undefined);
      if (dates.length > 0) {
        span = {
          start: dates.reduce(
            (first, each) => (each.start < first ? each.start : first),
            dates[0]!.start,
          ),
          finish: dates.reduce(
            (last, each) => (each.finish > last ? each.finish : last),
            dates[0]!.finish,
          ),
        };
      }
    }
    if (span === undefined || calendar === null) {
      unscheduled.push(line.id);
      if (anchor !== null) add(plannedOn, anchor, line.amountCents);
      continue;
    }
    const days: string[] = [];
    for (let day = span.start; day <= span.finish; day = addCalendarDays(day, 1)) {
      if (isWorkingDay(calendar, day)) days.push(day);
    }
    const shares = spread(line.amountCents, workingDaysBetween(calendar, span.start, span.finish));
    days.forEach((day, index) => add(plannedOn, day, shares[index]!));
  }

  const byPayment = new Map(payments.map((payment) => [payment.seq, payment]));
  for (const payment of payments) {
    const original = payment.reversesSeq === null ? undefined : byPayment.get(payment.reversesSeq);
    add(paidOn, original?.day ?? payment.day, payment.amountCents);
  }

  const edges = [...plannedOn.keys(), ...paidOn.keys(), ...(isIsoDay(today) ? [today] : [])];
  const totals = {
    planned: snapshot.costLines.reduce((sum, line) => sum + line.amountCents, 0),
    paid: payments.reduce((sum, payment) => sum + payment.amountCents, 0),
  };
  if (edges.length === 0) return { days: [], totals, unscheduled };

  const first = edges.reduce((a, b) => (b < a ? b : a));
  const last = edges.reduce((a, b) => (b > a ? b : a));
  const days: SCurveDay[] = [];
  let planned = 0;
  let paid = 0;
  for (let day = first; day <= last; day = addCalendarDays(day, 1)) {
    planned += plannedOn.get(day) ?? 0;
    paid += paidOn.get(day) ?? 0;
    days.push({ day, planned, paid, future: isIsoDay(today) && day > today });
  }
  return { days, totals, unscheduled };
}

// ── Checking a payment before the host is asked ──────────────────────────────

/** A payment, or a reversal, as the interface asks the host to record it. */
export interface PaymentDraft {
  readonly day: string;
  readonly stageId: string | null;
  readonly personId: string | null;
  readonly commitmentId: string | null;
  readonly amountCents: number;
  readonly whatFor: string;
  /** For a reversal, the seq it reverses; its amount is then negative. */
  readonly reversesSeq: number | null;
}

/** Why a payment is refused. The interface turns each code into a sentence. */
export type PaymentProblem =
  | { readonly code: 'invalid-day' }
  | { readonly code: 'future-day' }
  | { readonly code: 'no-stage' }
  | { readonly code: 'unknown-stage' }
  | { readonly code: 'unknown-person' }
  | { readonly code: 'unknown-commitment' }
  | { readonly code: 'commitment-of-another-stage' }
  | { readonly code: 'invalid-amount' }
  | { readonly code: 'amount-not-positive' }
  | { readonly code: 'reverses-unknown' }
  | { readonly code: 'reverses-a-reversal' }
  | { readonly code: 'already-reversed' }
  | { readonly code: 'reversal-not-negative' }
  | { readonly code: 'reversal-exceeds' }
  | { readonly code: 'reversal-without-note' }
  | { readonly code: 'what-for-too-long' };

const WHAT_FOR_LIMIT = 200;

/**
 * Check a payment against today and the plan before the host is asked. Never throws; every problem
 * is reported. Refused: a day that is not a day, or after today; no stage, or one not in the plan;
 * a person or commitment not in the plan, or a commitment of another stage; an amount that is not
 * whole cents; a payment of zero or less. A reversal must name a payment the ledger has, that is not
 * itself a reversal and not already reversed, with a negative amount no larger than the original,
 * and a note saying why. Paying over what was committed is not refused: it is flagged.
 */
export function validatePayment(
  draft: PaymentDraft,
  today: string,
  snapshot: WorkSnapshot,
): PaymentProblem[] {
  const problems: PaymentProblem[] = [];
  if (!isIsoDay(draft.day)) problems.push({ code: 'invalid-day' });
  else if (isIsoDay(today) && draft.day > today) problems.push({ code: 'future-day' });

  if (draft.stageId === null || draft.stageId === '') problems.push({ code: 'no-stage' });
  else if (!snapshot.stages.some((stage) => stage.id === draft.stageId)) {
    problems.push({ code: 'unknown-stage' });
  }

  if (draft.personId !== null && !snapshot.people.some((person) => person.id === draft.personId)) {
    problems.push({ code: 'unknown-person' });
  }
  if (draft.commitmentId !== null) {
    const commitment = snapshot.commitments.find((each) => each.id === draft.commitmentId);
    if (commitment === undefined) problems.push({ code: 'unknown-commitment' });
    else if (draft.stageId !== null && commitment.stageId !== draft.stageId) {
      problems.push({ code: 'commitment-of-another-stage' });
    }
  }

  if (!Number.isInteger(draft.amountCents)) {
    problems.push({ code: 'invalid-amount' });
  } else if (draft.reversesSeq === null) {
    if (draft.amountCents <= 0) problems.push({ code: 'amount-not-positive' });
  } else {
    const original = snapshot.payments.find((payment) => payment.seq === draft.reversesSeq);
    if (original === undefined) {
      problems.push({ code: 'reverses-unknown' });
    } else if (original.reversesSeq !== null) {
      problems.push({ code: 'reverses-a-reversal' });
    } else {
      if (snapshot.payments.some((payment) => payment.reversesSeq === original.seq)) {
        problems.push({ code: 'already-reversed' });
      }
      if (draft.amountCents >= 0) problems.push({ code: 'reversal-not-negative' });
      else if (-draft.amountCents > original.amountCents)
        problems.push({ code: 'reversal-exceeds' });
    }
    if (draft.whatFor.trim() === '') problems.push({ code: 'reversal-without-note' });
  }

  if (draft.whatFor.length > WHAT_FOR_LIMIT) problems.push({ code: 'what-for-too-long' });
  return problems;
}

/**
 * The draft that reverses a payment in full, dated today, with the person's note: what "Reverse…"
 * sends. Validate it like any other payment.
 */
export function reversalDraft(payment: Payment, note: string, today: string): PaymentDraft {
  return {
    day: today,
    stageId: payment.stageId,
    personId: payment.personId,
    commitmentId: payment.commitmentId,
    amountCents: -payment.amountCents,
    whatFor: note,
    reversesSeq: payment.seq,
  };
}
