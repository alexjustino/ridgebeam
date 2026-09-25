import { describe, expect, it } from 'vitest';

import { traceable } from '../figure';
import { activity, link, snapshot, stage } from '../__fixtures__/plan';
import type { Baseline, WorkSnapshot } from '../plan';
import { baselineDraft, schedule } from './index';
import { SLIP_LABEL_KEY, slip } from './slip';

/**
 * A (3 d) ──+1──▶ B (2 d) ──▶ C (1 d); A ──▶ D (1 d). From Tuesday 1 September 2026.
 * A Tue 1–Thu 3, B Mon 7–Tue 8, C Wed 9, D Fri 4. D has three days of float.
 */
const PLAN = snapshot({
  stages: [stage('s1', 1), stage('s2', 2)],
  activities: [
    activity('a', 's1', 1, 3),
    activity('b', 's1', 2, 2),
    activity('c', 's2', 1, 1),
    activity('d', 's2', 2, 1),
  ],
  dependencies: [link('ab', 'a', 'b', 1), link('bc', 'b', 'c'), link('ad', 'a', 'd')],
});

/** Approve a plan: baseline 1 from the schedule as it is. */
function approve(plan: WorkSnapshot): Baseline {
  const draft = baselineDraft(plan, schedule(plan));
  return {
    id: 'baseline-1',
    number: 1,
    takenAt: '2026-08-31T12:00:00.000Z',
    reason: null,
    ...draft,
  };
}

const withDuration = (plan: WorkSnapshot, id: string, days: number | null): WorkSnapshot => ({
  ...plan,
  activities: plan.activities.map((a) => (a.id === id ? { ...a, durationDays: days } : a)),
});

const BASELINE = approve(PLAN);

