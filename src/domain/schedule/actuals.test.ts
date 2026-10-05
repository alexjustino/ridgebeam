import { describe, expect, it } from 'vitest';

import {
  activity,
  correction,
  entry,
  finished,
  snapshot,
  stage,
  worked,
} from '../__fixtures__/plan';
import type { DiaryEntry } from '../diary';
import { traceable } from '../figure';
import type { Activity, WorkSnapshot } from '../plan';
import {
  ACTUALS_LABEL_KEYS,
  ACTUALS_MESSAGE_KEYS,
  ACTUALS_PROBLEM_KEYS,
  activityActuals,
  learnedCounts,
  type ActualRow,
} from './actuals';
import * as schedule from './index';

// The work starts on Tuesday 1 September 2026, Monday to Friday: 1–4, 7–11, 14–18, 21–25 are
// working days; 5–6, 12–13, 19–20 are a weekend.

const TODAY = '2026-09-21';

const ranged = (base: Activity, min: number, max: number): Activity => ({
  ...base,
  durationMinDays: min,
  durationMaxDays: max,
});

/** One entry per call, numbered in order: `day` and what was done on it. */
function diary(...days: Array<[string, ...ReturnType<typeof worked>[]]>): DiaryEntry[] {
  return days.map(([day, ...done], index) => entry(index + 1, day, { done }));
}

const rowOf = (rows: readonly ActualRow[], id: string): ActualRow =>
  rows.find((row) => row.activityId === id)!;

function plan(activities: Activity[], parts: Partial<WorkSnapshot> = {}): WorkSnapshot {
  return snapshot({ stages: [stage('s1', 1, 'Joinery')], activities, ...parts });
}

describe('how long an activity took', () => {
  it('counts working days from the first day worked to the day finished, both included', () => {
    const work = plan([activity('a', 's1', 1, 2)]);
    const result = activityActuals(
      work,
      diary(['2026-09-01', worked('a')], ['2026-09-03', finished('a')]),
      TODAY,
    );
    expect(rowOf(result.rows, 'a')).toMatchObject({
      state: 'finished',
      startedOn: '2026-09-01',
      finishedOn: '2026-09-03',
      planned: 2,
      tookDays: 3,
      soFarDays: null,
      differenceDays: 1,
      inRange: null,
      overrunning: false,
      problem: null,
    });
  });

  it('is 1 when it finished on the day it started', () => {
    const work = plan([activity('a', 's1', 1, 1)]);
    const row = rowOf(activityActuals(work, diary(['2026-09-02', finished('a')]), TODAY).rows, 'a');
    expect(row).toMatchObject({ tookDays: 1, differenceDays: 0 });
  });

  it('passes over a weekend and a holiday, which are not working days', () => {
    const work = plan([activity('a', 's1', 1, 3)]);
    const entries = diary(['2026-09-04', worked('a')], ['2026-09-08', finished('a')]);
    // Friday, Monday, Tuesday.
    expect(rowOf(activityActuals(work, entries, TODAY).rows, 'a').tookDays).toBe(3);
    const withHoliday = { ...work, holidays: [{ date: '2026-09-07', name: 'Sample holiday' }] };
    // Friday and Tuesday: the Monday was a holiday.
    expect(rowOf(activityActuals(withHoliday, entries, TODAY).rows, 'a').tookDays).toBe(2);
  });

  it('counts the waiting and the lost days in between: elapsed, not effort', () => {
    const work = plan([activity('a', 's1', 1, 2)]);
    const entries = [
      entry(1, '2026-09-01', { done: [worked('a')] }),
      entry(2, '2026-09-02', { lostDay: true, lostCause: 'weather' }),
      // Nothing written on the 3rd, the 4th or the 7th.
      entry(3, '2026-09-08', { done: [finished('a')] }),
    ];
    // 1, 2, 3, 4, 7, 8.
    expect(rowOf(activityActuals(work, entries, TODAY).rows, 'a')).toMatchObject({
      tookDays: 6,
      differenceDays: 4,
    });
  });

  it('took at least one day when the diary names only days off the calendar', () => {
    const work = plan([activity('a', 's1', 1, 1), activity('b', 's1', 2, 1)]);
    const entries = diary(
      ['2026-09-05', finished('a'), worked('b')],
      ['2026-09-07', finished('b')],
    );
    const { rows } = activityActuals(work, entries, TODAY);
    // Saturday only: 1, never 0.
    expect(rowOf(rows, 'a').tookDays).toBe(1);
    // Saturday to Monday: the Monday.
    expect(rowOf(rows, 'b').tookDays).toBe(1);
  });

  it('reads the diary as corrected: a correction moves the finish', () => {
    const work = plan([activity('a', 's1', 1, 2)]);
    const entries = [
      entry(1, '2026-09-01', { done: [worked('a')] }),
      entry(2, '2026-09-02', { done: [finished('a')] }),
      correction(3, 2, '2026-09-02', { done: [worked('a')] }),
      entry(4, '2026-09-04', { done: [finished('a')] }),
    ];
    expect(rowOf(activityActuals(work, entries, TODAY).rows, 'a')).toMatchObject({
      finishedOn: '2026-09-04',
      tookDays: 4,
    });
  });
});

