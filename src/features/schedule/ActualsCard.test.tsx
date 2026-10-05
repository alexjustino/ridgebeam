// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_SETTINGS } from '@/data/commands';
import { keys } from '@/data/queries';
import { activity, entry, finished, snapshot, stage, worked } from '@/domain/__fixtures__/plan';
import type { DiaryEntry } from '@/domain/diary';
import type { Activity, WorkSnapshot } from '@/domain/plan';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { ActualsCard } from './ActualsCard';

/**
 * The Schedule's Planned and actual card (slice G3): a row per activity that started, planned
 * beside actual with the difference in words and its unit; three figures that open onto their rows;
 * a sentence when nothing has started, and the reason when no day can be counted — in both
 * languages.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

// The work starts on Tuesday 1 September 2026, Monday to Friday. Today is Thursday the 17th.
const TODAY = '2026-09-17';

const ranged = (base: Activity, min: number, max: number): Activity => ({
  ...base,
  durationMinDays: min,
  durationMaxDays: max,
});

const PLAN = snapshot({
  stages: [stage('s1', 1, 'Joinery')],
  activities: [
    // 1–7 September: 5 working days against 3 planned, outside 2 to 4.
    ranged({ ...activity('a', 's1', 1, 3), name: 'Fit the cabinets' }, 2, 4),
    // 8–9 September: 2 against 2, inside 2 to 6.
    ranged({ ...activity('b', 's1', 2, 2), name: 'Hang the doors' }, 2, 6),
    // Started on the 14th, running: 4 so far against 1 planned.
    { ...activity('c', 's1', 3, 1), name: 'Fit the handles' },
    // No duration: 15–16 September, 2.
    { ...activity('d', 's1', 4, null), name: 'Seal the joints' },
    // Never started.
    { ...activity('e', 's1', 5, 2), name: 'Clean up' },
  ],
});

const DIARY: DiaryEntry[] = [
  entry(1, '2026-09-01', { done: [worked('a')] }),
  entry(2, '2026-09-07', { done: [finished('a')] }),
  entry(3, '2026-09-08', { done: [worked('b')] }),
  entry(4, '2026-09-09', { done: [finished('b')] }),
  entry(5, '2026-09-14', { done: [worked('c')] }),
  entry(6, '2026-09-15', { done: [worked('d')] }),
  entry(7, '2026-09-16', { done: [finished('d')] }),
];

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(of: WorkSnapshot, diary: DiaryEntry[], language: Language) {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens: 'owner' });
  client.setQueryData(keys.diary, diary);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <ActualsCard snapshot={of} today={TODAY} />
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

const find = (testId: string) => {
  const found = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`no ${testId}`);
  return found;
};

const row = (id: string) => {
  const found = host.querySelector<HTMLElement>(`[data-actual-id="${id}"]`);
  if (found === null) throw new Error(`no row ${id}`);
  return found;
};

/** A row's data attributes, read one by one (an empty value is still a value). */
const data = (id: string) => {
  const element = row(id);
  const read = (name: string) => element.getAttribute(`data-${name}`);
  return {
    state: read('state'),
    took: read('took'),
    soFar: read('so-far'),
    planned: read('planned'),
    difference: read('difference'),
    inRange: read('in-range'),
  };
};

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string) =>
    Promise.resolve(command === 'diary_list' ? DIARY : null),
  );
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const WORDS = {
  en: {
    title: 'Planned and actual',
    a: 'Planned 3 working days · took 5 — 2 more · outside the range it was given (2 to 4)',
    b: 'Planned 2 working days · took 2 — as planned · inside the range it was given (2 to 6)',
    c: 'Planned 1 working day · so far 4 — already 3 more than planned',
    d: 'No duration was planned · took 2',
    aDays: 'Started on September 1, 2026, finished on September 7, 2026',
    cDays: 'Started on September 14, 2026',
    empty: 'Nothing has started yet: the diary says when an activity starts and finishes.',
    noCalendar: 'No day can be counted',
  },
  'pt-BR': {
    title: 'Planejado e real',
    a: 'Planejado: 3 dias úteis · levou 5 — 2 a mais · fora da faixa que recebeu (2 a 4)',
    b: 'Planejado: 2 dias úteis · levou 2 — conforme o planejado · dentro da faixa que recebeu (2 a 6)',
    c: 'Planejado: 1 dia útil · até agora 4 — já 3 a mais do que o planejado',
    d: 'Nenhuma duração foi planejada · levou 2',
    aDays: 'Começou em 1 de setembro de 2026, terminou em 7 de setembro de 2026',
    cDays: 'Começou em 14 de setembro de 2026',
    empty: 'Nada começou ainda: o diário diz quando uma atividade começa e termina.',
    noCalendar: 'Nenhum dia pode ser contado',
  },
} as const;

