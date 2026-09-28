import { describe, expect, it } from 'vitest';

import { activity, snapshot, stage, takeBaseline } from './__fixtures__/plan';
import { traceable } from './figure';
import {
  committedOf,
  moneyByStage,
  moneyByTrade,
  moneyOfWork,
  NOT_PRICED_KEY,
  overCommitted,
  overCommittedFigure,
  owedOf,
  paidOf,
  plannedOf,
  remainingOf,
  reversalDraft,
  sCurve,
  stageOfLine,
  tradeOf,
  unpricedRows,
  validatePayment,
  varianceOf,
  type Commitment,
  type CostLine,
  type Payment,
  type PaymentDraft,
} from './money';
import type { WorkSnapshot } from './plan';
import { readiness, readinessByRule } from './readiness';
import { schedule } from './schedule';

const line = (
  id: string,
  stageId: string,
  amountCents: number,
  activityId: string | null = null,
): CostLine => ({ id, stageId, activityId, label: `Line ${id}`, amountCents });

const commitment = (
  id: string,
  stageId: string,
  amountCents: number,
  personId: string | null = null,
): Commitment => ({
  id,
  stageId,
  personId,
  label: `Commitment ${id}`,
  amountCents,
  agreedOn: '2026-08-28',
  documentHash: null,
});

const payment = (
  seq: number,
  day: string,
  stageId: string,
  amountCents: number,
  parts: Partial<Payment> = {},
): Payment => ({
  id: `payment-${seq}`,
  seq,
  day,
  personId: null,
  stageId,
  commitmentId: null,
  amountCents,
  whatFor: `Payment ${seq}`,
  receiptHash: null,
  reversesSeq: null,
  authorName: 'Sample author',
  createdAt: `${day}T12:00:00.000Z`,
  ...parts,
});

/**
 * The e2e's work, in cents. Tiling (one activity, 3 days, Tue 1 – Thu 3 September 2026): Tiles
 * 1 200.00 on the activity and Labour 800.00 on the stage; the tiler's quote 1 500.00; paid
 * 1 000.00, then 700.00, then the 700.00 reversed.
 */
const TILER = {
  id: 'tiler',
  name: 'A. Tiler',
  trade: 'tiler',
  phone: null,
  email: null,
  note: null,
  availability: null,
  stageIds: [],
};
const BASE = snapshot({
  people: [TILER],
  stages: [stage('tiling', 1, 'Tiling')],
  activities: [activity('tile', 'tiling', 1, 3)],
  costLines: [line('tiles', 'tiling', 120_000, 'tile'), line('labour', 'tiling', 80_000)],
  commitments: [commitment('quote', 'tiling', 150_000, 'tiler')],
});
const FIRST = payment(1, '2026-09-02', 'tiling', 100_000, {
  personId: 'tiler',
  commitmentId: 'quote',
});
const SECOND = payment(2, '2026-09-03', 'tiling', 70_000, {
  personId: 'tiler',
  commitmentId: 'quote',
});
const REVERSAL = payment(3, '2026-09-04', 'tiling', -70_000, {
  reversesSeq: 2,
  whatFor: 'Paid twice by mistake',
});
const withPayments = (...payments: Payment[]): WorkSnapshot => ({ ...BASE, payments });

const TILING = { kind: 'stage', stageId: 'tiling' } as const;
const WORK = { kind: 'work' } as const;

