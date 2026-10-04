/**
 * Funding: where the money for the work comes from, and what has arrived (slice E2, ADR-042).
 *
 * **Funding is plan, receipts are facts.** A funding row says money is expected — savings on hand, a
 * loan's tranche, a client's instalment — from where, how much and on what day; it is edited like a
 * commitment and is never locked by approval. A receipt is money that arrived: one row of an
 * append-only ledger exactly like the payments ledger. A mistake is a new receipt that reverses it, the
 * only kind whose amount is negative, counted against the funding row of the receipt it reverses, so
 * a pair nets out where the original was counted. A receipt may name no funding row: money that
 * arrived unplanned.
 *
 * Per funding row: **received** is the receipts naming it to date, reversals included; **remaining**
 * is its amount less that, from zero (money received over the amount is received, not owed back);
 * **late** is a row still expecting money whose day has passed. A row is **removable** only while no
 * receipt names it (the host refuses otherwise; the domain says so first).
 *
 * **Today is an input**, as everywhere in the domain. What this module is not: storage or text.
 */

import { counted, moneyFigure, type AmountRow, type Figure } from './figure';
import { compareText, type Funding, type FundingReceipt, type WorkSnapshot } from './plan';

export type { Funding, FundingReceipt } from './plan';

// ── Message keys ─────────────────────────────────────────────────────────────

/** The figures' names: "Money received", "Funding late". */
export const FUNDING_LABEL_KEYS = {
  received: 'money.funding.figure.received',
  late: 'money.funding.figure.late',
} as const;

/** Every message key this module adds, for the dictionaries' completeness test. */
export const FUNDING_MESSAGE_KEYS: readonly string[] = Object.values(FUNDING_LABEL_KEYS);

// ── Reading the ledger ───────────────────────────────────────────────────────

/** The funding rows in the order the plan shows them: by position, then by id. */
export function fundingInOrder(snapshot: WorkSnapshot): Funding[] {
  return [...snapshot.funding].sort((a, b) => a.position - b.position || compareText(a.id, b.id));
}

/**
 * The funding row a receipt counts for: a reversal counts for the row of the receipt it reverses (a
 * reversal of a receipt the ledger does not hold counts for its own).
 */
function fundingOf(
  receipt: FundingReceipt,
  bySeq: ReadonlyMap<number, FundingReceipt>,
): string | null {
  const original = receipt.reversesSeq === null ? undefined : bySeq.get(receipt.reversesSeq);
  return (original ?? receipt).fundingId;
}

/** A row of a receipts figure: one receipt, as the ledger recorded it. */
export interface ReceiptRow extends AmountRow {
  readonly seq: number;
  /** The funding row it counts for (a reversal's is its original's); `null` when unplanned. */
  readonly fundingId: string | null;
  readonly reversesSeq: number | null;
}

/**
 * The receipts recorded on or before `today`, in seq order, each with the funding row it counts for.
 * The ledger never holds a day after the day it was written; one after `today` is not money yet.
 */
export function receiptRows(snapshot: WorkSnapshot, today: string): ReceiptRow[] {
  const bySeq = new Map(snapshot.fundingReceipts.map((receipt) => [receipt.seq, receipt]));
  return [...snapshot.fundingReceipts]
    .filter((receipt) => receipt.day <= today)
    .sort((a, b) => a.seq - b.seq)
    .map((receipt) => ({
      key: `receipt:${receipt.seq}`,
      itemId: receipt.fundingId,
      title: receipt.note ?? '',
      day: receipt.day,
      minutes: 0,
      amountCents: receipt.amountCents,
      seq: receipt.seq,
      fundingId: fundingOf(receipt, bySeq),
      reversesSeq: receipt.reversesSeq,
    }));
}

/** One funding row and what has arrived of it. */
export interface FundingStatus {
  readonly funding: Funding;
  /** The receipts counted for it to date, reversals included: their sum is `received.value`. */
  readonly received: Figure<ReceiptRow>;
  /** Its amount less what was received, from zero. */
  readonly remainingCents: number;
  /** Still expecting money, and its day is before today: not counted as money (slice E2). */
  readonly late: boolean;
  /** No receipt (nor a reversal of one) names it: the host lets it be removed. */
  readonly removable: boolean;
}

/** Every funding row, in plan order, with what has arrived of it as of `today`. */
export function fundingStatuses(snapshot: WorkSnapshot, today: string): FundingStatus[] {
  const rows = receiptRows(snapshot, today);
  // A reversal's original names the row already: every receipt that names one is enough to ask.
  const named = new Set(snapshot.fundingReceipts.map((receipt) => receipt.fundingId));
  return fundingInOrder(snapshot).map((funding) => {
    const received = moneyFigure(
      `received:funding:${funding.id}`,
      FUNDING_LABEL_KEYS.received,
      rows.filter((row) => row.fundingId === funding.id),
    );
    const remainingCents = Math.max(0, funding.amountCents - received.value);
    return {
      funding,
      received,
      remainingCents,
      late: remainingCents > 0 && funding.expectedOn < today,
      removable: !named.has(funding.id),
    };
  });
}

/** Can this funding row be removed: is it in the plan, with no receipt naming it? */
export function fundingRemovable(snapshot: WorkSnapshot, fundingId: string): boolean {
  return (
    snapshot.funding.some((funding) => funding.id === fundingId) &&
    !snapshot.fundingReceipts.some((receipt) => receipt.fundingId === fundingId)
  );
}

/** A row of the late figure: a funding row still expecting money after its day. */
export interface LateFundingRow extends AmountRow {
  readonly fundingId: string;
  /** The day it was expected. */
  readonly expectedOn: string;
  /** What has arrived of it; `amountCents` is what has not. */
  readonly receivedCents: number;
}

/**
 * The funding rows still expecting money after their day, counted: "1 expected fund is late". Each
 * row's amount is what has not arrived, its day the day it was expected.
 */
export function lateFundingFigure(snapshot: WorkSnapshot, today: string): Figure<LateFundingRow> {
  return counted(
    'funding-late',
    FUNDING_LABEL_KEYS.late,
    fundingStatuses(snapshot, today)
      .filter((status) => status.late)
      .map((status) => ({
        key: `funding:${status.funding.id}`,
        itemId: status.funding.id,
        title: status.funding.label,
        day: status.funding.expectedOn,
        minutes: 0,
        amountCents: status.remainingCents,
        fundingId: status.funding.id,
        expectedOn: status.funding.expectedOn,
        receivedCents: status.received.value,
      })),
  );
}
