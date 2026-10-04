import { describe, expect, it } from 'vitest';

import {
  activity,
  correction,
  entry,
  finished,
  link,
  snapshot,
  stage,
  takeBaseline,
  worked,
} from '../__fixtures__/plan';
import type { DiaryEntry } from '../diary';
import type { WorkSnapshot } from '../plan';
import { forecast } from './forecast';
import { schedule } from './index';

// The work starts on Tuesday 1 September 2026, Monday to Friday: 1–4, 7–11, 14–18 are working days.

const ask = (plan: WorkSnapshot, entries: readonly DiaryEntry[], today: string) =>
  forecast(plan, schedule(plan), entries, today);

const datesOf = (plan: WorkSnapshot, entries: readonly DiaryEntry[], today: string) =>
  Object.fromEntries(
    [...ask(plan, entries, today).dates].map(([id, { start, finish }]) => [id, [start, finish]]),
  );

describe('the forecast with nothing written yet', () => {
  const plan = snapshot({
    stages: [stage('s1', 1), stage('s2', 2)],
    activities: [
      activity('a', 's1', 1, 3),
      activity('b', 's1', 2, 2),
      activity('c', 's2', 1, 4),
      activity('d', 's2', 2, 1),
      activity('loose', 's2', 3, null),
    ],
    dependencies: [link('l1', 'a', 'b', 2), link('l2', 'a', 'c'), link('l3', 'b', 'd')],
    holidays: [{ date: '2026-09-07', name: 'Sample holiday' }],
  });

  it.each(['2026-08-20', '2026-09-01'])(
    'is the plan, day for day, when today (%s) is on or before the start',
    (today) => {
      const scheduled = schedule(plan);
      const result = forecast(plan, scheduled, [], today);
      expect(result.problem).toBeNull();
      expect(
        Object.fromEntries(
          [...result.dates].map(([id, { start, finish }]) => [id, { start, finish }]),
        ),
      ).toEqual(Object.fromEntries(scheduled.dates));
      expect(result.finishDate).toBe(scheduled.finishDate);
      expect([...result.critical].sort()).toEqual([...scheduled.critical].sort());
      expect(result.longestChain).toEqual(scheduled.longestChain);
      expect(result.daysAgainstPlan).toBe(0);
      expect([...result.dates.values()].every((dates) => dates.state === 'not-started')).toBe(true);
    },
  );

  it('leaves the plan’s own schedule untouched', () => {
    const before = schedule(plan);
    ask(plan, [entry(1, '2026-09-02', { done: [finished('a')] })], '2026-09-03');
    expect(schedule(plan)).toEqual(before);
  });

  it('starts what has not started no earlier than today, on the next working day', () => {
    const one = snapshot({ stages: [stage('s1', 1)], activities: [activity('a', 's1', 1, 2)] });
    expect(datesOf(one, [], '2026-09-08')).toEqual({ a: ['2026-09-08', '2026-09-09'] });
    // A Saturday: the first working day after it.
    expect(datesOf(one, [], '2026-09-05')).toEqual({ a: ['2026-09-07', '2026-09-08'] });
  });
});

