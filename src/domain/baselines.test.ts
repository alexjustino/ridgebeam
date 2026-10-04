import { describe, expect, it } from 'vitest';

import {
  COMPARISON_LABEL_KEYS,
  COMPARISON_PROBLEM_KEYS,
  changesBetween,
  compareBaselines,
  comparisonFigures,
  defaultPair,
  explainedByChanges,
  orderPair,
  sameBaseline,
  type Comparison,
  type ComparisonResult,
} from './baselines';
import { traceable } from './figure';
import {
  activity,
  changeDecision,
  changeOrder,
  link,
  snapshot,
  stage,
  takeBaseline,
} from './__fixtures__/plan';
import { workingCalendarOf, type Baseline, type WorkSnapshot } from './plan';

/**
 * Baseline 1: stage 1 holds A (3 d) ──+1──▶ B (2 d); stage 2 holds C (1 d) after B and D (1 d) after
 * A; stage 3 holds X (1 d). From Tuesday 1 September 2026: A Tue 1–Thu 3, B Mon 7–Tue 8, C Wed 9,
 * D Fri 4, X Tue 1. Finish Wed 9. Money: 1 000,00 on stage 1, 500,00 on C.
 */
const PLAN_1 = snapshot({
  stages: [stage('s1', 1), stage('s2', 2), stage('s3', 3)],
  activities: [
    activity('a', 's1', 1, 3),
    activity('b', 's1', 2, 2),
    activity('c', 's2', 1, 1),
    activity('d', 's2', 2, 1),
    activity('x', 's3', 1, 1),
  ],
  dependencies: [link('ab', 'a', 'b', 1), link('bc', 'b', 'c'), link('ad', 'a', 'd')],
  costLines: [
    { id: 'l1', stageId: 's1', activityId: null, label: 'Sample', amountCents: 1000_00 },
    { id: 'l2', stageId: 's2', activityId: 'c', label: 'Sample', amountCents: 500_00 },
  ],
});

/**
 * Baseline 2, replanned: B renamed and 4 days (Mon 7–Thu 10), so C moves to Fri 11; D removed; stage
 * 3 and X removed; stage 2 renamed; stage 4 added with E (2 d, Tue 1–Wed 2). Money: 1 200,00 on
 * stage 1. Finish Fri 11: two working days later.
 */
const PLAN_2: WorkSnapshot = {
  ...PLAN_1,
  stages: [stage('s1', 1), stage('s2', 2, 'Stage two, renamed'), stage('s4', 4)],
  activities: [
    activity('a', 's1', 1, 3),
    { ...activity('b', 's1', 2, 4), name: 'Tiling' },
    activity('c', 's2', 1, 1),
    activity('e', 's4', 1, 2),
  ],
  dependencies: [link('ab', 'a', 'b', 1), link('bc', 'b', 'c')],
  costLines: [
    { id: 'l1', stageId: 's1', activityId: null, label: 'Sample', amountCents: 1200_00 },
    { id: 'l2', stageId: 's2', activityId: 'c', label: 'Sample', amountCents: 500_00 },
  ],
};

const CALENDAR = workingCalendarOf(PLAN_1);
const B1 = takeBaseline(PLAN_1, 1);
const B2 = takeBaseline(PLAN_2, 2, { reason: 'Tiles arrive two weeks late' });

function compared(result: ComparisonResult): Comparison {
  if (!result.ok) throw new Error(`refused: ${result.problem.code}`);
  return result.comparison;
}

