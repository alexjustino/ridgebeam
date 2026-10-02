import { describe, expect, it } from 'vitest';

import {
  CHANGE_LABEL_KEYS,
  CHANGE_LIMITS,
  CHANGE_PROBLEM_KEYS,
  CHANGE_WAITING_LIMIT_DAYS,
  changeImpact,
  changeOrderRows,
  changeState,
  changeTally,
  effectActivityId,
  effectDependencyId,
  validateEffects,
  waitsTooLong,
  withEffects,
  type ChangeDraft,
  type ChangeImpact,
  type ChangeImpactResult,
  type ChangeTally,
  type WithEffectsResult,
} from './changes';
import { traceable, type Figure, type ReportRow } from './figure';
import {
  activity,
  changeDecision,
  changeOrder,
  link,
  onStage,
  person,
  snapshot,
  stage,
} from './__fixtures__/plan';
import type { ChangeEffect, WorkSnapshot } from './plan';
import { schedule } from './schedule';

/** Freeze a value and everything in it, so any write to it throws. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/**
 * Stage 1: A (3 d) ──+1──▶ B (2 d); stage 2: C (1 d) after B, D (1 d) after A. From Tuesday
 * 1 September 2026: A Tue 1–Thu 3, B Mon 7–Tue 8, C Wed 9, D Fri 4. Finish Wed 9; A, B and C are
 * critical, D is not. Stage 3 is closed and holds X (1 d, Tue 1). Frozen: a change that wrote to it
 * would throw.
 */
const PLAN: WorkSnapshot = deepFreeze(
  snapshot({
    stages: [
      stage('s1', 1),
      stage('s2', 2),
      {
        ...stage('s3', 3),
        startedAt: '2026-08-01T00:00:00.000Z',
        closedAt: '2026-08-02T00:00:00.000Z',
      },
    ],
    activities: [
      activity('a', 's1', 1, 3),
      activity('b', 's1', 2, 2),
      activity('c', 's2', 1, 1),
      activity('d', 's2', 2, 1),
      activity('x', 's3', 1, 1),
    ],
    dependencies: [link('ab', 'a', 'b', 1), link('bc', 'b', 'c'), link('ad', 'a', 'd')],
    people: [person('p1', 'Sample electrician')],
  }),
);
const BEFORE = structuredClone(PLAN);

const add = (name: string, durationDays: number, after: string | null): ChangeEffect => ({
  kind: 'add',
  name,
  durationDays,
  after,
});
const duration = (activityId: string, durationDays: number): ChangeEffect => ({
  kind: 'duration',
  activityId,
  durationDays,
});
const remove = (activityId: string): ChangeEffect => ({ kind: 'remove', activityId });

function applied(result: WithEffectsResult): WorkSnapshot {
  if (!result.ok) throw new Error(`refused: ${result.problems.map((p) => p.code).join(', ')}`);
  return result.snapshot;
}

function impactOf(result: ChangeImpactResult): ChangeImpact {
  if (!result.ok) throw new Error(`refused: ${result.problems.map((p) => p.code).join(', ')}`);
  return result.impact;
}

/** A tally's three figures, as one list. */
const figuresOf = (tally: ChangeTally): Array<Figure<ReportRow>> => [
  tally.figures.cost,
  tally.figures.days,
  tally.figures.waiting,
];

const draft = (
  effects: ChangeEffect[],
  stageId = 's2',
  costCents: number | null = null,
): ChangeDraft => ({ stageId, effects, costCents });

