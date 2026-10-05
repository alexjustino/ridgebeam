import { describe, expect, it } from 'vitest';

import {
  activity,
  correction,
  decision,
  entry,
  finished,
  link,
  person,
  purchase,
  snapshot,
  stage,
  takeBaseline,
  worked,
} from '../__fixtures__/plan';
import type { DiaryEntry } from '../diary';
import { traceable, type Figure, type ReportRow } from '../figure';
import type { Payment, WorkSnapshot } from '../plan';
import { purchaseFigures } from '../purchases';
import { schedule } from '../schedule';
import {
  WEEKLY_DECISION_WINDOW_DAYS,
  WEEKLY_LABEL_KEYS,
  WEEKLY_LACKS,
  WEEKLY_PROBLEM_KEYS,
  weekly,
  type Weekly,
} from './weekly';

/**
 * From Tuesday 1 September 2026, Monday to Friday. Structure (20 days, 1 – 28 September), then
 * Finishes: Tiles (2 days, from Tuesday 29 September) and Paint (1 day). Two people; a stray
 * activity whose stage is gone.
 */
const PLAN = snapshot({
  people: [person('p1', 'Sample tiler', { trade: 'Tiler' }), person('p2', 'Sample mason')],
  stages: [stage('struct', 1, 'Structure'), stage('finish', 2, 'Finishes')],
  activities: [
    activity('frame', 'struct', 1, 20, 'p2'),
    { ...activity('tiles', 'finish', 1, 2, 'p1'), quantity: 20, unit: 'm²' },
    activity('paint', 'finish', 2, 1),
    activity('stray', 'gone', 1, 1),
  ],
  dependencies: [link('l1', 'frame', 'tiles'), link('l2', 'tiles', 'paint')],
});

const made = (
  plan: WorkSnapshot,
  entries: readonly DiaryEntry[],
  week: string | null,
  today: string,
) => {
  const result = weekly(plan, schedule(plan), entries, week, today);
  if (!result.ok) throw new Error(result.problem.code);
  return result.weekly;
};

const figuresOf = (report: Weekly): Array<Figure<ReportRow>> => [
  report.entries,
  report.daysWithoutEntry,
  report.worked,
  report.finished,
  report.onSite,
  report.weatherLost,
  report.readiness,
  report.decisions,
  report.money.planned,
  report.money.committed,
  report.money.paid,
  report.money.paidThisWeek,
  report.money.paidAhead,
  report.money.dueNow,
  report.stages.planned,
  report.stages.ready,
  report.stages.started,
  report.stages.held,
  report.stages.closed,
  report.purchases.toOrderThisWeek,
  report.purchases.lateToOrder,
  report.purchases.lateToArrive,
  report.purchases.arrivesAfterNeeded,
  ...(report.finish.slip === null ? [] : [report.finish.slip]),
];

describe('which week', () => {
  it('is the week of today when none is asked for', () => {
    const report = made(PLAN, [], null, '2026-09-10');
    expect(report.week.from).toBe('2026-09-07');
    expect(report.week.to).toBe('2026-09-13');
    expect(report.today).toBe('2026-09-10');
  });

  it('is the week any of its days falls in, across a month', () => {
    const report = made(PLAN, [], '2026-10-04', '2026-10-20');
    expect(report.week.from).toBe('2026-09-28');
    expect(report.week.to).toBe('2026-10-04');
  });

  it('refuses a day that is not a day, and a week that has not begun', () => {
    const scheduled = schedule(PLAN);
    expect(weekly(PLAN, scheduled, [], '2026-02-30', '2026-09-10')).toEqual({
      ok: false,
      problem: { code: 'invalid-week', messageKey: WEEKLY_PROBLEM_KEYS['invalid-week'] },
    });
    expect(weekly(PLAN, scheduled, [], null, 'today')).toEqual({
      ok: false,
      problem: { code: 'invalid-today', messageKey: WEEKLY_PROBLEM_KEYS['invalid-today'] },
    });
    expect(weekly(PLAN, scheduled, [], '2026-09-14', '2026-09-13')).toEqual({
      ok: false,
      problem: {
        code: 'future-week',
        messageKey: WEEKLY_PROBLEM_KEYS['future-week'],
        from: '2026-09-14',
      },
    });
    // The week that holds today has begun, even on its Monday.
    expect(weekly(PLAN, scheduled, [], '2026-09-20', '2026-09-14').ok).toBe(true);
  });
});

