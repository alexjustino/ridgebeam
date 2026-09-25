import { describe, expect, it } from 'vitest';

import { activity, decision, link, snapshot, stage } from './__fixtures__/plan';
import {
  byUrgency,
  deadlineOf,
  decisionRows,
  decisionsDue,
  overdueOnCreation,
  stageStart,
  type DecisionRow,
} from './decisions';
import { traceable } from './figure';
import { decisionsInOrder, decisionsOf, type WorkSnapshot } from './plan';
import { schedule } from './schedule';

/**
 * Tiling (3 d) Tue 1 – Thu 3 September 2026, then Painting (2 d) Fri 4 and Mon 7.
 *
 *   Tiling:   "Which tile"   — its stage starts Tue 1.
 *   Painting: "Which colour" — its stage starts Fri 4.
 */
const PLAN = snapshot({
  stages: [stage('painting', 2, 'Painting'), stage('tiling', 1, 'Tiling')],
  activities: [activity('tile', 'tiling', 1, 3), activity('paint', 'painting', 1, 2)],
  dependencies: [link('tp', 'tile', 'paint')],
  decisions: [
    { ...decision('colour', 'painting', 1, 1), name: 'Which colour' },
    { ...decision('tile-choice', 'tiling', 1, 2), name: 'Which tile' },
  ],
});

const rowsOf = (plan: WorkSnapshot, today: string) => decisionRows(plan, schedule(plan), today);
const rowOf = (plan: WorkSnapshot, today: string, id: string) =>
  rowsOf(plan, today).find((row) => row.decisionId === id)!;
const withLead = (plan: WorkSnapshot, id: string, leadTimeDays: number): WorkSnapshot => ({
  ...plan,
  decisions: plan.decisions.map((d) => (d.id === id ? { ...d, leadTimeDays } : d)),
});

describe('the order of decisions', () => {
  it('is stage by stage, by position inside each, those of a missing stage last', () => {
    const plan = snapshot({
      ...PLAN,
      decisions: [
        decision('orphan-b', 'gone', 2, 0),
        decision('orphan', 'gone', 1, 0),
        decision('p2', 'painting', 2, 0),
        decision('p1', 'painting', 1, 0),
        decision('t1', 'tiling', 1, 0),
      ],
    });
    expect(decisionsInOrder(plan).map((d) => d.id)).toEqual([
      't1',
      'p1',
      'p2',
      'orphan',
      'orphan-b',
    ]);
    expect(decisionsOf(plan, 'painting').map((d) => d.id)).toEqual(['p1', 'p2']);
    expect(decisionsOf(plan, 'nowhere')).toEqual([]);
  });

  it('breaks a tie in position by id, so the order never depends on the host', () => {
    const plan = snapshot({
      ...PLAN,
      decisions: [
        decision('zz', 'gone', 1, 0),
        decision('yy', 'gone', 1, 0),
        decision('b', 'tiling', 1, 0),
        decision('a', 'tiling', 1, 0),
      ],
    });
    expect(decisionsInOrder(plan).map((d) => d.id)).toEqual(['a', 'b', 'yy', 'zz']);
  });
});

