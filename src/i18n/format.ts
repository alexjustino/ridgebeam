/**
 * Dates, numbers and names of things, in the window's language — all through `Intl`.
 *
 * Nothing here is a word of ours: the weekday names, the currency names and the shape of a date
 * are the platform's, for the language the person chose, so they are never in the tables and
 * never in a component. Pure functions of a language and a value, tested as such.
 */

import type { Language } from './index';

/** A `YYYY-MM-DD` day, as a long date. Read as a calendar day, never shifted by a time zone. */
export function formatDay(language: Language, day: string): string {
  const moment = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(moment.getTime())) return day;
  return new Intl.DateTimeFormat(language, { dateStyle: 'long', timeZone: 'UTC' }).format(moment);
}

/** An instant (UTC, from the host), as a date and a time on this machine's clock. */
export function formatInstant(language: Language, instant: string): string {
  const moment = new Date(instant);
  if (Number.isNaN(moment.getTime())) return instant;
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    moment,
  );
}

/** A number, grouped and with the decimal mark of the language. */
export function formatNumber(language: Language, value: number): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value);
}

/** A Monday: 2024-01-01. The seven days after it name the week, Monday first. */
const A_MONDAY = Date.UTC(2024, 0, 1);

/** The seven weekday names, Monday first — the order the working-days mask is stored in. */
export function weekdayNames(language: Language, width: 'long' | 'short'): string[] {
  const format = new Intl.DateTimeFormat(language, { weekday: width, timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, index) =>
    format.format(new Date(A_MONDAY + index * 86_400_000)),
  );
}

/** The working weekdays of a mask, named and listed the way the language lists things. */
export function workingDaysList(language: Language, workingDays: readonly boolean[]): string {
  const names = weekdayNames(language, 'short').filter((_, index) => workingDays[index] === true);
  return new Intl.ListFormat(language, { style: 'short', type: 'unit' }).format(names);
}

/** A currency code with its name in the language: "BRL — Brazilian Real". */
export function currencyLabel(language: Language, code: string): string {
  try {
    const name = new Intl.DisplayNames([language], { type: 'currency' }).of(code);
    return name === undefined || name === code ? code : `${code} — ${name}`;
  } catch {
    return code;
  }
}