describe('a week with no entry', () => {
  const report = made(PLAN, [entry(1, '2026-09-01')], '2026-09-09', '2026-09-11');

  it('says it is empty, and lists the working days that are over with nothing written', () => {
    expect(report.empty).toBe(true);
    expect(report.entries.value).toBe(0);
    expect(report.daysWithoutEntry.rows.map((row) => row.day)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
    ]);
    expect(report.days.map((day) => day.status)).toEqual([
      'missing',
      'missing',
      'missing',
      'missing',
      'to-come',
      'not-working',
      'not-working',
    ]);
  });

  it('still gives everything else', () => {
    expect(report.readiness.value).toBeGreaterThan(0);
    expect(report.finish.finishDate).toBe('2026-10-01');
    expect(report.stages.ready.rows.map((row) => row.stageId)).toEqual(['struct']);
    expect(figuresOf(report).every(traceable)).toBe(true);
  });
});

describe('what the week’s entries say', () => {
  const entries = [
    entry(1, '2026-09-29', {
      done: [worked('tiles', 5)],
      present: ['p1', 'p2'],
      weather: 'rain',
    }),
    // The correction, inside the week, says Tiles was finished with 8 m² and only the tiler came.
    correction(2, 1, '2026-09-29', {
      done: [finished('tiles', 8)],
      present: ['p1'],
      weather: 'sun',
    }),
    entry(3, '2026-09-30', { done: [worked('paint'), worked('frame', 1), worked('ghost')] }),
    entry(4, '2026-10-01', { done: [worked('paint', null), worked('stray', 2)], present: ['p2'] }),
    entry(5, '2026-10-02', { weather: 'storm' }),
    entry(6, '2026-10-06', { done: [finished('paint')] }),
  ];
  const report = made(PLAN, entries, '2026-10-01', '2026-10-08');

  it('reads the correction and not what it corrects', () => {
    expect(report.empty).toBe(false);
    expect(report.entries.rows.map((row) => row.seq)).toEqual([2, 3, 4, 5]);
    expect(
      report.finished.rows.map((row) => [row.activityId, row.quantity, row.unit, row.days]),
    ).toEqual([['tiles', 8, 'm²', ['2026-09-29']]]);
    expect(report.onSite.rows.map((row) => row.personId)).toEqual(['p2', 'p1']);
    expect(report.weatherLost.rows.map((row) => [row.day, row.weather])).toEqual([
      ['2026-10-02', 'storm'],
    ]);
  });

  it('lists what was worked on and not finished in the week, in plan order, gone activities left out', () => {
    expect(
      report.worked.rows.map((row) => [
        row.number,
        row.activityId,
        row.stageName,
        row.days,
        row.quantity,
        row.day,
      ]),
    ).toEqual([
      ['1.1', 'frame', 'Structure', ['2026-09-30'], 1, '2026-09-30'],
      ['2.2', 'paint', 'Finishes', ['2026-09-30', '2026-10-01'], null, '2026-10-01'],
      [null, 'stray', null, ['2026-10-01'], 2, '2026-10-01'],
    ]);
    expect(report.worked.label).toBe(WEEKLY_LABEL_KEYS.worked);
    expect(report.finished.label).toBe(WEEKLY_LABEL_KEYS.finished);
    expect(report.worked.rows[0]).toMatchObject({
      key: 'activity:frame',
      itemId: 'frame',
      title: 'Activity frame',
      unit: null,
    });
  });

  it('gives every day of a week across a month end, and lists the missing one', () => {
    expect(report.days.map((day) => [day.day, day.status])).toEqual([
      ['2026-09-28', 'missing'],
      ['2026-09-29', 'written'],
      ['2026-09-30', 'written'],
      ['2026-10-01', 'written'],
      ['2026-10-02', 'written'],
      ['2026-10-03', 'not-working'],
      ['2026-10-04', 'not-working'],
    ]);
    expect(report.daysWithoutEntry.rows.map((row) => row.day)).toEqual(['2026-09-28']);
  });

  it('keeps every figure traceable', () => {
    expect(figuresOf(report).every(traceable)).toBe(true);
  });
});

