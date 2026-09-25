/**
 * The working calendar: which days the site works, and how durations are counted on it.
 *
 * Every duration, lag and deadline in this product is counted in working days, never in
 * calendar days (glossary: "working day"). This module is the one place that knows what a
 * working day is: a weekday the mask marks as working that is not a holiday.
 *
 * Days are ISO 8601 `YYYY-MM-DD` strings, the same text the host stores. Arithmetic is done on
 * a UTC day number, so no time zone and no daylight-saving change can move a day: a date is a
 * date, not a moment.
 *
 * What this module is not: a scheduler. It does not know about activities, dependencies or the
 * critical path. It only answers "is this a working day" and "which working day is n working
 * days after this one". It performs no I/O and never reads the clock.
 *
 * Two kinds of input, two kinds of failure. A calendar or a day that arrives from outside is
 * checked by `validateCalendar`, `readCalendar` or `isIsoDay`, which return a result and never
 * throw. The arithmetic functions take what those checks accepted; handed a malformed day or a
 * calendar with no working day, they throw a `RangeError`, because that is a programming error
 * and not something a person typed.
 */

const DAY_MS = 86_400_000;

/** A working calendar, ready for arithmetic. */
export interface WorkingCalendar {
  /** Seven entries, Monday first: `true` for a working weekday. */
  readonly workingDays: readonly boolean[];
  /** Hours in a working day, above zero and at most 24. */
  readonly hoursPerDay: number;
  /** Days taken out of the working days whatever the mask says, as `YYYY-MM-DD`. */
  readonly holidays: ReadonlySet<string>;
}

/** Why a calendar was refused. The interface turns each code into a sentence. */
export type CalendarProblem =
  | { readonly code: 'working-days-mask' }
  | { readonly code: 'no-working-day' }
  | { readonly code: 'hours-per-day' }
  | { readonly code: 'holiday-date'; readonly date: string };

/** The answer of a check: the calendar, accepted, or every reason it was refused. */
export type CalendarValidation =
  | { readonly ok: true; readonly calendar: WorkingCalendar }
  | { readonly ok: false; readonly problems: readonly CalendarProblem[] };

// ── Days ─────────────────────────────────────────────────────────────────────

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The UTC day number of a `YYYY-MM-DD` day, or `null` when it is not a real day. */
function dayNumberOf(day: string): number | null {
  const match = ISO_DAY.exec(day);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  // `setUTCFullYear`, not `Date.UTC`: the latter reads the years 0 to 99 as 1900 to 1999.
  const moment = new Date(0);
  moment.setUTCFullYear(year, month - 1, date);
  // A day that rolled over (2026-02-30 became 2026-03-02) is not the day that was written.
  if (
    moment.getUTCFullYear() !== year ||
    moment.getUTCMonth() !== month - 1 ||
    moment.getUTCDate() !== date
  ) {
    return null;
  }
  return Math.round(moment.getTime() / DAY_MS);
}