describe('planned, committed and paid', () => {
  const plan = withPayments(FIRST, SECOND, REVERSAL);

  it('plans from the cost lines, the stage’s own and its activities’', () => {
    const planned = plannedOf(plan, TILING);
    expect(planned.value).toBe(200_000);
    expect(planned.rows.map((row) => [row.key, row.amountCents, row.source])).toEqual([
      ['cost-line:tiles', 120_000, 'cost-line'],
      ['cost-line:labour', 80_000, 'cost-line'],
    ]);
    expect(planned.unit).toBe('money');
  });

  it('commits from the commitments', () => {
    const committed = committedOf(plan, TILING);
    expect(committed.value).toBe(150_000);
    expect(committed.rows[0]).toMatchObject({
      key: 'commitment:quote',
      personId: 'tiler',
      day: '2026-08-28',
    });
  });

  it('pays from the ledger, a reversal netting its payment out, both still listed', () => {
    const paid = paidOf(plan, TILING);
    expect(paid.value).toBe(100_000);
    expect(paid.rows.map((row) => [row.key, row.amountCents])).toEqual([
      ['payment:1', 100_000],
      ['payment:2', 70_000],
      ['payment:3', -70_000],
    ]);
  });

  it('leaves planned less paid remaining, its rows the two sets signed', () => {
    const remaining = remainingOf(plan, TILING);
    expect(remaining.value).toBe(100_000);
    expect(remaining.rows.map((row) => row.amountCents)).toEqual([
      120_000, 80_000, -100_000, -70_000, 70_000,
    ]);
  });

  it('gives committed less planned as the variance, here 500.00 under', () => {
    const variance = varianceOf(plan, TILING);
    expect(variance.value).toBe(-50_000);
    expect(variance.rows.map((row) => row.amountCents)).toEqual([150_000, -120_000, -80_000]);
  });

  it('keeps every money figure traceable', () => {
    for (const each of [plannedOf, committedOf, paidOf, remainingOf, varianceOf, owedOf]) {
      for (const scope of [TILING, WORK, { kind: 'trade', trade: 'tiler' } as const]) {
        expect(traceable(each(plan, scope)), `${each.name} ${scope.kind}`).toBe(true);
      }
    }
  });

  it('counts a line on an activity for the activity’s stage, whatever stage the line names', () => {
    const odd = {
      ...BASE,
      stages: [...BASE.stages, stage('other', 2)],
      costLines: [line('x', 'other', 5, 'tile')],
    };
    expect(stageOfLine(odd, odd.costLines[0]!)).toBe('tiling');
    expect(plannedOf(odd, TILING).value).toBe(5);
    // An activity that is not in the plan leaves the line on the stage it names.
    expect(stageOfLine(odd, line('y', 'other', 5, 'gone'))).toBe('other');
  });
});

describe('the stages add up to the work', () => {
  const two: WorkSnapshot = {
    ...withPayments(FIRST, SECOND, REVERSAL, payment(4, '2026-09-05', 'paint', 30_000)),
    stages: [stage('tiling', 1, 'Tiling'), stage('paint', 2, 'Painting')],
    activities: [activity('tile', 'tiling', 1, 3), activity('walls', 'paint', 1, 2)],
    costLines: [...BASE.costLines, line('paint', 'paint', 40_000, 'walls')],
    commitments: [...BASE.commitments, commitment('painter', 'paint', 45_000)],
  };

  it('in every figure', () => {
    const stages = moneyByStage(two);
    const work = moneyOfWork(two);
    for (const name of ['planned', 'committed', 'paid', 'remaining', 'variance'] as const) {
      expect(
        stages.reduce((sum, each) => sum + each[name].value, 0),
        name,
      ).toBe(work[name].value);
      for (const each of stages) expect(traceable(each[name])).toBe(true);
      expect(traceable(work[name])).toBe(true);
    }
    expect(work).toMatchObject({
      planned: { value: 240_000 },
      committed: { value: 195_000 },
      paid: { value: 130_000 },
      remaining: { value: 110_000 },
      variance: { value: -45_000 },
    });
  });

  it.each(Array.from({ length: 30 }, (_, seed) => seed))('for generated plan %i', (seed) => {
    let state = seed + 5;
    const next = () => (state = (state * 48271) % 2147483647) / 2147483647;
    const int = (below: number) => Math.floor(next() * below);
    const stages = Array.from({ length: 1 + int(4) }, (_, i) => stage(`s${i}`, i));
    const pick = () => stages[int(stages.length)]!.id;
    const activities = Array.from({ length: int(5) }, (_, i) =>
      activity(`a${i}`, pick(), i, 1 + int(3)),
    );
    const plan = snapshot({
      stages,
      activities,
      costLines: Array.from({ length: int(6) }, (_, i) =>
        line(
          `l${i}`,
          pick(),
          int(100_000),
          activities.length > 0 && next() < 0.5 ? activities[int(activities.length)]!.id : null,
        ),
      ),
      commitments: Array.from({ length: int(4) }, (_, i) =>
        commitment(`c${i}`, pick(), int(100_000)),
      ),
      payments: Array.from({ length: int(5) }, (_, i) =>
        payment(i + 1, '2026-09-01', pick(), 1 + int(50_000)),
      ),
    });
    const work = moneyOfWork(plan);
    const stagesMoney = moneyByStage(plan);
    for (const name of ['planned', 'committed', 'paid', 'remaining', 'variance'] as const) {
      expect(stagesMoney.reduce((sum, each) => sum + each[name].value, 0)).toBe(work[name].value);
    }
  });
});