describe('a decision’s deadline', () => {
  const scheduled = schedule(PLAN);

  it('is the stage’s first start when the lead time is 0', () => {
    expect(stageStart(scheduled, 'painting')).toBe('2026-09-04');
    expect(deadlineOf(scheduled, 'painting', 0)).toBe('2026-09-04');
  });

  it('is the first start less the lead time, counted back in working days', () => {
    expect(deadlineOf(scheduled, 'painting', 1)).toBe('2026-09-03');
    expect(deadlineOf(scheduled, 'painting', 3)).toBe('2026-09-01');
  });

  it('crosses a weekend and a holiday counting back', () => {
    // Tiling takes four days, Tue 1 – Fri 4; Monday 7 is a holiday, so Painting starts Tue 8.
    const plan = snapshot({
      ...PLAN,
      holidays: [{ date: '2026-09-07', name: 'A holiday' }],
      activities: [activity('tile', 'tiling', 1, 4), activity('paint', 'painting', 1, 2)],
    });
    const later = schedule(plan);
    expect(stageStart(later, 'painting')).toBe('2026-09-08');
    expect(deadlineOf(later, 'painting', 1)).toBe('2026-09-04');
    expect(deadlineOf(later, 'painting', 2)).toBe('2026-09-03');
  });

  it('moves with the schedule: a lag before the stage moves it by the same working days', () => {
    const lagged = { ...PLAN, dependencies: [link('tp', 'tile', 'paint', 2)] };
    const before = rowOf(PLAN, '2026-08-31', 'colour');
    const after = rowOf(lagged, '2026-08-31', 'colour');
    expect(before.deadline).toBe('2026-09-03');
    // Painting now starts Tue 8 instead of Fri 4: two working days later, and so does the deadline.
    expect(after.deadline).toBe('2026-09-07');
  });

  it('is not known for a stage with nothing scheduled', () => {
    const empty = snapshot({ ...PLAN, stages: [...PLAN.stages, stage('garden', 3)] });
    expect(stageStart(schedule(empty), 'garden')).toBeNull();
    expect(deadlineOf(schedule(empty), 'garden', 0)).toBeNull();
  });

  it('is not known for a stage whose activities have no duration', () => {
    const plan = snapshot({ ...PLAN, activities: [activity('tile', 'tiling', 1, null)] });
    expect(deadlineOf(schedule(plan), 'tiling', 0)).toBeNull();
  });

  it('is not known when the schedule holds a cycle', () => {
    const looped = {
      ...PLAN,
      dependencies: [link('tp', 'tile', 'paint'), link('pt', 'paint', 'tile')],
    };
    expect(deadlineOf(schedule(looped), 'tiling', 0)).toBeNull();
  });

  it.each([[-1], [1.5], [Number.NaN]])('is not known for a lead time of %o', (lead) => {
    expect(deadlineOf(scheduled, 'painting', lead)).toBeNull();
  });
});