describe('an activity still running', () => {
  const work = plan([activity('a', 's1', 1, 4), activity('b', 's1', 2, 5)]);
  const entries = diary(['2026-09-08', worked('a'), worked('b')]);

  it('counts so far from the day it started to today, today only when it is a working day', () => {
    // Saturday: Tuesday to Friday.
    const saturday = activityActuals(work, entries, '2026-09-12');
    expect(rowOf(saturday.rows, 'a')).toMatchObject({
      state: 'started',
      tookDays: null,
      soFarDays: 4,
      differenceDays: null,
      inRange: null,
      overrunning: false,
    });
    // Monday: and the Monday.
    const monday = activityActuals(work, entries, '2026-09-14');
    expect(rowOf(monday.rows, 'a')).toMatchObject({ soFarDays: 5, overrunning: true });
    expect(rowOf(monday.rows, 'b')).toMatchObject({ soFarDays: 5, overrunning: false });
  });

  it('started today is one day so far', () => {
    expect(rowOf(activityActuals(work, entries, '2026-09-08').rows, 'a').soFarDays).toBe(1);
  });

  it('is never counted as finished, longer or outside', () => {
    const result = activityActuals(work, entries, '2026-09-21');
    expect(result.finished.value).toBe(0);
    expect(result.longer.value).toBe(0);
    expect(result.outside.value).toBe(0);
  });
});

describe('against the plan and the range it was given', () => {
  const work = plan([
    activity('slow', 's1', 1, 3),
    ranged(activity('inside', 's1', 2, 4), 1, 6),
    ranged(activity('beyond', 's1', 3, 2), 2, 4),
    activity('fast', 's1', 4, 4),
    ranged(activity('unplanned', 's1', 5, null), 1, 2),
    activity('waiting', 's1', 6, 2),
    activity('slower', 's1', 7, 1),
  ]);
  const entries = diary(
    ['2026-09-01', worked('slow'), worked('beyond'), worked('fast'), worked('slower')],
    ['2026-09-02', finished('inside'), finished('fast')],
    ['2026-09-07', finished('slow'), finished('beyond'), finished('unplanned')],
    ['2026-09-11', finished('slower')],
  );
  const result = activityActuals(work, entries, TODAY);

  it('says the difference and whether it fell inside the range', () => {
    expect(
      result.rows.map((row) => [row.activityId, row.tookDays, row.differenceDays, row.inRange]),
    ).toEqual([
      ['slow', 5, 2, null],
      ['inside', 1, -3, true],
      ['beyond', 5, 3, false],
      ['fast', 2, -2, null],
      ['unplanned', 1, null, true],
      ['waiting', null, null, null],
      ['slower', 9, 8, null],
    ]);
    expect(rowOf(result.rows, 'unplanned')).toMatchObject({
      planned: null,
      range: { min: 1, max: 2 },
    });
    expect(rowOf(result.rows, 'waiting')).toMatchObject({
      state: 'not-started',
      startedOn: null,
      soFarDays: null,
      problem: null,
    });
  });

  it('opens every figure onto exactly the rows it counts', () => {
    const ids = (rows: readonly ActualRow[]) => rows.map((row) => row.activityId);
    expect(ids(result.finished.rows)).toEqual([
      'slow',
      'inside',
      'beyond',
      'fast',
      'unplanned',
      'slower',
    ]);
    // The most days over first.
    expect(ids(result.longer.rows)).toEqual(['slower', 'beyond', 'slow']);
    // The most days under first.
    expect(ids(result.less.rows)).toEqual(['inside', 'fast']);
    expect(ids(result.outside.rows)).toEqual(['beyond']);
    expect(result.finished.value).toBe(6);
    expect(result.longer.value).toBe(3);
    expect(result.less.value).toBe(2);
    expect(result.outside.value).toBe(1);
    for (const figure of [result.finished, result.longer, result.less, result.outside]) {
      expect(figure.unit).toBe('count');
      expect(traceable(figure)).toBe(true);
    }
  });

  it('adds up the days over, carried by the rows that took longer', () => {
    expect(result.daysOver.unit).toBe('days');
    expect(result.daysOver.value).toBe(8 + 3 + 2);
    expect(result.daysOver.rows.map((row) => [row.activityId, row.days])).toEqual([
      ['slower', 8],
      ['beyond', 3],
      ['slow', 2],
    ]);
    expect(result.daysOver.rows.map((row) => row.key)).toEqual(
      result.longer.rows.map((row) => row.key),
    );
    expect(traceable(result.daysOver)).toBe(true);
  });

  it('is empty and traceable when nothing has started', () => {
    const none = activityActuals(work, [], TODAY);
    expect(none.problem).toBeNull();
    expect(none.rows.every((row) => row.state === 'not-started')).toBe(true);
    for (const figure of [none.finished, none.longer, none.less, none.outside, none.daysOver]) {
      expect(figure.value).toBe(0);
      expect(figure.rows).toEqual([]);
      expect(traceable(figure)).toBe(true);
    }
  });

  it('carries what the figures need to open onto an activity', () => {
    expect(rowOf(result.rows, 'slow')).toMatchObject({
      key: 'activity:slow',
      itemId: 'slow',
      title: 'Activity slow',
      day: '2026-09-07',
      minutes: 0,
      stageId: 's1',
    });
  });
});