describe('a week across the end of a year, with a holiday', () => {
  const plan = { ...PLAN, holidays: [{ date: '2027-01-01', name: 'Sample holiday' }] };
  const report = made(
    plan,
    [
      entry(1, '2026-12-31', { weather: 'rain' }),
      entry(2, '2027-01-02', { note: 'Saturday visit' }),
    ],
    '2026-12-30',
    '2027-01-05',
  );

  it('runs Monday 28 December to Sunday 3 January, the holiday not a missing day', () => {
    expect(report.week).toMatchObject({ from: '2026-12-28', to: '2027-01-03' });
    expect(report.days.map((day) => day.status)).toEqual([
      'missing',
      'missing',
      'missing',
      'written',
      'not-working',
      'written',
      'not-working',
    ]);
    expect(report.days[4]).toMatchObject({ day: '2027-01-01', holiday: true, working: false });
    expect(report.daysWithoutEntry.value).toBe(3);
    expect(report.weatherLost.rows.map((row) => row.day)).toEqual(['2026-12-31']);
  });
});

describe('readiness and the finish', () => {
  it('names the first three things readiness lacks, in its order', () => {
    const report = made(PLAN, [], null, '2026-09-10');
    expect(WEEKLY_LACKS).toBe(3);
    expect(report.lacks).toEqual(report.readiness.rows.slice(0, 3));
    expect(report.readiness.rows.length).toBeGreaterThan(3);
  });

  it('has no baseline and no slip before the plan is approved', () => {
    expect(made(PLAN, [], null, '2026-09-10').finish).toEqual({
      finishDate: '2026-10-01',
      baseline: null,
      slip: null,
    });
  });

  it('reads the finish against the latest baseline, with the slip', () => {
    const shorter = {
      ...PLAN,
      activities: PLAN.activities.map((each) =>
        each.id === 'frame' ? { ...each, durationDays: 18 } : each,
      ),
    };
    const plan = { ...PLAN, baselines: [takeBaseline(PLAN, 1), takeBaseline(shorter, 2)] };
    const report = made(plan, [], null, '2026-09-10');
    expect(report.finish.baseline).toEqual({ number: 2, finishDate: '2026-09-29' });
    expect(report.finish.slip!.value).toBe(2);
    expect(traceable(report.finish.slip!)).toBe(true);
  });
});

