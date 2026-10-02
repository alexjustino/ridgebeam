import { describe, expect, it } from 'vitest';

import { activity, link, person, snapshot, stage, takeBaseline } from '../__fixtures__/plan';
import type { WorkSnapshot } from '../plan';
import { schedule } from '../schedule';
import { SCHEDULE_BLOCKED_KEYS, scheduleReport } from './schedule';

/**
 * From Tuesday 1 September 2026, Monday to Friday, Thursday 3 September a holiday. Tiling 3 days
 * (Tue 1, Wed 2, Fri 4), then Grout 2 (Mon 7, Tue 8), then Paint 1 (Wed 9); Clean 1 day, linked to
 * nothing, on day 0 with five days of float. Seal has no duration; Stray's stage is gone.
 */
const PLAN = snapshot({
  holidays: [{ date: '2026-09-03', name: 'Sample holiday' }],
  people: [person('p1', 'Sample tiler')],
  stages: [stage('bath', 1, 'Bathroom'), stage('paint', 2, 'Painting')],
  activities: [
    activity('tile', 'bath', 1, 3, 'p1'),
    activity('grout', 'bath', 2, 2, 'gone-person'),
    activity('seal', 'bath', 3, null),
    activity('walls', 'paint', 1, 1),
    activity('clean', 'paint', 2, 1),
    activity('stray', 'gone', 1, 2),
  ],
  dependencies: [link('l1', 'tile', 'grout'), link('l2', 'grout', 'walls')],
});

const report = (plan: WorkSnapshot, ...rest: [] | [Parameters<typeof scheduleReport>[2]]) =>
  scheduleReport(plan, schedule(plan), ...rest);

describe('the schedule printed', () => {
  it('draws the screen’s Gantt: calendar days from day 0, holidays and weekends among them', () => {
    const printed = report(PLAN);
    expect(printed.blocked).toBeNull();
    expect(printed.day0).toBe('2026-09-01');
    expect(printed.finishDate).toBe('2026-09-09');
    const gantt = printed.gantt!;
    expect(gantt.days).toBe(9);
    expect(gantt.columns.map((column) => column.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ]);
    expect(gantt.columns[2]).toEqual({ date: '2026-09-03', working: false, holiday: true });
    expect(gantt.columns[4]).toEqual({ date: '2026-09-05', working: false, holiday: false });
    expect(
      gantt.rows.map((row) => [row.activityId, row.number, row.start, row.length, row.critical]),
    ).toEqual([
      ['tile', '1.1', 0, 4, true],
      ['grout', '1.2', 6, 2, true],
      ['walls', '2.1', 8, 1, true],
      ['clean', '2.2', 0, 1, false],
    ]);
    expect(gantt.rows[0]).toMatchObject({
      name: 'Activity tile',
      stageId: 'bath',
      stageName: 'Bathroom',
      baselineStart: null,
      baselineLength: null,
    });
  });

  it('prints every activity in the table, placed or not, in breakdown order', () => {
    const table = report(PLAN).table;
    expect(
      table.map((row) => [
        row.number,
        row.activityId,
        row.start,
        row.finish,
        row.durationDays,
        row.float,
        row.unplaced,
      ]),
    ).toEqual([
      ['1.1', 'tile', '2026-09-01', '2026-09-04', 3, 0, null],
      ['1.2', 'grout', '2026-09-07', '2026-09-08', 2, 0, null],
      ['1.3', 'seal', null, null, null, null, 'no-duration'],
      ['2.1', 'walls', '2026-09-09', '2026-09-09', 1, 0, null],
      ['2.2', 'clean', '2026-09-01', '2026-09-01', 1, 5, null],
      [null, 'stray', null, null, 2, null, 'no-stage'],
    ]);
    expect(table[0]).toMatchObject({
      name: 'Activity tile',
      stageName: 'Bathroom',
      critical: true,
      responsibleId: 'p1',
      responsibleName: 'Sample tiler',
    });
    expect(table[1]).toMatchObject({ responsibleId: 'gone-person', responsibleName: null });
    expect(table[2]).toMatchObject({ responsibleId: null, responsibleName: null, critical: false });
    expect(table[5]).toMatchObject({ stageId: 'gone', stageName: null });
  });

  it('draws no baseline when there is none, or when asked for none', () => {
    const approved = { ...PLAN, baselines: [takeBaseline(PLAN, 1)] };
    expect(report(PLAN).baselineNumber).toBeNull();
    const none = report(approved, null);
    expect(none.baselineNumber).toBeNull();
    expect(
      none.gantt!.rows.every((row) => row.baselineStart === null && row.baselineLength === null),
    ).toBe(true);
  });

  it('draws the latest baseline beneath the bars, in the same columns', () => {
    // Baseline 1 when Tiling was 2 days; baseline 2 when it was 1 day and the work began a day earlier.
    const shorter = (days: number, start = '2026-09-01'): WorkSnapshot => ({
      ...PLAN,
      work: { ...PLAN.work, startDate: start },
      activities: PLAN.activities.map((each) =>
        each.id === 'tile' ? { ...each, durationDays: days } : each,
      ),
    });
    const baselines = [takeBaseline(shorter(2), 1), takeBaseline(shorter(1, '2026-08-31'), 2)];
    const printed = report({ ...PLAN, baselines });
    expect(printed.baselineNumber).toBe(2);
    const gantt = printed.gantt!;
    // Day 0 of the chart is the baseline's Monday 31 August, earlier than the schedule's.
    expect(gantt.columns[0]!.date).toBe('2026-08-31');
    expect(gantt.days).toBe(10);
    expect(
      gantt.rows.map((row) => [
        row.activityId,
        row.start,
        row.length,
        row.baselineStart,
        row.baselineLength,
      ]),
    ).toEqual([
      ['tile', 1, 4, 0, 1],
      ['grout', 7, 2, 1, 2],
      ['walls', 9, 1, 4, 1],
      ['clean', 1, 1, 0, 1],
    ]);
  });

  it('leaves the baseline off a bar it did not place', () => {
    const before: WorkSnapshot = {
      ...PLAN,
      activities: PLAN.activities.filter((each) => each.id !== 'clean'),
    };
    const printed = report({ ...PLAN, baselines: [takeBaseline(before, 1)] });
    const clean = printed.gantt!.rows.find((row) => row.activityId === 'clean')!;
    expect(clean).toMatchObject({ baselineStart: null, baselineLength: null });
    expect(printed.gantt!.rows.find((row) => row.activityId === 'tile')).toMatchObject({
      baselineStart: 0,
      baselineLength: 4,
    });
  });
});