describe('two baselines compared', () => {
  const comparison = compared(compareBaselines([B1, B2], 1, 2, CALENDAR));

  it('says how far the finish moved, in working days', () => {
    expect(comparison.finishMoved).toEqual({ from: '2026-09-09', to: '2026-09-11', days: 2 });
  });

  it('lists every date that moved, by finish, renamed activities as the same activity', () => {
    expect(
      comparison.datesMoved.rows.map((row) => [row.activityId, row.from, row.to, row.days]),
    ).toEqual([
      ['b', '2026-09-08', '2026-09-10', 2],
      ['c', '2026-09-09', '2026-09-11', 2],
    ]);
    const b = comparison.datesMoved.rows[0]!;
    expect(b).toMatchObject({ name: 'Tiling', nameThen: 'Activity b', change: 'moved' });
    expect(comparison.datesMoved).toMatchObject({
      unit: 'count',
      value: 2,
      label: COMPARISON_LABEL_KEYS.datesMoved,
    });
  });

  it('lists the durations that changed', () => {
    expect(comparison.durationsChanged.rows).toEqual([
      expect.objectContaining({ activityId: 'b', from: 2, to: 4, delta: 2, day: null }),
    ]);
  });

  it('lists the activities added and removed, never a renamed one', () => {
    expect(comparison.activitiesAdded.rows.map((row) => row.activityId)).toEqual(['e']);
    expect(comparison.activitiesRemoved.rows.map((row) => row.activityId)).toEqual(['d', 'x']);
    expect(comparison.activitiesAdded.rows[0]).toMatchObject({
      key: 'activity:e',
      finish: '2026-09-02',
      plannedCents: 0,
    });
  });

  it('lists the stages added and removed by id: a renamed stage is the same stage', () => {
    expect(comparison.stagesAdded.rows.map((row) => row.stageId)).toEqual(['s4']);
    expect(comparison.stagesRemoved.rows.map((row) => row.stageId)).toEqual(['s3']);
    expect(comparison.stagesRemoved.rows[0]).toMatchObject({
      key: 'stage:s3',
      name: 'Stage s3',
      position: 3,
      plannedCents: 0,
    });
  });

  it('says how the money planned changed', () => {
    expect(comparison.money).toEqual({ from: 1500_00, to: 1700_00, delta: 200_00 });
  });

  it('gives the reasons of the baselines after the earlier one', () => {
    expect(comparison.reasons).toEqual(['Tiles arrive two weeks late']);
    expect(comparison.unexplained).toEqual([]);
  });

  it('is counted figures whose rows are the figure', () => {
    for (const figure of comparisonFigures(comparison)) expect(traceable(figure)).toBe(true);
    expect(comparisonFigures(comparison).map((figure) => [figure.label, figure.value])).toEqual([
      [COMPARISON_LABEL_KEYS.datesMoved, 2],
      [COMPARISON_LABEL_KEYS.durationsChanged, 1],
      [COMPARISON_LABEL_KEYS.activitiesAdded, 1],
      [COMPARISON_LABEL_KEYS.activitiesRemoved, 2],
      [COMPARISON_LABEL_KEYS.stagesAdded, 1],
      [COMPARISON_LABEL_KEYS.stagesRemoved, 1],
    ]);
  });
});

describe('the pair', () => {
  it('is put in order of number whatever order it was chosen in, and says it was turned', () => {
    const forward = compared(compareBaselines([B1, B2], 1, 2, CALENDAR));
    const backward = compared(compareBaselines([B2, B1], 2, 1, CALENDAR));
    expect(forward.swapped).toBe(false);
    expect(backward.swapped).toBe(true);
    expect({ ...backward, swapped: false }).toEqual(forward);
    expect(backward.earlier.number).toBe(1);
  });

  it('orders anything with a number, an equal pair as given', () => {
    const one = { number: 1 };
    const two = { number: 2 };
    expect(orderPair(two, one)).toEqual({ earlier: one, later: two, swapped: true });
    expect(orderPair(one, two)).toEqual({ earlier: one, later: two, swapped: false });
    const other = { number: 1 };
    expect(orderPair(one, other).earlier).toBe(one);
  });

  it('defaults to the last two, earlier first, and to none with fewer than two', () => {
    expect(defaultPair([])).toBeNull();
    expect(defaultPair([B1])).toBeNull();
    const b3 = { ...B2, id: 'b3', number: 3 };
    expect(defaultPair([b3, B1, B2])).toEqual({ a: 2, b: 3 });
  });
});

