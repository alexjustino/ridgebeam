import { describe, expect, it } from 'vitest';

import { addWorkingDays, parseWorkingDays, type WorkingCalendar } from '../calendar';
import { activity, link, onStage, snapshot, stage } from '../__fixtures__/plan';
import { plan } from './criticalPath';
import { baselineDraft, schedule, toDates } from './index';

/**
 * The end-to-end plan, by hand. Work starts Tuesday 1 September 2026, Monday to Friday.
 *
 *   A (3 d) ──+1 d──▶ B (2 d) ──▶ C (1 d)
 *      └────────────▶ D (1 d)
 *
 *   A: Tue 1 – Thu 3 · lag: Fri 4 · B: Mon 7 – Tue 8 · C: Wed 9 · D: Fri 4.
 *   Finish: Wed 9. Critical: A, B, C. D has float.
 */
const E2E = snapshot({
  stages: [stage('s1', 1), stage('s2', 2)],
  activities: [
    activity('a', 's1', 1, 3),
    activity('b', 's1', 2, 2),
    activity('c', 's2', 1, 1),
    activity('d', 's2', 2, 1),
  ],
  dependencies: [link('ab', 'a', 'b', 1), link('bc', 'b', 'c'), link('ad', 'a', 'd')],
});

describe('the schedule of a plan you can check by hand', () => {
  const result = schedule(E2E);

  it('places every activity on the working calendar, lag included', () => {
    expect(Object.fromEntries(result.dates)).toEqual({
      a: { start: '2026-09-01', finish: '2026-09-03' },
      b: { start: '2026-09-07', finish: '2026-09-08' },
      c: { start: '2026-09-09', finish: '2026-09-09' },
      d: { start: '2026-09-04', finish: '2026-09-04' },
    });
  });

  it('finishes on the last finish', () => {
    expect(result.finishDate).toBe('2026-09-09');
    expect(result.day0).toBe('2026-09-01');
  });

  it('marks the chain that decides the finish, and not the activity with float', () => {
    expect([...result.critical].sort()).toEqual(['a', 'b', 'c']);
    expect(result.longestChain).toEqual(['a', 'b', 'c']);
    expect(result.plan.timing.get('d')!.slack).toBe(3);
  });

  it('moves every dependent activity and the finish when one slips', () => {
    const slipped = schedule({
      ...E2E,
      activities: E2E.activities.map((a) => (a.id === 'b' ? { ...a, durationDays: 4 } : a)),
    });
    expect(slipped.dates.get('c')).toEqual({ start: '2026-09-11', finish: '2026-09-11' });
    expect(slipped.finishDate).toBe('2026-09-11');
    expect(slipped.dates.get('d')).toEqual(result.dates.get('d'));
  });

  it('reports nothing unplaced, inert or cyclic', () => {
    expect(result.unplaced).toEqual([]);
    expect(result.inert).toEqual([]);
    expect(result.cyclic).toBe(false);
  });
});

describe('the schedule on the calendar', () => {
  it('places one stage with one activity (the F0 proof, still true)', () => {
    const one = schedule(
      snapshot({ stages: [stage('s', 1)], activities: [activity('tiling', 's', 1, 3)] }),
    );
    expect(one.dates.get('tiling')).toEqual({ start: '2026-09-01', finish: '2026-09-03' });
    expect(one.finishDate).toBe('2026-09-03');
  });

  it('starts an activity with no dependency on day 0: parallel is what nothing constrains means', () => {
    const parallel = schedule(
      snapshot({
        stages: [stage('s', 1)],
        activities: [activity('a', 's', 1, 3), activity('b', 's', 2, 2)],
      }),
    );
    expect(parallel.dates.get('a')!.start).toBe('2026-09-01');
    expect(parallel.dates.get('b')!.start).toBe('2026-09-01');
  });

  it('moves a start date on a Saturday to the Monday', () => {
    const saturday = schedule(
      snapshot({
        work: { ...snapshot().work, startDate: '2026-09-05' },
        stages: [stage('s', 1)],
        activities: [activity('a', 's', 1, 1)],
      }),
    );
    expect(saturday.day0).toBe('2026-09-07');
    expect(saturday.dates.get('a')).toEqual({ start: '2026-09-07', finish: '2026-09-07' });
  });

  it('extends the finish of an activity with a holiday inside it', () => {
    const plain = snapshot({ stages: [stage('s', 1)], activities: [activity('a', 's', 1, 5)] });
    expect(schedule(plain).finishDate).toBe('2026-09-07');
    const holiday = { ...plain, holidays: [{ date: '2026-09-03', name: 'A holiday' }] };
    expect(schedule(holiday).finishDate).toBe('2026-09-08');
  });

  it('still schedules a lag longer than all the work: waiting is not work', () => {
    const long = schedule(
      snapshot({
        stages: [stage('s', 1)],
        activities: [activity('pour', 's', 1, 1), activity('build', 's', 2, 1)],
        dependencies: [link('l', 'pour', 'build', 30)],
      }),
    );
    // Tuesday 1, then 30 working days of curing, then the day after: offset 31.
    expect(long.dates.get('build')!.start).toBe(addWorkingDays(long.calendar!, '2026-09-01', 31));
    expect(long.finishDate).toBe(long.dates.get('build')!.finish);
  });

  it('expands a stage endpoint: the next stage waits for every activity of the first', () => {
    const staged = schedule(
      snapshot({
        stages: [stage('s1', 1), stage('s2', 2)],
        activities: [
          activity('short', 's1', 1, 1),
          activity('long', 's1', 2, 4),
          activity('x', 's2', 1, 1),
        ],
        dependencies: [link('l', onStage('s1'), onStage('s2'))],
      }),
    );
    expect(staged.dates.get('x')!.start).toBe('2026-09-07');
  });
});

