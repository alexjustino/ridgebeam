import { describe, expect, it } from 'vitest';

import {
  activity,
  correction,
  entry,
  finished,
  link,
  snapshot,
  stage,
  withStageRules,
  worked,
} from './__fixtures__/plan';
import { traceable, type Figure, type ReportRow } from './figure';
import {
  FULL_PLAN_BP,
  MILESTONE_LABEL_KEYS,
  MILESTONE_MESSAGE_KEYS,
  MILESTONE_PENDING_KEYS,
  MILESTONE_PROBLEM_KEYS,
  MILESTONE_STATE_KEYS,
  MILESTONE_TRIGGER_KEYS,
  MILESTONE_TRIGGERS,
  PAYMENT_PREVIEW_KEYS,
  USUAL_PLAN,
  USUAL_PLAN_LABEL_KEYS,
  aheadFigure,
  commitmentPlanOf,
  commitmentsWithMoney,
  dueFigure,
  expectedOn,
  lastActivityOf,
  milestoneCents,
  milestonesInOrder,
  milestonesLocked,
  noPlanFigure,
  paymentPlans,
  paymentPreview,
  percentToBp,
  scheduledFacts,
  shareOfCents,
  usualPlan,
  validateMilestone,
  type CommitmentPlan,
  type MilestoneDraft,
} from './milestones';
import { paidRowsByCommitment, reversalDraft, type PaymentDraft } from './money';
import type { Commitment, Milestone, MilestoneTrigger, Payment, WorkSnapshot } from './plan';
import { readiness, readinessByRule, readinessFigure } from './readiness';
import { schedule } from './schedule';

// ── Builders ─────────────────────────────────────────────────────────────────

const milestone = (
  id: string,
  position: number,
  shareBp: number,
  trigger: MilestoneTrigger,
  activityId: string | null = null,
  label = `Milestone ${id}`,
): Milestone => ({ id, position, label, shareBp, trigger, activityId });

const commitment = (
  id: string,
  stageId: string,
  amountCents: number,
  milestones: Milestone[] = [],
  parts: Partial<Commitment> = {},
): Commitment => ({
  id,
  stageId,
  personId: null,
  label: `Commitment ${id}`,
  amountCents,
  agreedOn: '2026-08-28',
  documentHash: null,
  milestones,
  ...parts,
});

const payment = (
  seq: number,
  commitmentId: string | null,
  amountCents: number,
  parts: Partial<Payment> = {},
): Payment => ({
  id: `payment-${seq}`,
  seq,
  day: '2026-09-02',
  personId: null,
  stageId: 'tiling',
  commitmentId,
  amountCents,
  whatFor: `Payment ${seq}`,
  receiptHash: null,
  reversesSeq: null,
  authorName: 'Sample author',
  createdAt: '2026-09-02T12:00:00.000Z',
  ...parts,
});

const draft = (commitmentId: string | null, amountCents: number): PaymentDraft => ({
  day: '2026-09-10',
  stageId: 'tiling',
  personId: null,
  commitmentId,
  amountCents,
  whatFor: 'Next payment',
  reversesSeq: null,
});

const TODAY = '2026-09-10';

/**
 * The e2e's work: a stage Tiling with "Prepare the floor" and "Lay the tiles"; the Tiler's quote,
 * 1 000.00, paid 30 % in advance, 40 % when the tiles are laid, 30 % when the stage closes.
 */
const TILER_PLAN = [
  milestone('advance', 1, 3_000, 'advance', null, 'Advance'),
  milestone('laid', 2, 4_000, 'activity_finished', 'lay', 'Tiles laid'),
  milestone('closed', 3, 3_000, 'stage_closed', null, 'Stage closed'),
];
const TILING = snapshot({
  stages: [{ ...stage('tiling', 1, 'Tiling'), startedAt: '2026-09-01T08:00:00.000Z' }],
  activities: [
    { ...activity('prepare', 'tiling', 1, 2), name: 'Prepare the floor' },
    { ...activity('lay', 'tiling', 2, 3), name: 'Lay the tiles' },
  ],
  commitments: [commitment('quote', 'tiling', 1_000_00, TILER_PLAN, { label: 'Tiler’s quote' })],
});

const planOf = (
  plan: WorkSnapshot,
  entries = [] as Parameters<typeof paymentPlans>[1],
  id = 'quote',
  today = TODAY,
): CommitmentPlan => commitmentPlanOf(plan, entries, today, id)!;

const values = (plan: CommitmentPlan) => ({
  earned: plan.earned.value,
  paid: plan.paid.value,
  due: plan.due.value,
  ahead: plan.ahead.value,
});

const allTraceable = (figures: ReadonlyArray<Figure<ReportRow>>) =>
  figures.every((figure) => traceable(figure));

// ── Basis points on cents ────────────────────────────────────────────────────