describe('money by trade', () => {
  it('groups commitments and payments by the person’s trade, owed being committed less paid', () => {
    const rows = moneyByTrade(withPayments(FIRST, SECOND, REVERSAL));
    expect(
      rows.map((row) => [row.trade, row.committed.value, row.paid.value, row.owed.value]),
    ).toEqual([
      // The reversal names no person; it counts for the payment it reverses.
      ['tiler', 150_000, 100_000, 50_000],
    ]);
    for (const row of rows) {
      for (const each of [row.committed, row.paid, row.owed]) expect(traceable(each)).toBe(true);
    }
  });

  it('puts what was paid to nobody, or to someone with no trade yet, under no trade, last', () => {
    const plan: WorkSnapshot = {
      ...withPayments(
        FIRST,
        payment(2, '2026-09-03', 'tiling', 5_000),
        payment(3, '2026-09-03', 'tiling', 1_000, { personId: 'helper' }),
      ),
      people: [
        TILER,
        {
          id: 'helper',
          name: 'Helper',
          trade: '  ',
          phone: null,
          email: null,
          note: null,
          availability: null,
          stageIds: [],
        },
        {
          id: 'sparky',
          name: 'Sparky',
          trade: 'electrician',
          phone: null,
          email: null,
          note: null,
          availability: null,
          stageIds: [],
        },
      ],
    };
    const rows = moneyByTrade(plan);
    expect(rows.map((row) => [row.trade, row.paid.value])).toEqual([
      ['electrician', 0],
      ['tiler', 100_000],
      [null, 6_000],
    ]);
    expect(tradeOf(plan, 'helper')).toBeNull();
    expect(tradeOf(plan, 'gone')).toBeNull();
    expect(tradeOf(plan, null)).toBeNull();
  });

  it('takes the trade from the commitment when the payment names no person', () => {
    const plan = withPayments(
      payment(1, '2026-09-02', 'tiling', 10_000, { commitmentId: 'quote' }),
    );
    expect(moneyByTrade(plan).map((row) => [row.trade, row.paid.value])).toEqual([
      ['tiler', 10_000],
    ]);
  });

  it('never counts a cost line for a trade: planned has no trade', () => {
    expect(plannedOf(BASE, { kind: 'trade', trade: null }).rows).toEqual([]);
    expect(plannedOf(BASE, { kind: 'trade', trade: 'tiler' }).value).toBe(0);
    expect(moneyByTrade(BASE).some((row) => row.trade === null)).toBe(false);
  });
});

