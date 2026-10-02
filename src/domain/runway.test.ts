import { describe, expect, it } from 'vitest';

import { activity, changeOrder, link, snapshot, stage } from './__fixtures__/plan';
import { traceable, type Figure, type ReportRow } from './figure';
import type {
  Commitment,
  CostLine,
  Funding,
  FundingReceipt,
  Milestone,
  MilestoneTrigger,
  Payment,
  WorkSnapshot,
} from './plan';
import {
  RUNWAY_CHANCE_KEYS,
  RUNWAY_DEFAULT_WEEKS,
  RUNWAY_LABEL_KEYS,
  RUNWAY_MAX_WEEKS,
  RUNWAY_MESSAGE_KEYS,
  RUNWAY_NOTE_KEYS,
  RUNWAY_SENTENCE_KEYS,
  runway,
  runwayChance,
  type Runway,
  type RunwayRow,
} from './runway';
import { schedule } from './schedule';
import { PROBABILITY_MESSAGE_KEYS, finishProbability } from './schedule/probability';

// ── Builders ─────────────────────────────────────────────────────────────────

/** Wednesday of the week before the work starts (Monday 7 September 2026). */
const TODAY = '2026-09-02';

const milestone = (
  id: string,
  position: number,
  shareBp: number,
  trigger: MilestoneTrigger,
  activityId: string | null = null,
): Milestone => ({ id, position, label: `Milestone ${id}`, shareBp, trigger, activityId });

const commitment = (
  id: string,
  stageId: string,
  amountCents: number,
  milestones: Milestone[] = [],
  agreedOn = '2026-08-20',
): Commitment => ({
  id,
  stageId,
  personId: null,
  label: `Commitment ${id}`,
  amountCents,
  agreedOn,
  documentHash: null,
  milestones,
});

const line = (
  id: string,
  stageId: string,
  amountCents: number | null,
  activityId: string | null = null,
): CostLine => ({ id, stageId, activityId, label: `Line ${id}`, amountCents });

const payment = (
  seq: number,
  stageId: string,
  commitmentId: string | null,
  amountCents: number,
  day: string,
  reversesSeq: number | null = null,
): Payment => ({
  id: `payment-${seq}`,
  seq,
  day,
  personId: null,
  stageId,
  commitmentId,
  amountCents,
  whatFor: `Payment ${seq}`,
  receiptHash: null,
  reversesSeq,
  authorName: 'Sample author',
  createdAt: `${day}T12:00:00.000Z`,
});