describe('basis points on cents', () => {
  it('rounds each share half up, in whole cents', () => {
    expect(shareOfCents(1_000_00, 3_000)).toBe(300_00);
    expect(shareOfCents(1, 5_000)).toBe(1); // 0.5 → 1
    expect(shareOfCents(1, 4_999)).toBe(0); // 0.4999 → 0
    expect(shareOfCents(3, 5_000)).toBe(2); // 1.5 → 2
    expect(shareOfCents(10_001, 3_333)).toBe(3_333); // 3 333.3333 → 3 333
    expect(shareOfCents(0, 10_000)).toBe(0);
    expect(shareOfCents(-1, 5_000)).toBe(0); // half up is towards +∞: −0.5 → 0
    expect(Object.is(shareOfCents(-1, 5_000), 0)).toBe(true);
  });

  it('stays exact where a float product would not', () => {
    // 90 trillion cents × 3 333 is past 2^53; split into ten-thousands it is not.
    const amount = 90_000_000_000_001;
    const exact = (BigInt(amount) * 3_333n * 2n + 10_000n) / 20_000n;
    expect(BigInt(shareOfCents(amount, 3_333))).toBe(exact);
  });

  it('puts the remainder on the last milestone, so a 100 % plan sums to the amount exactly', () => {
    const three = [
      milestone('a', 1, 3_333, 'advance'),
      milestone('b', 2, 3_333, 'stage_started'),
      milestone('c', 3, 3_334, 'stage_closed'),
    ];
    expect(milestoneCents(100, three)).toEqual([33, 33, 34]);
    expect(milestoneCents(1, three)).toEqual([0, 0, 1]);
    // Half up would say 50 + 50 + 1 = 101 for 30.5 %, 49.5 %… here, the last absorbs it.
    const halves = [
      milestone('a', 1, 5_000, 'advance'),
      milestone('b', 2, 2_500, 'stage_started'),
      milestone('c', 3, 2_500, 'stage_closed'),
    ];
    expect(milestoneCents(3, halves)).toEqual([2, 1, 0]);
    expect(milestoneCents(3, halves).reduce((a, b) => a + b, 0)).toBe(3);

    // Every split of every amount a seeded generator gives: exactly the amount.
    let x = 20260929;
    const next = (below: number) => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return Math.floor((x / 2147483648) * below);
    };
    for (let run = 0; run < 2_000; run += 1) {
      const amount = next(10_000_000_00);
      const cuts = new Set<number>();
      const parts = 1 + next(6);
      while (cuts.size < parts - 1) cuts.add(1 + next(FULL_PLAN_BP - 1));
      const edges = [0, ...[...cuts].sort((a, b) => a - b), FULL_PLAN_BP];
      const plan = edges
        .slice(1)
        .map((edge, index) => milestone(`m${index}`, index, edge - edges[index]!, 'advance'));
      const cents = milestoneCents(amount, plan);
      expect(cents.reduce((a, b) => a + b, 0)).toBe(amount);
      // Every milestone but the last is its own share, half up.
      cents.slice(0, -1).forEach((each, index) => {
        expect(each).toBe(shareOfCents(amount, plan[index]!.shareBp));
      });
    }
  });

  it('rounds a plan under 100 % milestone by milestone, and leaves the rest out', () => {
    const part = [milestone('a', 1, 3_333, 'advance'), milestone('b', 2, 3_333, 'stage_closed')];
    expect(milestoneCents(100, part)).toEqual([33, 33]);
    expect(milestoneCents(100, [])).toEqual([]);
  });

  it('reads a percent as typed, whole or with one decimal, in basis points', () => {
    expect(percentToBp('30')).toBe(3_000);
    expect(percentToBp('12,5')).toBe(1_250);
    expect(percentToBp('12.5')).toBe(1_250);
    expect(percentToBp(' 7 ')).toBe(700);
    expect(percentToBp('100')).toBe(10_000);
    expect(percentToBp('0')).toBe(0);
    expect(percentToBp('150')).toBe(15_000); // read; the range is validateMilestone's
    expect(percentToBp('12.55')).toBeNull();
    expect(percentToBp('')).toBeNull();
    expect(percentToBp('-5')).toBeNull();
    expect(percentToBp('thirty')).toBeNull();
  });
});

// ── Earned, by trigger ───────────────────────────────────────────────────────