describe('the plan with a change', () => {
  it('adds an activity last in the change’s stage, finish-to-start after `after`, in memory only', () => {
    const plan = applied(withEffects(PLAN, 's2', [add('Extra socket', 2, 'c')]));
    const added = plan.activities.find((each) => each.id === effectActivityId(0))!;
    expect(added).toMatchObject({
      stageId: 's2',
      position: 3,
      name: 'Extra socket',
      durationDays: 2,
      responsibleId: null,
    });
    expect(plan.dependencies).toContainEqual(link(effectDependencyId(0), 'c', effectActivityId(0)));
    expect(PLAN).toEqual(BEFORE);
  });

  it('adds an activity with no `after` with no link: it starts on day 0', () => {
    const plan = applied(withEffects(PLAN, 's1', [add('Survey', 1, null)]));
    expect(plan.dependencies).toHaveLength(PLAN.dependencies.length);
    expect(schedule(plan).dates.get(effectActivityId(0))).toEqual({
      start: '2026-09-01',
      finish: '2026-09-01',
    });
  });

  it('changes a duration, and leaves everything else as it was', () => {
    const plan = applied(withEffects(PLAN, 's1', [duration('b', 1)]));
    expect(plan.activities.find((each) => each.id === 'b')!.durationDays).toBe(1);
    expect(plan.activities.filter((each) => each.id !== 'b')).toEqual(
      PLAN.activities.filter((each) => each.id !== 'b'),
    );
    expect(plan.dependencies).toEqual(PLAN.dependencies);
  });

  it('removes an activity and every dependency that names it, and keeps a stage’s', () => {
    const plan = applied(
      withEffects(
        { ...PLAN, dependencies: [...PLAN.dependencies, link('s1d', onStage('s1'), 'd')] },
        's1',
        [remove('b')],
      ),
    );
    expect(plan.activities.map((each) => each.id)).toEqual(['a', 'c', 'd', 'x']);
    expect(plan.dependencies.map((each) => each.id)).toEqual(['ad', 's1d']);
  });

  it('gives an equal, new snapshot for a change with no effects', () => {
    const plan = applied(withEffects(PLAN, 's1', []));
    expect(plan).toEqual(PLAN);
    expect(plan).not.toBe(PLAN);
  });

  it('allows an `after` in another stage: dependencies already cross stages', () => {
    expect(withEffects(PLAN, 's1', [add('Touch-up', 1, 'c')]).ok).toBe(true);
  });

  it('gives each add its own activity and link, by effect index', () => {
    const plan = applied(
      withEffects(PLAN, 's2', [add('One', 1, 'c'), duration('a', 2), add('Two', 1, 'd')]),
    );
    expect(plan.activities.slice(-2).map((each) => [each.id, each.position])).toEqual([
      [effectActivityId(0), 3],
      [effectActivityId(2), 4],
    ]);
    expect(plan.dependencies.slice(-2).map((each) => each.id)).toEqual([
      effectDependencyId(0),
      effectDependencyId(2),
    ]);
  });
});

