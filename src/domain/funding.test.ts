import { describe, expect, it } from 'vitest';

import { snapshot } from './__fixtures__/plan';
import { traceable } from './figure';
import {
  FUNDING_LABEL_KEYS,
  FUNDING_MESSAGE_KEYS,
  fundingInOrder,
  fundingRemovable,
  fundingStatuses,
  lateFundingFigure,
  receiptRows,
} from './funding';
import type { Funding, FundingReceipt } from './plan';

const TODAY = '2026-09-10';

const funding = (
  id: string,
  position: number,
  amountCents: number,
  expectedOn: string,
): Funding => ({
  id,
  position,
  label: `Funding ${id}`,
  source: null,
  amountCents,
  expectedOn,
  note: null,
});

const receipt = (
  seq: number,
  fundingId: string | null,
  amountCents: number,
  day: string,
  reversesSeq: number | null = null,
): FundingReceipt => ({
  seq,
  fundingId,
  amountCents,
  day,
  note: null,
  reversesSeq,
  authorName: 'Sample author',
  createdAt: `${day}T12:00:00.000Z`,
});

describe('funding rows', () => {
  it('are listed by position, then by id', () => {
    const plan = snapshot({
      funding: [
        funding('b', 2, 1_00, TODAY),
        funding('c', 1, 1_00, TODAY),
        funding('a', 2, 1_00, TODAY),
      ],
    });
    expect(fundingInOrder(plan).map((each) => each.id)).toEqual(['c', 'a', 'b']);
  });

  it('count the receipts naming them as received, and the rest as remaining', () => {
    const plan = snapshot({
      funding: [funding('loan', 1, 1_000_00, '2026-09-20')],
      fundingReceipts: [receipt(1, 'loan', 300_00, '2026-09-05'), receipt(2, null, 50_00, TODAY)],
    });
    const [status] = fundingStatuses(plan, TODAY);
    expect(status).toMatchObject({ remainingCents: 700_00, late: false, removable: false });
    expect(status!.received.value).toBe(300_00);
    expect(traceable(status!.received)).toBe(true);
  });

  it('count a reversal against the row of the receipt it reverses, so the pair nets out', () => {
    const plan = snapshot({
      funding: [funding('loan', 1, 1_000_00, '2026-09-20')],
      fundingReceipts: [
        receipt(1, 'loan', 300_00, '2026-09-05'),
        // A reversal written without the row: it still counts against the original's.
        receipt(2, null, -300_00, '2026-09-06', 1),
      ],
    });
    const [status] = fundingStatuses(plan, TODAY);
    expect(status!.received.value).toBe(0);
    expect(status!.remainingCents).toBe(1_000_00);
    expect(receiptRows(plan, TODAY).map((row) => [row.seq, row.fundingId])).toEqual([
      [1, 'loan'],
      [2, 'loan'],
    ]);
    // Money has moved on it: it cannot be removed, even though nothing is left received.
    expect(status!.removable).toBe(false);
  });

  it('never owe money received over the amount: the remaining is zero, not negative', () => {
    const plan = snapshot({
      funding: [funding('loan', 1, 100_00, '2026-09-20')],
      fundingReceipts: [receipt(1, 'loan', 150_00, '2026-09-05')],
    });
    expect(fundingStatuses(plan, TODAY)[0]!.remainingCents).toBe(0);
  });

  it('do not count a receipt dated after today: it is not money yet', () => {
    const plan = snapshot({
      funding: [funding('loan', 1, 100_00, '2026-09-20')],
      fundingReceipts: [receipt(1, 'loan', 100_00, '2026-09-11')],
    });
    expect(fundingStatuses(plan, TODAY)[0]!.remainingCents).toBe(100_00);
    expect(receiptRows(plan, TODAY)).toEqual([]);
  });

  it('are late when their day has passed with money still expected; on the day itself they are not', () => {
    const plan = snapshot({
      funding: [
        funding('yesterday', 1, 100_00, '2026-09-09'),
        funding('today', 2, 100_00, TODAY),
        funding('paid', 3, 100_00, '2026-09-01'),
        funding('part', 4, 100_00, '2026-09-02'),
      ],
      fundingReceipts: [
        receipt(1, 'paid', 100_00, '2026-09-01'),
        receipt(2, 'part', 40_00, '2026-09-03'),
      ],
    });
    expect(fundingStatuses(plan, TODAY).map((status) => [status.funding.id, status.late])).toEqual([
      ['yesterday', true],
      ['today', false],
      ['paid', false],
      ['part', true],
    ]);
    const late = lateFundingFigure(plan, TODAY);
    expect(late).toMatchObject({ id: 'funding-late', label: FUNDING_LABEL_KEYS.late, value: 2 });
    expect(late.rows.map((row) => [row.fundingId, row.amountCents, row.receivedCents])).toEqual([
      ['yesterday', 100_00, 0],
      ['part', 60_00, 40_00],
    ]);
    expect(traceable(late)).toBe(true);
  });

  it('can be removed only while no receipt names them, and only when they exist', () => {
    const plan = snapshot({
      funding: [funding('free', 1, 100_00, TODAY), funding('named', 2, 100_00, TODAY)],
      fundingReceipts: [receipt(1, 'named', 10_00, '2026-09-01')],
    });
    expect(fundingRemovable(plan, 'free')).toBe(true);
    expect(fundingRemovable(plan, 'named')).toBe(false);
    expect(fundingRemovable(plan, 'gone')).toBe(false);
  });

  it('name their figures by message key', () => {
    expect(FUNDING_MESSAGE_KEYS).toEqual([
      'money.funding.figure.received',
      'money.funding.figure.late',
    ]);
  });
});