describe('earned, by the facts of the work', () => {
  it('earns an advance the day the commitment was agreed, and not before', () => {
    const plan = planOf(TILING);
    expect(plan.milestones[0]).toMatchObject({
      earned: true,
      earnedOn: '2026-08-28',
      cents: 300_00,
      target: { kind: 'commitment', id: 'quote', name: 'Tiler’s quote' },
    });
    expect(plan.earned.rows).toEqual([
      {
        key: 'milestone:advance',
        itemId: 'advance',
        title: 'Advance',
        day: '2026-08-28',
        minutes: 0,
        amountCents: 300_00,
        source: 'milestone',
        milestoneId: 'advance',
        commitmentId: 'quote',
        stageId: 'tiling',
        trigger: 'advance',
        shareBp: 3_000,
        target: { kind: 'commitment', id: 'quote', name: 'Tiler’s quote' },
      },
    ]);
    // Agreed after today: not a fact yet.
    const early = planOf(TILING, [], 'quote', '2026-08-27');
    expect(early.earned.value).toBe(0);
    expect(early.next).toMatchObject({
      milestoneId: 'advance',
      pendingKey: MILESTONE_PENDING_KEYS.advance,
    });
  });

  it('earns a stage start the day the stage was started; a planned stage earns nothing', () => {
    const started: WorkSnapshot = {
      ...TILING,
      commitments: [
        commitment('quote', 'tiling', 1_000_00, [milestone('s', 1, 5_000, 'stage_started')]),
      ],
    };
    expect(planOf(started).milestones[0]).toMatchObject({
      earned: true,
      earnedOn: '2026-09-01',
      target: { kind: 'stage', id: 'tiling', name: 'Tiling' },
    });
    const planned: WorkSnapshot = { ...started, stages: [stage('tiling', 1, 'Tiling')] };
    expect(planOf(planned).milestones[0]).toMatchObject({ earned: false, earnedOn: null });
    expect(planOf(planned).next?.pendingKey).toBe(MILESTONE_PENDING_KEYS.stage_started);
    // A start stamped after today is not a fact yet.
    expect(planOf(started, [], 'quote', '2026-08-31').milestones[0]!.earned).toBe(false);
    // A stage closed with no start said (never stored by the host) was started: from its close.
    const closedOnly: WorkSnapshot = {
      ...started,
      stages: [{ ...stage('tiling', 1, 'Tiling'), closedAt: '2026-09-05T17:00:00.000Z' }],
    };
    expect(planOf(closedOnly).milestones[0]!.earnedOn).toBe('2026-09-05');
  });

  it('earns an activity’s finish the first day an effective entry finished it', () => {
    const entries = [
      entry(1, '2026-09-03', { done: [worked('lay')] }),
      entry(2, '2026-09-04', { done: [finished('lay')] }),
      entry(3, '2026-09-05', { done: [finished('lay')] }),
    ];
    expect(planOf(TILING, entries).milestones[1]).toMatchObject({
      earned: true,
      earnedOn: '2026-09-04',
      cents: 400_00,
      target: { kind: 'activity', id: 'lay', name: 'Lay the tiles' },
    });
    // Worked on is not finished.
    const workedOnly = [entry(1, '2026-09-03', { done: [worked('lay')] })];
    expect(planOf(TILING, workedOnly).milestones[1]!.earned).toBe(false);
    expect(planOf(TILING, workedOnly).next).toEqual({
      milestoneId: 'laid',
      label: 'Tiles laid',
      shareBp: 4_000,
      cents: 400_00,
      trigger: 'activity_finished',
      target: { kind: 'activity', id: 'lay', name: 'Lay the tiles' },
      pendingKey: MILESTONE_PENDING_KEYS.activity_finished,
      openSnags: 0,
    });
  });

  it('un-earns it when a correction says the activity was not finished after all', () => {
    const entries = [
      entry(1, '2026-09-04', { done: [finished('lay')] }),
      correction(2, 1, '2026-09-04', { done: [worked('lay')] }),
    ];
    expect(planOf(TILING, entries.slice(0, 1)).earned.value).toBe(700_00);
    expect(planOf(TILING, entries).earned.value).toBe(300_00);
    // And a correction moving the finish to another day moves the day it was earned.
    const moved = [
      entry(1, '2026-09-04', { done: [finished('lay')] }),
      correction(2, 1, '2026-09-07', { done: [finished('lay')] }),
    ];
    expect(planOf(TILING, moved).milestones[1]!.earnedOn).toBe('2026-09-07');
  });

  it('earns nothing for an activity that is not in the plan, or for no activity at all', () => {
    const plan: WorkSnapshot = {
      ...TILING,
      commitments: [
        commitment('quote', 'tiling', 1_000_00, [
          milestone('x', 1, 5_000, 'activity_finished', 'gone'),
          // The host never stores a finish with no activity; read, it waits on nothing that exists.
          milestone('y', 2, 5_000, 'activity_finished', null),
        ]),
      ],
    };
    expect(planOf(plan).milestones[1]).toMatchObject({
      earned: false,
      target: { kind: 'activity', id: '', name: null },
    });
    const entries = [entry(1, '2026-09-04', { done: [finished('gone')] })];
    expect(planOf(plan, entries).milestones[0]).toMatchObject({
      earned: false,
      target: { kind: 'activity', id: 'gone', name: null },
    });
  });

  it('earns a stage close the day it closed, and un-earns it when the stage is reopened', () => {
    const closed: WorkSnapshot = {
      ...TILING,
      stages: [{ ...TILING.stages[0]!, closedAt: '2026-09-09T17:00:00.000Z' }],
    };
    expect(planOf(closed).milestones[2]).toMatchObject({ earned: true, earnedOn: '2026-09-09' });
    // Reopened: the host clears `closedAt`; the start stays.
    const reopened: WorkSnapshot = {
      ...closed,
      stages: [{ ...closed.stages[0]!, closedAt: null }],
    };
    expect(planOf(reopened).milestones[2]).toMatchObject({ earned: false, earnedOn: null });
    expect(planOf(reopened).next?.pendingKey).toBe(MILESTONE_PENDING_KEYS.activity_finished);
  });

  it('reads a commitment whose stage is not in the plan without inventing a fact', () => {
    const plan = snapshot({
      commitments: [
        commitment('lost', 'nowhere', 100_00, [
          milestone('s', 1, 5_000, 'stage_started'),
          milestone('c', 2, 5_000, 'stage_closed'),
        ]),
      ],
    });
    const lost = planOf(plan, [], 'lost');
    expect(lost.earned.value).toBe(0);
    expect(lost.milestones.map((each) => each.target)).toEqual([
      { kind: 'stage', id: 'nowhere', name: null },
      { kind: 'stage', id: 'nowhere', name: null },
    ]);
  });

  it('counts every fact when today is not a day', () => {
    expect(planOf(TILING, [], 'quote', 'not a day').earned.value).toBe(300_00);
  });

  it('orders the milestones by position, whatever order they came in, the last taking the rest', () => {
    const plan: WorkSnapshot = {
      ...TILING,
      commitments: [
        commitment('quote', 'tiling', 100, [
          milestone('c', 3, 3_334, 'stage_closed'),
          milestone('a', 1, 3_333, 'advance'),
          milestone('b', 2, 3_333, 'stage_started'),
        ]),
      ],
    };
    const ordered = planOf(plan);
    expect(ordered.milestones.map((each) => [each.milestone.id, each.cents])).toEqual([
      ['a', 33],
      ['b', 33],
      ['c', 34],
    ]);
    expect(milestonesInOrder(plan.commitments[0]!).map((each) => each.id)).toEqual(['a', 'b', 'c']);
    // Ties by position fall back to the id.
    const tie = commitment('t', 'tiling', 1, [
      milestone('z', 1, 5_000, 'advance'),
      milestone('y', 1, 5_000, 'advance'),
    ]);
    expect(milestonesInOrder(tie).map((each) => each.id)).toEqual(['y', 'z']);
  });
});

// ── Paid, due, ahead ─────────────────────────────────────────────────────────

