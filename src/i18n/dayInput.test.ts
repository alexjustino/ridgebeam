import { describe, expect, it } from 'vitest';

import { formatDayInput, isStoredDay, readDayInput } from './dayInput';

/**
 * A day in a date field is the product's language's, never the webview's: `10/02/2026` is the 10th
 * of February in Portuguese, and English, where those digits are read two ways, takes the month as
 * a word. The stored form is the same in both, and read in both.
 */

const day = (iso: string) => ({ kind: 'day', iso });

describe('formatDayInput', () => {
  it('shows a day as the language writes it, day first in Portuguese, the month as a word in English', () => {
    expect(formatDayInput('pt-BR', '2026-02-10')).toBe('10/02/2026');
    expect(formatDayInput('en', '2026-02-10')).toBe('Feb 10, 2026');
  });

  it('shows nothing for no day, and leaves what is not a stored day as it is', () => {
    expect(formatDayInput('pt-BR', '')).toBe('');
    expect(formatDayInput('en', 'soon')).toBe('soon');
  });
});

describe('readDayInput in Portuguese', () => {
  const read = (text: string) => readDayInput('pt-BR', text);

  it('reads DD/MM/AAAA, with any separator or none', () => {
    for (const text of ['10/02/2026', '10-02-2026', '10.02.2026', '10 02 2026', '10022026']) {
      expect(read(text), text).toEqual(day('2026-02-10'));
    }
    expect(read('1/2/2026')).toEqual(day('2026-02-01'));
  });

  it('reads the month as a word, abbreviated or whole, accents or none', () => {
    expect(read('10 fev 2026')).toEqual(day('2026-02-10'));
    expect(read('10 de fevereiro de 2026')).toEqual(day('2026-02-10'));
    expect(read('5 de março de 2026')).toEqual(day('2026-03-05'));
    expect(read('5 marco 2026')).toEqual(day('2026-03-05'));
  });

  it('reads the stored form too, the year first', () => {
    expect(read('2026-02-10')).toEqual(day('2026-02-10'));
  });

  it('reads back exactly what it shows', () => {
    expect(read(formatDayInput('pt-BR', '2026-12-31'))).toEqual(day('2026-12-31'));
  });

  it('calls a day still being typed partial, a two-digit year included', () => {
    for (const text of ['1', '10/', '10/02', '10/02/20', '100220', '10 fev']) {
      expect(read(text).kind, text).toBe('partial');
    }
  });

  it('refuses what is not a day on the calendar', () => {
    for (const text of ['31/02/2026', '10/13/2026', 'amanhã', '10/02/2026/1', '100/02/2026']) {
      expect(read(text).kind, text).toBe('not-a-day');
    }
  });

  it('calls empty text no day', () => {
    expect(read('  ').kind).toBe('empty');
  });
});

describe('readDayInput in English', () => {
  const read = (text: string) => readDayInput('en', text);

  it('reads the month as a word in either order', () => {
    for (const text of ['Feb 10, 2026', 'feb 10 2026', '10 Feb 2026', 'February 10th, 2026']) {
      expect(read(text), text).toEqual(day('2026-02-10'));
    }
    expect(read('Sept 3 2026')).toEqual(day('2026-09-03'));
  });

  it('reads the year first in figures, with or without separators', () => {
    for (const text of ['2026-02-10', '2026/02/10', '2026.2.10', '20260210']) {
      expect(read(text), text).toEqual(day('2026-02-10'));
    }
  });

  it('reads back exactly what it shows', () => {
    expect(read(formatDayInput('en', '2026-12-31'))).toEqual(day('2026-12-31'));
  });

  it('refuses a day and a month in figures alone: they are read two ways', () => {
    for (const text of ['10/02/2026', '02/10/2026', '13/02/2026', '10-02']) {
      expect(read(text).kind, text).toBe('month-as-word');
    }
  });

  it('calls a day still being typed partial, and refuses one that is not on the calendar', () => {
    for (const text of ['Feb', 'Feb 10', 'Feb 10, 20', '2026-02']) {
      expect(read(text).kind, text).toBe('partial');
    }
    for (const text of ['Feb 30, 2026', 'Smarch 10, 2026', 'Feb Mar 10 2026']) {
      expect(read(text).kind, text).toBe('not-a-day');
    }
  });
});

describe('isStoredDay', () => {
  it('is the stored form of a real day, and nothing else', () => {
    expect(isStoredDay('2026-02-10')).toBe(true);
    expect(isStoredDay('2026-02-30')).toBe(false);
    expect(isStoredDay('10/02/2026')).toBe(false);
    expect(isStoredDay('')).toBe(false);
  });
});