describe('paid over committed', () => {
  it('is allowed and flagged, per stage and per commitment, with the excess', () => {
    const over = overCommitted(withPayments(FIRST, SECOND));
    expect(over.stages).toEqual([
      expect.objectContaining({
        scope: 'stage',
        id: 'tiling',
        committedCents: 150_000,
        paidCents: 170_000,
        amountCents: 20_000,
      }),
    ]);
    expect(over.commitments).toEqual([
      expect.objectContaining({
        scope: 'commitment',
        id: 'quote',
        paidCents: 170_000,
        amountCents: 20_000,
      }),
    ]);
    expect(moneyByStage(withPayments(FIRST, SECOND))[0]!.overCommittedCents).toBe(20_000);
  });

  it('goes away when the payment that caused it is reversed', () => {
    const over = overCommitted(withPayments(FIRST, SECOND, REVERSAL));
    expect(over).toEqual({ stages: [], commitments: [] });
    expect(moneyByStage(withPayments(FIRST, SECOND, REVERSAL))[0]!.overCommittedCents).toBeNull();
  });

  it('flags paying a stage with nothing committed: over a commitment of zero', () => {
    const plan = { ...withPayments(payment(1, '2026-09-02', 'tiling', 5_000)), commitments: [] };
    expect(overCommitted(plan).stages.map((row) => row.amountCents)).toEqual([5_000]);
  });

  it('counts the stages paid over as a traceable figure', () => {
    const figure = overCommittedFigure(withPayments(FIRST, SECOND));
    expect(figure).toMatchObject({ id: 'over-committed', unit: 'count', value: 1 });
    expect(traceable(figure)).toBe(true);
    expect(overCommittedFigure(BASE).value).toBe(0);
  });
});