describe('paid, due now and paid ahead of the work', () => {
  const finishLay = [entry(1, '2026-09-08', { done: [finished('lay')] })];

  it('walks the e2e: earned 300 due 300; paid 300; 500 more is ahead; tiles laid, 100 ahead', () => {
    expect(values(planOf(TILING))).toEqual({ earned: 300_00, paid: 0, due: 300_00, ahead: 0 });

    const paid300 = { ...TILING, payments: [payment(1, 'quote', 300_00)] };
    expect(values(planOf(paid300))).toEqual({ earned: 300_00, paid: 300_00, due: 0, ahead: 0 });

    const paid800 = { ...paid300, payments: [...paid300.payments, payment(2, 'quote', 500_00)] };
    const ahead = planOf(paid800);
    expect(values(ahead)).toEqual({ earned: 300_00, paid: 800_00, due: 0, ahead: 500_00 });
    // Its rows: the payments, and what was earned taken away.
    expect(ahead.ahead.rows.map((row) => [row.key, row.amountCents])).toEqual([
      ['payment:1', 300_00],
      ['payment:2', 500_00],
      ['milestone:advance', -300_00],
    ]);

    const laid = planOf(paid800, finishLay);
    expect(values(laid)).toEqual({ earned: 700_00, paid: 800_00, due: 0, ahead: 100_00 });

    const figures = [ahead, laid].flatMap((each) => [each.earned, each.paid, each.due, each.ahead]);
    expect(allTraceable(figures)).toBe(true);
  });

  it('lists what is due as the milestones reached less the payments', () => {
    const plan = planOf({ ...TILING, payments: [payment(1, 'quote', 100_00)] }, finishLay);
    expect(values(plan)).toEqual({ earned: 700_00, paid: 100_00, due: 600_00, ahead: 0 });
    expect(plan.due.rows.map((row) => [row.key, row.amountCents])).toEqual([
      ['milestone:advance', 300_00],
      ['milestone:laid', 400_00],
      ['payment:1', -100_00],
    ]);
    expect(plan.ahead.rows).toEqual([]);
    expect(traceable(plan.due)).toBe(true);
  });

  it('applies reversals: a reversed payment is paid for nothing, both still listed', () => {
    const plan = planOf({
      ...TILING,
      payments: [
        payment(1, 'quote', 300_00),
        payment(2, 'quote', 500_00),
        // A reversal names what it reverses; it counts there even when it names no commitment.
        payment(3, null, -500_00, { reversesSeq: 2 }),
      ],
    });
    expect(values(plan)).toEqual({ earned: 300_00, paid: 300_00, due: 0, ahead: 0 });
    expect(plan.paid.rows.map((row) => row.key)).toEqual(['payment:1', 'payment:2', 'payment:3']);
  });

  it('never writes minus zero for a milestone of no cents taken away', () => {
    const tiny = {
      ...TILING,
      commitments: [
        commitment('quote', 'tiling', 1, [
          milestone('a', 1, 4_000, 'advance'),
          milestone('c', 2, 6_000, 'stage_closed'),
        ]),
      ],
      payments: [payment(1, 'quote', 1)],
    };
    const plan = planOf(tiny);
    expect(plan.milestones.map((each) => each.cents)).toEqual([0, 1]);
    expect(plan.ahead.value).toBe(1);
    const negated = plan.ahead.rows.find((row) => row.key === 'milestone:a')!;
    expect(Object.is(negated.amountCents, 0)).toBe(true);
  });

  it('says how much of the amount is in the plan and how much is not yet', () => {
    const part = {
      ...TILING,
      commitments: [commitment('quote', 'tiling', 1_000_00, TILER_PLAN.slice(0, 2))],
    };
    expect(planOf(part)).toMatchObject({ plannedBp: 7_000, restBp: 3_000, hasPlan: true });
    expect(planOf(TILING)).toMatchObject({ plannedBp: 10_000, restBp: 0 });
  });

  it('does not evaluate a commitment with no plan: nothing earned, due or ahead; paid as paid', () => {
    const plan: WorkSnapshot = {
      ...TILING,
      commitments: [...TILING.commitments, commitment('bare', 'tiling', 500_00)],
      payments: [payment(1, 'bare', 200_00)],
    };
    const bare = planOf(plan, [], 'bare');
    expect(bare).toMatchObject({ hasPlan: false, locked: true, next: null, plannedBp: 0 });
    expect(values(bare)).toEqual({ earned: 0, paid: 200_00, due: 0, ahead: 0 });
    // Listed as having no plan, with its amount; counted.
    const none = noPlanFigure(plan);
    expect(none.unit).toBe('count');
    expect(none.label).toBe(MILESTONE_LABEL_KEYS.noPlan);
    expect(none.rows.map((row) => [row.commitmentId, row.amountCents, row.stageId])).toEqual([
      ['bare', 500_00, 'tiling'],
    ]);
    expect(traceable(none)).toBe(true);
    // And not in the sums.
    const sums = paymentPlans(plan, [], TODAY).work;
    expect(sums.earned.rows.map((row) => row.commitmentId)).toEqual(['quote']);
    expect(sums.paid.value).toBe(0);
    expect(sums.due.value).toBe(300_00);
  });
});

// ── Per stage and for the work ───────────────────────────────────────────────