describe('a change refused', () => {
  const codes = (stageId: string, effects: ChangeEffect[]) =>
    validateEffects(PLAN, stageId, effects).map((each) => [each.code, each.messageKey]);

  it('refuses a stage the plan does not have', () => {
    expect(codes('nowhere', [])).toEqual([['unknown-stage', CHANGE_PROBLEM_KEYS['unknown-stage']]]);
  });

  it('refuses an add into a closed stage, and a duration or removal of its activities', () => {
    expect(validateEffects(PLAN, 's3', [add('Late', 1, null)])).toEqual([
      {
        code: 'closed-stage',
        effectIndex: 0,
        stageId: 's3',
        activityId: null,
        messageKey: 'changes.problem.closedStage',
      },
    ]);
    expect(codes('s1', [duration('x', 2), remove('x')]).map(([code]) => code)).toEqual([
      'closed-stage',
      'duplicate',
      'closed-stage',
    ]);
  });

  it('allows an `after` in a closed stage: depending on finished work is fine', () => {
    expect(validateEffects(PLAN, 's1', [add('After X', 1, 'x')])).toEqual([]);
  });

  it('refuses an activity the plan does not have, as a target or as an `after`', () => {
    expect(
      validateEffects(PLAN, 's1', [
        duration('ghost', 2),
        remove('ghost2'),
        add('N', 1, 'ghost3'),
      ]).map((each) => [each.code, 'activityId' in each ? each.activityId : null]),
    ).toEqual([
      ['unknown-activity', 'ghost'],
      ['unknown-activity', 'ghost2'],
      ['unknown-activity', 'ghost3'],
    ]);
  });

  it.each([0, -1, 1.5, CHANGE_LIMITS.durationDays + 1, Number.NaN])(
    'refuses a duration of %s',
    (days) => {
      expect(codes('s1', [duration('a', days)])).toEqual([
        ['invalid-duration', 'changes.problem.invalidDuration'],
      ]);
      expect(codes('s1', [add('N', days, null)])).toEqual([
        ['invalid-duration', 'changes.problem.invalidDuration'],
      ]);
    },
  );

  it('accepts the limits themselves: 1 and 3 650 working days', () => {
    expect(validateEffects(PLAN, 's1', [duration('a', 1), add('N', 3650, null)])).toEqual([]);
  });

  it("refuses a blank name and one over 120 characters (an activity's limit), counted as the host counts them", () => {
    expect(codes('s1', [add('   ', 1, null)])).toEqual([
      ['invalid-name', 'changes.problem.invalidName'],
    ]);
    expect(codes('s1', [add('x'.repeat(121), 1, null)])).toEqual([
      ['invalid-name', 'changes.problem.invalidName'],
    ]);
    // 120 emoji are 240 UTF-16 units and 120 characters: allowed.
    expect(codes('s1', [add('🧱'.repeat(120), 1, null)])).toEqual([]);
  });

  it('refuses more than 50 effects', () => {
    const many = Array.from({ length: 51 }, (_, i) => add(`N${i}`, 1, null));
    expect(validateEffects(PLAN, 's1', many)).toEqual([
      { code: 'too-many', count: 51, limit: 50, messageKey: 'changes.problem.tooMany' },
    ]);
    expect(validateEffects(PLAN, 's1', many.slice(0, 50))).toEqual([]);
  });

  it('refuses two effects on one activity, and an `after` the same change removes', () => {
    expect(codes('s1', [duration('a', 2), duration('a', 3)])).toEqual([
      ['duplicate', 'changes.problem.duplicate'],
    ]);
    expect(codes('s1', [add('N', 1, 'b'), remove('b')])).toEqual([
      ['after-removed', 'changes.problem.afterRemoved'],
    ]);
  });

  it('refuses the whole change, with every problem, and never throws', () => {
    const result = withEffects(PLAN, 's3', [add('', 0, 'ghost'), duration('a', 2)]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.map((each) => each.code)).toEqual([
      'invalid-name',
      'invalid-duration',
      'closed-stage',
      'unknown-activity',
    ]);
    expect(changeImpact(PLAN, draft([remove('ghost')])).ok).toBe(false);
  });

  it('has a message key for every refusal, under changes.problem.', () => {
    for (const key of Object.values(CHANGE_PROBLEM_KEYS))
      expect(key).toMatch(/^changes\.problem\./);
  });
});