describe('what the schedule cannot place, it says', () => {
  it('leaves an activity with no duration unplaced, and still passes its blocker on', () => {
    // a → (unknown) → c: c still waits for a, even though the middle has no duration yet.
    const result = schedule(
      snapshot({
        stages: [stage('s', 1)],
        activities: [
          activity('a', 's', 1, 2),
          activity('unknown', 's', 2, null),
          activity('c', 's', 3, 1),
        ],
        dependencies: [link('l1', 'a', 'unknown'), link('l2', 'unknown', 'c')],
      }),
    );
    expect(result.unplaced).toEqual([{ activityId: 'unknown', reason: 'no-duration' }]);
    expect(result.dates.has('unknown')).toBe(false);
    expect(result.dates.get('c')).toEqual({ start: '2026-09-03', finish: '2026-09-03' });
    expect(result.critical.has('unknown')).toBe(false);
    expect(result.longestChain).toEqual(['a', 'c']);
    expect(result.plan.noDurationOnPath).toEqual(['unknown']);
  });

  it.each([[0], [-1], [2.5]])('counts a duration of %o as none', (days) => {
    const result = schedule(
      snapshot({ stages: [stage('s', 1)], activities: [activity('a', 's', 1, days)] }),
    );
    expect(result.unplaced).toEqual([{ activityId: 'a', reason: 'no-duration' }]);
    expect(result.finishDate).toBeNull();
  });

  it('says an activity whose stage is not in the plan has no place', () => {
    const result = schedule(
      snapshot({
        stages: [stage('s', 1)],
        activities: [activity('a', 's', 1, 1), activity('ghost', 'gone', 1, 1)],
      }),
    );
    expect(result.unplaced).toEqual([{ activityId: 'ghost', reason: 'no-stage' }]);
    expect(result.dates.has('ghost')).toBe(false);
  });

  it('plans a stored cycle as cyclic: no dates, every activity unplaced, and no throw', () => {
    const looped = snapshot({
      stages: [stage('s', 1)],
      activities: [activity('a', 's', 1, 1), activity('b', 's', 2, 1), activity('c', 's', 3, 1)],
      dependencies: [link('l1', 'a', 'b'), link('l2', 'b', 'a'), link('l3', 'b', 'c')],
    });
    expect(() => schedule(looped)).not.toThrow();
    const result = schedule(looped);
    expect(result.cyclic).toBe(true);
    expect(result.dates.size).toBe(0);
    expect(result.finishDate).toBeNull();
    expect(result.critical.size).toBe(0);
    expect(result.unplaced.map((row) => row.reason)).toEqual(['cyclic', 'cyclic', 'cyclic']);
  });

  it('treats an activity made to wait on its own stage as a cycle', () => {
    const self = schedule(
      snapshot({
        stages: [stage('s', 1)],
        activities: [activity('a', 's', 1, 1)],
        dependencies: [link('l', 'a', onStage('s'))],
      }),
    );
    expect(self.cyclic).toBe(true);
  });

  it('places nothing on a calendar with no working day, and says why', () => {
    const result = schedule(
      snapshot({
        calendar: { workingDays: '0000000', hoursPerDay: 8 },
        stages: [stage('s', 1)],
        activities: [activity('a', 's', 1, 2)],
      }),
    );
    expect(result.calendar).toBeNull();
    expect(result.day0).toBeNull();
    expect(result.unplaced).toEqual([{ activityId: 'a', reason: 'invalid-calendar' }]);
  });

  it('places nothing from a start date that is not a day, and says why', () => {
    const result = schedule(
      snapshot({
        work: { ...snapshot().work, startDate: '2026-02-30' },
        stages: [stage('s', 1)],
        activities: [activity('a', 's', 1, 2)],
      }),
    );
    expect(result.day0).toBeNull();
    expect(result.unplaced).toEqual([{ activityId: 'a', reason: 'invalid-start' }]);
  });

  it('keeps a dependency naming something gone as inert, never throws, never drops other edges', () => {
    const plan = snapshot({
      stages: [stage('s', 1), stage('empty', 2)],
      activities: [activity('a', 's', 1, 2), activity('b', 's', 2, 1)],
      dependencies: [
        link('gone-activity', 'deleted', 'b', 5),
        link('real', 'a', 'b'),
        link('gone-stage', onStage('deleted-stage'), 'a'),
        link('empty', 'a', onStage('empty')),
      ],
    });
    expect(() => schedule(plan)).not.toThrow();
    const result = schedule(plan);
    expect(result.inert).toEqual(['gone-activity', 'gone-stage', 'empty']);
    expect(Object.fromEntries(result.inertReasons)).toEqual({
      'gone-activity': 'unknown-endpoint',
      'gone-stage': 'unknown-endpoint',
      empty: 'empty-stage',
    });
    expect(result.dates.get('b')).toEqual({ start: '2026-09-03', finish: '2026-09-03' });
  });

  it('is empty for an empty plan', () => {
    const result = schedule(snapshot());
    expect(result.dates.size).toBe(0);
    expect(result.finishDate).toBeNull();
    expect(result.activities).toEqual([]);
    expect(result.plan.unplanned).toBe(true);
  });

  it.skip('refuses a dependency onto an activity in a closed stage — slice F5: stages have no closed state until the check gates arrive', () => {
    // SPEC §6 lists this negative case; it cannot be written before a stage can be closed.
  });
});

