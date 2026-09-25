import { describe, expect, it } from 'vitest';

import { activity, entry, finished, link, snapshot, stage, worked } from '../__fixtures__/plan';
import type { Baseline, WorkSnapshot } from '../plan';
import { type GanttBar, ganttLayout } from './gantt';
import { baselineDraft, schedule } from './index';

/**
 * Stage 1: A (3 d) ──+1──▶ B (2 d); stage 2: C (1 d) after B, D (1 d) after A, E (no duration).
 * From Tuesday 1 September 2026, with a holiday on Thursday 10.
 *
 *   A Tue 1–Thu 3 · B Mon 7–Tue 8 · C Wed 9 · D Fri 4
 */
const PLAN = snapshot({
  holidays: [{ date: '2026-09-10', name: 'A holiday' }],
  stages: [stage('s2', 2, 'Finishes'), stage('s1', 1, 'Structure')],
  activities: [
    activity('a', 's1', 1, 3),
    activity('b', 's1', 2, 2),
    activity('c', 's2', 1, 1),
    activity('d', 's2', 2, 1),
    activity('e', 's2', 3, null),
  ],
  dependencies: [link('ab', 'a', 'b', 1), link('bc', 'b', 'c'), link('ad', 'a', 'd')],
});

function layout(plan: WorkSnapshot, baseline: Baseline | null = null) {
  const scheduled = schedule(plan);
  return ganttLayout(scheduled, plan, scheduled.calendar!, baseline);
}

const bars = (rows: ReturnType<typeof layout>['rows']) =>
  rows.filter((row): row is GanttBar => row.kind === 'bar');

