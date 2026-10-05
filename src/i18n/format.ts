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

/** A `YYYY-MM-DD` day, shorter: "5 Oct 2026" — for a table column, where the long form will not fit. */
export function formatDayShort(language: Language, day: string): string {
  const moment = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(moment.getTime())) return day;
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(moment);
}

/**
 * A `YYYY-MM-DD` day as the owner says a day of the next two weeks: its weekday, day and month —
 * "Monday, Oct 5", "segunda-feira, 5 de out." — the year left out, because the days are this
 * fortnight's (D4).
 */
export function formatDayWeekday(language: Language, day: string): string {
  const moment = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(moment.getTime())) return day;
  return new Intl.DateTimeFormat(language, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(moment);
}

/** A `YYYY-MM-DD` day as a narrow chart column names it: "Mon 5", "seg., 5". */
export function formatDayColumn(language: Language, day: string): string {
  const moment = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(moment.getTime())) return day;
  return new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(moment);
}

/** A `YYYY-MM-DD` day as its day and month in figures — "10/05", "05/10" — for a chart's column. */
export function formatDayMonth(language: Language, day: string): string {
  const moment = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(moment.getTime())) return day;
  return new Intl.DateTimeFormat(language, {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(moment);
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

/**
 * An amount of money kept in minor units (cents), as the language writes it in the work's currency:
 * `US$ 1.000,00` in Portuguese, `$1,000.00` in English. Money is never a float anywhere but here,
 * at the last step, where it becomes words.
 */
export function formatMoney(language: Language, cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(language, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

/**
 * What a person typed as an amount in major units — `1200`, `1200.5`, `1200.50` — as whole cents,
 * or `null` when it is not an amount (empty, not a number, negative, or more than two decimals).
 * The number field gives a dot for the decimal mark whatever the language, so only the dot is read.
 */
export function toCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/**
 * The same, for an amount that may be negative — a change order that saves money (E1): `-150`,
 * `-150.5`. A minus sign in front of an amount `toCents` reads, and nothing else; `-0` is 0.
 */
export function toSignedCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  if (!trimmed.startsWith('-')) return toCents(trimmed);
  const cents = toCents(trimmed.slice(1));
  return cents === null ? null : cents === 0 ? 0 : -cents;
}

/** Whole cents as the plain major-unit text a number field holds: 120000 → `1200.00`. */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const value = Math.abs(cents);
  return `${sign}${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

/** The month of a `YYYY-MM-DD` day, with its year: "October 2026", "outubro de 2026". */
export function formatMonth(language: Language, day: string): string {
  const moment = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(moment.getTime())) return day.slice(0, 7);
  return new Intl.DateTimeFormat(language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(moment);
}