describe('a comparison refused', () => {
  it('compares nothing with itself: the same baseline twice is refused, not an empty answer', () => {
    expect(sameBaseline(2, 2)).toBe(true);
    expect(sameBaseline(1, 2)).toBe(false);
    expect(compareBaselines([B1, B2], 2, 2, CALENDAR)).toEqual({
      ok: false,
      problem: {
        code: 'same-baseline',
        messageKey: COMPARISON_PROBLEM_KEYS['same-baseline'],
        number: 2,
      },
    });
  });

  it('refuses a number the work does not hold, on either side', () => {
    for (const [a, b] of [
      [1, 7],
      [7, 1],
    ] as const) {
      expect(compareBaselines([B1, B2], a, b, CALENDAR)).toEqual({
        ok: false,
        problem: {
          code: 'unknown-baseline',
          messageKey: COMPARISON_PROBLEM_KEYS['unknown-baseline'],
          number: 7,
        },
      });
    }
  });
});

describe('money', () => {
  it('not recorded on either side is said, never counted as 0', () => {
    const old = { ...B1, plannedCents: null };
    expect(compared(compareBaselines([old, B2], 1, 2, CALENDAR)).money).toBe('not recorded');
    const later = { ...B2, plannedCents: null };
    expect(compared(compareBaselines([B1, later], 1, 2, CALENDAR)).money).toBe('not recorded');
  });

  it('that did not change is a delta of 0', () => {
    const same = { ...B2, plannedCents: B1.plannedCents };
    expect(compared(compareBaselines([B1, same], 1, 2, CALENDAR)).money).toEqual({
      from: 1500_00,
      to: 1500_00,
      delta: 0,
    });
  });
});

describe('reasons between two baselines', () => {
  const b3 = takeBaseline(PLAN_2, 3, { reason: 'Owner changed the tile' });
  const b4 = takeBaseline(PLAN_2, 4, { reason: '   ' });
  const b5 = takeBaseline(PLAN_2, 5, { reason: 'Reverted' });

  it('are every reason after the earlier one up to the later one, in number order', () => {
    const comparison = compared(compareBaselines([b3, B1, B2], 1, 3, CALENDAR));
    expect(comparison.reasons).toEqual(['Tiles arrive two weeks late', 'Owner changed the tile']);
    expect(compared(compareBaselines([b3, B1, B2], 3, 2, CALENDAR)).reasons).toEqual([
      'Owner changed the tile',
    ]);
  });

  it('say which baselines gave none, or are missing from the list, instead of dropping them', () => {
    const none = { ...B2, reason: null };
    const comparison = compared(compareBaselines([B1, none, b4, b5], 1, 5, CALENDAR));
    expect(comparison.reasons).toEqual(['Reverted']);
    expect(comparison.unexplained).toEqual([2, 3, 4]);
  });
});

describe('what the rows say when a side is missing', () => {
  const unplacedB: Baseline = {
    ...B2,
    finishDate: '2026-09-11',
    rows: B2.rows.map((row) =>
      row.activityId === 'b' ? { ...row, durationDays: null, start: null, finish: null } : row,
    ),
  };

  it('an activity that lost its duration is unplaced, its days not counted', () => {
    const comparison = compared(compareBaselines([B1, unplacedB], 1, 2, CALENDAR));
    expect(comparison.datesMoved.rows[0]).toMatchObject({
      activityId: 'b',
      change: 'unplaced',
      from: '2026-09-08',
      to: null,
      days: null,
      day: '2026-09-08',
    });
    expect(comparison.durationsChanged.rows[0]).toMatchObject({ from: 2, to: null, delta: null });
  });

  it('one that gained a duration is placed', () => {
    const comparison = compared(
      compareBaselines([{ ...unplacedB, number: 1 }, B2], 1, 2, CALENDAR),
    );
    expect(comparison.datesMoved.rows[0]).toMatchObject({
      activityId: 'b',
      change: 'placed',
      from: null,
      to: '2026-09-10',
      days: null,
    });
  });

  it('with no calendar to count on, days are null, never guessed', () => {
    const comparison = compared(compareBaselines([B1, B2], 1, 2, null));
    expect(comparison.finishMoved).toEqual({ from: '2026-09-09', to: '2026-09-11', days: null });
    expect(comparison.datesMoved.rows.every((row) => row.days === null)).toBe(true);
  });

  it('a date that is not a day is not counted', () => {
    const broken = { ...B2, finishDate: 'not a day' };
    expect(compared(compareBaselines([B1, broken], 1, 2, CALENDAR)).finishMoved).toEqual({
      from: '2026-09-09',
      to: 'not a day',
      days: null,
    });
  });

  it('a finish that did not move is no move at all', () => {
    const same = takeBaseline(PLAN_1, 2);
    const comparison = compared(compareBaselines([B1, same], 1, 2, CALENDAR));
    expect(comparison.finishMoved).toBeNull();
    expect(comparisonFigures(comparison)).toEqual([]);
    expect(comparison.money).toEqual({ from: 1500_00, to: 1500_00, delta: 0 });
  });
});