describe.each(['en', 'pt-BR'] as const)('Planned and actual, in %s', (language) => {
  const words = WORDS[language];

  it('gives each activity that started a row, planned beside actual, in words with the unit', () => {
    render(PLAN, DIARY, language);
    expect(find('schedule-actuals').textContent).toContain(words.title);

    const rows = [...host.querySelectorAll<HTMLElement>('[data-actual-id]')];
    // Plan order, and never the activity that has not started.
    expect(rows.map((each) => each.dataset.actualId)).toEqual(['a', 'b', 'c', 'd']);

    expect(data('a')).toMatchObject({
      state: 'finished',
      took: '5',
      planned: '3',
      difference: '2',
      inRange: 'false',
      soFar: '',
    });
    expect(row('a').textContent).toContain(words.a);
    expect(row('a').textContent).toContain(words.aDays);

    expect(data('b')).toMatchObject({ took: '2', difference: '0', inRange: 'true' });
    expect(row('b').textContent).toContain(words.b);

    expect(data('c')).toMatchObject({
      state: 'started',
      took: '',
      soFar: '4',
      planned: '1',
      difference: '',
    });
    expect(row('c').textContent).toContain(words.c);
    expect(row('c').textContent).toContain(words.cDays);

    expect(data('d')).toMatchObject({ took: '2', planned: '', difference: '' });
    expect(row('d').textContent).toContain(words.d);
  });

  it('opens each figure onto its rows, in the same words', () => {
    render(PLAN, DIARY, language);
    expect(find('actuals-finished-value').textContent).toBe('3');
    expect(find('actuals-longer-value').textContent).toBe('1');
    expect(find('actuals-outside-value').textContent).toBe('1');

    act(() => find('actuals-longer-value').click());
    const longer = [
      ...find('actuals-longer').querySelectorAll('[data-testid="actuals-longer-row"]'),
    ];
    expect(longer.map((each) => each.textContent)).toEqual([`Fit the cabinets — ${words.a}`]);

    act(() => find('actuals-finished-value').click());
    const finishedRows = find('actuals-finished').querySelectorAll(
      '[data-testid="actuals-finished-row"]',
    );
    expect([...finishedRows].map((each) => each.textContent?.split(' — ')[0])).toEqual([
      'Fit the cabinets',
      'Hang the doors',
      'Seal the joints',
    ]);

    act(() => find('actuals-outside-value').click());
    expect(find('actuals-outside').textContent).toContain(words.a);
  });

  it('says that nothing has started, and where the answer comes from', () => {
    render(PLAN, [], language);
    expect(find('actuals-empty').textContent).toBe(words.empty);
    expect(host.querySelector('[data-actual-id]')).toBeNull();
    expect(host.querySelector('[data-testid="actuals-finished"]')).toBeNull();
  });

  it('says why no day is counted when the work has no calendar, and invents none', () => {
    render({ ...PLAN, calendar: { workingDays: '0000000', hoursPerDay: 8 } }, DIARY, language);
    expect(find('actuals-problem').dataset.problem).toBe('no-calendar');
    expect(find('actuals-problem').textContent).toContain(words.noCalendar);
    expect(data('a')).toMatchObject({ took: '', difference: '', state: 'finished' });
  });
});