describe('the slip against the baseline', () => {
  it('is 0 with no rows when the plan is compared with its own baseline', () => {
    const figure = slip(schedule(PLAN), BASELINE);
    expect(figure).toEqual({ id: 'slip', label: SLIP_LABEL_KEY, unit: 'days', value: 0, rows: [] });
    expect(traceable(figure)).toBe(true);
  });

  it('moves the finish by two working days when a critical activity grows by two, with every row that moved', () => {
    const figure = slip(schedule(withDuration(PLAN, 'b', 4)), BASELINE);
    expect(figure.value).toBe(2);
    expect(figure.rows.map((row) => [row.activityId, row.change, row.days])).toEqual([
      ['b', 'moved', 2],
      ['c', 'moved', 2],
    ]);
    expect(figure.rows[1]).toMatchObject({
      baselineFinish: '2026-09-09',
      currentFinish: '2026-09-11',
      againstFinish: 2,
      key: 'activity:c',
      itemId: 'c',
      title: 'Activity c',
      day: '2026-09-11',
    });
    expect(traceable(figure)).toBe(true);
  });

  it('does not move the finish when an activity slips inside its float, and still lists it', () => {
    // D has three days of float: two more days of D move D, and nothing else.
    const figure = slip(schedule(withDuration(PLAN, 'd', 3)), BASELINE);
    expect(figure.value).toBe(0);
    expect(figure.rows.map((row) => [row.activityId, row.days, row.againstFinish])).toEqual([
      ['d', 2, -1],
    ]);
    expect(traceable(figure)).toBe(true);
  });

  it('is negative when the finish moves earlier, and that is allowed and traceable', () => {
    const figure = slip(schedule(withDuration(PLAN, 'b', 1)), BASELINE);
    expect(figure.value).toBe(-1);
    expect(figure.rows.map((row) => [row.activityId, row.days])).toEqual([
      ['b', -1],
      ['c', -1],
    ]);
    expect(traceable(figure)).toBe(true);
  });

  it('lists an activity removed since the baseline, and does not count it', () => {
    const removed: WorkSnapshot = {
      ...PLAN,
      activities: PLAN.activities.filter((a) => a.id !== 'd'),
      dependencies: PLAN.dependencies.filter((d) => d.id !== 'ad'),
    };
    const figure = slip(schedule(removed), BASELINE);
    expect(figure.value).toBe(0);
    expect(figure.rows).toEqual([
      expect.objectContaining({
        activityId: 'd',
        change: 'removed',
        removed: true,
        added: false,
        days: 0,
        baselineFinish: '2026-09-04',
        currentFinish: null,
        againstFinish: null,
        day: '2026-09-04',
      }),
    ]);
    expect(traceable(figure)).toBe(true);
  });

  it('lists an activity added since the baseline, and counts it where it finishes', () => {
    const added: WorkSnapshot = {
      ...PLAN,
      activities: [...PLAN.activities, activity('e', 's2', 3, 2)],
      dependencies: [...PLAN.dependencies, link('ce', 'c', 'e')],
    };
    const figure = slip(schedule(added), BASELINE);
    expect(figure.value).toBe(2);
    expect(figure.rows).toEqual([
      expect.objectContaining({
        activityId: 'e',
        change: 'added',
        added: true,
        days: 0,
        againstFinish: 2,
      }),
    ]);
    expect(traceable(figure)).toBe(true);
  });

  it('lists an activity that can no longer be placed, and one placed since', () => {
    const unplaced = slip(schedule(withDuration(PLAN, 'd', null)), BASELINE);
    expect(unplaced.rows).toEqual([
      expect.objectContaining({
        activityId: 'd',
        change: 'unplaced',
        currentFinish: null,
        days: 0,
      }),
    ]);
    expect(traceable(unplaced)).toBe(true);

    const before = approve(withDuration(PLAN, 'd', null));
    const placed = slip(schedule(PLAN), before);
    expect(placed.rows).toEqual([
      expect.objectContaining({ activityId: 'd', change: 'placed', baselineFinish: null, days: 0 }),
    ]);
    expect(traceable(placed)).toBe(true);
  });

  it('is 0 against a baseline that had no finish, rather than a number from nothing', () => {
    const empty = snapshot({
      stages: [stage('s1', 1)],
      activities: [activity('a', 's1', 1, null)],
    });
    const figure = slip(schedule(withDuration(empty, 'a', 2)), approve(empty));
    expect(figure.value).toBe(0);
    expect(figure.rows.map((row) => row.change)).toEqual(['placed']);
    expect(traceable(figure)).toBe(true);
  });

  it('is 0 when the schedule can no longer be drawn, and lists everything that lost its dates', () => {
    const looped = { ...PLAN, dependencies: [...PLAN.dependencies, link('ca', 'c', 'a')] };
    const figure = slip(schedule(looped), BASELINE);
    expect(figure.value).toBe(0);
    expect(figure.rows.map((row) => row.change)).toEqual([
      'unplaced',
      'unplaced',
      'unplaced',
      'unplaced',
    ]);
    expect(traceable(figure)).toBe(true);
  });

  it('counts the slip in working days, over a holiday and a weekend', () => {
    // Two more days on B and a holiday on Thursday 10 take C from Wednesday 9 to Monday 14. On
    // the calendar that is two working days (Friday 11 and Monday 14), not five calendar days.
    const holiday = {
      ...withDuration(PLAN, 'b', 4),
      holidays: [{ date: '2026-09-10', name: 'A holiday' }],
    };
    const figure = slip(schedule(holiday), BASELINE);
    expect(figure.rows.find((row) => row.activityId === 'c')!.currentFinish).toBe('2026-09-14');
    expect(figure.value).toBe(2);
    expect(traceable(figure)).toBe(true);
  });
});

describe('a broken slip figure is caught', () => {
  const honest = slip(schedule(withDuration(PLAN, 'b', 4)), BASELINE);

  it('when its value is not the furthest finish among its rows', () => {
    expect(traceable(honest)).toBe(true);
    expect(traceable({ ...honest, value: 3 })).toBe(false);
    expect(traceable({ ...honest, value: 1 })).toBe(false);
  });

  it('when it claims the finish did not move while a row finishes past the baseline', () => {
    expect(traceable({ ...honest, value: 0 })).toBe(false);
  });

  it('when it claims a slip with nothing behind it', () => {
    expect(traceable({ ...honest, rows: [] })).toBe(false);
  });

  it('when the row that moved the finish is hidden', () => {
    // B finishes one day past the baseline's finish, C two: without C, nothing reaches the value.
    expect(honest.rows.map((row) => [row.activityId, row.againstFinish])).toEqual([
      ['b', 1],
      ['c', 2],
    ]);
    expect(
      traceable({ ...honest, rows: honest.rows.filter((row) => row.activityId !== 'c') }),
    ).toBe(false);
  });
});
