import { describe, expect, it } from 'vitest';

import { traceable } from '../figure';
import { activity, link, snapshot, stage } from '../__fixtures__/plan';
import { workingCalendarOf, type WorkSnapshot } from '../plan';
import { schedule } from './index';
import {
  WHAT_IF_LABEL_KEY,
  WHAT_IF_LIMIT_DAYS,
  WHAT_IF_PROBLEM_KEYS,
  overrideTarget,
  putOverride,
  validateOverride,
  whatIfDelta,
  withOverrides,
  type Override,
  type WhatIfResult,
} from './whatIf';

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
 * 1 September 2026: A Tue 1–Thu 3, B Mon 7–Tue 8, C Wed 9, D Fri 4. Finish Wed 9. Stage 3 is closed
 * and holds X (1 d, Tue 1). Frozen: a what-if that wrote to it would throw.
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
  }),
);
const BEFORE = structuredClone(PLAN);
const CALENDAR = workingCalendarOf(PLAN);

function applied(result: WhatIfResult): WorkSnapshot {
  if (!result.ok) throw new Error(`refused: ${result.problems.map((p) => p.code).join(', ')}`);
  return result.snapshot;
}

describe('a what-if', () => {
  it('returns a new plan with the durations changed, and never touches the one it was given', () => {
    const next = applied(
      withOverrides(PLAN, [{ kind: 'duration', activityId: 'b', durationDays: 4 }]),
    );
    expect(next).not.toBe(PLAN);
    expect(next.activities.find((a) => a.id === 'b')?.durationDays).toBe(4);
    expect(next.activities.find((a) => a.id === 'a')).toBe(PLAN.activities[0]);
    expect(PLAN).toEqual(BEFORE);
    expect(schedule(PLAN).finishDate).toBe('2026-09-09');
    expect(schedule(next).finishDate).toBe('2026-09-11');
  });

  it('changes a lag the same way', () => {
    const next = applied(withOverrides(PLAN, [{ kind: 'lag', dependencyId: 'ab', lagDays: 3 }]));
    expect(next.dependencies.find((d) => d.id === 'ab')?.lagDays).toBe(3);
    expect(next.dependencies.find((d) => d.id === 'bc')).toBe(PLAN.dependencies[1]);
    expect(PLAN).toEqual(BEFORE);
    expect(schedule(next).finishDate).toBe('2026-09-11');
  });

  it('with nothing in it is an equal, new plan', () => {
    const next = applied(withOverrides(PLAN, []));
    expect(next).not.toBe(PLAN);
    expect(next).toEqual(PLAN);
  });

  it('is not a baseline: the plan keeps the baselines it had', () => {
    const next = applied(
      withOverrides(PLAN, [{ kind: 'duration', activityId: 'a', durationDays: 9 }]),
    );
    expect(next.baselines).toBe(PLAN.baselines);
  });
});

