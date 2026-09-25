import { describe, expect, it } from 'vitest';

import { currencyLabel, formatDay, formatNumber, weekdayNames, workingDaysList } from './format';

/**
 * The platform's words, in the person's language: dates, numbers, weekdays and currencies come
 * from `Intl`, never from the tables and never from a component.
 */
describe('formatting through Intl', () => {
  it('reads a day as a calendar day, never shifted by a time zone', () => {
    expect(formatDay('en', '2026-09-25')).toBe('September 25, 2026');
    expect(formatDay('pt-BR', '2026-09-25')).toBe('25 de setembro de 2026');
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
});