describe('the S-curve', () => {
  const plan = withPayments(FIRST, SECOND, REVERSAL);
  const curve = sCurve(plan, schedule(plan), plan.payments, '2026-09-05');

  it('spreads each line over its working days, in whole cents, the odd cents first', () => {
    // Tiles 1 200.00 over Tue, Wed, Thu; Labour 800.00 over the stage's span, the same three days.
    expect(curve.days.map((day) => [day.day, day.planned])).toEqual([
      ['2026-09-01', 40_000 + 26_667],
      ['2026-09-02', 80_000 + 53_334],
      ['2026-09-03', 200_000],
      ['2026-09-04', 200_000],
      ['2026-09-05', 200_000],
    ]);
  });

  it('counts payments on their day, and a reversal on the day of what it reverses', () => {
    expect(curve.days.map((day) => day.paid)).toEqual([0, 100_000, 100_000, 100_000, 100_000]);
  });

  it('never runs backwards, and ends at the totals', () => {
    for (let i = 1; i < curve.days.length; i += 1) {
      expect(curve.days[i]!.planned).toBeGreaterThanOrEqual(curve.days[i - 1]!.planned);
      expect(curve.days[i]!.paid).toBeGreaterThanOrEqual(curve.days[i - 1]!.paid);
    }
    expect(curve.totals).toEqual({ planned: 200_000, paid: 100_000 });
    expect(curve.days.at(-1)).toMatchObject({ planned: 200_000, paid: 100_000 });
    expect(curve.unscheduled).toEqual([]);
  });

  it('marks the days after today, and runs on to the plan’s last day', () => {
    const early = sCurve(plan, schedule(plan), [FIRST], '2026-09-01');
    expect(early.days.map((day) => [day.day, day.future])).toEqual([
      ['2026-09-01', false],
      ['2026-09-02', true],
      ['2026-09-03', true],
    ]);
  });

  it('skips the weekend inside an activity', () => {
    const long = {
      ...BASE,
      activities: [activity('tile', 'tiling', 1, 5)],
      costLines: [line('tiles', 'tiling', 500, 'tile')],
    };
    const days = sCurve(long, schedule(long), [], '2026-09-01').days;
    // Tue 1 – Mon 7: five working days of 100, nothing on Saturday or Sunday.
    expect(days.map((day) => day.planned)).toEqual([100, 200, 300, 400, 400, 400, 500]);
  });

  it('spreads a stage’s own line over the whole stage, from its first start to its last finish', () => {
    // Middle (Fri 4) after Early (Tue 1 – Thu 3); Late (Mon 7) after Middle. The stage runs
    // Tue 1 – Mon 7: five working days of 100. A deposit was paid the Monday before.
    const plan2: WorkSnapshot = {
      ...BASE,
      activities: [
        activity('middle', 'tiling', 1, 1),
        activity('early', 'tiling', 2, 3),
        activity('late', 'tiling', 3, 1),
      ],
      dependencies: [
        {
          id: 'd1',
          blocker: { kind: 'activity', id: 'early' },
          blocked: { kind: 'activity', id: 'middle' },
          lagDays: 0,
        },
        {
          id: 'd2',
          blocker: { kind: 'activity', id: 'middle' },
          blocked: { kind: 'activity', id: 'late' },
          lagDays: 0,
        },
      ],
      costLines: [line('labour', 'tiling', 500)],
    };
    const deposit = payment(1, '2026-08-31', 'tiling', 50);
    const result = sCurve(plan2, schedule(plan2), [deposit], '2026-09-01');
    expect(result.days.map((day) => [day.day, day.planned, day.paid])).toEqual([
      ['2026-08-31', 0, 50],
      ['2026-09-01', 100, 50],
      ['2026-09-02', 200, 50],
      ['2026-09-03', 300, 50],
      ['2026-09-04', 400, 50],
      ['2026-09-05', 400, 50],
      ['2026-09-06', 400, 50],
      ['2026-09-07', 500, 50],
    ]);
  });

  it('puts a line that cannot be scheduled on the work’s start, and says which', () => {
    const plan2 = {
      ...BASE,
      stages: [...BASE.stages, stage('empty', 2)],
      activities: [activity('tile', 'tiling', 1, null)],
      costLines: [line('tiles', 'tiling', 120_000, 'tile'), line('later', 'empty', 5_000)],
    };
    const result = sCurve(plan2, schedule(plan2), [], '2026-09-01');
    expect(result.unscheduled).toEqual(['tiles', 'later']);
    expect(result.days).toEqual([{ day: '2026-09-01', planned: 125_000, paid: 0, future: false }]);
  });

  it('puts everything on the start when the calendar cannot be counted on', () => {
    const noCalendar = { ...BASE, calendar: { workingDays: '0000000', hoursPerDay: 8 } };
    const result = sCurve(noCalendar, schedule(noCalendar), [], '2026-09-03');
    expect(result.unscheduled).toEqual(['tiles', 'labour']);
    expect(result.days[0]).toMatchObject({ day: '2026-09-01', planned: 200_000 });
    expect(result.days.at(-1)).toMatchObject({ day: '2026-09-03', planned: 200_000 });
  });

  it('anchors on today when the start is not a day, and is empty when nothing is a day', () => {
    const noStart = { ...BASE, work: { ...BASE.work, startDate: 'soon' }, activities: [] };
    expect(sCurve(noStart, schedule(noStart), [], '2026-09-02').days).toEqual([
      { day: '2026-09-02', planned: 200_000, paid: 0, future: false },
    ]);
    const nothing = sCurve(noStart, schedule(noStart), [], 'today');
    expect(nothing.days).toEqual([]);
    expect(nothing.totals).toEqual({ planned: 200_000, paid: 0 });
  });

  it('is empty for a work with no money', () => {
    expect(sCurve(snapshot(), schedule(snapshot()), [], 'today')).toEqual({
      days: [],
      totals: { planned: 0, paid: 0 },
      unscheduled: [],
    });
  });
});