describe('what a change does to the finish', () => {
  it('an add after the critical activity moves the finish by its working days', () => {
    const impact = impactOf(changeImpact(PLAN, draft([add('Extra socket', 2, 'c')], 's2', 300_00)));
    expect(impact).toMatchObject({
      finishBefore: '2026-09-09',
      finishAfter: '2026-09-11',
      days: 2,
      costCents: 300_00,
    });
    expect(impact.moved).toMatchObject({ unit: 'days', value: 2, label: CHANGE_LABEL_KEYS.moved });
    expect(impact.moved.rows).toEqual([
      expect.objectContaining({
        key: 'effect:0',
        itemId: null,
        activityId: null,
        effectIndex: 0,
        name: 'Extra socket',
        change: 'added',
        beforeFinish: null,
        afterFinish: '2026-09-11',
        againstFinish: 2,
      }),
    ]);
    expect(traceable(impact.moved)).toBe(true);
  });

  it('an add on a branch that is not critical moves nothing', () => {
    const impact = impactOf(changeImpact(PLAN, draft([add('Shelf', 1, 'd')])));
    expect(impact).toMatchObject({
      finishBefore: '2026-09-09',
      finishAfter: '2026-09-09',
      days: 0,
    });
    expect(impact.moved.value).toBe(0);
    expect(
      impact.moved.rows.map((row) => [row.change, row.afterFinish, row.againstFinish]),
    ).toEqual([['added', '2026-09-07', -2]]);
    expect(traceable(impact.moved)).toBe(true);
  });

  it('a duration cut on the critical path moves the finish back, with what moved', () => {
    const impact = impactOf(changeImpact(PLAN, draft([duration('b', 1)], 's1', -150_00)));
    expect(impact).toMatchObject({ finishAfter: '2026-09-08', days: -1, costCents: -150_00 });
    expect(impact.moved.rows.map((row) => [row.activityId, row.change, row.days])).toEqual([
      ['b', 'moved', -1],
      ['c', 'moved', -1],
    ]);
    expect(traceable(impact.moved)).toBe(true);
  });

  it('a duration longer on a branch with float moves nothing but that branch', () => {
    const impact = impactOf(changeImpact(PLAN, draft([duration('d', 3)])));
    expect(impact.days).toBe(0);
    expect(impact.moved.rows.map((row) => [row.activityId, row.days])).toEqual([['d', 2]]);
    expect(traceable(impact.moved)).toBe(true);
  });

  it('a removal lists what it takes away, so a finish brought forward has its row', () => {
    const impact = impactOf(changeImpact(PLAN, draft([remove('c')])));
    expect(impact).toMatchObject({ finishAfter: '2026-09-08', days: -1 });
    expect(impact.moved.rows).toEqual([
      expect.objectContaining({
        key: 'activity:c',
        activityId: 'c',
        change: 'removed',
        beforeFinish: '2026-09-09',
        afterFinish: null,
        againstFinish: null,
      }),
    ]);
    expect(traceable(impact.moved)).toBe(true);
  });

  it('a removal in the middle frees what waited on it', () => {
    // B gone: C waits on nothing and starts on day 0; the finish is D's, Fri 4.
    const impact = impactOf(changeImpact(PLAN, draft([remove('b')], 's1')));
    expect(impact).toMatchObject({ finishAfter: '2026-09-04', days: -3 });
    expect(impact.moved.rows.map((row) => [row.activityId, row.change])).toEqual([
      ['c', 'moved'],
      ['b', 'removed'],
    ]);
    expect(traceable(impact.moved)).toBe(true);
  });

  it('a money-only change moves nothing and carries its price', () => {
    const impact = impactOf(changeImpact(PLAN, draft([], 's1', 1_200_00)));
    expect(impact).toMatchObject({
      finishBefore: '2026-09-09',
      finishAfter: '2026-09-09',
      days: 0,
      costCents: 1_200_00,
    });
    expect(impact.moved.rows).toEqual([]);
    expect(traceable(impact.moved)).toBe(true);
  });

  it('says it cannot count when the calendar cannot, and still lists what moved', () => {
    const broken = { ...PLAN, calendar: { workingDays: '0000000', hoursPerDay: 8 } };
    const impact = impactOf(changeImpact(broken, draft([add('N', 1, 'c')])));
    expect(impact).toMatchObject({ finishBefore: null, finishAfter: null, days: null });
    expect(impact.moved.value).toBe(0);
    expect(traceable(impact.moved)).toBe(true);
  });

  it('never touches the plan it was given', () => {
    changeImpact(PLAN, draft([add('N', 2, 'c'), duration('b', 4), remove('d')]));
    expect(PLAN).toEqual(BEFORE);
  });

  it.each(Array.from({ length: 30 }, (_, seed) => seed))(
    'gives a traceable figure for generated change %i',
    (seed) => {
      let state = seed + 7;
      const next = () => (state = (state * 48271) % 2147483647) / 2147483647;
      const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
      const effects: ChangeEffect[] = [];
      const used = new Set<string>();
      for (let i = 0; i < 1 + Math.floor(next() * 3); i += 1) {
        const target = pick(['a', 'b', 'c', 'd']);
        const kind = pick(['add', 'duration', 'remove'] as const);
        if (kind === 'add') effects.push(add(`N${i}`, pick([1, 2, 5]), pick([null, 'a', 'c'])));
        else if (!used.has(target)) {
          used.add(target);
          effects.push(kind === 'remove' ? remove(target) : duration(target, pick([1, 2, 6])));
        }
      }
      const result = changeImpact(PLAN, draft(effects, pick(['s1', 's2'])));
      if (!result.ok) {
        // Only an `after` the same change removes can be refused here.
        expect(result.problems.every((each) => each.code === 'after-removed')).toBe(true);
        return;
      }
      expect(traceable(result.impact.moved)).toBe(true);
      expect(result.impact.moved.value).toBe(result.impact.days ?? 0);
    },
  );
});