describe('the sums, per stage and for the work', () => {
  const plan: WorkSnapshot = {
    ...TILING,
    stages: [
      { ...stage('paint', 2, 'Painting') },
      ...TILING.stages,
      { ...stage('empty', 3, 'Empty') },
    ],
    commitments: [
      commitment('painter', 'paint', 600_00, [milestone('p', 1, 5_000, 'advance')]),
      ...TILING.commitments,
      commitment('grout', 'tiling', 200_00, [milestone('g', 1, 10_000, 'stage_started')]),
      commitment('stray', 'nowhere', 100_00, [milestone('s', 1, 10_000, 'advance')]),
      commitment('bare', 'tiling', 50_00),
    ],
    payments: [
      payment(1, 'quote', 800_00),
      payment(2, 'grout', 50_00),
      payment(3, null, 70_00),
      payment(4, 'painter', 100_00, { stageId: 'paint' }),
    ],
  };
  const plans = paymentPlans(plan, [], TODAY);

  it('lists the commitments by their stage’s order, the ones of no stage last', () => {
    expect(plans.commitments.map((each) => each.commitmentId)).toEqual([
      'quote',
      'grout',
      'bare',
      'painter',
      'stray',
    ]);
    expect(plans.stages.map((each) => each.stageId)).toEqual(['tiling', 'paint', 'empty']);
    // Commitments of no stage keep their given order after all the others, whichever side they sort on.
    const mixed: WorkSnapshot = {
      ...TILING,
      commitments: [
        commitment('x1', 'nowhere', 1),
        commitment('quote', 'tiling', 1),
        commitment('x2', 'elsewhere', 1),
        commitment('q2', 'tiling', 1),
      ],
    };
    expect(paymentPlans(mixed, [], TODAY).commitments.map((each) => each.commitmentId)).toEqual([
      'quote',
      'q2',
      'x1',
      'x2',
    ]);
  });

  it('never nets one commitment’s excess against another’s due', () => {
    const tiling = plans.stages[0]!;
    // quote: earned 300, paid 800 → 500 ahead. grout: earned 200, paid 50 → 150 due.
    expect(tiling.earned.value).toBe(500_00);
    expect(tiling.paid.value).toBe(850_00);
    expect(tiling.due.rows.map((row) => [row.commitmentId, row.amountCents])).toEqual([
      ['grout', 150_00],
    ]);
    expect(tiling.ahead.rows.map((row) => [row.commitmentId, row.amountCents])).toEqual([
      ['quote', 500_00],
    ]);
    expect(tiling.ahead.rows[0]).toMatchObject({
      key: 'commitment:quote',
      earnedCents: 300_00,
      paidCents: 800_00,
      commitmentCents: 1_000_00,
      next: { milestoneId: 'laid' },
    });
    expect(plans.stages[2]).toMatchObject({ earned: { value: 0, rows: [] } });
  });

  it('adds up to the work, which also counts commitments of no stage', () => {
    const { work } = plans;
    expect(work.earned.value).toBe(300_00 + 200_00 + 300_00 + 100_00);
    expect(work.due.rows.map((row) => row.commitmentId)).toEqual(['grout', 'painter', 'stray']);
    expect(work.due.value).toBe(150_00 + 200_00 + 100_00);
    expect(work.ahead.value).toBe(500_00);
    const stageDue = plans.stages.reduce((sum, each) => sum + each.due.value, 0);
    expect(stageDue + 100_00).toBe(work.due.value); // + the commitment of no stage
    const figures = [
      ...plans.stages.flatMap((each) => [each.earned, each.paid, each.due, each.ahead]),
      work.earned,
      work.paid,
      work.due,
      work.ahead,
      plans.noPlan,
      plans.outside,
    ];
    expect(allTraceable(figures)).toBe(true);
  });

  it('counts the commitments paid ahead, and sums what is earned and not paid', () => {
    const ahead = aheadFigure(plan, [], TODAY);
    expect(ahead).toMatchObject({ id: 'paid-ahead', unit: 'count', value: 1 });
    expect(ahead.label).toBe(MILESTONE_LABEL_KEYS.paidAhead);
    expect(ahead.rows[0]).toMatchObject({ commitmentId: 'quote', amountCents: 500_00 });
    const due = dueFigure(plan, [], TODAY);
    expect(due).toMatchObject({ id: 'due-now', unit: 'money', value: 450_00 });
    expect(due.label).toBe(MILESTONE_LABEL_KEYS.dueNow);
    expect(traceable(ahead) && traceable(due)).toBe(true);
  });

  it('says how many payments are on no commitment: outside the payment plans', () => {
    expect(plans.outside).toMatchObject({ unit: 'count', value: 1 });
    expect(plans.outside.rows.map((row) => row.key)).toEqual(['payment:3']);
    expect(plans.noPlan.rows.map((row) => row.commitmentId)).toEqual(['bare']);
  });

  it('is worked out once for a snapshot, its diary and today', () => {
    expect(paymentPlans(plan, [], TODAY)).toBe(plans);
    const entries = [entry(1, '2026-09-08', { done: [finished('lay')] })];
    const later = paymentPlans(plan, entries, TODAY);
    expect(later).not.toBe(plans);
    expect(later.work.earned.value).toBe(plans.work.earned.value + 400_00);
    expect(paymentPlans(plan, entries, '2026-09-11')).not.toBe(later);
    expect(commitmentPlanOf(plan, [], TODAY, 'nobody')).toBeNull();
  });

  it('builds the paid rows of every commitment in one pass over the ledger', () => {
    const rows = paidRowsByCommitment(plan);
    expect([...rows.keys()]).toEqual(['quote', 'grout', null, 'painter']);
    expect(rows.get('painter')!.map((row) => row.amountCents)).toEqual([100_00]);
  });
});

// ── The warning before a payment ─────────────────────────────────────────────