describe('when there is nothing to draw', () => {
  it('says the calendar cannot be counted on, and still prints the table', () => {
    const printed = report({ ...PLAN, calendar: { workingDays: '0000000', hoursPerDay: 8 } });
    expect(printed.gantt).toBeNull();
    expect(printed.blocked).toBe('invalid-calendar');
    expect(printed.day0).toBeNull();
    expect(printed.table).toHaveLength(6);
    expect(printed.table[0]!.unplaced).toBe('invalid-calendar');
  });

  it('says the start is not a day', () => {
    const printed = report({ ...PLAN, work: { ...PLAN.work, startDate: 'soon' } });
    expect(printed.blocked).toBe('invalid-start');
    expect(printed.gantt).toBeNull();
  });

  it('says the links make a loop', () => {
    const looped = { ...PLAN, dependencies: [...PLAN.dependencies, link('l3', 'walls', 'tile')] };
    expect(report(looped).blocked).toBe('cyclic');
  });

  it('says nothing has a duration yet, and an empty plan has an empty table', () => {
    const plan = snapshot({
      stages: [stage('bath', 1)],
      activities: [activity('a', 'bath', 1, null)],
    });
    expect(report(plan)).toMatchObject({
      blocked: 'nothing-placed',
      gantt: null,
      finishDate: null,
    });
    expect(report(snapshot())).toMatchObject({ blocked: 'nothing-placed', table: [] });
  });

  it('names every reason with a message key', () => {
    expect(Object.keys(SCHEDULE_BLOCKED_KEYS).sort()).toEqual(
      ['cyclic', 'invalid-calendar', 'invalid-start', 'nothing-placed'].sort(),
    );
  });
});