describe('the Gantt layout', () => {
  const result = layout(PLAN);

  it('has one column per calendar day, from the first start to the last finish', () => {
    expect(result.columns.map((day) => day.date)).toEqual([
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
  });

  it('marks the weekend as not working, so it can be shaded', () => {
    expect(result.columns.filter((day) => !day.working).map((day) => day.date)).toEqual([
      '2026-09-05',
      '2026-09-06',
    ]);
  });

  it('follows the breakdown: a band per stage in order, its placed activities under it', () => {
    expect(
      result.rows.map((row) => (row.kind === 'band' ? `band ${row.number}` : row.number)),
    ).toEqual(['band 1', '1.1', '1.2', 'band 2', '2.1', '2.2']);
    expect(result.rows.map((row) => row.y)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('leaves out an activity the schedule could not place', () => {
    expect(bars(result.rows).map((bar) => bar.activityId)).not.toContain('e');
  });

  it('draws a bar from its start column across the days it spans, the weekend included', () => {
    const b = bars(result.rows).find((bar) => bar.activityId === 'b')!;
    expect(b).toMatchObject({ x: 6, width: 2, start: '2026-09-07', finish: '2026-09-08' });
    const a = bars(result.rows).find((bar) => bar.activityId === 'a')!;
    expect(a).toMatchObject({
      x: 0,
      width: 3,
      durationDays: 3,
      slack: 0,
      critical: true,
      ghost: null,
    });
  });

  it('carries the critical path as data, never as a colour', () => {
    expect(bars(result.rows).map((bar) => [bar.activityId, bar.critical])).toEqual([
      ['a', true],
      ['b', true],
      ['c', true],
      ['d', false],
    ]);
  });

  it('draws an arrow per dependency between placed bars, critical only along the path', () => {
    expect(result.arrows).toEqual([
      { fromId: 'a', toId: 'b', lagDays: 1, critical: true, fromX: 3, fromY: 1, toX: 6, toY: 2 },
      { fromId: 'b', toId: 'c', lagDays: 0, critical: true, fromX: 8, fromY: 2, toX: 8, toY: 4 },
      { fromId: 'a', toId: 'd', lagDays: 0, critical: false, fromX: 3, fromY: 1, toX: 3, toY: 5 },
    ]);
  });

  it('draws no arrow into an activity with no bar', () => {
    const plan = { ...PLAN, dependencies: [...PLAN.dependencies, link('ce', 'c', 'e')] };
    expect(layout(plan).arrows.map((arrow) => arrow.toId)).not.toContain('e');
  });

  it('is empty when nothing is placed', () => {
    const empty = snapshot({ stages: [stage('s', 1)], activities: [activity('x', 's', 1, null)] });
    const result = layout(empty);
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([
      { kind: 'band', stageId: 's', number: '1', name: 'Stage s', y: 0 },
    ]);
    expect(result.arrows).toEqual([]);
  });
});

describe('the baseline under the plan', () => {
  const draft = baselineDraft(PLAN, schedule(PLAN));
  const baseline: Baseline = {
    id: 'b1',
    number: 1,
    takenAt: '2026-08-31T12:00:00.000Z',
    reason: null,
    ...draft,
  };

  it('is a ghost at the same place when nothing moved', () => {
    const b = bars(layout(PLAN, baseline).rows).find((bar) => bar.activityId === 'b')!;
    expect(b.ghost).toEqual({ x: b.x, width: b.width, start: b.start, finish: b.finish });
  });

  it('stays where it was when the bar moves, and the columns cover both, holiday marked', () => {
    const slipped = {
      ...PLAN,
      activities: PLAN.activities.map((a) => (a.id === 'b' ? { ...a, durationDays: 4 } : a)),
    };
    const result = layout(slipped, baseline);
    const b = bars(result.rows).find((bar) => bar.activityId === 'b')!;
    // B now runs Monday 7 to Friday 11, over the holiday; its ghost still ends on Tuesday 8.
    expect(b).toMatchObject({ start: '2026-09-07', finish: '2026-09-11', x: 6, width: 5 });
    expect(b.ghost).toMatchObject({ start: '2026-09-07', finish: '2026-09-08', x: 6, width: 2 });
    const holiday = result.columns.find((day) => day.date === '2026-09-10')!;
    expect(holiday).toEqual({ date: '2026-09-10', working: false, holiday: true });
    expect(result.columns.at(-1)!.date).toBe('2026-09-14');
  });

  it('widens the columns to a baseline that started earlier than the plan does now', () => {
    const later = { ...PLAN, work: { ...PLAN.work, startDate: '2026-09-03' } };
    const result = layout(later, baseline);
    expect(result.columns[0]!.date).toBe('2026-09-01');
    const a = bars(result.rows).find((bar) => bar.activityId === 'a')!;
    expect(a.ghost!.x).toBe(0);
    expect(a.x).toBe(2);
  });

  it('has no ghost for an activity the baseline did not place', () => {
    const unplacedThen: Baseline = {
      ...baseline,
      rows: baseline.rows.map((row) =>
        row.activityId === 'd' ? { ...row, start: null, finish: null } : row,
      ),
    };
    const d = bars(layout(PLAN, unplacedThen).rows).find((bar) => bar.activityId === 'd')!;
    expect(d.ghost).toBeNull();
  });
});

describe('the diary over the bars', () => {
  const withQuantity = {
    ...PLAN,
    activities: PLAN.activities.map((a) => (a.id === 'b' ? { ...a, quantity: 10, unit: 'm²' } : a)),
  };
  const barOf = (plan: WorkSnapshot, entries: Parameters<typeof ganttLayout>[4], id: string) => {
    const scheduled = schedule(plan);
    return bars(ganttLayout(scheduled, plan, scheduled.calendar!, null, entries).rows).find(
      (bar) => bar.activityId === id,
    )!;
  };

  it('leaves every bar unfilled and with no actual span when the diary is empty', () => {
    for (const bar of bars(layout(PLAN).rows)) {
      expect(bar.progress).toEqual({
        state: 'not-started',
        fill: 0,
        actualStart: null,
        actualFinish: null,
        actual: null,
      });
    }
  });

  it('fills a finished bar and draws where it actually ran, the planned bar unchanged', () => {
    const entries = [
      entry(1, '2026-09-01', { done: [worked('a')] }),
      entry(2, '2026-09-04', { done: [finished('a')] }),
    ];
    const a = barOf(PLAN, entries, 'a');
    expect(a).toMatchObject({ x: 0, width: 3, start: '2026-09-01', finish: '2026-09-03' });
    expect(a.progress).toEqual({
      state: 'finished',
      fill: 1,
      actualStart: '2026-09-01',
      actualFinish: '2026-09-04',
      actual: { x: 0, width: 4 },
    });
  });

  it('fills a started bar by the share of quantities done, and marks it with no fill when there are none', () => {
    const measured = [entry(1, '2026-09-07', { done: [worked('b', 4)] })];
    expect(barOf(withQuantity, measured, 'b').progress).toMatchObject({
      state: 'started',
      fill: 0.4,
      actualStart: '2026-09-07',
      actualFinish: null,
    });
    const unmeasured = [entry(1, '2026-09-07', { done: [worked('b')] })];
    expect(barOf(withQuantity, unmeasured, 'b').progress).toMatchObject({
      state: 'started',
      fill: null,
    });
  });

  it('widens the columns to a day the diary says work began before the plan did', () => {
    const early = [entry(1, '2026-08-31', { done: [worked('a')] })];
    const scheduled = schedule(PLAN);
    const result = ganttLayout(scheduled, PLAN, scheduled.calendar!, null, early);
    expect(result.columns[0]!.date).toBe('2026-08-31');
    const a = bars(result.rows).find((bar) => bar.activityId === 'a')!;
    expect(a.x).toBe(1);
    expect(a.progress.actual).toEqual({ x: 0, width: 1 });
  });

  it('draws nothing for a diary line about an activity with no bar', () => {
    const result = layout(PLAN);
    const scheduled = schedule(PLAN);
    const withE = ganttLayout(scheduled, PLAN, scheduled.calendar!, null, [
      entry(1, '2026-10-30', { done: [worked('e')] }),
    ]);
    expect(withE.columns).toEqual(result.columns);
  });
});