describe('the preview before a payment', () => {
  const paid300 = { ...TILING, payments: [payment(1, 'quote', 300_00)] };

  it('warns when a payment would put the commitment ahead of the work, naming the next milestone', () => {
    const preview = paymentPreview(paid300, [], TODAY, draft('quote', 500_00));
    expect(preview).toEqual({
      kind: 'plan',
      commitmentId: 'quote',
      label: 'Tiler’s quote',
      earnedCents: 300_00,
      paidCents: 300_00,
      paidAfterCents: 800_00,
      dueCents: 0,
      dueAfterCents: 0,
      aheadCents: 0,
      aheadAfterCents: 500_00,
      reversal: false,
      warn: true,
      messageKey: PAYMENT_PREVIEW_KEYS.ahead,
      next: {
        milestoneId: 'laid',
        label: 'Tiles laid',
        shareBp: 4_000,
        cents: 400_00,
        trigger: 'activity_finished',
        target: { kind: 'activity', id: 'lay', name: 'Lay the tiles' },
        pendingKey: MILESTONE_PENDING_KEYS.activity_finished,
        openSnags: 0,
      },
    });
  });

  it('does not warn a payment of what is due, and says what would still be due', () => {
    const preview = paymentPreview(TILING, [], TODAY, draft('quote', 100_00));
    expect(preview).toMatchObject({
      kind: 'plan',
      dueCents: 300_00,
      dueAfterCents: 200_00,
      aheadAfterCents: 0,
      warn: false,
      messageKey: null,
    });
    const exact = paymentPreview(TILING, [], TODAY, draft('quote', 300_00));
    expect(exact).toMatchObject({ dueAfterCents: 0, aheadAfterCents: 0, warn: false });
  });

  it('warns with no next milestone when every one is earned and the rest is not in the plan', () => {
    const part: WorkSnapshot = {
      ...TILING,
      commitments: [commitment('quote', 'tiling', 1_000_00, [TILER_PLAN[0]!])],
      payments: [payment(1, 'quote', 300_00)],
    };
    expect(paymentPreview(part, [], TODAY, draft('quote', 50_00))).toMatchObject({
      warn: true,
      messageKey: PAYMENT_PREVIEW_KEYS.aheadNoNext,
      next: null,
      aheadAfterCents: 50_00,
    });
  });

  it('never warns about a reversal, nor about nothing typed yet on a commitment already ahead', () => {
    const ahead = { ...paid300, payments: [...paid300.payments, payment(2, 'quote', 500_00)] };
    const original = ahead.payments[1]!;
    const reversal = paymentPreview(ahead, [], TODAY, reversalDraft(original, 'Twice', TODAY));
    expect(reversal).toMatchObject({
      kind: 'plan',
      reversal: true,
      warn: false,
      aheadCents: 500_00,
      aheadAfterCents: 0,
    });
    // A reversal that names no commitment itself still finds the one it reverses.
    const bare = { ...reversalDraft(original, 'Twice', TODAY), commitmentId: null };
    expect(paymentPreview(ahead, [], TODAY, bare)).toMatchObject({ commitmentId: 'quote' });
    expect(paymentPreview(ahead, [], TODAY, draft('quote', 0))).toMatchObject({
      aheadCents: 500_00,
      aheadAfterCents: 500_00,
      warn: false,
    });
    // An amount that is not whole cents counts as nothing typed.
    expect(paymentPreview(ahead, [], TODAY, draft('quote', 1.5))).toMatchObject({
      paidAfterCents: 800_00,
      warn: false,
    });
  });

  it('has nothing to say of a payment on no commitment, or on one not in the plan', () => {
    expect(paymentPreview(TILING, [], TODAY, draft(null, 100_00))).toEqual({ kind: 'none' });
    expect(paymentPreview(TILING, [], TODAY, draft('nobody', 100_00))).toEqual({ kind: 'none' });
  });

  it('says only what was paid on a commitment with no plan', () => {
    const plan: WorkSnapshot = {
      ...TILING,
      commitments: [commitment('bare', 'tiling', 500_00)],
      payments: [payment(1, 'bare', 200_00)],
    };
    expect(paymentPreview(plan, [], TODAY, draft('bare', 400_00))).toEqual({
      kind: 'no-plan',
      commitmentId: 'bare',
      paidCents: 200_00,
      paidAfterCents: 600_00,
    });
  });
});

// ── Locked once money has moved ──────────────────────────────────────────────

describe('a plan is locked once money has moved on its commitment', () => {
  it('locks after a payment, and stays locked after its reversal', () => {
    expect(milestonesLocked(TILING, 'quote')).toBe(false);
    const paid = { ...TILING, payments: [payment(1, 'quote', 300_00)] };
    expect(milestonesLocked(paid, 'quote')).toBe(true);
    expect(planOf(paid).locked).toBe(true);
    const reversed = {
      ...paid,
      payments: [...paid.payments, payment(2, null, -300_00, { reversesSeq: 1 })],
    };
    expect(milestonesLocked(reversed, 'quote')).toBe(true);
    expect(planOf(reversed).paid.value).toBe(0);
    // A reversal of a payment on no commitment locks nothing; one of an unknown seq neither.
    const loose = {
      ...TILING,
      payments: [payment(1, null, 10_00), payment(2, null, -10_00, { reversesSeq: 1 })],
    };
    expect([...commitmentsWithMoney(loose)]).toEqual([]);
    const orphan = { ...TILING, payments: [payment(2, null, -10_00, { reversesSeq: 9 })] };
    expect([...commitmentsWithMoney(orphan)]).toEqual([]);
  });

  it('is not locked by a closed stage: money is not a plan edit', () => {
    const closed = {
      ...TILING,
      stages: [{ ...TILING.stages[0]!, closedAt: '2026-09-09T17:00:00.000Z' }],
    };
    expect(milestonesLocked(closed, 'quote')).toBe(false);
    expect(validateMilestone(closed, 'quote', { ...ADD, shareBp: 0 + 1 }, 'closed')).toEqual([]);
  });
});

// ── Checking a milestone ─────────────────────────────────────────────────────