describe('what cannot be counted is said, never invented', () => {
  const entries = diary(['2026-09-01', worked('a'), worked('b')], ['2026-09-02', finished('a')]);

  it('with no calendar, no row has days and every row says why', () => {
    const work = plan(
      [activity('a', 's1', 1, 2), activity('b', 's1', 2, 2), activity('c', 's1', 3, 1)],
      {
        calendar: { workingDays: '0000000', hoursPerDay: 8 },
      },
    );
    const result = activityActuals(work, entries, TODAY);
    expect(result.problem).toBe('no-calendar');
    for (const row of result.rows) {
      expect(row).toMatchObject({
        tookDays: null,
        soFarDays: null,
        differenceDays: null,
        inRange: null,
        overrunning: false,
        problem: 'no-calendar',
      });
    }
    // What the diary says is still said: finished is a state, not a count of days.
    expect(rowOf(result.rows, 'a').state).toBe('finished');
    expect(result.finished.value).toBe(1);
    expect(result.longer.value).toBe(0);
  });

  it('with no today, what is running has no "so far", and what finished still took its days', () => {
    const work = plan([activity('a', 's1', 1, 2), activity('b', 's1', 2, 2)]);
    const result = activityActuals(work, entries, 'not a day');
    expect(result.problem).toBe('invalid-today');
    expect(rowOf(result.rows, 'a')).toMatchObject({ tookDays: 2, problem: null });
    expect(rowOf(result.rows, 'b')).toMatchObject({ soFarDays: null, problem: 'invalid-today' });
  });

  it('a diary day that is not a day is not counted', () => {
    const work = plan([activity('a', 's1', 1, 2)]);
    const result = activityActuals(work, diary(['2026-02-30', finished('a')]), TODAY);
    expect(rowOf(result.rows, 'a')).toMatchObject({
      state: 'finished',
      tookDays: null,
      problem: 'invalid-day',
    });
  });
});

describe('learnedCounts', () => {
  it('counts the activities a template holds that finished with their days counted', () => {
    const work = plan([
      activity('a', 's1', 1, 2),
      activity('b', 's1', 2, 2),
      activity('c', 's1', 3, 2),
      activity('orphan', 'gone', 1, 2),
    ]);
    const entries = diary(
      ['2026-09-01', worked('a'), finished('b'), finished('orphan')],
      ['2026-09-02', finished('a')],
    );
    expect(learnedCounts(work, entries, TODAY)).toEqual({ finished: 2, total: 3 });
    expect(learnedCounts(work, [], TODAY)).toEqual({ finished: 0, total: 3 });
    const noCalendar = { ...work, calendar: { workingDays: '0000000', hoursPerDay: 8 } };
    expect(learnedCounts(noCalendar, entries, TODAY)).toEqual({ finished: 0, total: 3 });
    expect(learnedCounts(snapshot(), [], TODAY)).toEqual({ finished: 0, total: 0 });
  });
});

describe('the words', () => {
  it('are message keys under schedule.actuals, each once', () => {
    expect(new Set(ACTUALS_MESSAGE_KEYS).size).toBe(ACTUALS_MESSAGE_KEYS.length);
    for (const key of ACTUALS_MESSAGE_KEYS) expect(key).toMatch(/^schedule\.actuals\.[a-zA-Z.]+$/);
    expect(ACTUALS_MESSAGE_KEYS).toEqual([
      ...Object.values(ACTUALS_LABEL_KEYS),
      ...Object.values(ACTUALS_PROBLEM_KEYS),
    ]);
  });

  it('are reachable from the schedule module, as the rest of it', () => {
    expect(schedule.activityActuals).toBe(activityActuals);
    expect(schedule.learnedCounts).toBe(learnedCounts);
  });
});
