import { describe, expect, it } from 'vitest';

import {
  counted,
  daysFigure,
  percent,
  percentOf,
  summed,
  traceable,
  type DaysRow,
  type Figure,
  type ReportRow,
} from './figure';

// Adapted from Tessera's `report.test.ts` ("every number can be traced to the rows it came
// from"), with the percent unit added.

const row = (key: string, minutes = 0): ReportRow => ({
  key,
  itemId: key,
  title: `Row ${key}`,
  day: null,
  minutes,
});

describe('a figure built from its rows', () => {
  it('adds the rows up when it is summed', () => {
    const figure = summed('hours', 'figure.hours', [row('a', 60), row('b', 30)]);
    expect(figure.unit).toBe('minutes');
    expect(figure.value).toBe(90);
    expect(traceable(figure)).toBe(true);
  });

  it('counts the rows when it is counted', () => {
    const figure = counted('rows', 'figure.rows', [row('a'), row('b'), row('c')]);
    expect(figure.unit).toBe('count');
    expect(figure.value).toBe(3);
    expect(traceable(figure)).toBe(true);
  });

  it('is zero rather than wrong when there is nothing', () => {
    expect(summed('x', 'x', []).value).toBe(0);
    expect(counted('x', 'x', []).value).toBe(0);
    expect(traceable(summed('x', 'x', []))).toBe(true);
  });

  it('keeps its label as a message key, not as text', () => {
    expect(counted('rows', 'readiness.figure.label', []).label).toBe('readiness.figure.label');
  });
});

describe('a percent figure', () => {
  it('is the whole share of what must be known that is known', () => {
    expect(percentOf(1, 2)).toBe(50);
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(4, 4)).toBe(100);
    expect(percentOf(0, 4)).toBe(0);
  });

  it('is zero when there is nothing to know', () => {
    expect(percentOf(0, 0)).toBe(0);
  });

  it('never reads 100 while one thing is missing: 199 of 200 is 99, not a rounded 100', () => {
    expect(Math.round((100 * 199) / 200)).toBe(100); // what plain rounding would claim
    expect(percentOf(199, 200)).toBe(99);
    expect(percentOf(999, 1000)).toBe(99);
    const figure = percent('r', 'r', 199, 200, [row('the-one-missing')]);
    expect(figure.value).toBe(99);
    expect(traceable(figure)).toBe(true);
  });

  it('reads 100 when nothing is missing', () => {
    expect(percentOf(200, 200)).toBe(100);
    const figure = percent('r', 'r', 200, 200, []);
    expect(figure.value).toBe(100);
    expect(traceable(figure)).toBe(true);
  });

  it('leaves a share below the cap as it rounds', () => {
    expect(percentOf(197, 200)).toBe(99); // 98.5 rounds to 99 on its own
    expect(percentOf(196, 200)).toBe(98);
  });

  it('carries the missing rows, one per thing not known', () => {
    const figure = percent('readiness', 'readiness.figure', 1, 2, [row('missing')]);
    expect(figure).toMatchObject({ unit: 'percent', value: 50, known: 1, mustKnow: 2 });
    expect(traceable(figure)).toBe(true);
  });

  it('is traceable at 100 % with no rows', () => {
    expect(traceable(percent('r', 'r', 2, 2, []))).toBe(true);
  });

  it('is traceable at 0 of 0 only when a row says why there is nothing to measure', () => {
    expect(traceable(percent('r', 'r', 0, 0, [row('plan.activity:w')]))).toBe(true);
    expect(traceable(percent('r', 'r', 0, 0, []))).toBe(false);
  });
});