const ADD: MilestoneDraft = {
  label: 'Grout done',
  shareBp: 1_000,
  trigger: 'stage_closed',
  activityId: null,
};

describe('checking a milestone before the host is asked', () => {
  const partPlan: WorkSnapshot = {
    ...TILING,
    stages: [...TILING.stages, stage('other', 2, 'Other')],
    activities: [...TILING.activities, activity('elsewhere', 'other', 1, 1)],
    commitments: [commitment('quote', 'tiling', 1_000_00, TILER_PLAN.slice(0, 2))],
  };

  it('accepts a milestone that fits', () => {
    expect(validateMilestone(partPlan, 'quote', { ...ADD, shareBp: 3_000 })).toEqual([]);
    expect(
      validateMilestone(partPlan, 'quote', {
        label: 'Floor ready',
        shareBp: 500,
        trigger: 'activity_finished',
        activityId: 'prepare',
      }),
    ).toEqual([]);
  });

  it('refuses one that takes the plan over 100 %, saying what is left', () => {
    expect(validateMilestone(partPlan, 'quote', { ...ADD, shareBp: 3_001 })).toEqual([
      { code: 'over-plan', availableBp: 3_000 },
    ]);
    // An edit is measured without the milestone it replaces.
    expect(validateMilestone(partPlan, 'quote', { ...ADD, shareBp: 7_000 }, 'laid')).toEqual([]);
    expect(validateMilestone(partPlan, 'quote', { ...ADD, shareBp: 7_001 }, 'laid')).toEqual([
      { code: 'over-plan', availableBp: 7_000 },
    ]);
    const full = { ...TILING };
    expect(validateMilestone(full, 'quote', ADD)).toEqual([{ code: 'over-plan', availableBp: 0 }]);
  });

  it('refuses a share that is not whole basis points from 1 to 10 000', () => {
    for (const shareBp of [0, -1, 10_001, 12.5, Number.NaN]) {
      expect(validateMilestone(partPlan, 'quote', { ...ADD, shareBp })).toEqual([
        { code: 'invalid-share' },
      ]);
    }
  });

  it('refuses a label that is empty or too long', () => {
    expect(validateMilestone(partPlan, 'quote', { ...ADD, label: '  ' })).toEqual([
      { code: 'label-empty' },
    ]);
    expect(validateMilestone(partPlan, 'quote', { ...ADD, label: 'x'.repeat(121) })).toEqual([
      { code: 'label-too-long' },
    ]);
    expect(validateMilestone(partPlan, 'quote', { ...ADD, label: 'x'.repeat(120) })).toEqual([]);
  });

  it('asks an activity of the commitment’s stage exactly for a finish', () => {
    const finish = { ...ADD, trigger: 'activity_finished' as const };
    expect(validateMilestone(partPlan, 'quote', finish)).toEqual([{ code: 'activity-required' }]);
    expect(validateMilestone(partPlan, 'quote', { ...finish, activityId: 'nope' })).toEqual([
      { code: 'unknown-activity' },
    ]);
    expect(validateMilestone(partPlan, 'quote', { ...finish, activityId: 'elsewhere' })).toEqual([
      { code: 'activity-of-another-stage' },
    ]);
    expect(validateMilestone(partPlan, 'quote', { ...ADD, activityId: 'prepare' })).toEqual([
      { code: 'activity-not-allowed' },
    ]);
    expect(
      validateMilestone(partPlan, 'quote', {
        ...ADD,
        trigger: 'someday' as MilestoneTrigger,
      }),
    ).toEqual([{ code: 'invalid-trigger' }]);
  });

  it('refuses an unknown commitment or milestone, and a commitment money has moved on', () => {
    expect(validateMilestone(partPlan, 'nobody', ADD)).toEqual([{ code: 'unknown-commitment' }]);
    expect(validateMilestone(partPlan, 'quote', ADD, 'nope')).toEqual([
      { code: 'unknown-milestone' },
    ]);
    const paid = { ...partPlan, payments: [payment(1, 'quote', 1_00)] };
    expect(validateMilestone(paid, 'quote', ADD)).toEqual([{ code: 'locked' }]);
    // Every problem at once, in the order of the form.
    expect(
      validateMilestone(
        paid,
        'quote',
        { label: '', shareBp: 0, trigger: 'advance', activityId: 'prepare' },
        'nope',
      ).map((problem) => problem.code),
    ).toEqual([
      'unknown-milestone',
      'locked',
      'label-empty',
      'invalid-share',
      'activity-not-allowed',
    ]);
  });
});

// ── The usual plan ───────────────────────────────────────────────────────────