describe('the record, read', () => {
  const TODAY = '2026-10-02';

  it('says where each change stands, and how long a waiting one has waited, in calendar days', () => {
    const plan = {
      ...PLAN,
      changeOrders: [
        changeOrder('co2', 2, 'gone', '2026-09-30'),
        changeOrder('co1', 1, 's1', '2026-09-20', {
          decision: changeDecision('withdrawn', '2026-09-21'),
        }),
      ],
    };
    expect(changeOrderRows(plan, TODAY)).toEqual([
      expect.objectContaining({
        changeOrderId: 'co1',
        state: 'withdrawn',
        waitedDays: null,
        stageName: 'Stage s1',
      }),
      expect.objectContaining({
        changeOrderId: 'co2',
        state: 'pending',
        waitedDays: 2,
        stageName: null,
      }),
    ]);
    expect(changeState(plan.changeOrders[0]!)).toBe('pending');
    expect(changeOrderRows(plan, 'not a day')[1]!.waitedDays).toBeNull();
  });

  it('waits 7 calendar days in time; the eighth is too long', () => {
    expect(CHANGE_WAITING_LIMIT_DAYS).toBe(7);
    const row = (raisedOn: string) =>
      changeOrderRows({ ...PLAN, changeOrders: [changeOrder('c', 1, 's1', raisedOn)] }, TODAY)[0]!;
    expect(row('2026-09-25')).toMatchObject({ waitedDays: 7 });
    expect(waitsTooLong(row('2026-09-25'))).toBe(false);
    expect(row('2026-09-24')).toMatchObject({ waitedDays: 8 });
    expect(waitsTooLong(row('2026-09-24'))).toBe(true);
  });
});

