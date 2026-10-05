/**
 * A day as a person types it, and as a date field shows it — in the product's language, never the
 * webview's.
 *
 * The stored form is `YYYY-MM-DD` and it never changes; this module is the one place that turns it
 * into what a person reads in a field and turns what they type back into it. Portuguese reads and
 * writes a day as `DD/MM/AAAA` — the order a Brazilian reads `10/02/2026` in, the 10th of February.
 * English shows the month as a word — "Feb 10, 2026", the product's own short day — because the
 * same digits are the 2nd of October to an American and the 10th of February to everybody else;
 * a word cannot be read the wrong way round. So English refuses a day written all in digits unless
 * the year comes first, which is the one numeric order nobody reads two ways.
 *
 * Pure functions of a language and a text, tested as such. Month names come from `Intl`, so they
 * are the platform's words, not ours.
 */

import { formatDayShort } from './format';
import type { Language } from './index';

/** What a field's text says, read in a language. */
export type DayReading =
  /** Nothing typed: the field holds no day. */
  | { readonly kind: 'empty' }
  /** A day on the calendar, as the stored form. */
  | { readonly kind: 'day'; readonly iso: string }
  /** Not a day yet, but it could become one: a part is missing. */
  | { readonly kind: 'partial' }
  /** Not a day on the calendar — the 31st of February, a 13th month, a word that is no month. */
  | { readonly kind: 'not-a-day' }
  /** English digits in a day-and-month order, which two readers read two ways. */
  | { readonly kind: 'month-as-word' };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` when the parts are a day on the calendar, else `null`. */
function isoOf(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const moment = new Date(Date.UTC(year, month - 1, day));
  if (moment.getUTCMonth() !== month - 1 || moment.getUTCDate() !== day) return null;
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

/** Whether a text is a stored day — the form the database and every caller use. */
export function isStoredDay(text: string): boolean {
  const match = ISO.exec(text);
  return match !== null && isoOf(Number(match[1]), Number(match[2]), Number(match[3])) === text;
}

/** A stored day as its field shows it: `10/02/2026` in Portuguese, `Feb 10, 2026` in English. */
export function formatDayInput(language: Language, iso: string): string {
  if (iso === '') return '';
  if (!isStoredDay(iso)) return iso;
  if (language === 'en') return formatDayShort(language, iso);
  const moment = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat(language, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(moment);
}

/** Lower case, accents off, dots off: "Março." and "marco" are the same word to a reader. */
function fold(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').replace(/\./g, '').toLowerCase();
}

const MONTHS = new Map<Language, ReadonlyArray<{ long: string; short: string }>>();

/** The twelve months in a language, long and short, folded — from the platform. */
function monthsOf(language: Language): ReadonlyArray<{ long: string; short: string }> {
  const known = MONTHS.get(language);
  if (known !== undefined) return known;
  const long = new Intl.DateTimeFormat(language, { month: 'long', timeZone: 'UTC' });
  const short = new Intl.DateTimeFormat(language, { month: 'short', timeZone: 'UTC' });
  const months = Array.from({ length: 12 }, (_, index) => {
    const moment = new Date(Date.UTC(2024, index, 15));
    return { long: fold(long.format(moment)), short: fold(short.format(moment)) };
  });
  MONTHS.set(language, months);
  return months;
}

/**
 * The month a word names, 1 to 12, or `null`. A word of three letters or more that starts the
 * month's long name is that month — "fev", "feve", "sept" — so a person does not have to know
 * which abbreviation the platform prefers.
 */
function monthOf(language: Language, word: string): number | null {
  const folded = fold(word);
  if (folded.length < 3) return null;
  const found = monthsOf(language)
    .map((month, index) => ({ month, index }))
    .filter(({ month }) => month.short === folded || month.long.startsWith(folded));
  return found.length === 1 ? (found[0]?.index ?? 0) + 1 : null;
}

/**
 * Words a day is written with that say nothing about which day: "10 de fevereiro de 2026",
 * "the 10th of February". Not shown to anybody; read past.
 */
const FILLER = new Set(['de', 'do', 'of', 'the', 'st', 'nd', 'rd', 'th']);

const day = (iso: string | null): DayReading =>
  iso === null ? { kind: 'not-a-day' } : { kind: 'day', iso };

/** Three numbers, year first: the order nobody reads two ways, in either language. */
function yearFirst(parts: readonly string[]): DayReading {
  const [year = '', month = '', date = ''] = parts;
  if (month.length > 2 || date.length > 2) return { kind: 'not-a-day' };
  return day(isoOf(Number(year), Number(month), Number(date)));
}

/** A text with no month word: digits, and whatever separated them. */
function readDigits(language: Language, numbers: readonly string[]): DayReading {
  const [first = ''] = numbers;
  if (numbers.length === 1) {
    if (first.length < 8) return { kind: 'partial' };
    if (first.length > 8) return { kind: 'not-a-day' };
    // Eight digits with nothing between them: the language's own order, year last in Portuguese.
    return language === 'en'
      ? yearFirst([first.slice(0, 4), first.slice(4, 6), first.slice(6)])
      : day(isoOf(Number(first.slice(4)), Number(first.slice(2, 4)), Number(first.slice(0, 2))));
  }
  if (first.length === 4) {
    if (numbers.length === 2) return { kind: 'partial' };
    if (numbers.length > 3) return { kind: 'not-a-day' };
    return yearFirst(numbers);
  }
  // Day and month in digits: Portuguese reads them day first; English cannot say which is which.
  if (language === 'en') return { kind: 'month-as-word' };
  if (numbers.length > 3) return { kind: 'not-a-day' };
  if (numbers.length === 2) return { kind: 'partial' };
  const [date = '', month = '', year = ''] = numbers;
  if (date.length > 2 || month.length > 2 || year.length > 4) return { kind: 'not-a-day' };
  if (year.length < 4) return { kind: 'partial' };
  return day(isoOf(Number(year), Number(month), Number(date)));
}

/** A text with a month word: the day and the year are the numbers, in either order. */
function readWithMonth(month: number, numbers: readonly string[]): DayReading {
  if (numbers.length > 2) return { kind: 'not-a-day' };
  if (numbers.length < 2) {
    return numbers.some((number) => number.length > 4)
      ? { kind: 'not-a-day' }
      : { kind: 'partial' };
  }
  const yearAt = numbers.findIndex((number) => number.length === 4);
  if (yearAt === -1) {
    // "10 Feb 20": the year is still being typed.
    return numbers.every((number) => number.length <= 3)
      ? { kind: 'partial' }
      : { kind: 'not-a-day' };
  }
  const date = numbers[1 - yearAt] ?? '';
  if (date.length > 2) return { kind: 'not-a-day' };
  return day(isoOf(Number(numbers[yearAt]), month, Number(date)));
}

/**
 * What a person typed into a date field, read in the product's language.
 *
 * Forgiving where it can be and strict where a guess would be dangerous: digits with or without
 * separators, a month as a word or an abbreviation in either order, and the stored form
 * `YYYY-MM-DD` in both languages — the year first is never ambiguous. A year is four digits: "26"
 * is a year still being typed, not 2026 guessed at.
 */
export function readDayInput(language: Language, text: string): DayReading {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  const tokens = trimmed.match(/\p{N}+|\p{L}+/gu) ?? [];
  if (tokens.length === 0) return { kind: 'not-a-day' };

  const numbers: string[] = [];
  const months: number[] = [];
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      numbers.push(token);
      continue;
    }
    if (/^\p{N}+$/u.test(token)) return { kind: 'not-a-day' };
    if (FILLER.has(fold(token))) continue;
    const month = monthOf(language, token);
    if (month === null) return { kind: 'not-a-day' };
    months.push(month);
  }

  if (months.length > 1) return { kind: 'not-a-day' };
  const [month] = months;
  if (month !== undefined) return readWithMonth(month, numbers);
  if (numbers.length === 0) return { kind: 'partial' };
  return readDigits(language, numbers);
}

/** The text a field holds once it stands for a stored day: the stored form is never left showing. */
export function isMachineDay(text: string): boolean {
  return ISO.test(text.trim());
}
