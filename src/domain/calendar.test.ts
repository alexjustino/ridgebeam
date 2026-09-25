import { afterEach, describe, expect, it } from 'vitest';

import {
  addCalendarDays,
  addWorkingDays,
  formatWorkingDays,
  isIsoDay,
  isWorkingDay,
  nextWorkingDay,
  previousWorkingDay,
  parseWorkingDays,
  readCalendar,
  subtractWorkingDays,
  validateCalendar,
  weekdayIndex,
  workingDaysBetween,
  workingDaysUntil,
  workingDaysFrom,
  type WorkingCalendar,
} from './calendar';

/**
 * Early September 2026, the week every test below is read against:
 *
 *   Mon 31 Aug · Tue 1 · Wed 2 · Thu 3 · Fri 4 · Sat 5 · Sun 6 · Mon 7 (holiday) · Tue 8
 */
const calendar = (mask: string, holidays: string[] = [], hoursPerDay = 8): WorkingCalendar => ({
  workingDays: parseWorkingDays(mask)!,
  hoursPerDay,
  holidays: new Set(holidays),
});

const WEEKDAYS = calendar('1111100');
const WITH_HOLIDAY = calendar('1111100', ['2026-09-07']);

describe('a day', () => {
  it('is a real calendar day written as YYYY-MM-DD, and nothing else', () => {
    expect(isIsoDay('2026-09-04')).toBe(true);
    expect(isIsoDay('2028-02-29')).toBe(true);
    expect(isIsoDay('0001-01-01')).toBe(true);
  });

  it.each([
    ['2026-02-30'],
    ['2026-02-29'],
    ['2026-13-01'],
    ['2026-00-10'],
    ['2026-9-4'],
    ['04/09/2026'],
    ['2026-09-04T00:00:00Z'],
    [''],
  ])('refuses %o without throwing', (value) => {
    expect(() => isIsoDay(value)).not.toThrow();
    expect(isIsoDay(value)).toBe(false);
  });

  it('refuses a value that is not text at all', () => {
    expect(isIsoDay(20260904)).toBe(false);
    expect(isIsoDay(null)).toBe(false);
    expect(isIsoDay(new Date('2026-09-04'))).toBe(false);
  });

  it('knows its weekday, Monday first like the mask', () => {
    expect(weekdayIndex('2026-08-31')).toBe(0);
    expect(weekdayIndex('2026-09-04')).toBe(4);
    expect(weekdayIndex('2026-09-06')).toBe(6);
    expect(weekdayIndex('1970-01-01')).toBe(3);
    expect(weekdayIndex('1969-12-29')).toBe(0);
  });

  it('moves by calendar days across a month, a year and a leap day', () => {
    expect(addCalendarDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2026-09-01', -1)).toBe('2026-08-31');
    expect(addCalendarDays('2026-09-01', 0)).toBe('2026-09-01');
  });

  it('keeps a year below 100 as written, not as the 1900s', () => {
    expect(addCalendarDays('0099-12-31', 1)).toBe('0100-01-01');
  });

  it('refuses a malformed day or a fraction of a day in arithmetic, as a programming error', () => {
    expect(() => addCalendarDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addCalendarDays('2026-09-01', 0.5)).toThrow(RangeError);
    expect(() => weekdayIndex('tomorrow')).toThrow(RangeError);
    // A value that is not text at all, as data from outside might be.
    expect(() => addCalendarDays(20260904 as unknown as string, 1)).toThrow(RangeError);
  });
});

describe('the working-days mask', () => {
  it('reads seven flags, Monday first', () => {
    expect(parseWorkingDays('1111100')).toEqual([true, true, true, true, true, false, false]);
    expect(parseWorkingDays('0000001')).toEqual([false, false, false, false, false, false, true]);
  });

  it('parses a week with no working day, leaving the refusal to validation', () => {
    expect(parseWorkingDays('0000000')).toEqual(Array(7).fill(false));
  });

  it.each([['111110'], ['11111000'], ['11a1100'], ['1111 00'], [''], [1111100], [null]])(
    'reads %o as nothing rather than guessing',
    (mask) => {
      expect(parseWorkingDays(mask)).toBeNull();
    },
  );

  it('writes back exactly what it read', () => {
    for (const mask of ['1111100', '1111110', '0000001', '1010101', '0000000']) {
      expect(formatWorkingDays(parseWorkingDays(mask)!)).toBe(mask);
    }
  });

  it('refuses to write a week that is not seven days', () => {
    expect(() => formatWorkingDays([true, true])).toThrow(RangeError);
  });
});

describe('validating a calendar', () => {
  it('accepts Monday to Friday, eight hours, one holiday', () => {
    const result = validateCalendar(WITH_HOLIDAY);
    expect(result).toEqual({ ok: true, calendar: WITH_HOLIDAY });
  });

  it('refuses a calendar with no working day, and says why', () => {
    expect(validateCalendar(calendar('0000000'))).toEqual({
      ok: false,
      problems: [{ code: 'no-working-day' }],
    });
  });

  it.each([[0], [-8], [24.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'refuses %o hours in a working day',
    (hours) => {
      expect(validateCalendar(calendar('1111100', [], hours))).toEqual({
        ok: false,
        problems: [{ code: 'hours-per-day' }],
      });
    },
  );

  it('accepts a whole day of 24 hours and a short day of half an hour', () => {
    expect(validateCalendar(calendar('1111100', [], 24)).ok).toBe(true);
    expect(validateCalendar(calendar('1111100', [], 0.5)).ok).toBe(true);
  });

  it('answers an invalid holiday date with a result, never a throw', () => {
    const bad = calendar('1111100', ['2026-09-07', '2026-02-30', 'Christmas']);
    expect(() => validateCalendar(bad)).not.toThrow();
    expect(validateCalendar(bad)).toEqual({
      ok: false,
      problems: [
        { code: 'holiday-date', date: '2026-02-30' },
        { code: 'holiday-date', date: 'Christmas' },
      ],
    });
  });

  it('refuses a week that is not seven days', () => {
    const short: WorkingCalendar = { ...WEEKDAYS, workingDays: [true, true, true] };
    expect(validateCalendar(short)).toEqual({
      ok: false,
      problems: [{ code: 'working-days-mask' }],
    });
  });

  it('reports every reason at once, not the first one only', () => {
    const result = validateCalendar(calendar('0000000', ['someday'], 0));
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.map((problem) => problem.code)).toEqual([
      'no-working-day',
      'hours-per-day',
      'holiday-date',
    ]);
  });
});

describe('reading a stored calendar', () => {
  it('builds a calendar from the mask text, the hours and the holiday days', () => {
    const result = readCalendar({
      workingDays: '1111100',
      hoursPerDay: 8,
      holidays: ['2026-09-07'],
    });
    expect(result.ok).toBe(true);
    expect(result.ok && isWorkingDay(result.calendar, '2026-09-07')).toBe(false);
    expect(result.ok && isWorkingDay(result.calendar, '2026-09-08')).toBe(true);
  });

  it('refuses the stored mask 0000000, which has no working day', () => {
    expect(readCalendar({ workingDays: '0000000', hoursPerDay: 8, holidays: [] })).toEqual({
      ok: false,
      problems: [{ code: 'no-working-day' }],
    });
  });

  it('answers a malformed mask with a result, and still reports the other problems', () => {
    expect(() =>
      readCalendar({ workingDays: 'weekdays', hoursPerDay: 8, holidays: [] }),
    ).not.toThrow();
    expect(readCalendar({ workingDays: 'weekdays', hoursPerDay: 8, holidays: [] })).toEqual({
      ok: false,
      problems: [{ code: 'working-days-mask' }],
    });
    expect(readCalendar({ workingDays: null, hoursPerDay: -1, holidays: ['31/12'] })).toEqual({
      ok: false,
      problems: [
        { code: 'working-days-mask' },
        { code: 'hours-per-day' },
        { code: 'holiday-date', date: '31/12' },
      ],
    });
  });
});

describe('working days', () => {
  it('are the weekdays the mask marks, and not the weekend', () => {
    expect(isWorkingDay(WEEKDAYS, '2026-09-04')).toBe(true);
    expect(isWorkingDay(WEEKDAYS, '2026-09-05')).toBe(false);
    expect(isWorkingDay(WEEKDAYS, '2026-09-06')).toBe(false);
  });

  it('skip a holiday that falls on a working weekday', () => {
    expect(isWorkingDay(WEEKDAYS, '2026-09-07')).toBe(true);
    expect(isWorkingDay(WITH_HOLIDAY, '2026-09-07')).toBe(false);
    expect(nextWorkingDay(WITH_HOLIDAY, '2026-09-07')).toBe('2026-09-08');
  });

  it('start from the day itself when it is a working day', () => {
    expect(nextWorkingDay(WEEKDAYS, '2026-09-04')).toBe('2026-09-04');
  });

  it('move a Saturday to the Monday, and past a Monday holiday to the Tuesday', () => {
    expect(nextWorkingDay(WEEKDAYS, '2026-09-05')).toBe('2026-09-07');
    expect(nextWorkingDay(WITH_HOLIDAY, '2026-09-05')).toBe('2026-09-08');
  });

  it('refuse to count on a calendar with no working day rather than loop forever', () => {
    expect(() => nextWorkingDay(calendar('0000000'), '2026-09-04')).toThrow(RangeError);
    expect(() => addWorkingDays(calendar('0000000'), '2026-09-04', 3)).toThrow(RangeError);
  });

  it('find the working day even behind a long run of holidays', () => {
    // Sundays only, and the next five Sundays are holidays.
    const sundays = calendar('0000001', [
      '2026-09-06',
      '2026-09-13',
      '2026-09-20',
      '2026-09-27',
      '2026-10-04',
    ]);
    expect(nextWorkingDay(sundays, '2026-08-31')).toBe('2026-10-11');
  });
});

describe('counting working days forward', () => {
  it('gives the first working day on or after the day for n = 0', () => {
    expect(addWorkingDays(WEEKDAYS, '2026-09-02', 0)).toBe('2026-09-02');
    expect(addWorkingDays(WEEKDAYS, '2026-09-05', 0)).toBe('2026-09-07');
  });

  it('moves n = 0 on a holiday to the next working day', () => {
    expect(addWorkingDays(WITH_HOLIDAY, '2026-09-07', 0)).toBe('2026-09-08');
  });

  it('counts whole working days, the start day being the first', () => {
    // Three days from Tuesday: Tue, Wed, Thu.
    expect(addWorkingDays(WEEKDAYS, '2026-09-01', 3 - 1)).toBe('2026-09-03');
  });

  it('spans a weekend', () => {
    expect(addWorkingDays(WEEKDAYS, '2026-09-04', 1)).toBe('2026-09-07');
  });

  it('spans a weekend and a holiday together', () => {
    // Friday, then Saturday, Sunday and the Monday holiday are passed over.
    expect(addWorkingDays(WITH_HOLIDAY, '2026-09-04', 1)).toBe('2026-09-08');
    // Four working days from Thursday: Thu 3, Fri 4, Tue 8, Wed 9.
    expect(addWorkingDays(WITH_HOLIDAY, '2026-09-03', 3)).toBe('2026-09-09');
  });

  it('works on a calendar that is only Sunday', () => {
    const sundays = calendar('0000001');
    expect(isWorkingDay(sundays, '2026-09-06')).toBe(true);
    expect(isWorkingDay(sundays, '2026-09-04')).toBe(false);
    expect(addWorkingDays(sundays, '2026-09-01', 0)).toBe('2026-09-06');
    expect(addWorkingDays(sundays, '2026-09-06', 2)).toBe('2026-09-20');
    expect(workingDaysBetween(sundays, '2026-09-01', '2026-09-30')).toBe(4);
  });

  it('refuses a negative or fractional count', () => {
    expect(() => addWorkingDays(WEEKDAYS, '2026-09-04', -1)).toThrow(RangeError);
    expect(() => addWorkingDays(WEEKDAYS, '2026-09-04', 1.5)).toThrow(RangeError);
  });
});

describe('working days between two days', () => {
  it('counts both ends', () => {
    expect(workingDaysBetween(WEEKDAYS, '2026-09-01', '2026-09-01')).toBe(1);
    expect(workingDaysBetween(WEEKDAYS, '2026-08-31', '2026-09-04')).toBe(5);
  });

  it('leaves out the weekend and the holiday', () => {
    expect(workingDaysBetween(WEEKDAYS, '2026-09-01', '2026-09-11')).toBe(9);
    expect(workingDaysBetween(WITH_HOLIDAY, '2026-09-01', '2026-09-11')).toBe(8);
    expect(workingDaysBetween(WITH_HOLIDAY, '2026-09-05', '2026-09-07')).toBe(0);
  });

  it('is zero when the end comes before the start', () => {
    expect(workingDaysBetween(WEEKDAYS, '2026-09-04', '2026-09-01')).toBe(0);
  });

  it('agrees with counting forward: an activity of d days spans d working days', () => {
    for (const start of ['2026-09-01', '2026-09-04', '2026-09-08']) {
      for (let duration = 1; duration <= 12; duration += 1) {
        const finish = addWorkingDays(WITH_HOLIDAY, start, duration - 1);
        expect(workingDaysBetween(WITH_HOLIDAY, start, finish)).toBe(duration);
      }
    }
  });
});

describe('no time zone leaks into a day', () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it.each([
    // Fourteen hours ahead of UTC: the local date differs from the UTC date most of the day.
    ['Pacific/Kiritimati', 14 * 60],
    // Behind UTC, and the clocks go back on 1 November 2026.
    ['America/New_York', -4 * 60],
  ])('gives the same answers in %s', (zone, offsetMinutes) => {
    process.env.TZ = zone;
    // Precondition: the zone really took effect, or this test would pass for the wrong reason.
    expect(-new Date('2026-09-01T12:00:00Z').getTimezoneOffset()).toBe(offsetMinutes);

    expect(weekdayIndex('2026-09-04')).toBe(4);
    expect(addCalendarDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addCalendarDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addWorkingDays(WITH_HOLIDAY, '2026-09-04', 1)).toBe('2026-09-08');
    expect(addWorkingDays(WEEKDAYS, '2026-10-30', 1)).toBe('2026-11-02');
    expect(workingDaysBetween(WEEKDAYS, '2026-10-26', '2026-11-06')).toBe(10);
  });
});

describe('a run of working days', () => {
  it('lists the first n working days on or after a day, each the same as counting forward', () => {
    const days = workingDaysFrom(WITH_HOLIDAY, '2026-09-05', 6);
    expect(days).toEqual([
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-14',
      '2026-09-15',
    ]);
    days.forEach((day, k) => expect(day).toBe(addWorkingDays(WITH_HOLIDAY, '2026-09-05', k)));
  });

  it('is empty for none, and refuses a negative or fractional count', () => {
    expect(workingDaysFrom(WEEKDAYS, '2026-09-01', 0)).toEqual([]);
    expect(() => workingDaysFrom(WEEKDAYS, '2026-09-01', -1)).toThrow(RangeError);
    expect(() => workingDaysFrom(WEEKDAYS, '2026-09-01', 1.5)).toThrow(RangeError);
  });
});

describe('working days until a day', () => {
  it('counts the working days after the first up to the second, signed', () => {
    expect(workingDaysUntil(WEEKDAYS, '2026-09-04', '2026-09-07')).toBe(1);
    expect(workingDaysUntil(WITH_HOLIDAY, '2026-09-04', '2026-09-08')).toBe(1);
    expect(workingDaysUntil(WEEKDAYS, '2026-09-07', '2026-09-04')).toBe(-1);
    expect(workingDaysUntil(WEEKDAYS, '2026-09-01', '2026-09-15')).toBe(10);
    expect(workingDaysUntil(WEEKDAYS, '2026-09-15', '2026-09-01')).toBe(-10);
  });

  it('is 0 for the same day', () => {
    expect(workingDaysUntil(WEEKDAYS, '2026-09-04', '2026-09-04')).toBe(0);
  });
});

describe('counting working days back', () => {
  it('gives the day itself for n = 0 when it is a working day', () => {
    expect(subtractWorkingDays(WEEKDAYS, '2026-09-08', 0)).toBe('2026-09-08');
  });

  it('moves n = 0 on a weekend or a holiday back to the working day before', () => {
    expect(subtractWorkingDays(WEEKDAYS, '2026-09-06', 0)).toBe('2026-09-04');
    expect(subtractWorkingDays(WITH_HOLIDAY, '2026-09-07', 0)).toBe('2026-09-04');
  });

  it('crosses a weekend and a holiday', () => {
    // Back one from Tuesday 8: Monday 7 is a holiday, the weekend is not work: Friday 4.
    expect(subtractWorkingDays(WITH_HOLIDAY, '2026-09-08', 1)).toBe('2026-09-04');
    expect(subtractWorkingDays(WITH_HOLIDAY, '2026-09-08', 3)).toBe('2026-09-02');
  });

  it('is undone by counting forward the same number of working days', () => {
    for (const day of ['2026-09-01', '2026-09-04', '2026-09-08', '2026-09-15']) {
      for (let n = 0; n <= 12; n += 1) {
        expect(addWorkingDays(WITH_HOLIDAY, subtractWorkingDays(WITH_HOLIDAY, day, n), n)).toBe(
          day,
        );
      }
    }
  });

  it('works on a calendar that is only Sunday', () => {
    expect(subtractWorkingDays(calendar('0000001'), '2026-09-12', 1)).toBe('2026-08-30');
  });

  it('refuses a negative or fractional count, and a calendar with no working day', () => {
    expect(() => subtractWorkingDays(WEEKDAYS, '2026-09-08', -1)).toThrow(RangeError);
    expect(() => subtractWorkingDays(WEEKDAYS, '2026-09-08', 0.5)).toThrow(RangeError);
    expect(() => previousWorkingDay(calendar('0000000'), '2026-09-08')).toThrow(RangeError);
  });
});