describe('checking a payment before the host is asked', () => {
  const plan = withPayments(FIRST, SECOND);
  const draft = (parts: Partial<PaymentDraft> = {}): PaymentDraft => ({
    day: '2026-09-04',
    stageId: 'tiling',
    personId: 'tiler',
    commitmentId: 'quote',
    amountCents: 10_000,
    whatFor: 'Second instalment',
    reversesSeq: null,
    ...parts,
  });
  const check = (parts: Partial<PaymentDraft> = {}, on: WorkSnapshot = plan) =>
    validatePayment(draft(parts), '2026-09-04', on).map((problem) => problem.code);

  it('accepts a payment, even one that pays over what was committed', () => {
    expect(check()).toEqual([]);
    expect(check({ amountCents: 1_000_000 })).toEqual([]);
  });

  it('refuses a day in the future, and a day that is not a day', () => {
    expect(check({ day: '2026-09-05' })).toEqual(['future-day']);
    expect(check({ day: '4 Sep' })).toEqual(['invalid-day']);
  });

  it('refuses a payment with no stage, or a stage, person or commitment not in the plan', () => {
    expect(check({ stageId: null, commitmentId: null })).toEqual(['no-stage']);
    expect(check({ stageId: '', commitmentId: null })).toEqual(['no-stage']);
    expect(check({ stageId: 'gone', commitmentId: null })).toEqual(['unknown-stage']);
    expect(check({ personId: 'nobody' })).toEqual(['unknown-person']);
    expect(check({ commitmentId: 'nothing' })).toEqual(['unknown-commitment']);
  });

  it('refuses a commitment of another stage', () => {
    const two = { ...plan, stages: [...plan.stages, stage('paint', 2)] };
    expect(check({ stageId: 'paint' }, two)).toEqual(['commitment-of-another-stage']);
  });

  it('refuses nothing, less than nothing, and a fraction of a cent', () => {
    expect(check({ amountCents: 0 })).toEqual(['amount-not-positive']);
    expect(check({ amountCents: -100 })).toEqual(['amount-not-positive']);
    expect(check({ amountCents: 10.5 })).toEqual(['invalid-amount']);
  });

  it('accepts a full reversal with a note, as the Reverse button drafts it', () => {
    const reversal = reversalDraft(SECOND, 'Paid twice by mistake', '2026-09-04');
    expect(reversal).toMatchObject({ amountCents: -70_000, reversesSeq: 2, stageId: 'tiling' });
    expect(validatePayment(reversal, '2026-09-04', plan)).toEqual([]);
    expect(check({ amountCents: -1_000, reversesSeq: 2, whatFor: 'Part of it' })).toEqual([]);
  });

  it('refuses a reversal larger than the original', () => {
    expect(check({ amountCents: -70_001, reversesSeq: 2, whatFor: 'Too much' })).toEqual([
      'reversal-exceeds',
    ]);
  });

  it('refuses a second reversal of the same payment', () => {
    const reversed = withPayments(FIRST, SECOND, REVERSAL);
    expect(check({ amountCents: -1, reversesSeq: 2, whatFor: 'Again' }, reversed)).toEqual([
      'already-reversed',
    ]);
  });

  it('refuses a reversal of a reversal, of a payment that is not there, or with no note', () => {
    const reversed = withPayments(FIRST, SECOND, REVERSAL);
    expect(check({ amountCents: -1, reversesSeq: 3, whatFor: 'Undo' }, reversed)).toEqual([
      'reverses-a-reversal',
    ]);
    expect(check({ amountCents: -1, reversesSeq: 9, whatFor: 'Undo' })).toEqual([
      'reverses-unknown',
    ]);
    expect(check({ amountCents: -1, reversesSeq: 1, whatFor: '  ' })).toEqual([
      'reversal-without-note',
    ]);
  });

  it('refuses a reversal that is not negative', () => {
    expect(check({ amountCents: 0, reversesSeq: 1, whatFor: 'Undo' })).toEqual([
      'reversal-not-negative',
    ]);
    expect(check({ amountCents: 5, reversesSeq: 1, whatFor: 'Undo' })).toEqual([
      'reversal-not-negative',
    ]);
  });

  it('refuses a note over 200 characters, and reports every problem at once', () => {
    expect(check({ whatFor: 'x'.repeat(201) })).toEqual(['what-for-too-long']);
    expect(check({ day: 'soon', stageId: null, commitmentId: null, amountCents: 0 })).toEqual([
      'invalid-day',
      'no-stage',
      'amount-not-positive',
    ]);
  });
});