describe('decisions due', () => {
  // Today is Monday 7 September; the window ends Monday 21 September. Finishes starts Tuesday 29
  // September, so a lead of L working days puts the deadline L working days before it.
  const TODAY = '2026-09-07';
  const plan: WorkSnapshot = {
    ...PLAN,
    stages: [...PLAN.stages, stage('empty', 3, 'Nothing scheduled')],
    decisions: [
      decision('in-window-edge', 'finish', 1, 6), // Mon 21 September: today + 14
      decision('past-window', 'finish', 2, 5), // Tue 22 September: today + 15
      decision('today', 'finish', 3, 16), // Mon 7 September
      decision('overdue', 'finish', 4, 17), // Fri 4 September
      decision('made', 'finish', 5, 16, '2026-09-01T12:00:00.000Z'),
      decision('unknown', 'empty', 1, 0),
      decision('far-overdue', 'struct', 1, 3), // before the work began
    ],
  };

  it('lists the overdue and those due up to today + 14 days, both ends in, most urgent first', () => {
    expect(WEEKLY_DECISION_WINDOW_DAYS).toBe(14);
    const report = made(plan, [], null, TODAY);
    expect(report.decisions.label).toBe(WEEKLY_LABEL_KEYS.decisions);
    expect(
      report.decisions.rows.map((row) => [
        row.decisionId,
        row.status,
        row.deadline,
        row.daysLeft,
        row.stageName,
      ]),
    ).toEqual([
      ['far-overdue', 'overdue', '2026-08-27', -7, 'Structure'],
      ['overdue', 'overdue', '2026-09-04', -1, 'Finishes'],
      ['today', 'due', '2026-09-07', 0, 'Finishes'],
      ['in-window-edge', 'due', '2026-09-21', 10, 'Finishes'],
    ]);
    expect(traceable(report.decisions)).toBe(true);
  });

  it('never lists a decision whose stage is gone: it has no deadline', () => {
    // A decision on a stage that is not in the plan has no deadline, so it is never due.
    const orphaned = { ...plan, decisions: [decision('lost', 'gone', 1, 0)] };
    expect(made(orphaned, [], null, TODAY).decisions.value).toBe(0);
  });

  it('lists none when the calendar cannot be counted on', () => {
    const broken = { ...plan, calendar: { workingDays: '0000000', hoursPerDay: 8 } };
    const report = made(broken, [], null, TODAY);
    expect(report.decisions.rows).toEqual([]);
    expect(report.calendarKnown).toBe(false);
    expect(report.days.every((day) => day.status === 'unknown')).toBe(true);
  });
});

describe('money', () => {
  const payment = (
    seq: number,
    day: string,
    amountCents: number,
    reversesSeq: number | null = null,
  ): Payment => ({
    id: `pay-${seq}`,
    seq,
    day,
    personId: null,
    stageId: 'struct',
    commitmentId: null,
    amountCents,
    whatFor: `Payment ${seq}`,
    receiptHash: null,
    reversesSeq,
    authorName: 'Sample author',
    createdAt: `${day}T12:00:00.000Z`,
  });
  const plan: WorkSnapshot = {
    ...PLAN,
    costLines: [
      { id: 'c1', stageId: 'struct', activityId: null, label: 'Frame', amountCents: 500_00 },
    ],
    commitments: [
      {
        id: 'k1',
        stageId: 'struct',
        personId: 'p2',
        label: 'Mason',
        amountCents: 400_00,
        agreedOn: '2026-08-30',
        documentHash: null,
        milestones: [],
      },
    ],
    payments: [
      payment(1, '2026-09-04', 100_00),
      payment(2, '2026-09-08', 50_00),
      payment(3, '2026-09-09', -100_00, 1),
      payment(4, '2026-09-14', 70_00),
    ],
  };

  it('gives planned, committed and paid for the work, and what was paid in the week', () => {
    const report = made(plan, [], '2026-09-08', '2026-09-15');
    expect(report.money.planned.value).toBe(500_00);
    expect(report.money.committed.value).toBe(400_00);
    expect(report.money.paid.value).toBe(120_00);
    expect(report.money.paidThisWeek.label).toBe(WEEKLY_LABEL_KEYS.paidThisWeek);
    expect(report.money.paidThisWeek.rows.map((row) => row.sourceId)).toEqual(['2', '3']);
    expect(report.money.paidThisWeek.value).toBe(-50_00);
    expect(traceable(report.money.paidThisWeek)).toBe(true);
  });

  it('says which commitments are paid ahead of the work and what is earned and not paid (D2)', () => {
    const planned: WorkSnapshot = {
      ...plan,
      commitments: [
        {
          ...plan.commitments[0]!,
          // 25 % in advance; 75 % once the frame is finished.
          milestones: [
            {
              id: 'm1',
              position: 1,
              label: 'Advance',
              shareBp: 2_500,
              trigger: 'advance',
              activityId: null,
            },
            {
              id: 'm2',
              position: 2,
              label: 'Frame up',
              shareBp: 7_500,
              trigger: 'activity_finished',
              activityId: 'frame',
            },
          ],
        },
        {
          id: 'k2',
          stageId: 'finish',
          personId: 'p1',
          label: 'Tiler',
          amountCents: 200_00,
          agreedOn: '2026-08-30',
          documentHash: null,
          milestones: [
            {
              id: 'm3',
              position: 1,
              label: 'Advance',
              shareBp: 5_000,
              trigger: 'advance',
              activityId: null,
            },
          ],
        },
      ],
      payments: [{ ...payment(1, '2026-09-04', 250_00), commitmentId: 'k1' }],
    };
    // The mason's 100 earned, 250 paid: 150 ahead. The tiler's 100 earned, nothing paid: due.
    const before = made(planned, [], '2026-09-08', '2026-09-15');
    expect(before.money.paidAhead).toMatchObject({ unit: 'count', value: 1 });
    expect(before.money.paidAhead.rows[0]).toMatchObject({
      commitmentId: 'k1',
      amountCents: 150_00,
    });
    expect(before.money.dueNow).toMatchObject({ unit: 'money', value: 100_00 });
    // Once the diary finishes the frame, the mason's plan is earned: 150 due, none ahead.
    const done = [entry(1, '2026-09-14', { done: [finished('frame')] })];
    const after = made(planned, done, '2026-09-08', '2026-09-15');
    expect(after.money.paidAhead.value).toBe(0);
    expect(after.money.dueNow.value).toBe(250_00);
    expect(figuresOf(after).every((figure) => traceable(figure))).toBe(true);
  });
});

