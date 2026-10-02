import { describe, expect, it } from 'vitest';

import {
  currencyLabel,
  formatDay,
  formatDayColumn,
  formatDayWeekday,
  formatMoney,
  formatNumber,
  fromCents,
  toCents,
  weekdayNames,
  workingDaysList,
} from './format';

/**
 * The platform's words, in the person's language: dates, numbers, weekdays and currencies come
 * from `Intl`, never from the tables and never from a component.
 */
describe('formatting through Intl', () => {
  it('reads a day as a calendar day, never shifted by a time zone', () => {
    expect(formatDay('en', '2026-09-25')).toBe('September 25, 2026');
    expect(formatDay('pt-BR', '2026-09-25')).toBe('25 de setembro de 2026');
  });

  it('says a day of the next two weeks with its weekday, and no year (D4)', () => {
    expect(formatDayWeekday('en', '2026-10-05')).toBe('Monday, Oct 5');
    expect(formatDayWeekday('pt-BR', '2026-10-05')).toBe('segunda-feira, 5 de out.');
    expect(formatDayColumn('en', '2026-10-05')).toContain('Mon');
    expect(formatDayColumn('pt-BR', '2026-10-05')).toContain('seg');
    expect(formatDayWeekday('en', 'not a day')).toBe('not a day');
  });

  it('shows a value that is not a day as it is, rather than "Invalid Date"', () => {
    expect(formatDay('en', 'not a day')).toBe('not a day');
  });

  it('writes numbers with the decimal mark of the language', () => {
    expect(formatNumber('en', 7.5)).toBe('7.5');
    expect(formatNumber('pt-BR', 7.5)).toBe('7,5');
    expect(formatNumber('pt-BR', 1234)).toBe('1.234');
  });

  it('names the week Monday first, the order the mask is stored in', () => {
    expect(weekdayNames('en', 'long')[0]).toBe('Monday');
    expect(weekdayNames('en', 'long')[6]).toBe('Sunday');
    expect(weekdayNames('pt-BR', 'long')[0]).toBe('segunda-feira');
  });

  it('lists the working days of a mask', () => {
    const weekdays = [true, true, true, true, true, false, false];
    expect(workingDaysList('en', weekdays)).toBe('Mon, Tue, Wed, Thu, Fri');
    expect(workingDaysList('en', [false, false, false, false, false, true, false])).toBe('Sat');
  });

  it('names a currency in the language, beside its code', () => {
    expect(currencyLabel('en', 'BRL')).toBe('BRL — Brazilian Real');
    expect(currencyLabel('pt-BR', 'BRL')).toBe('BRL — Real brasileiro');
  });

  it('writes money in the work’s currency, the way the language writes it', () => {
    expect(formatMoney('en', 100000, 'USD')).toBe('$1,000.00');
    expect(formatMoney('pt-BR', 100000, 'USD').replace(/\u00a0/g, ' ')).toBe('US$ 1.000,00');
    expect(formatMoney('pt-BR', -50000, 'BRL').replace(/\u00a0/g, ' ')).toBe('-R$ 500,00');
  });

  it('reads an amount typed in major units as whole cents, never as a float', () => {
    expect(toCents('1200')).toBe(120000);
    expect(toCents('1200.5')).toBe(120050);
    expect(toCents('1200.50')).toBe(120050);
    expect(toCents('0.1')).toBe(10);
    expect(toCents(' 7 ')).toBe(700);
  });

  it('refuses what is not an amount', () => {
    for (const text of ['', 'abc', '-5', '1.234', '1,5', '1e3', '.5']) {
      expect(toCents(text), text).toBeNull();
    }
  });

  it('writes cents back as the text a number field holds', () => {
    expect(fromCents(120000)).toBe('1200.00');
    expect(fromCents(5)).toBe('0.05');
    expect(fromCents(-70000)).toBe('-700.00');
  });
});