describe('every number can be traced to the rows it came from', () => {
  it('and the check itself catches a figure that lies', () => {
    const honest: Figure = {
      id: 'x',
      label: 'x',
      unit: 'minutes',
      value: 3,
      rows: [row('a', 1), row('b', 2)],
    };
    expect(traceable(honest)).toBe(true);
    expect(traceable({ ...honest, value: 4 })).toBe(false);
    // A row counted twice is a figure that adds up and still lies.
    expect(traceable({ ...honest, value: 2, rows: [honest.rows[0]!, honest.rows[0]!] })).toBe(
      false,
    );
    expect(traceable({ ...honest, unit: 'count', value: 2 })).toBe(true);
    expect(traceable({ ...honest, unit: 'count', value: 3 })).toBe(false);
  });

  it('catches a percent whose value does not match its counts', () => {
    const honest = percent('r', 'r', 1, 2, [row('a')]);
    expect(traceable(honest)).toBe(true);
    expect(traceable({ ...honest, value: 51 })).toBe(false);
    expect(traceable({ ...honest, value: 100 })).toBe(false);
  });

  it('catches a percent whose rows are not the things missing', () => {
    // 1 of 3 known leaves two things missing; one row hides the other.
    expect(traceable(percent('r', 'r', 1, 3, [row('a')]))).toBe(false);
    // Nothing is missing at 2 of 2, so a row is an invented problem.
    expect(traceable(percent('r', 'r', 2, 2, [row('a')]))).toBe(false);
    // The same missing thing listed twice.
    expect(traceable(percent('r', 'r', 0, 2, [row('a'), row('a')]))).toBe(false);
  });

  it('catches a percent that reads 100 with a list behind it', () => {
    const honest = percent('r', 'r', 199, 200, [row('a')]);
    expect(traceable({ ...honest, value: 100 })).toBe(false);
  });

  it('catches a percent that reads below 100 with nothing behind it', () => {
    const honest = percent('r', 'r', 200, 200, []);
    expect(traceable({ ...honest, value: 99 })).toBe(false);
    expect(traceable({ ...honest, value: 0 })).toBe(false);
  });

  it('catches a percent with impossible counts', () => {
    expect(traceable(percent('r', 'r', 3, 2, []))).toBe(false);
    expect(traceable(percent('r', 'r', -1, 2, [row('a'), row('b'), row('c')]))).toBe(false);
    expect(traceable(percent('r', 'r', 0.5, 2, [row('a')]))).toBe(false);
    expect(traceable({ ...percent('r', 'r', 0, 0, [row('a')]), value: 100 })).toBe(false);
  });
});

describe('a days figure', () => {
  const moved = (key: string, days: number, againstFinish: number | null): DaysRow => ({
    key,
    itemId: key,
    title: `Row ${key}`,
    day: null,
    minutes: 0,
    days,
    againstFinish,
  });

  it('is 0 with nothing moved', () => {
    const figure = daysFigure('slip', 'schedule.slip.label', 0, []);
    expect(figure).toMatchObject({ unit: 'days', value: 0, rows: [] });
    expect(traceable(figure)).toBe(true);
  });

  it('moved later is exactly the furthest row past the reference', () => {
    const rows = [moved('a', 3, 1), moved('b', 2, 2)];
    expect(traceable(daysFigure('slip', 'l', 2, rows))).toBe(true);
    expect(traceable(daysFigure('slip', 'l', 1, rows))).toBe(false);
    expect(traceable(daysFigure('slip', 'l', 3, rows))).toBe(false);
  });

  it('did not move, or moved earlier, when no row lies beyond it', () => {
    // A row that slipped inside its float: it moved three days and still finishes before the end.
    expect(traceable(daysFigure('slip', 'l', 0, [moved('a', 3, -2)]))).toBe(true);
    expect(traceable(daysFigure('slip', 'l', -1, [moved('a', -1, -1), moved('b', -1, -4)]))).toBe(
      true,
    );
    expect(traceable(daysFigure('slip', 'l', -2, [moved('a', -1, -1)]))).toBe(false);
    expect(traceable(daysFigure('slip', 'l', 0, [moved('a', 1, 1)]))).toBe(false);
  });

  it('ignores rows with no date now (removed) when finding the furthest', () => {
    expect(traceable(daysFigure('slip', 'l', 0, [moved('gone', 0, null)]))).toBe(true);
    expect(traceable(daysFigure('slip', 'l', 1, [moved('gone', 0, null)]))).toBe(false);
  });

  it('is broken with a value and no rows, a fraction, or rows that are not days rows', () => {
    expect(traceable(daysFigure('slip', 'l', 2, []))).toBe(false);
    expect(traceable(daysFigure('slip', 'l', 1.5, [moved('a', 1.5, 1.5)]))).toBe(false);
    expect(traceable({ id: 'x', label: 'l', unit: 'days', value: 1, rows: [row('a')] })).toBe(
      false,
    );
  });

  it('is broken when a row is listed twice', () => {
    expect(traceable(daysFigure('slip', 'l', 1, [moved('a', 1, 1), moved('a', 1, 1)]))).toBe(false);
  });
});