describe('a decision’s status, against today', () => {
  it('is due, with the working days left, when the deadline is today or later', () => {
    expect(rowOf(PLAN, '2026-09-01', 'colour')).toMatchObject({
      deadline: '2026-09-03',
      status: 'due',
      daysLeft: 2,
    });
    expect(rowOf(PLAN, '2026-09-03', 'colour')).toMatchObject({ status: 'due', daysLeft: 0 });
  });

  it('is overdue, by at least one working day, once the deadline has passed', () => {
    expect(rowOf(PLAN, '2026-09-04', 'colour')).toMatchObject({ status: 'overdue', daysLeft: -1 });
    expect(rowOf(PLAN, '2026-09-08', 'colour')).toMatchObject({ status: 'overdue', daysLeft: -3 });
  });

  it('is at least one working day late the day after a Friday deadline, a Saturday', () => {
    // Deadline Fri 4 (lead 0: Painting's start). No working day lies between Friday and Saturday,
    // yet a decision made on Saturday reaches the site on Monday, a working day late.
    const plan = withLead(PLAN, 'colour', 0);
    expect(rowOf(plan, '2026-09-05', 'colour')).toMatchObject({
      deadline: '2026-09-04',
      status: 'overdue',
      daysLeft: -1,
    });
  });

  it('counts from a today on a weekend', () => {
    // Saturday 5: a Thursday deadline is past; Painting's first start on Friday 4 is past too.
    expect(rowOf(PLAN, '2026-09-05', 'colour')).toMatchObject({ status: 'overdue', daysLeft: -1 });
    const plan = withLead(
      snapshot({ ...PLAN, dependencies: [link('tp', 'tile', 'paint', 3)] }),
      'colour',
      0,
    );
    // Painting now starts Wed 9: from Saturday that is Mon, Tue, Wed — three working days.
    expect(rowOf(plan, '2026-09-05', 'colour')).toMatchObject({
      deadline: '2026-09-09',
      status: 'due',
      daysLeft: 3,
    });
  });

  it('is overdue from the start when the lead time is longer than the time left', () => {
    // Ten working days of lead before a stage that starts on day 1.
    const plan = withLead(PLAN, 'tile-choice', 10);
    const row = rowOf(plan, '2026-09-01', 'tile-choice');
    expect(row.status).toBe('overdue');
    expect(row.deadline).toBe('2026-08-18');
    expect(row.daysLeft).toBeLessThan(0);
  });

  it('is made, whatever its deadline, once it is made', () => {
    const plan = {
      ...PLAN,
      decisions: PLAN.decisions.map((d) =>
        d.id === 'colour' ? { ...d, madeAt: '2026-08-20T10:00:00.000Z', answer: 'Grey' } : d,
      ),
    };
    expect(rowOf(plan, '2026-12-01', 'colour')).toMatchObject({
      status: 'made',
      daysLeft: null,
      deadline: '2026-09-03',
      answer: 'Grey',
    });
  });

  it('is unknown with no deadline, and never overdue', () => {
    const plan = snapshot({ ...PLAN, activities: [activity('tile', 'tiling', 1, null)] });
    expect(rowOf(plan, '2027-01-01', 'tile-choice')).toMatchObject({
      status: 'unknown',
      deadline: null,
      daysLeft: null,
    });
  });

  it('is unknown against a today that is not a day, rather than a guess', () => {
    expect(rowOf(PLAN, 'yesterday', 'colour')).toMatchObject({ status: 'unknown', daysLeft: null });
  });

  it('lists a decision whose stage is not in the plan, as unknown, never dropping it', () => {
    const plan = snapshot({
      ...PLAN,
      decisions: [...PLAN.decisions, decision('orphan', 'gone', 1, 0)],
    });
    expect(rowsOf(plan, '2026-09-01').at(-1)).toMatchObject({
      decisionId: 'orphan',
      stageName: null,
      deadline: null,
      status: 'unknown',
    });
  });

  it('carries the stage, the name and the lead time, in plan order', () => {
    expect(
      rowsOf(PLAN, '2026-09-01').map((row) => [
        row.decisionId,
        row.stageName,
        row.name,
        row.leadTimeDays,
      ]),
    ).toEqual([
      ['tile-choice', 'Tiling', 'Which tile', 2],
      ['colour', 'Painting', 'Which colour', 1],
    ]);
  });
});

describe('overdue on creation', () => {
  const scheduled = schedule(PLAN);

  it('says the deadline and how many working days the stage leaves, when the lead is too long', () => {
    // Painting starts Fri 4, three working days after Tue 1; ten days of lead cannot fit.
    expect(overdueOnCreation(PLAN, scheduled, '2026-09-01', 'painting', 10)).toEqual({
      deadline: '2026-08-21',
      left: 3,
    });
  });

  it('is nothing when the decision is in time, or its deadline is not yet known', () => {
    expect(overdueOnCreation(PLAN, scheduled, '2026-09-01', 'painting', 3)).toBeNull();
    expect(overdueOnCreation(PLAN, scheduled, '2026-09-01', 'painting', 1)).toBeNull();
    const empty = snapshot({ ...PLAN, stages: [...PLAN.stages, stage('garden', 3)] });
    expect(overdueOnCreation(empty, schedule(empty), '2026-09-01', 'garden', 10)).toBeNull();
  });

  it('is nothing for a stage that is not in the plan, or a today that is not a day', () => {
    expect(overdueOnCreation(PLAN, scheduled, '2026-09-01', 'gone', 10)).toBeNull();
    expect(overdueOnCreation(PLAN, scheduled, 'today', 'painting', 10)).toBeNull();
  });

  it('says the stage has already started with a negative count', () => {
    expect(overdueOnCreation(PLAN, scheduled, '2026-09-08', 'painting', 0)).toEqual({
      deadline: '2026-09-04',
      left: -2,
    });
  });
});