describe('readiness: every stage has its money planned', () => {
  const measure = (plan: WorkSnapshot) =>
    readiness(plan, { schedule: schedule(plan), today: '2026-09-01' });
  const moneyRule = (plan: WorkSnapshot) =>
    readinessByRule(measure(plan)).find((rule) => rule.ruleId === 'stage.money')!;

  it('is known for a stage with a line of its own, or on one of its activities', () => {
    expect(moneyRule(BASE)).toMatchObject({ known: 1, mustKnow: 1 });
    const activityOnly = { ...BASE, costLines: [line('tiles', 'tiling', 1, 'tile')] };
    expect(moneyRule(activityOnly)).toMatchObject({ known: 1, mustKnow: 1 });
  });

  it('is missing for a stage with no line, and says so', () => {
    const plan = {
      ...BASE,
      stages: [...BASE.stages, stage('paint', 2, 'Painting')],
      activities: [...BASE.activities, activity('walls', 'paint', 1, 2)],
    };
    const rule = moneyRule(plan);
    expect(rule).toMatchObject({ known: 1, mustKnow: 2, labelKey: 'readiness.rule.stage.money' });
    expect(rule.missing).toEqual([
      {
        ruleId: 'stage.money',
        entity: 'stage',
        id: 'paint',
        name: 'Painting',
        stageName: 'Painting',
        durationRange: null,
      },
    ]);
    expect(traceable(rule.figure!)).toBe(true);
  });
});

describe('a cost line not priced yet', () => {
  const unpriced = (id: string, stageId: string, activityId: string | null = null): CostLine => ({
    id,
    stageId,
    activityId,
    label: `Label ${id}`,
    amountCents: null,
  });
  const plan = snapshot({
    stages: [stage('s1', 1), stage('s2', 2)],
    activities: [activity('a1', 's1', 1, 2)],
    costLines: [line('p1', 's1', 300_00), unpriced('u1', 's1', 'a1'), unpriced('u2', 's2')],
    payments: [],
  });

  it('is a row of planned, marked, counting nothing, and the figure still adds up', () => {
    const planned = plannedOf(plan, { kind: 'work' });
    expect(planned.value).toBe(300_00);
    expect(traceable(planned)).toBe(true);
    expect(planned.rows.map((row) => [row.sourceId, row.amountCents, row.priced])).toEqual([
      ['p1', 300_00, true],
      ['u1', 0, false],
      ['u2', 0, false],
    ]);
    expect(unpricedRows(planned).map((row) => row.sourceId)).toEqual(['u1', 'u2']);
    expect(NOT_PRICED_KEY).toBe('money.row.notPriced');
  });

  it('counts as nothing, never as minus nothing, where planned is taken away', () => {
    const variance = varianceOf(plan, { kind: 'stage', stageId: 's2' });
    expect(variance.rows).toHaveLength(1);
    expect(Object.is(variance.rows[0]!.amountCents, 0)).toBe(true);
    expect(variance.value).toBe(0);
    expect(traceable(variance)).toBe(true);
    expect(traceable(remainingOf(plan, { kind: 'work' }))).toBe(true);
  });

  it('leaves the stage with no money planned when it is all the stage has', () => {
    const [first, second] = moneyByStage(plan);
    expect(first!.planned.value).toBe(300_00);
    expect(second!.planned.value).toBe(0);
    expect(unpricedRows(second!.planned)).toHaveLength(1);
  });

  it('is not on the S-curve: it has no money to spread', () => {
    const curve = sCurve(plan, schedule(plan), [], '2026-09-01');
    expect(curve.totals.planned).toBe(300_00);
    expect(curve.unscheduled).toEqual([]);
    expect(curve.days.at(-1)!.planned).toBe(300_00);
  });

  it('is recorded as nothing by a baseline, like the host records it', () => {
    const taken = takeBaseline(plan, 1);
    expect(taken.plannedCents).toBe(300_00);
    expect(taken.stages.map((each) => each.plannedCents)).toEqual([300_00, 0]);
  });

  it('marks commitments and payments as priced, always', () => {
    const withMoney = snapshot({
      stages: [stage('s1', 1)],
      commitments: [commitment('c1', 's1', 100_00)],
      payments: [payment(1, '2026-09-01', 's1', 50_00)],
    });
    expect(committedOf(withMoney, { kind: 'work' }).rows[0]!.priced).toBe(true);
    expect(paidOf(withMoney, { kind: 'work' }).rows[0]!.priced).toBe(true);
  });
});