describe('the usual plan', () => {
  const bare: WorkSnapshot = {
    ...TILING,
    commitments: [commitment('quote', 'tiling', 1_000_00)],
  };

  it('is a common split as data: 30 % started, 40 % last activity finished, 30 % closed', () => {
    expect(USUAL_PLAN).toEqual([
      { part: 'started', shareBp: 3_000, trigger: 'stage_started' },
      { part: 'finished', shareBp: 4_000, trigger: 'activity_finished' },
      { part: 'closed', shareBp: 3_000, trigger: 'stage_closed' },
    ]);
    expect(USUAL_PLAN.reduce((sum, each) => sum + each.shareBp, 0)).toBe(FULL_PLAN_BP);
  });

  it('fills a commitment with none, the 40 % waiting on the stage’s last activity', () => {
    expect(usualPlan(bare, 'quote')).toEqual({
      ok: true,
      milestones: [
        {
          part: 'started',
          labelKey: USUAL_PLAN_LABEL_KEYS.started,
          shareBp: 3_000,
          trigger: 'stage_started',
          activityId: null,
        },
        {
          part: 'finished',
          labelKey: USUAL_PLAN_LABEL_KEYS.finished,
          shareBp: 4_000,
          trigger: 'activity_finished',
          activityId: 'lay',
        },
        {
          part: 'closed',
          labelKey: USUAL_PLAN_LABEL_KEYS.closed,
          shareBp: 3_000,
          trigger: 'stage_closed',
          activityId: null,
        },
      ],
    });
  });

  it('is offered only on a commitment with no plan and no money moved, with an activity', () => {
    expect(usualPlan(TILING, 'quote')).toEqual({ ok: false, code: 'has-plan' });
    expect(usualPlan(bare, 'nobody')).toEqual({ ok: false, code: 'unknown-commitment' });
    const paid = { ...bare, payments: [payment(1, 'quote', 1_00)] };
    expect(usualPlan(paid, 'quote')).toEqual({ ok: false, code: 'locked' });
    const empty = { ...bare, activities: [] };
    expect(usualPlan(empty, 'quote')).toEqual({ ok: false, code: 'no-activity' });
  });

  it('takes the last activity by position, then by id, as the host does', () => {
    const plan = snapshot({
      activities: [
        activity('b', 's', 2, 1),
        activity('c', 's', 1, 1),
        activity('a', 's', 2, 1),
        activity('x', 'other', 9, 1),
      ],
    });
    expect(lastActivityOf(plan, 's')?.id).toBe('b');
    expect(lastActivityOf(plan, 'none')).toBeNull();
  });
});

// ── Readiness does not move ──────────────────────────────────────────────────

describe('readiness', () => {
  it('is exactly the same with payment plans, earned, due or paid ahead', () => {
    const base = withStageRules({
      ...TILING,
      commitments: [commitment('quote', 'tiling', 1_000_00)],
    });
    const withPlans: WorkSnapshot = {
      ...base,
      commitments: [
        commitment('quote', 'tiling', 1_000_00, TILER_PLAN),
        commitment('other', 'tiling', 500_00, [milestone('o', 1, 10_000, 'advance')]),
      ],
      payments: [payment(1, 'quote', 900_00)],
    };
    expect(aheadFigure(withPlans, [], TODAY).value).toBe(1);
    expect(dueFigure(withPlans, [], TODAY).value).toBe(500_00);
    const measure = (plan: WorkSnapshot) => {
      const withoutMoney = { ...plan, commitments: base.commitments, payments: [] };
      const measured = readiness(plan, { schedule: schedule(plan), today: TODAY });
      const reference = readiness(withoutMoney, {
        schedule: schedule(withoutMoney),
        today: TODAY,
      });
      return { measured, reference };
    };
    const { measured, reference } = measure(withPlans);
    expect(measured).toEqual(reference);
    expect(readinessFigure(measured)).toEqual(readinessFigure(reference));
    expect(readinessByRule(measured)).toEqual(readinessByRule(reference));
  });
});

// ── Message keys ─────────────────────────────────────────────────────────────

describe('the message keys', () => {
  it('are distinct, in the money namespace, one per trigger where a trigger is said', () => {
    expect(new Set(MILESTONE_MESSAGE_KEYS).size).toBe(MILESTONE_MESSAGE_KEYS.length);
    for (const key of MILESTONE_MESSAGE_KEYS) expect(key.startsWith('money.')).toBe(true);
    expect(Object.keys(MILESTONE_TRIGGER_KEYS)).toEqual([...MILESTONE_TRIGGERS]);
    expect(Object.keys(MILESTONE_PENDING_KEYS)).toEqual([...MILESTONE_TRIGGERS]);
    expect(Object.keys(MILESTONE_PROBLEM_KEYS)).toHaveLength(12);
    expect(MILESTONE_MESSAGE_KEYS).toContain(MILESTONE_STATE_KEYS.earned);
    expect(MILESTONE_MESSAGE_KEYS).toContain(USUAL_PLAN_LABEL_KEYS.note);
  });
});

// ── When the schedule expects a milestone (lifted from the lookahead, slice E2) ──

describe('the day a milestone is expected', () => {
  // Tuesday 1 September 2026 on: a (3 days, 1–3 Sep) → b (2 days, 4–7 Sep); c has no duration.
  const plan = snapshot({
    stages: [stage('s1', 1), stage('s2', 2)],
    activities: [
      activity('a', 's1', 1, 3),
      activity('b', 's1', 2, 2),
      activity('c', 's2', 1, null),
    ],
    dependencies: [link('ab', 'a', 'b')],
  });
  const facts = scheduledFacts(schedule(plan));
  const on = { stageId: 's1', agreedOn: '2026-08-20' };
  const expected = (trigger: MilestoneTrigger, activityId: string | null = null) =>
    expectedOn(facts, on, { trigger, activityId });

  it('is the day agreed for an advance, whatever the schedule says', () => {
    expect(expected('advance')).toBe('2026-08-20');
  });

  it('is the stage’s first start, its last finish, or the activity’s finish', () => {
    expect(expected('stage_started')).toBe('2026-09-01');
    expect(expected('stage_closed')).toBe('2026-09-07');
    expect(expected('activity_finished', 'a')).toBe('2026-09-03');
  });

  it('is unknown when the schedule places nothing that says it', () => {
    expect(
      expectedOn(facts, { ...on, stageId: 's2' }, { trigger: 'stage_started', activityId: null }),
    ).toBeNull();
    expect(expected('activity_finished', 'c')).toBeNull();
    expect(expected('activity_finished', null)).toBeNull();
    expect(expected('activity_finished', 'gone')).toBeNull();
  });

  it('reads one schedule once: the same facts for the same schedule', () => {
    const scheduled = schedule(plan);
    expect(scheduledFacts(scheduled)).toBe(scheduledFacts(scheduled));
  });
});