describe('what the diary says happened', () => {
  const chain = snapshot({
    stages: [stage('s1', 1)],
    activities: [activity('a', 's1', 1, 5), activity('b', 's1', 2, 2)],
    dependencies: [link('l1', 'a', 'b')],
  });

  it('pins a finished activity at its diary dates, whatever its links say', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [activity('a', 's1', 1, 3), activity('b', 's1', 2, 2)],
      dependencies: [link('l1', 'a', 'b')],
    });
    // b was done before a: the record is the record.
    const entries = [
      entry(1, '2026-09-01', { done: [finished('b')] }),
      entry(2, '2026-09-02', { done: [worked('a')] }),
      entry(3, '2026-09-04', { done: [finished('a')] }),
    ];
    const result = ask(plan, entries, '2026-09-08');
    expect(result.dates.get('b')).toEqual({
      start: '2026-09-01',
      finish: '2026-09-01',
      state: 'finished',
    });
    expect(result.dates.get('a')).toEqual({
      start: '2026-09-02',
      finish: '2026-09-04',
      state: 'finished',
    });
    expect(result.finishDate).toBe('2026-09-04');
  });

  it('keeps a finished activity’s dates even on a day the site does not work', () => {
    const one = snapshot({ stages: [stage('s1', 1)], activities: [activity('a', 's1', 1, 2)] });
    const entries = [entry(1, '2026-09-05', { done: [finished('a')] })];
    expect(datesOf(one, entries, '2026-09-07')).toEqual({ a: ['2026-09-05', '2026-09-05'] });
  });

  it('pulls the forecast in when an activity finishes early', () => {
    const plan = { ...chain, baselines: [takeBaseline(chain, 1)] };
    const entries = [
      entry(1, '2026-09-01', { done: [worked('a')] }),
      entry(2, '2026-09-02', { done: [finished('a')] }),
    ];
    const result = ask(plan, entries, '2026-09-03');
    expect(schedule(plan).finishDate).toBe('2026-09-09');
    expect(result.dates.get('b')).toMatchObject({ start: '2026-09-03', finish: '2026-09-04' });
    expect(result.finishDate).toBe('2026-09-04');
    expect(result.daysAgainstPlan).toBe(-3);
    expect(result.daysAgainstBaseline).toBe(-3);
    expect(result.baselineFinish).toBe('2026-09-09');
  });

  it('finishes a started activity its planned duration from its start', () => {
    const entries = [entry(1, '2026-09-01', { done: [worked('a')] })];
    expect(datesOf(chain, entries, '2026-09-02')).toEqual({
      a: ['2026-09-01', '2026-09-07'],
      b: ['2026-09-08', '2026-09-09'],
    });
  });

  it('never finishes a started activity before today: it is not done', () => {
    const entries = [entry(1, '2026-09-01', { done: [worked('a')] })];
    const result = ask(chain, entries, '2026-09-14');
    expect(result.dates.get('a')).toEqual({
      start: '2026-09-01',
      finish: '2026-09-14',
      state: 'started',
    });
    expect(result.dates.get('b')).toMatchObject({ start: '2026-09-15', finish: '2026-09-16' });
    expect(result.longestChain).toEqual(['a', 'b']);
    expect([...result.critical].sort()).toEqual(['a', 'b']);
  });

  it('starts a started activity on the day the diary says, even before the work’s start', () => {
    const entries = [entry(1, '2026-08-28', { done: [worked('a')] })];
    expect(datesOf(chain, entries, '2026-08-31')).toEqual({
      a: ['2026-08-28', '2026-09-03'],
      b: ['2026-09-04', '2026-09-07'],
    });
  });

  it('reads only the effective entries: a finish corrected away is not a finish', () => {
    const entries = [
      entry(1, '2026-09-01', { done: [finished('a')] }),
      correction(2, 1, '2026-09-01', { done: [worked('a')] }),
    ];
    expect(ask(chain, entries, '2026-09-02').dates.get('a')).toMatchObject({
      state: 'started',
      finish: '2026-09-07',
    });
  });

  it('waits out a lag after a finished blocker, on the working calendar', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [activity('a', 's1', 1, 2), activity('b', 's1', 2, 1)],
      dependencies: [link('l1', 'a', 'b', 2)],
      holidays: [{ date: '2026-09-07', name: 'Sample holiday' }],
    });
    const entries = [
      entry(1, '2026-09-01', { done: [worked('a')] }),
      entry(2, '2026-09-02', { done: [finished('a')] }),
    ];
    // a ends Wednesday; two working days of lag (Thursday, Friday); Monday is a holiday.
    expect(datesOf(plan, entries, '2026-09-02')).toMatchObject({ b: ['2026-09-08', '2026-09-08'] });
  });

  it('treats a link into an activity that started as spent', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [activity('a', 's1', 1, 3), activity('b', 's1', 2, 2)],
      dependencies: [link('l1', 'a', 'b')],
    });
    // b started while a was still running: both run until today, and a still decides the finish.
    const entries = [
      entry(1, '2026-09-01', { done: [worked('a')] }),
      entry(2, '2026-09-02', { done: [worked('b')] }),
    ];
    const result = ask(plan, entries, '2026-09-08');
    expect(result.dates.get('a')).toMatchObject({ finish: '2026-09-08' });
    expect(result.dates.get('b')).toMatchObject({ start: '2026-09-02', finish: '2026-09-08' });
    expect([...result.critical].sort()).toEqual(['a', 'b']);
  });

  it('places an activity with no duration only once the diary says it started', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [activity('a', 's1', 1, 2), activity('x', 's1', 2, null)],
    });
    expect(ask(plan, [], '2026-09-01').dates.has('x')).toBe(false);
    const entries = [entry(1, '2026-09-01', { done: [worked('x')] })];
    expect(ask(plan, entries, '2026-09-03').dates.get('x')).toEqual({
      start: '2026-09-01',
      finish: '2026-09-03',
      state: 'started',
    });
  });
});

describe('what the forecast cannot say', () => {
  const plan = snapshot({ stages: [stage('s1', 1)], activities: [activity('a', 's1', 1, 2)] });

  it('stands against no baseline before approval', () => {
    const result = ask(plan, [], '2026-09-01');
    expect(result.baselineFinish).toBeNull();
    expect(result.daysAgainstBaseline).toBeNull();
    expect(result.daysAgainstPlan).toBe(0);
  });

  it('gives nothing against a today that is not a day', () => {
    expect(ask(plan, [], 'today')).toMatchObject({
      problem: 'invalid-today',
      finishDate: null,
      daysAgainstPlan: null,
    });
  });

  it('gives nothing when the plan itself cannot be scheduled', () => {
    const cyclic = snapshot({
      stages: [stage('s1', 1)],
      activities: [activity('a', 's1', 1, 2), activity('b', 's1', 2, 2)],
      dependencies: [link('l1', 'a', 'b'), link('l2', 'b', 'a')],
    });
    expect(ask(cyclic, [], '2026-09-01').problem).toBe('no-schedule');
    const noCalendar = { ...plan, calendar: { workingDays: '0000000', hoursPerDay: 8 } };
    expect(ask(noCalendar, [], '2026-09-01')).toMatchObject({
      problem: 'no-schedule',
      dates: new Map(),
    });
  });
});