describe('the tally', () => {
  const TODAY = '2026-10-02';
  const plan: WorkSnapshot = {
    ...PLAN,
    changeOrders: [
      changeOrder('co1', 1, 's2', '2026-09-02', {
        costCents: 300_00,
        decision: changeDecision('approved', '2026-09-03', { costCents: 300_00, daysDelta: 2 }),
      }),
      changeOrder('co2', 2, 's1', '2026-09-04', {
        askedBy: 'person',
        askedByPersonId: 'p1',
        costCents: 900_00,
        decision: changeDecision('declined', '2026-09-05', { costCents: 900_00, daysDelta: 4 }),
      }),
      changeOrder('co3', 3, 's1', '2026-09-24', { askedBy: 'other', askedByName: ' Neighbour ' }),
      changeOrder('co4', 4, 's1', '2026-09-30', { askedBy: 'person', askedByPersonId: 'p1' }),
      changeOrder('co5', 5, 's1', '2026-09-06', {
        askedBy: 'person',
        askedByPersonId: 'p1',
        decision: changeDecision('approved', '2026-09-08', { costCents: -50_00, daysDelta: -1 }),
      }),
      changeOrder('co6', 6, 's1', '2026-09-07', {
        decision: changeDecision('approved', '2026-09-09', { costCents: null, daysDelta: null }),
      }),
      changeOrder('co7', 7, 's1', '2026-09-10', {
        askedBy: 'person',
        askedByPersonId: 'gone',
        decision: changeDecision('withdrawn', '2026-09-11'),
      }),
    ],
  };
  const tally = changeTally(plan, TODAY);

  it('counts the changes by where they stand', () => {
    expect(tally).toMatchObject({ approved: 3, declined: 1, withdrawn: 1, pending: 2 });
  });

  it('sums the money and the days of the approved changes only, from their decisions', () => {
    expect(tally.costCents).toBe(250_00);
    expect(tally.days).toBe(1);
    expect(tally.figures.cost).toMatchObject({
      unit: 'money',
      value: 250_00,
      label: 'changes.figure.cost',
    });
    expect(
      tally.figures.cost.rows.map((row) => [row.changeOrderId, row.amountCents, row.priced]),
    ).toEqual([
      ['co1', 300_00, true],
      ['co5', -50_00, true],
      ['co6', 0, false],
    ]);
    expect(tally.figures.days).toMatchObject({
      unit: 'days',
      value: 1,
      label: 'changes.figure.days',
    });
    expect(
      tally.figures.days.rows.map((row) => [
        row.changeOrderId,
        row.days,
        row.daysDelta,
        row.againstFinish,
      ]),
    ).toEqual([
      ['co1', 2, 2, 1],
      ['co5', -1, -1, 1],
      ['co6', 0, null, null],
    ]);
  });

  it('lists what waits for a decision, the longest wait first, with how long', () => {
    expect(tally.figures.waiting).toMatchObject({
      unit: 'count',
      value: 2,
      label: 'changes.figure.waiting',
    });
    expect(
      tally.figures.waiting.rows.map((row) => [row.changeOrderId, row.waitedDays, row.tooLong]),
    ).toEqual([
      ['co3', 8, true],
      ['co4', 2, false],
    ]);
  });

  it('says who asked: the owner first, then each party by its first change', () => {
    expect(
      tally.byParty.map((row) => [
        row.key,
        row.name,
        row.approved,
        row.declined,
        row.withdrawn,
        row.pending,
        row.costCents,
        row.days,
      ]),
    ).toEqual([
      ['owner', null, 2, 0, 0, 0, 300_00, 2],
      ['person:p1', 'Sample electrician', 1, 1, 0, 1, -50_00, -1],
      ['other:Neighbour', 'Neighbour', 0, 0, 0, 1, 0, 0],
      ['person:gone', null, 0, 0, 1, 0, 0, 0],
    ]);
  });

  it('has traceable figures, and they add up to the tally', () => {
    for (const figure of figuresOf(tally)) expect(traceable(figure), figure.id).toBe(true);
    expect(tally.byParty.reduce((sum, row) => sum + row.costCents, 0)).toBe(tally.costCents);
    expect(tally.byParty.reduce((sum, row) => sum + row.days, 0)).toBe(tally.days);
  });

  it('is empty, with traceable figures of 0, before any change', () => {
    const empty = changeTally(PLAN, TODAY);
    expect(empty).toMatchObject({ approved: 0, pending: 0, costCents: 0, days: 0, byParty: [] });
    for (const figure of figuresOf(empty)) {
      expect(figure.value).toBe(0);
      expect(traceable(figure)).toBe(true);
    }
  });

  it.each([
    [[2, 3], 5],
    [[-1, -1], -2],
    [[3, -1], 2],
    [[-3, 1], -2],
    [[0], 0],
  ])('keeps the days figure traceable for approved deltas %j', (deltas, total) => {
    const changes = deltas.map((daysDelta, i) =>
      changeOrder(`c${i}`, i + 1, 's1', '2026-09-01', {
        decision: changeDecision('approved', '2026-09-02', { daysDelta }),
      }),
    );
    const figure = changeTally({ ...PLAN, changeOrders: changes }, TODAY).figures.days;
    expect(figure.value).toBe(total);
    expect(traceable(figure)).toBe(true);
  });
});