describe('offsets to dates', () => {
  const calendar: WorkingCalendar = {
    workingDays: parseWorkingDays('1111100')!,
    hoursPerDay: 8,
    holidays: new Set(['2026-09-07', '2026-09-15']),
  };

  it('gives every offset the same day as counting forward from the start', () => {
    const planned = plan(
      Array.from({ length: 12 }, (_, i) => ({
        id: `t${i}`,
        durationDays: i + 1,
        isMilestone: false,
      })),
      Array.from({ length: 11 }, (_, i) => ({
        blockerId: `t${i}`,
        blockedId: `t${i + 1}`,
        lagDays: i % 3,
      })),
    );
    const dates = toDates(planned, calendar, '2026-09-05');
    for (const [id, timing] of planned.timing) {
      expect(dates.get(id)).toEqual({
        start: addWorkingDays(calendar, '2026-09-05', timing.earliestStart),
        finish: addWorkingDays(calendar, '2026-09-05', timing.earliestFinish - 1),
      });
    }
  });

  it('gives an activity that takes no days no dates', () => {
    const planned = plan([{ id: 'x', durationDays: null, isMilestone: false }], []);
    expect(toDates(planned, calendar, '2026-09-01').size).toBe(0);
  });
});

describe('the draft of a baseline', () => {
  it('holds every activity once, in plan order, as the schedule places it now', () => {
    const plan = snapshot({
      ...E2E,
      activities: [
        ...E2E.activities,
        activity('later', 's2', 3, null),
        activity('ghost', 'gone', 1, 1),
      ],
    });
    const draft = baselineDraft(plan, schedule(plan));
    expect(draft.finishDate).toBe('2026-09-09');
    expect(draft.rows.map((row) => row.activityId)).toEqual(['a', 'b', 'c', 'd', 'later', 'ghost']);
    expect(draft.rows[0]).toEqual({
      activityId: 'a',
      name: 'Activity a',
      stageName: 'Stage s1',
      durationDays: 3,
      start: '2026-09-01',
      finish: '2026-09-03',
    });
    expect(draft.rows[4]).toMatchObject({ activityId: 'later', start: null, finish: null });
    expect(draft.rows[5]).toMatchObject({ activityId: 'ghost', stageName: '' });
  });
});