describe('a baseline that lists something twice', () => {
  it('counts it once, the first row kept, so every row key is unique', () => {
    const doubled: Baseline = {
      ...B2,
      rows: [...B2.rows, { ...B2.rows[0]!, finish: '2027-01-01' }],
      stages: [...B2.stages, { ...B2.stages[0]!, name: 'Duplicate' }],
    };
    const comparison = compared(compareBaselines([B1, doubled], 1, 2, CALENDAR));
    for (const figure of comparisonFigures(comparison)) expect(traceable(figure)).toBe(true);
    expect(comparison.datesMoved.rows.map((row) => row.activityId)).toEqual(['b', 'c']);
  });

  it('orders stages by position, then by id', () => {
    const tied: Baseline = {
      ...B2,
      stages: [
        { stageId: 'z', position: 9, name: 'Z', plannedCents: null },
        { stageId: 'y', position: 9, name: 'Y', plannedCents: null },
        ...B2.stages,
      ],
    };
    const comparison = compared(compareBaselines([B1, tied], 1, 2, CALENDAR));
    expect(comparison.stagesAdded.rows.map((row) => row.stageId)).toEqual(['s4', 'y', 'z']);
  });
});

describe('the change orders approved between two baselines (E1)', () => {
  const first = { ...B1, takenAt: '2026-09-01T12:00:00.000Z' };
  const second = { ...B2, takenAt: '2026-09-10T12:00:00.000Z' };
  const approved = (id: string, number: number, createdAt: string, parts = {}) =>
    changeOrder(id, number, 's1', '2026-09-01', {
      decision: {
        ...changeDecision('approved', createdAt.slice(0, 10), parts),
        createdAt,
      },
    });
  const changes = [
    approved('before', 1, '2026-09-01T12:00:00.000Z'),
    approved('co3', 3, '2026-09-10T12:00:00.000Z', { daysDelta: 1, costCents: null }),
    approved('co2', 2, '2026-09-04T08:00:00.000Z', { daysDelta: 2, costCents: 300_00 }),
    approved('after', 4, '2026-09-10T12:00:00.001Z'),
    changeOrder('declined', 5, 's1', '2026-09-02', {
      decision: changeDecision('declined', '2026-09-03', { costCents: 900_00 }),
    }),
    changeOrder('waiting', 6, 's1', '2026-09-02'),
  ];
  const comparison = compared(compareBaselines([first, second], 1, 2, CALENDAR, changes));

  it('lists the approvals recorded after the earlier was taken, up to the later, by number', () => {
    expect(comparison.changes).toMatchObject({
      unit: 'count',
      value: 2,
      label: COMPARISON_LABEL_KEYS.changes,
    });
    expect(
      comparison.changes.rows.map((row) => [row.changeOrderId, row.number, row.daysDelta]),
    ).toEqual([
      ['co2', 2, 2],
      ['co3', 3, 1],
    ]);
    expect(traceable(comparison.changes)).toBe(true);
  });

  it('is the same pair whichever way round it was chosen', () => {
    const swapped = compared(compareBaselines([first, second], 2, 1, CALENDAR, changes));
    expect(swapped.changes.rows).toEqual(comparison.changes.rows);
  });

  it('says what of the move the changes explain', () => {
    expect(explainedByChanges(comparison)).toEqual({
      costCents: 300_00,
      days: 3,
      unpriced: 1,
      uncounted: 0,
    });
  });

  it('puts them in the summary line, last, when there are any', () => {
    expect(comparisonFigures(comparison).at(-1)).toBe(comparison.changes);
    const none = compared(compareBaselines([first, second], 1, 2, CALENDAR));
    expect(none.changes.rows).toEqual([]);
    expect(comparisonFigures(none)).not.toContain(none.changes);
    expect(changesBetween(changes, second, first)).toEqual([]);
  });
});