describe('the owner’s order', () => {
  const row = (
    id: string,
    status: DecisionRow['status'],
    deadline: string | null,
  ): DecisionRow => ({
    decisionId: id,
    stageId: 's',
    stageName: 'S',
    name: id,
    leadTimeDays: 0,
    deadline,
    status,
    daysLeft: null,
    madeAt: status === 'made' ? '2026-08-01T00:00:00.000Z' : null,
    answer: null,
  });

  it('takes the earlier deadline first, whichever order the rows came in', () => {
    const rows = [
      row('c', 'due', '2026-09-30'),
      row('b', 'due', '2026-09-20'),
      row('a', 'due', '2026-09-10'),
      row('same', 'due', '2026-09-10'),
    ];
    expect(byUrgency(rows).map((r) => r.decisionId)).toEqual(['a', 'same', 'b', 'c']);
    expect(byUrgency([...rows].reverse()).map((r) => r.decisionId)).toEqual([
      'same',
      'a',
      'b',
      'c',
    ]);
  });

  it('is overdue, then due, then unknown, then made; by deadline inside each; then plan order', () => {
    const rows = [
      row('made', 'made', '2026-09-01'),
      row('unknown-a', 'unknown', null),
      row('due-late', 'due', '2026-09-20'),
      row('overdue', 'overdue', '2026-08-30'),
      row('due-soon', 'due', '2026-09-10'),
      row('unknown-b', 'unknown', null),
    ];
    expect(byUrgency(rows).map((r) => r.decisionId)).toEqual([
      'overdue',
      'due-soon',
      'due-late',
      'unknown-a',
      'unknown-b',
      'made',
    ]);
  });
});

describe('decisions due', () => {
  /** The work starts Mon 14 September; four decisions on Painting and one on a stage that is gone. */
  const plan = snapshot({
    ...PLAN,
    work: { ...PLAN.work, startDate: '2026-09-14' },
    decisions: [
      decision('far', 'painting', 1, 0), // deadline = the start
      decision('near', 'painting', 2, 3),
      decision('late', 'painting', 3, 12),
      { ...decision('made', 'painting', 4, 12), madeAt: '2026-08-01T00:00:00.000Z' },
      decision('nowhere', 'garden', 1, 0),
    ],
  });
  const scheduled = schedule(plan);
  const today = '2026-09-10';

  it('counts the overdue and those due within five working days, most urgent first', () => {
    // Tiling Mon 14 – Wed 16, Painting from Thu 17. far: Thu 17, 5 left. near: Mon 14, 2 left.
    // late: twelve before Thu 17 is Tue 1, overdue. made and nowhere are not counted.
    const figure = decisionsDue(decisionRows(plan, scheduled, today), scheduled.calendar!, today);
    expect(
      figure.rows.map((row) => [row.decisionId, row.status, row.deadline, row.daysLeft]),
    ).toEqual([
      ['late', 'overdue', '2026-09-01', -7],
      ['near', 'due', '2026-09-14', 2],
      ['far', 'due', '2026-09-17', 5],
    ]);
    expect(figure).toMatchObject({ id: 'decisions-due', unit: 'count', value: 3 });
    expect(figure.rows[0]).toMatchObject({
      key: 'decision:late',
      itemId: 'late',
      day: '2026-09-01',
    });
    expect(traceable(figure)).toBe(true);
  });

  it('leaves out what is due after the horizon', () => {
    const figure = decisionsDue(
      decisionRows(plan, scheduled, today),
      scheduled.calendar!,
      today,
      4,
    );
    expect(figure.rows.map((row) => row.decisionId)).toEqual(['late', 'near']);
  });

  it('counts again from the deadlines against the today it is given', () => {
    const yesterday = decisionRows(plan, scheduled, '2026-09-09');
    const figure = decisionsDue(yesterday, scheduled.calendar!, '2026-09-15');
    expect(figure.rows.map((row) => [row.decisionId, row.status, row.daysLeft])).toEqual([
      ['late', 'overdue', -10],
      ['near', 'overdue', -1],
      ['far', 'due', 2],
    ]);
  });

  it('is 0 with no rows when nothing is due', () => {
    const figure = decisionsDue([], scheduled.calendar!, today);
    expect(figure.value).toBe(0);
    expect(traceable(figure)).toBe(true);
  });
});