describe('a what-if refused', () => {
  const refused = (overrides: readonly Override[]) => {
    const result = withOverrides(PLAN, overrides);
    expect(PLAN).toEqual(BEFORE);
    return result.ok ? [] : result.problems;
  };

  it('names an activity the plan does not have', () => {
    expect(refused([{ kind: 'duration', activityId: 'ghost', durationDays: 2 }])).toEqual([
      {
        code: 'unknown-activity',
        messageKey: WHAT_IF_PROBLEM_KEYS['unknown-activity'],
        activityId: 'ghost',
      },
    ]);
  });

  it('names a link the plan does not have', () => {
    expect(refused([{ kind: 'lag', dependencyId: 'ghost', lagDays: 1 }])).toEqual([
      {
        code: 'unknown-dependency',
        messageKey: WHAT_IF_PROBLEM_KEYS['unknown-dependency'],
        dependencyId: 'ghost',
      },
    ]);
  });

  it('changes the duration of an activity whose stage is closed: its work is a fact', () => {
    expect(refused([{ kind: 'duration', activityId: 'x', durationDays: 5 }])).toEqual([
      {
        code: 'closed-stage',
        messageKey: WHAT_IF_PROBLEM_KEYS['closed-stage'],
        activityId: 'x',
        stageId: 's3',
      },
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN, WHAT_IF_LIMIT_DAYS + 1])('gives a duration of %s', (days) => {
    expect(refused([{ kind: 'duration', activityId: 'b', durationDays: days }])).toEqual([
      expect.objectContaining({ code: 'invalid-duration', activityId: 'b' }),
    ]);
  });

  it.each([-1, 0.5, WHAT_IF_LIMIT_DAYS + 1])('gives a lag of %s', (days) => {
    expect(refused([{ kind: 'lag', dependencyId: 'ab', lagDays: days }])).toEqual([
      expect.objectContaining({
        code: 'invalid-lag',
        messageKey: WHAT_IF_PROBLEM_KEYS['invalid-lag'],
      }),
    ]);
  });

  it('accepts the limits themselves', () => {
    expect(refused([{ kind: 'duration', activityId: 'b', durationDays: 1 }])).toEqual([]);
    expect(refused([{ kind: 'lag', dependencyId: 'ab', lagDays: 0 }])).toEqual([]);
    expect(
      refused([{ kind: 'duration', activityId: 'b', durationDays: WHAT_IF_LIMIT_DAYS }]),
    ).toEqual([]);
  });

  it('says the same thing twice: one of the two would silently lose', () => {
    expect(
      refused([
        { kind: 'duration', activityId: 'b', durationDays: 3 },
        { kind: 'duration', activityId: 'b', durationDays: 5 },
      ]),
    ).toEqual([
      { code: 'duplicate', messageKey: WHAT_IF_PROBLEM_KEYS.duplicate, target: 'activity:b' },
    ]);
  });

  it('reports every problem at once', () => {
    expect(
      refused([
        { kind: 'duration', activityId: 'ghost', durationDays: 0 },
        { kind: 'lag', dependencyId: 'ghost', lagDays: -1 },
      ]).map((problem) => problem.code),
    ).toEqual(['unknown-activity', 'invalid-duration', 'unknown-dependency', 'invalid-lag']);
  });

  it('is checked one override at a time before it is added', () => {
    expect(validateOverride(PLAN, { kind: 'duration', activityId: 'b', durationDays: 2 })).toEqual(
      [],
    );
    expect(
      validateOverride(PLAN, { kind: 'duration', activityId: 'x', durationDays: 0 }).map(
        (problem) => problem.code,
      ),
    ).toEqual(['closed-stage', 'invalid-duration']);
  });

  it('an activity whose stage is not in the plan is not closed', () => {
    const orphan = { ...PLAN, activities: [...PLAN.activities, activity('o', 'gone', 1, 1)] };
    expect(
      validateOverride(orphan, { kind: 'duration', activityId: 'o', durationDays: 2 }),
    ).toEqual([]);
  });
});

describe('the list of overrides', () => {
  const b3: Override = { kind: 'duration', activityId: 'b', durationDays: 3 };
  const b5: Override = { kind: 'duration', activityId: 'b', durationDays: 5 };
  const lag: Override = { kind: 'lag', dependencyId: 'b', lagDays: 2 };

  it('keys each override by what it changes', () => {
    expect(overrideTarget(b3)).toBe('activity:b');
    expect(overrideTarget(lag)).toBe('dependency:b');
  });

  it('replaces an override of the same thing in place, and adds a new one at the end', () => {
    const list: readonly Override[] = deepFreeze([b3, lag]);
    expect(putOverride(list, b5)).toEqual([b5, lag]);
    expect(putOverride([b3], lag)).toEqual([b3, lag]);
    expect(list).toEqual([b3, lag]);
  });
});

describe('how far a what-if moves the finish', () => {
  const next = applied(
    withOverrides(PLAN, [{ kind: 'duration', activityId: 'b', durationDays: 4 }]),
  );

  it('is the working days between the two finishes, with the activities that moved', () => {
    const delta = whatIfDelta(schedule(PLAN), schedule(next), CALENDAR);
    expect(delta).toMatchObject({ from: '2026-09-09', to: '2026-09-11', days: 2 });
    expect(delta.moved).toMatchObject({ unit: 'days', value: 2, label: WHAT_IF_LABEL_KEY });
    expect(delta.moved.rows.map((row) => [row.activityId, row.days, row.againstFinish])).toEqual([
      ['b', 2, 1],
      ['c', 2, 2],
    ]);
    expect(traceable(delta.moved)).toBe(true);
  });

  it('is signed: shorter is earlier', () => {
    const delta = whatIfDelta(schedule(next), schedule(PLAN), CALENDAR);
    expect(delta.days).toBe(-2);
    expect(traceable(delta.moved)).toBe(true);
  });

  it('is 0 with no rows when nothing moved', () => {
    const delta = whatIfDelta(schedule(PLAN), schedule(PLAN), CALENDAR);
    expect(delta.days).toBe(0);
    expect(delta.moved.rows).toEqual([]);
    expect(traceable(delta.moved)).toBe(true);
  });

  it('lists an activity placed or unplaced, its own days 0', () => {
    const cleared: WorkSnapshot = {
      ...PLAN,
      activities: PLAN.activities.map((a) => (a.id === 'd' ? { ...a, durationDays: null } : a)),
    };
    const placed = whatIfDelta(schedule(cleared), schedule(PLAN), CALENDAR);
    expect(placed.moved.rows).toEqual([
      expect.objectContaining({ activityId: 'd', change: 'placed', days: 0, beforeFinish: null }),
    ]);
    const unplaced = whatIfDelta(schedule(PLAN), schedule(cleared), CALENDAR);
    expect(unplaced.moved.rows).toEqual([
      expect.objectContaining({
        activityId: 'd',
        change: 'unplaced',
        days: 0,
        againstFinish: null,
        day: '2026-09-04',
      }),
    ]);
    expect(traceable(unplaced.moved)).toBe(true);
  });

  it('with no calendar, or no finish, is not counted: days null, the figure 0', () => {
    const delta = whatIfDelta(schedule(PLAN), schedule(next), null);
    expect(delta.days).toBeNull();
    expect(delta.moved.value).toBe(0);
    expect(delta.moved.rows.map((row) => row.days)).toEqual([0, 0]);
    const empty = snapshot();
    expect(whatIfDelta(schedule(empty), schedule(empty), CALENDAR)).toMatchObject({
      from: null,
      to: null,
      days: null,
    });
  });
});