/** The `YYYY-MM-DD` text of a UTC day number. */
function dayOf(dayNumber: number): string {
  const moment = new Date(dayNumber * DAY_MS);
  const year = String(moment.getUTCFullYear()).padStart(4, '0');
  const month = String(moment.getUTCMonth() + 1).padStart(2, '0');
  const date = String(moment.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

/** The day number of a day the caller promised is valid. */
function requireDay(day: string): number {
  const dayNumber = typeof day === 'string' ? dayNumberOf(day) : null;
  if (dayNumber === null) throw new RangeError(`Not a YYYY-MM-DD day: ${JSON.stringify(day)}`);
  return dayNumber;
}

/** Is this a real calendar day written as `YYYY-MM-DD`? Never throws. */
export function isIsoDay(value: unknown): value is string {
  return typeof value === 'string' && dayNumberOf(value) !== null;
}

/** The weekday of a day, Monday = 0 to Sunday = 6, the same order as the mask. */
export function weekdayIndex(day: string): number {
  // 1970-01-01, day number 0, was a Thursday: index 3.
  return (((requireDay(day) + 3) % 7) + 7) % 7;
}

/** The day `n` calendar days after `day`, or before it for a negative `n`. */
export function addCalendarDays(day: string, n: number): string {
  if (!Number.isInteger(n)) throw new RangeError(`Not a whole number of days: ${n}`);
  return dayOf(requireDay(day) + n);
}

// ── The mask ─────────────────────────────────────────────────────────────────

/**
 * Read the stored mask, seven `0` or `1` characters Monday first, as working weekdays.
 *
 * Returns `null` for anything else rather than guessing. A mask with no `1` is parsed: it is
 * well formed, and refusing it is `validateCalendar`'s job, with its own reason.
 */
export function parseWorkingDays(mask: unknown): readonly boolean[] | null {
  if (typeof mask !== 'string' || !/^[01]{7}$/.test(mask)) return null;
  return [...mask].map((flag) => flag === '1');
}

/** The stored form of working weekdays, Monday first: `1111100`. */
export function formatWorkingDays(workingDays: readonly boolean[]): string {
  if (workingDays.length !== 7) {
    throw new RangeError(`A week has seven days, not ${workingDays.length}`);
  }
  return workingDays.map((working) => (working ? '1' : '0')).join('');
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Check a calendar before anything is counted on it. Never throws.
 *
 * Refused, each with its reason: a week that is not seven days; a week with no working day (a
 * mandatory negative case: nothing could ever be scheduled on it); hours per day that are not a
 * number above zero and at most 24; a holiday that is not a real `YYYY-MM-DD` day.
 */
export function validateCalendar(calendar: WorkingCalendar): CalendarValidation {
  const problems: CalendarProblem[] = [];

  if (
    calendar.workingDays.length !== 7 ||
    !calendar.workingDays.every((flag) => typeof flag === 'boolean')
  ) {
    problems.push({ code: 'working-days-mask' });
  } else if (!calendar.workingDays.includes(true)) {
    problems.push({ code: 'no-working-day' });
  }

  const hours: unknown = calendar.hoursPerDay;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > 24) {
    problems.push({ code: 'hours-per-day' });
  }

  for (const date of [...calendar.holidays].sort()) {
    if (!isIsoDay(date)) problems.push({ code: 'holiday-date', date });
  }

  return problems.length === 0 ? { ok: true, calendar } : { ok: false, problems };
}

/**
 * Build and check a calendar from its stored form: the mask text, the hours, the holiday days.
 * Never throws. A malformed mask is a problem in the result, reported with any other.
 */
export function readCalendar(stored: {
  readonly workingDays: unknown;
  readonly hoursPerDay: number;
  readonly holidays: readonly string[];
}): CalendarValidation {
  const holidays = new Set(stored.holidays);
  const workingDays = parseWorkingDays(stored.workingDays);
  if (workingDays !== null) {
    return validateCalendar({ workingDays, hoursPerDay: stored.hoursPerDay, holidays });
  }
  // The mask is unreadable; check the rest against any readable week so that every reason is
  // reported at once, and none is invented.
  const rest = validateCalendar({
    workingDays: [true, false, false, false, false, false, false],
    hoursPerDay: stored.hoursPerDay,
    holidays,
  });
  return {
    ok: false,
    problems: [{ code: 'working-days-mask' }, ...(rest.ok ? [] : rest.problems)],
  };
}

// ── Arithmetic ───────────────────────────────────────────────────────────────

/** Is this a day the site works: a working weekday that is not a holiday? */
export function isWorkingDay(calendar: WorkingCalendar, day: string): boolean {
  return calendar.workingDays[weekdayIndex(day)] === true && !calendar.holidays.has(day);
}

/**
 * The first working day on or after `day`: the day itself when it is one.
 *
 * Throws for a calendar with no working weekday, which has no answer, and which
 * `validateCalendar` refuses before it gets here.
 */
export function nextWorkingDay(calendar: WorkingCalendar, day: string): string {
  if (!calendar.workingDays.includes(true)) {
    throw new RangeError('This calendar has no working day, so nothing can be counted on it');
  }
  // The loop ends: every week holds a working weekday, and the holidays are finitely many, so
  // at most 7 × (holidays + 1) days are passed over.
  let current = requireDay(day);
  while (!isWorkingDay(calendar, dayOf(current))) current += 1;
  return dayOf(current);
}

/**
 * The working day `n` whole working days after the first working day on or after `day`.
 *
 * `n = 0` is that first working day itself. An activity of `d` working days starting on
 * working day `s` finishes on `addWorkingDays(calendar, s, d - 1)`: its first day counts.
 */
export function addWorkingDays(calendar: WorkingCalendar, day: string, n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`Working days are counted forward in whole days, not ${n}`);
  }
  let current = nextWorkingDay(calendar, day);
  for (let counted = 0; counted < n; counted += 1) {
    current = nextWorkingDay(calendar, addCalendarDays(current, 1));
  }
  return current;
}

/** How many working days lie between two days, both included. Zero when `to` is before `from`. */
export function workingDaysBetween(calendar: WorkingCalendar, from: string, to: string): number {
  const first = requireDay(from);
  const last = requireDay(to);
  let count = 0;
  for (let current = first; current <= last; current += 1) {
    if (isWorkingDay(calendar, dayOf(current))) count += 1;
  }
  return count;
}

/**
 * The first `count` working days on or after `day`, in order: offset `k` of the result is
 * `addWorkingDays(calendar, day, k)`, computed in one walk rather than one walk per offset. What
 * turns a schedule's day offsets into dates.
 */
export function workingDaysFrom(calendar: WorkingCalendar, day: string, count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`A count of working days is a whole number from zero, not ${count}`);
  }
  const days: string[] = [];
  if (count === 0) return days;
  let current = requireDay(nextWorkingDay(calendar, day));
  while (days.length < count) {
    const text = dayOf(current);
    if (isWorkingDay(calendar, text)) days.push(text);
    current += 1;
  }
  return days;
}

/**
 * The signed distance from one working day to another, in working days: how many working days
 * after `from` the day `to` is, negative when it is before. `0` for the same day. What a slip is
 * measured in.
 */
export function workingDaysDiff(calendar: WorkingCalendar, from: string, to: string): number {
  if (to === from) return 0;
  if (to > from) return workingDaysBetween(calendar, addCalendarDays(from, 1), to);
  return -workingDaysBetween(calendar, addCalendarDays(to, 1), from);
}