const funding = (id: string, amountCents: number, expectedOn: string, position = 1): Funding => ({
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

/**
 * Walls (a, then b) then Paint (c), five working days each, from Monday 7 September 2026: a on
 * 7–11 Sep, b on 14–18, c on 21–25. Seen from Wednesday 2 September the weeks run from the week of
 * 31 Aug to the week of 21 Sep: four weeks.
 */
const BASE = snapshot({
  work: { ...snapshot().work, startDate: '2026-09-07' },
  stages: [stage('s1', 1, 'Walls'), stage('s2', 2, 'Paint')],
  activities: [activity('a', 's1', 1, 5), activity('b', 's1', 2, 5), activity('c', 's2', 1, 5)],
  dependencies: [link('ab', 'a', 'b'), link('bc', 'b', 'c')],
});

const run = (plan: WorkSnapshot, today = TODAY): Runway => runway(plan, schedule(plan), [], today);

/** Each week's rows, as [from, source:sourceId, cents]. */
const flows = (result: Runway) =>
  result.weeks.flatMap((week) =>
    week.rows.map((row) => [week.from, `${row.source}:${row.sourceId}`, row.amountCents]),
  );

/** Everything a runway promises about its numbers. */
function expectTraceable(result: Runway): void {
  const { end, short, late, notPriced } = result.figures;
  const figures: ReadonlyArray<Figure<ReportRow>> = [result.opening, end, short, late, notPriced];
  for (const figure of figures) expect(traceable(figure), figure.id).toBe(true);
  expect(end.value).toBe(result.spare);
  let balance = result.opening.value;
  for (const week of result.weeks) {
    expect(week.opening).toBe(balance);
    const sum = week.rows.reduce((total, row) => total + row.amountCents, 0);
    expect(sum).toBe(week.in - week.out);
    expect(week.closing).toBe(week.opening + week.in - week.out);
    expect(week.short).toBe(week.closing < 0);
    for (const row of week.rows) {
      expect(row.day! >= week.from && row.day! <= week.to, row.key).toBe(true);
    }
    balance = week.closing;
  }
  expect(result.spare).toBe(balance);
}

// ── The weeks ────────────────────────────────────────────────────────────────

describe('the weeks of a runway', () => {
  it('run Monday to Sunday from the week of today to the week of the finish', () => {
    const result = run(BASE);
    expect(result.weeks.map((week) => [week.index, week.from, week.to])).toEqual([
      [0, '2026-08-31', '2026-09-06'],
      [1, '2026-09-07', '2026-09-13'],
      [2, '2026-09-14', '2026-09-20'],
      [3, '2026-09-21', '2026-09-27'],
    ]);
    expect(result).toMatchObject({ noFinish: false, truncated: false, today: TODAY });
    expectTraceable(result);
  });

  it('are eight weeks when the plan has no finish yet, and say so', () => {
    const plan = {
      ...BASE,
      activities: BASE.activities.map((a) => ({ ...a, durationDays: null })),
    };
    const result = run(plan);
    expect(result.weeks).toHaveLength(RUNWAY_DEFAULT_WEEKS);
    expect(result.weeks.at(-1)!.from).toBe('2026-10-19');
    expect(result.noFinish).toBe(true);
    expect(result.notes).toContainEqual({ key: RUNWAY_NOTE_KEYS.noFinish, params: { weeks: 8 } });
  });

  it('are never more than 260, and what falls after is listed, not counted', () => {
    const plan = {
      ...BASE,
      activities: [activity('a', 's1', 1, 2_000)],
      dependencies: [],
      funding: [funding('late-tranche', 100_00, '2035-01-01')],
    };
    const result = run(plan);
    expect(result.weeks).toHaveLength(RUNWAY_MAX_WEEKS);
    expect(result.truncated).toBe(true);
    expect(result.notes).toContainEqual({
      key: RUNWAY_NOTE_KEYS.truncated,
      params: { weeks: RUNWAY_MAX_WEEKS },
    });
    expect(result.beyond.map((row) => [row.source, row.sourceId, row.amountCents])).toEqual([
      ['funding', 'late-tranche', 100_00],
    ]);
    expect(result.spare).toBe(0);
    expectTraceable(result);
  });

  it('are the current week alone when the finish is already past', () => {
    expect(run(BASE, '2026-12-02').weeks.map((week) => week.from)).toEqual(['2026-11-30']);
  });

  it('refuse a today that is not a day', () => {
    expect(() => run(BASE, '2026-02-30')).toThrow(RangeError);
    expect(() => runwayChance(BASE, schedule(BASE), [], 'today')).toThrow(RangeError);
  });
});

// ── The opening ──────────────────────────────────────────────────────────────

describe('the opening balance', () => {
  it('is money received less money paid, to date, both ledgers with their reversals', () => {
    const plan = {
      ...BASE,
      commitments: [commitment('k1', 's1', 1_000_00)],
      payments: [
        payment(1, 's1', 'k1', 300_00, '2026-08-25'),
        payment(2, 's1', null, 50_00, '2026-08-26'),
        payment(3, 's1', null, -50_00, '2026-08-27', 2),
      ],
      funding: [funding('savings', 1_000_00, '2026-08-20')],
      fundingReceipts: [
        receipt(1, 'savings', 600_00, '2026-08-20'),
        receipt(2, null, 80_00, '2026-08-21'),
        receipt(3, null, -80_00, '2026-08-22', 2),
        // Not money yet: dated after today.
        receipt(4, null, 999_00, '2026-09-03'),
      ],
    };
    const result = run(plan);
    expect(result.opening.value).toBe(300_00);
    expect(result.opening.rows.map((row) => [row.key, row.amountCents])).toEqual([
      ['opening:receipt:1', 600_00],
      ['opening:receipt:2', 80_00],
      ['opening:receipt:3', -80_00],
      ['opening:payment:1', -300_00],
      ['opening:payment:2', -50_00],
      ['opening:payment:3', 50_00],
    ]);
    expect(result.weeks[0]!.opening).toBe(300_00);
    expectTraceable(result);
  });
});

// ── Out ──────────────────────────────────────────────────────────────────────

describe('money out', () => {
  const PLANNED = {
    ...BASE,
    commitments: [
      commitment('k1', 's1', 1_000_00, [
        milestone('m1', 1, 3_000, 'stage_started'),
        milestone('m2', 2, 7_000, 'activity_finished', 'b'),
      ]),
    ],
  };

  it('puts a milestone not earned yet on the day the schedule expects its fact', () => {
    const result = run(PLANNED);
    expect(flows(result)).toEqual([
      ['2026-09-07', 'milestone:m1', -300_00],
      ['2026-09-14', 'milestone:m2', -700_00],
    ]);
    const m2 = result.weeks[2]!.rows[0]!;
    expect(m2).toMatchObject({
      day: '2026-09-18',
      expectedOn: '2026-09-18',
      when: 'on-day',
      commitmentId: 'k1',
      stageId: 's1',
      coveredCents: 0,
      messageKey: 'money.runway.row.milestone',
      whenKey: 'money.runway.when.onDay',
    });
    expectTraceable(result);
  });

  it('counts a milestone whose expected day has passed in the current week: it is still owed', () => {
    const result = run(PLANNED, '2026-09-09');
    const first = result.weeks[0]!;
    expect(first.from).toBe('2026-09-07');
    expect(first.rows).toEqual([
      expect.objectContaining({
        source: 'milestone',
        sourceId: 'm1',
        amountCents: -300_00,
        when: 'past',
        expectedOn: '2026-09-07',
        day: '2026-09-09',
      }),
    ]);
    expectTraceable(result);
  });

  it('takes off what money paid ahead covers, the earliest milestone first', () => {
    const plan = { ...PLANNED, payments: [payment(1, 's1', 'k1', 400_00, '2026-09-01')] };
    const result = run(plan);
    // m1 (300) is covered whole and is not owed; m2 is owed less the 100 left over.
    expect(flows(result)).toEqual([['2026-09-14', 'milestone:m2', -600_00]]);
    expect(result.weeks[2]!.rows[0]).toMatchObject({ coveredCents: 100_00 });
    expectTraceable(result);
  });

  it('counts what is earned and not paid in the current week', () => {
    const plan = {
      ...BASE,
      commitments: [commitment('k3', 's1', 200_00, [milestone('m', 1, 10_000, 'advance')])],
      payments: [payment(1, 's1', 'k3', 50_00, '2026-08-21')],
    };
    const result = run(plan);
    expect(flows(result)).toEqual([['2026-08-31', 'due:k3', -150_00]]);
    expect(result.weeks[0]!.rows[0]).toMatchObject({ when: 'past', day: TODAY });
    expectTraceable(result);
  });

  it('puts an advance agreed after today on the day agreed', () => {
    const plan = {
      ...BASE,
      commitments: [
        commitment('k3', 's1', 200_00, [milestone('m', 1, 10_000, 'advance')], '2026-09-15'),
      ],
    };
    expect(flows(run(plan))).toEqual([['2026-09-14', 'milestone:m', -200_00]]);
  });

  it('spreads the part of a commitment its plan does not hold like a commitment without one', () => {
    const plan = {
      ...BASE,
      commitments: [commitment('k1', 's1', 1_000_00, [milestone('m1', 1, 5_000, 'stage_started')])],
    };
    expect(flows(run(plan))).toEqual([
      ['2026-09-07', 'milestone:m1', -500_00],
      ['2026-09-07', 'plan-rest:k1', -250_00],
      ['2026-09-14', 'plan-rest:k1', -250_00],
    ]);
  });

  it('spreads a commitment without a plan over its stage’s remaining working days, the odd cents first', () => {
    const plan = {
      ...BASE,
      commitments: [commitment('k2', 's1', 1_000_03)],
    };
    const result = run(plan);
    // Walls run 7–18 Sep: ten working days, the first three take a cent more.
    expect(flows(result)).toEqual([
      ['2026-09-07', 'commitment:k2', -500_03],
      ['2026-09-14', 'commitment:k2', -500_00],
    ]);
    expect(result.weeks[1]!.rows[0]).toMatchObject({ when: 'spread', day: '2026-09-07' });
    expectTraceable(result);
  });

  it('spreads only what is unpaid, and only over the days left from today', () => {
    const plan = {
      ...BASE,
      commitments: [commitment('k2', 's1', 1_000_00)],
      payments: [payment(1, 's1', 'k2', 100_00, '2026-09-08')],
    };
    // Wednesday 16 Sep: Wed, Thu and Fri are left of the walls.
    const result = run(plan, '2026-09-16');
    expect(flows(result)).toEqual([['2026-09-14', 'commitment:k2', -900_00]]);
    expect(result.weeks[0]!.rows[0]).toMatchObject({ when: 'spread', day: '2026-09-16' });
    expectTraceable(result);
  });

  it('counts the rest of a span already over, and of a closed stage, in the current week', () => {
    const plan = { ...BASE, commitments: [commitment('k2', 's1', 1_000_00)] };
    expect(run(plan, '2026-09-23').weeks[0]!.rows).toEqual([
      expect.objectContaining({ sourceId: 'k2', amountCents: -1_000_00, when: 'past' }),
    ]);
    const closed = {
      ...plan,
      stages: [
        {
          ...stage('s1', 1, 'Walls'),
          startedAt: '2026-09-01T08:00:00.000Z',
          closedAt: '2026-09-02T08:00:00.000Z',
        },
        stage('s2', 2, 'Paint'),
      ],
    };
    const result = run(closed);
    expect(flows(result)).toEqual([['2026-08-31', 'commitment:k2', -1_000_00]]);
    expect(result.weeks[0]!.rows[0]).toMatchObject({
      when: 'closed',
      whenKey: 'money.runway.when.closed',
    });
    expectTraceable(result);
  });

  it('counts a closed stage’s milestones not earned in the current week too', () => {
    const plan = {
      ...BASE,
      stages: [
        {
          ...stage('s1', 1, 'Walls'),
          startedAt: '2026-09-01T08:00:00.000Z',
          closedAt: '2026-09-02T08:00:00.000Z',
        },
        stage('s2', 2, 'Paint'),
      ],
      commitments: [
        commitment('k1', 's1', 1_000_00, [milestone('m2', 1, 10_000, 'activity_finished', 'b')]),
      ],
    };
    expect(run(plan).weeks[0]!.rows).toEqual([
      expect.objectContaining({ sourceId: 'm2', amountCents: -1_000_00, when: 'closed' }),
    ]);
  });

  it('spreads a stage’s planned money not yet committed, less what was paid there on no commitment', () => {
    const plan = {
      ...BASE,
      costLines: [line('l1', 's2', 600_00, 'c'), line('l2', 's2', null), line('l3', 's1', 100_00)],
      commitments: [commitment('k1', 's1', 150_00, [milestone('m1', 1, 10_000, 'stage_started')])],
      payments: [payment(1, 's2', null, 100_00, '2026-09-01')],
    };
    const result = run(plan);
    // Walls: 100 planned, 150 committed: nothing uncommitted. Paint: 600 less 100 paid on nothing.
    expect(flows(result)).toEqual([
      ['2026-09-07', 'milestone:m1', -150_00],
      ['2026-09-21', 'uncommitted:s2', -500_00],
    ]);
    expect(result.figures.notPriced.rows.map((row) => row.costLineId)).toEqual(['l2']);
    expect(result.notes).toContainEqual({ key: RUNWAY_NOTE_KEYS.notPriced, params: { count: 1 } });
    expectTraceable(result);
  });

  it('counts money the schedule gives no day in the current week, and says so', () => {
    const plan = {
      ...BASE,
      stages: [...BASE.stages, stage('s3', 3, 'Garden')],
      activities: [...BASE.activities, activity('d', 's3', 1, null)],
      costLines: [line('l1', 's3', 300_00)],
    };
    const result = run(plan);
    expect(flows(result)).toEqual([['2026-08-31', 'uncommitted:s3', -300_00]]);
    expect(result.undated.map((row) => row.sourceId)).toEqual(['s3']);
    expect(result.notes).toContainEqual({
      key: RUNWAY_NOTE_KEYS.undated,
      params: { count: 1, amount: 300_00 },
    });
  });

  it('does not project a change order waiting for its decision (E1)', () => {
    const plan = {
      ...BASE,
      costLines: [line('l1', 's1', 500_00)],
      funding: [funding('f', 500_00, TODAY)],
    };
    const pending = {
      ...plan,
      changeOrders: [
        changeOrder('co1', 1, 's1', '2026-09-01', {
          costCents: 5_000_00,
          effects: [{ kind: 'add', name: 'Extra wall', durationDays: 10, after: 'b' }],
        }),
      ],
    };
    expect(run(pending).weeks).toEqual(run(plan).weeks);
  });
});

// ── In ───────────────────────────────────────────────────────────────────────

describe('money in', () => {
  it('counts each funding row’s part not received yet on its expected day', () => {
    const plan = {
      ...BASE,
      funding: [funding('loan', 1_000_00, '2026-09-15')],
      fundingReceipts: [receipt(1, 'loan', 400_00, '2026-09-01')],
    };
    const result = run(plan);
    expect(result.opening.value).toBe(400_00);
    expect(flows(result)).toEqual([['2026-09-14', 'funding:loan', 600_00]]);
    expect(result.spare).toBe(1_000_00);
    expectTraceable(result);
  });

  it('counts the whole row again once its receipt is reversed', () => {
    const plan = {
      ...BASE,
      funding: [funding('loan', 1_000_00, '2026-09-15')],
      fundingReceipts: [
        receipt(1, 'loan', 400_00, '2026-09-01'),
        receipt(2, 'loan', -400_00, '2026-09-02', 1),
      ],
    };
    const result = run(plan);
    expect(result.opening.value).toBe(0);
    expect(flows(result)).toEqual([['2026-09-14', 'funding:loan', 1_000_00]]);
  });

  it('does not count money expected before today and not received: it is late, and listed', () => {
    const plan = {
      ...BASE,
      funding: [funding('yesterday', 500_00, '2026-09-01', 1), funding('today', 200_00, TODAY, 2)],
    };
    const result = run(plan);
    expect(flows(result)).toEqual([['2026-08-31', 'funding:today', 200_00]]);
    expect(result.figures.late).toMatchObject({ value: 1, label: RUNWAY_LABEL_KEYS.late });
    expect(result.figures.late.rows).toEqual([
      expect.objectContaining({
        key: 'late:funding:yesterday',
        amountCents: 500_00,
        expectedOn: '2026-09-01',
        when: 'past',
      }),
    ]);
    expect(result.notes[0]).toEqual({
      key: RUNWAY_NOTE_KEYS.late,
      params: { count: 1, amount: 500_00 },
    });
    expect(result.spare).toBe(200_00);
    expectTraceable(result);
  });
});

// ── The sentence ─────────────────────────────────────────────────────────────

describe('the sentence', () => {
  const PLANNED = {
    ...BASE,
    commitments: [
      commitment('k1', 's1', 1_000_00, [
        milestone('m1', 1, 3_000, 'stage_started'),
        milestone('m2', 2, 7_000, 'activity_finished', 'b'),
      ]),
    ],
    fundingReceipts: [receipt(1, null, 400_00, '2026-09-01')],
  };

  it('says the money lasts, with what is left at the end', () => {
    const plan = { ...PLANNED, funding: [funding('loan', 1_000_00, '2026-09-14')] };
    const result = run(plan);
    expect(result.weeks.map((week) => week.closing)).toEqual([400_00, 100_00, 400_00, 400_00]);
    expect(result).toMatchObject({ state: 'lasts', shortWeek: null, shortBy: null, spare: 400_00 });
    expect(result.sentence).toEqual({ key: RUNWAY_SENTENCE_KEYS.lasts, params: { spare: 400_00 } });
    expect(result.figures.short).toMatchObject({ unit: 'days', value: 0, rows: [] });
    expectTraceable(result);
  });

  it('says the week it first runs short and by how much, even when a later week recovers', () => {
    const plan = { ...PLANNED, funding: [funding('loan', 1_000_00, '2026-09-21')] };
    const result = run(plan);
    expect(result.weeks.map((week) => week.closing)).toEqual([400_00, 100_00, -600_00, 400_00]);
    expect(result).toMatchObject({ state: 'short', shortBy: 600_00, spare: 400_00 });
    expect(result.shortWeek!.from).toBe('2026-09-14');
    expect(result.sentence).toEqual({
      key: RUNWAY_SENTENCE_KEYS.short,
      params: { week: '2026-09-14', short: 600_00 },
    });
    // "Runs short in": twelve calendar days from today to that Monday; its row the week.
    expect(result.figures.short).toMatchObject({ value: 12, label: RUNWAY_LABEL_KEYS.short });
    expect(result.figures.short.rows).toEqual([
      expect.objectContaining({
        from: '2026-09-14',
        to: '2026-09-20',
        shortByCents: 600_00,
        days: 12,
        againstFinish: 12,
      }),
    ]);
    expectTraceable(result);
  });

  it('runs short this week when more is owed now than is on hand', () => {
    const plan = {
      ...BASE,
      commitments: [commitment('k3', 's1', 200_00, [milestone('m', 1, 10_000, 'advance')])],
      funding: [funding('later', 500_00, '2026-09-14')],
    };
    const result = run(plan);
    expect(result).toMatchObject({ state: 'short', shortBy: 200_00, spare: 300_00 });
    expect(result.figures.short).toMatchObject({ value: 0 });
    expect(result.figures.short.rows).toHaveLength(1);
    expectTraceable(result);
  });

  it('says where the money comes from is not written down when nothing is funded or received', () => {
    const plan = { ...BASE, costLines: [line('l1', 's2', 600_00)] };
    const result = run(plan);
    expect(result.state).toBe('no-funding');
    expect(result.sentence).toEqual({
      key: RUNWAY_SENTENCE_KEYS.noFunding,
      params: { needed: 600_00 },
    });
  });

  it('says there is nothing to say when no money is planned, owed or received', () => {
    const result = run(BASE);
    expect(result.state).toBe('nothing');
    expect(result.sentence).toEqual({ key: RUNWAY_SENTENCE_KEYS.nothing, params: {} });
    expect(result.spare).toBe(0);
    expectTraceable(result);
  });

  it('opens “Money at the end” onto every row it counted, each key once', () => {
    const plan = {
      ...PLANNED,
      commitments: [...PLANNED.commitments, commitment('k2', 's2', 300_00)],
      costLines: [line('l1', 's2', 900_00)],
      funding: [funding('loan', 2_000_00, '2026-09-21')],
    };
    const result = run(plan);
    const end = result.figures.end;
    expect(end).toMatchObject({ id: 'runway.end', label: RUNWAY_LABEL_KEYS.end, unit: 'money' });
    const counted: RunwayRow[] = [...result.opening.rows, ...result.weeks.flatMap((w) => w.rows)];
    expect(end.rows).toEqual(counted);
    expect(end.value).toBe(400_00 + 2_000_00 - 1_000_00 - 300_00 - 600_00);
    expectTraceable(result);
  });

  it('names every key under money.runway.', () => {
    expect(new Set(RUNWAY_MESSAGE_KEYS).size).toBe(RUNWAY_MESSAGE_KEYS.length);
    for (const key of RUNWAY_MESSAGE_KEYS) expect(key).toMatch(/^money\.runway\./);
  });
});

// ── The chance ───────────────────────────────────────────────────────────────

describe('the chance it runs short (D1)', () => {
  /**
   * One activity, 2 to 20 working days (6 likely), from Monday 7 September; its finish earns all of
   * a commitment, and the money for it arrives on Monday 21 September. A run that finishes the work
   * before that week runs short; one that finishes it in that week or later does not.
   */
  const RANGED = snapshot({
    work: { ...snapshot().work, startDate: '2026-09-07' },
    stages: [stage('s1', 1, 'Walls')],
    activities: [{ ...activity('a', 's1', 1, 6), durationMinDays: 2, durationMaxDays: 20 }],
    commitments: [
      commitment('k1', 's1', 1_000_00, [milestone('m1', 1, 10_000, 'activity_finished', 'a')]),
    ],
    funding: [funding('loan', 1_000_00, '2026-09-21')],
  });
  const chanceOf = (plan: WorkSnapshot, runs = 400, seed?: number) =>
    runwayChance(plan, schedule(plan), [], TODAY, {
      runs,
      ...(seed === undefined ? {} : { seed }),
    });

  it('counts the runs whose balance goes below zero before their own finish', () => {
    const result = chanceOf(RANGED);
    if (!result.ok || result.kind !== 'chance') throw new Error('expected a chance');
    expect(result.runs).toBe(400);
    expect(result.hits).toBeGreaterThan(0);
    expect(result.hits).toBeLessThan(400);
    expect(result.chance).toBe(result.hits / 400);
    expect(result.frequency.n).toBe(Math.floor(result.chance * 10 + 1e-9));
    expect(result.sentence).toEqual({
      key: RUNWAY_CHANCE_KEYS.short,
      params: { n: result.frequency.n, hits: result.hits, runs: 400 },
    });
    expect(result.method).toEqual({ key: RUNWAY_CHANCE_KEYS.method, params: { runs: 400 } });
    expect(result.figure).toMatchObject({ unit: 'chance', hits: result.hits, runs: 400 });
    expect(traceable(result.figure)).toBe(true);
    // The deterministic runway: the plan's six days finish on 14 Sep, a week before the money.
    expect(run(RANGED).state).toBe('short');
  });

  it('gives the same chance for the same plan, and its own for another seed', () => {
    const first = chanceOf(RANGED);
    const again = chanceOf(RANGED);
    expect(again).toEqual(first);
    const seeded = chanceOf(RANGED, 400, 7);
    const seededAgain = chanceOf(RANGED, 400, 7);
    expect(seededAgain).toEqual(seeded);
    if (seeded.ok && seeded.kind === 'chance') expect(seeded.seed).toBe(7);
  });

  it('finds no run short when the money is there before anything is owed', () => {
    const plan = { ...RANGED, funding: [funding('loan', 1_000_00, TODAY)] };
    const result = chanceOf(plan);
    expect(result).toMatchObject({ ok: true, kind: 'chance', hits: 0 });
    if (result.ok && result.kind === 'chance') expect(result.frequency.kind).toBe('none');
  });

  it('finds every run short when the money never comes in time', () => {
    const plan = { ...RANGED, funding: [] };
    const result = chanceOf(plan);
    expect(result).toMatchObject({ ok: true, kind: 'chance', hits: 400 });
    if (result.ok && result.kind === 'chance') expect(result.frequency.kind).toBe('every');
  });

  it('says every duration is taken as certain when nothing has a range', () => {
    const plan = { ...RANGED, activities: [activity('a', 's1', 1, 6)] };
    expect(chanceOf(plan)).toEqual({
      ok: true,
      kind: 'all-certain',
      sentence: { key: RUNWAY_CHANCE_KEYS.allCertain, params: {} },
    });
  });

  it('is refused as the finish’s chance is, when nothing can be simulated', () => {
    const plan = { ...RANGED, activities: [activity('a', 's1', 1, null)] };
    expect(chanceOf(plan)).toEqual({
      ok: false,
      code: 'nothing-placed',
      messageKey: PROBABILITY_MESSAGE_KEYS.problem['nothing-placed'],
    });
  });

  it('places the spread money on each run’s dates too', () => {
    // No plan: the commitment is spread over the walls' span, which each run draws. Half the money
    // is on hand, the other half comes on 14 Sep: a run whose walls take fewer than ten working days
    // owes more than half in the week of 7 Sep, and runs short; a longer one does not.
    const plan = {
      ...RANGED,
      commitments: [commitment('k2', 's1', 1_000_00)],
      funding: [funding('loan', 500_00, '2026-09-14')],
      fundingReceipts: [receipt(1, null, 500_00, '2026-09-01')],
    };
    const result = chanceOf(plan);
    if (!result.ok || result.kind !== 'chance') throw new Error('expected a chance');
    expect(result.hits).toBeGreaterThan(0);
    expect(result.hits).toBeLessThan(400);
  });
  it('is, run by run, the runway of that run’s durations: the same rules, nothing else', () => {
    // Two stages of ranged work; a plan with milestones, one without, a plan below 100 %, money
    // planned and not committed, and three funds: every kind of money out and in.
    const plan = snapshot({
      work: { ...snapshot().work, startDate: '2026-09-07' },
      stages: [stage('s1', 1, 'Walls'), stage('s2', 2, 'Paint')],
      activities: [
        { ...activity('a', 's1', 1, 4), durationMinDays: 2, durationMaxDays: 9 },
        { ...activity('b', 's1', 2, 3), durationMinDays: 1, durationMaxDays: 8 },
        { ...activity('c', 's2', 1, 5), durationMinDays: 3, durationMaxDays: 12 },
      ],
      dependencies: [link('ab', 'a', 'b'), link('bc', 'b', 'c')],
      commitments: [
        commitment('k1', 's1', 900_00, [
          milestone('m1', 1, 3_000, 'stage_started'),
          milestone('m2', 2, 5_000, 'activity_finished', 'b'),
        ]),
        commitment('k2', 's2', 700_00),
      ],
      costLines: [line('l1', 's2', 1_100_00, 'c'), line('l2', 's1', 900_00)],
      fundingReceipts: [receipt(1, null, 500_00, '2026-09-01')],
      funding: [
        funding('f1', 1_100_00, '2026-09-14', 1),
        funding('f2', 700_00, '2026-09-21', 2),
        funding('f3', 900_00, '2026-10-05', 3),
      ],
    });
    const options = { runs: 80, seed: 5 };
    const drawn: Array<Record<string, number>> = [];
    finishProbability(plan, schedule(plan), {
      ...options,
      onRun: (each) => {
        const days: Record<string, number> = {};
        each.activityIds.forEach((id, at) => (days[id] = each.finish[at]! - each.start[at]!));
        drawn.push(days);
      },
    });
    const shortRuns = (today: string) =>
      drawn.filter((days) => {
        const certain = {
          ...plan,
          activities: plan.activities.map((each) => ({
            ...each,
            durationDays: days[each.id]!,
            durationMinDays: null,
            durationMaxDays: null,
          })),
        };
        return run(certain, today).weeks.some((week) => week.short);
      }).length;
    const short = shortRuns(TODAY);
    expect(runwayChance(plan, schedule(plan), [], TODAY, options)).toMatchObject({
      ok: true,
      kind: 'chance',
      hits: short,
      runs: 80,
    });
    // Some runs run short, some do not: the comparison is not won by every run agreeing trivially.
    expect(short).toBeGreaterThan(0);
    expect(short).toBeLessThan(80);
    expect(run(plan).state).toBe('lasts');
    // And from days inside the work, where spans are cut at today and days have passed.
    for (const today of ['2026-09-10', '2026-09-16', '2026-09-24']) {
      const result = runwayChance(plan, schedule(plan), [], today, options);
      expect(result, today).toMatchObject({ ok: true, kind: 'chance', hits: shortRuns(today) });
    }
  });
});