describe('stages', () => {
  it('are planned, ready, running, held and closed, as the work is today', () => {
    const plan: WorkSnapshot = {
      ...PLAN,
      stages: [
        {
          ...stage('struct', 1, 'Structure'),
          startedAt: '2026-09-01T08:00:00.000Z',
          closedAt: '2026-09-28T17:00:00.000Z',
        },
        { ...stage('finish', 2, 'Finishes'), startedAt: '2026-09-29T08:00:00.000Z' },
        stage('extra', 3, 'Extra'),
      ],
      checks: [
        {
          id: 'k',
          stageId: 'finish',
          gate: 'close',
          position: 1,
          name: 'Clean',
          needsPhoto: false,
        },
      ],
    };
    const report = made(plan, [], null, '2026-10-01');
    const ids = (figure: Figure<ReportRow>) => figure.rows.map((row) => row.itemId);
    expect(ids(report.stages.planned)).toEqual(['extra']);
    expect(ids(report.stages.ready)).toEqual([]);
    expect(ids(report.stages.started)).toEqual(['finish']);
    expect(ids(report.stages.held)).toEqual(['finish']);
    expect(ids(report.stages.closed)).toEqual(['struct']);
  });
});

describe('purchases', () => {
  it('says what to order this week and what is late, as of today, whatever week is asked', () => {
    // As things stand on Thursday 10 September the frame starts today, so the tiles start on
    // 8 October: thirty days from the supplier means ordering by 8 September — late.
    const plan: WorkSnapshot = {
      ...PLAN,
      purchases: [
        purchase('worktop', 1, 'finish', 30),
        purchase('handles', 2, 'finish', 3, { activityId: 'paint' }),
      ],
    };
    const today = '2026-09-10';
    const report = made(plan, [], '2026-09-01', today);
    expect(report.purchases).toEqual(purchaseFigures(plan, schedule(plan), [], today));
    expect(report.purchases.total).toBe(2);
    expect(report.purchases.lateToOrder.rows.map((row) => row.purchaseId)).toEqual(['worktop']);
    expect(report.purchases.lateToOrder.rows[0]).toMatchObject({
      neededOn: '2026-10-08',
      orderBy: '2026-09-08',
      daysLate: 2,
    });
    expect(report.purchases.toOrderThisWeek.rows.map((row) => row.purchaseId)).toEqual(['worktop']);
    expect(report.purchases.lateToArrive.value).toBe(0);
    for (const figure of figuresOf(report)) expect(traceable(figure)).toBe(true);
  });

  it('is nothing for a work with no purchase', () => {
    const report = made(PLAN, [], null, '2026-09-10');
    expect(report.purchases.total).toBe(0);
    expect(report.purchases.toOrderThisWeek.rows).toEqual([]);
  });
});
