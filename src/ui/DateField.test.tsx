// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { DateField, type DateFieldProps } from './DateField';

/**
 * A date field shows and reads a day in the product's language — `10/02/2026` in Portuguese, `Feb
 * 10, 2026` in English — whatever the webview's own locale, and hands its caller the stored form,
 * `YYYY-MM-DD`, exactly as the native field did. The end-to-end suite still sets it the way it
 * always has: the native value setter with the stored form, then an `input` event.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

interface Seen {
  changes: string[];
}

function mount(
  language: Language,
  initial = '',
  props: Partial<DateFieldProps> = {},
): Seen & { setOutside: (value: string) => void } {
  const seen: Seen = { changes: [] };
  let setOutside: (value: string) => void = () => undefined;
  function Harness() {
    const [value, setValue] = useState(initial);
    setOutside = setValue;
    return (
      <I18nContext.Provider value={build(language, language)}>
        <DateField
          label="day"
          data-testid="entry-day"
          value={value}
          onChange={(next) => {
            seen.changes.push(next);
            setValue(next);
          }}
          {...props}
        />
      </I18nContext.Provider>
    );
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<Harness />));
  return {
    ...seen,
    get changes() {
      return seen.changes;
    },
    setOutside: (value) => act(() => setOutside(value)),
  };
}

function field(): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>('[data-testid="entry-day"]');
  if (found === null) throw new Error('no field');
  return found;
}

/** Exactly what `setValue` in `e2e/*.e2e.ts` does: the native setter, then `input`. */
function setValueLikeE2e(element: HTMLElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The d1 suite's variant also blurs the field afterwards. */
function leave(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

const describedBy = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '');

const problem = () => document.querySelector('[data-testid="entry-day-problem"]');

describe('DateField in Portuguese', () => {
  it('shows the stored day as DD/MM/AAAA, and says the form in its description', () => {
    mount('pt-BR', '2026-02-10');
    expect(field().value).toBe('10/02/2026');
    expect(field().placeholder).toBe('DD/MM/AAAA');
    expect(describedBy(field()).join(' ')).toContain('DD/MM/AAAA');
    expect(document.querySelector('label')?.htmlFor).toBe(field().id);
  });

  it('takes the stored form set the way the end-to-end suite sets it, and shows it day first', () => {
    const seen = mount('pt-BR');
    setValueLikeE2e(field(), '2026-02-10');
    expect(seen.changes).toEqual(['2026-02-10']);
    expect(field().value).toBe('10/02/2026');
    expect(field().dataset.day).toBe('2026-02-10');
    leave(field());
    expect(field().value).toBe('10/02/2026');
    expect(problem()).toBeNull();
  });

  it('reads digits typed with no separators, and tidies them when the field is left', () => {
    const seen = mount('pt-BR');
    setValueLikeE2e(field(), '10022026');
    expect(seen.changes).toEqual(['2026-02-10']);
    expect(field().value).toBe('10022026');
    leave(field());
    expect(field().value).toBe('10/02/2026');
  });

  it('gives no day for text that is not one yet, and says so once the field is left', () => {
    const seen = mount('pt-BR', '2026-02-10');
    setValueLikeE2e(field(), '10/02/20');
    expect(seen.changes).toEqual(['']);
    expect(field().value).toBe('10/02/20');
    expect(problem()).toBeNull();
    leave(field());
    expect(problem()?.textContent).toContain('Digite o dia, o mês e o ano');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(field()).join(' ')).toContain('Digite o dia, o mês e o ano');
    // Finishing the year takes the problem away at once.
    setValueLikeE2e(field(), '10/02/2026');
    expect(seen.changes).toEqual(['', '2026-02-10']);
    expect(problem()).toBeNull();
  });

  it('names a day that is not on the calendar', () => {
    mount('pt-BR');
    setValueLikeE2e(field(), '31/02/2026');
    leave(field());
    expect(problem()?.textContent).toContain('“31/02/2026” não é um dia do calendário.');
  });

  it('follows a value the caller changes, and clears with it', () => {
    const seen = mount('pt-BR', '2026-02-10');
    seen.setOutside('2026-12-25');
    expect(field().value).toBe('25/12/2026');
    seen.setOutside('');
    expect(field().value).toBe('');
  });
});

