// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavigationContext, type Navigation } from '@/app/navigation';
import { BUILT_IN_SETTINGS } from '@/data/commands';
import { keys } from '@/data/queries';
import { person, snag, snagClosure, snapshot, stage } from '@/domain/__fixtures__/plan';
import type { WorkSnapshot } from '@/domain/plan';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { SnagsCard } from './SnagsCard';

/**
 * The dashboard's Still to fix card (slice E4): hidden while no snag has ever been raised; then the
 * open snags and those past their day as figures that open onto their snags, the open ones by who
 * must fix them, what is open and on whom in a sentence, and the way to the Plan's Snags tab — in
 * both languages. With nothing open it stays, and says how every snag was closed.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const TODAY = '2026-09-30';

const BASE = snapshot({
  people: [person('p1', 'Sample tiler')],
  stages: [stage('s1', 1, 'Finishes')],
});

const WITH_SNAGS: WorkSnapshot = {
  ...BASE,
  snags: [
    snag('n1', 1, 's1', { title: 'Cracked tile', personId: 'p1', dueOn: '2026-09-25' }),
    snag('n2', 2, 's1', { title: 'Door sticks', personId: 'p1' }),
    snag('n3', 3, 's1', { title: 'Socket loose' }),
    snag('n4', 4, 's1', { title: 'Paint drip', closure: snagClosure('fixed', '2026-09-22') }),
  ],
};

const ALL_CLOSED: WorkSnapshot = {
  ...BASE,
  snags: [
    snag('n1', 1, 's1', { closure: snagClosure('fixed', '2026-09-22') }),
    snag('n2', 2, 's1', { closure: snagClosure('withdrawn', '2026-09-22') }),
  ],
};

const openSnags = vi.fn();
const NAVIGATION: Navigation = {
  openDocuments: () => undefined,
  openDiary: () => undefined,
  openPlan: () => undefined,
  openPaymentPlan: () => undefined,
  openSnapshot: () => undefined,
  openBackup: () => undefined,
  openSchedule: () => undefined,
  openChanges: () => undefined,
  openSnags,
};

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(of: WorkSnapshot, language: Language) {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens: 'owner' });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <NavigationContext.Provider value={NAVIGATION}>
            <SnagsCard snapshot={of} today={TODAY} />
          </NavigationContext.Provider>
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

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(null);
  openSnags.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
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
    title: 'Still to fix',
    open: 'Snags still to fix',
    sentence: '3 snags are still to fix. 1 of them is past its day.',
    on: 'On whom: Sample tiler (2), nobody named (1).',
    person: 'On Sample tiler',
    closed: 'Every snag raised is closed — fixed: 1; withdrawn: 1.',
  },
  'pt-BR': {
    title: 'Falta resolver',
    open: 'Pendências por resolver',
    sentence: '3 pendências faltam resolver. 1 delas está vencida.',
    on: 'Com quem: Sample tiler (2), ninguém indicado (1).',
    person: 'Com Sample tiler',
    closed: 'Toda pendência anotada está fechada — resolvidas: 1; retiradas: 1.',
  },
} as const;

describe.each(['en', 'pt-BR'] as const)('the Still to fix card, in %s', (language) => {
  const words = WORDS[language];

  it('is not shown while no snag has ever been raised', () => {
    render(BASE, language);
    expect(host.querySelector('[data-testid="dashboard-snags"]')).toBeNull();
  });

  it('shows what is open and past its day as figures that open onto their snags, and on whom', () => {
    render(WITH_SNAGS, language);
    const card = find('dashboard-snags');
    expect(card.textContent).toContain(words.title);
    expect(card.textContent).toContain(words.open);
    expect(find('snags-open-value').textContent).toBe('3');
    expect(find('snags-overdue-value').textContent).toBe('1');

    act(() => find('snags-overdue-value').click());
    const rows = [...host.querySelectorAll('[data-testid="snags-overdue-row"]')];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Cracked tile');

    expect(find('snags-by-person').textContent).toContain(words.person);
    const sentence = find('snags-sentence').textContent ?? '';
    expect(sentence).toContain(words.sentence);
    expect(sentence).toContain(words.on);

    act(() => find('dashboard-snags-open').click());
    expect(openSnags).toHaveBeenCalledTimes(1);
  });

  it('stays once a snag was raised, and says how every one was closed', () => {
    render(ALL_CLOSED, language);
    expect(find('snags-open-value').textContent).toBe('0');
    expect(find('snags-sentence').textContent).toBe(words.closed);
  });
});