describe('DateField in English', () => {
  it('shows the stored day with the month as a word', () => {
    mount('en', '2026-02-10');
    expect(field().value).toBe('Feb 10, 2026');
    expect(field().placeholder).toBe('MMM D, YYYY');
    expect(describedBy(field()).join(' ')).toContain('Feb 10, 2026');
  });

  it('takes the stored form set the way the end-to-end suite sets it', () => {
    const seen = mount('en');
    setValueLikeE2e(field(), '2026-02-10');
    expect(seen.changes).toEqual(['2026-02-10']);
    expect(field().value).toBe('Feb 10, 2026');
  });

  it('reads the month typed as a word, either way round', () => {
    const seen = mount('en');
    setValueLikeE2e(field(), '10 feb 2026');
    leave(field());
    expect(seen.changes).toEqual(['2026-02-10']);
    expect(field().value).toBe('Feb 10, 2026');
  });

  it('refuses a day and a month in figures alone, and says why', () => {
    const seen = mount('en');
    setValueLikeE2e(field(), '10/02/2026');
    leave(field());
    expect(seen.changes).toEqual([]);
    expect(problem()?.textContent).toContain('Write the month as a word');
  });
});

describe('DateField, when the language changes', () => {
  it('shows the same day in the new language', () => {
    function Switcher({ language, value }: { language: Language; value: string }) {
      return (
        <I18nContext.Provider value={build(language, language)}>
          <DateField
            data-testid="entry-day"
            aria-label="day"
            value={value}
            onChange={() => undefined}
          />
        </I18nContext.Provider>
      );
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(<Switcher language="pt-BR" value="2026-02-10" />));
    expect(field().value).toBe('10/02/2026');
    act(() => root?.render(<Switcher language="en" value="2026-02-10" />));
    expect(field().value).toBe('Feb 10, 2026');
    expect(field().placeholder).toBe('MMM D, YYYY');
  });
});

describe('DateField, its calendar', () => {
  const opener = () => {
    const found = document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    if (found === null) throw new Error('no calendar button');
    return found;
  };
  const calendar = () => document.querySelector('[data-testid="date-field-calendar"]');
  const focusedDay = () => (document.activeElement as HTMLElement | null)?.dataset.day;

  it('opens on the chosen day, moves by the arrows, and chooses with Enter', () => {
    const seen = mount('pt-BR', '2026-02-10');
    act(() => opener().click());
    expect(calendar()?.getAttribute('role')).toBe('dialog');
    expect(focusedDay()).toBe('2026-02-10');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('10 de fevereiro de 2026');
    press('ArrowRight');
    expect(focusedDay()).toBe('2026-02-11');
    press('ArrowDown');
    expect(focusedDay()).toBe('2026-02-18');
    press('ArrowUp');
    press('ArrowLeft');
    press('ArrowLeft');
    expect(focusedDay()).toBe('2026-02-09');
    press('PageDown');
    expect(focusedDay()).toBe('2026-03-09');
    press('Enter');
    expect(seen.changes).toEqual(['2026-03-09']);
    expect(field().value).toBe('09/03/2026');
    expect(calendar()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('opens with Alt+Down from the field', () => {
    mount('en', '2026-02-10');
    act(() => field().focus());
    press('ArrowDown', { altKey: true });
    expect(calendar()).not.toBeNull();
    expect(focusedDay()).toBe('2026-02-10');
  });

  it('closes on Escape without choosing, and the Escape goes no further', () => {
    const seen = mount('en', '2026-02-10');
    const outside = vi.fn();
    act(() => opener().click());
    press('ArrowRight');
    document.addEventListener('keydown', outside);
    press('Escape');
    document.removeEventListener('keydown', outside);
    expect(calendar()).toBeNull();
    expect(seen.changes).toEqual([]);
    expect(outside).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener());
  });

  it('offers no day past max: it can be reached, not chosen', () => {
    const seen = mount('en', '2026-02-10', { max: '2026-02-10' });
    act(() => opener().click());
    press('ArrowRight');
    expect(focusedDay()).toBe('2026-02-11');
    expect(document.activeElement?.getAttribute('aria-disabled')).toBe('true');
    press('Enter');
    expect(seen.changes).toEqual([]);
    expect(calendar()).not.toBeNull();
  });
});
