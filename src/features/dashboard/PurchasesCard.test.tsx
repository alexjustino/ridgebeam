// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavigationContext, type Navigation } from '@/app/navigation';
import { BUILT_IN_SETTINGS } from '@/data/commands';
import { keys } from '@/data/queries';
import {
  activity,
  link,
  purchase,
  purchaseEvent,
  snapshot,
  stage,
} from '@/domain/__fixtures__/plan';
import type { WorkSnapshot } from '@/domain/plan';
import { schedule } from '@/domain/schedule';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { PurchasesCard } from './PurchasesCard';

/**
 * The dashboard's To order this week card (slice G2): hidden while the work has no purchase; then
 * what to order this week, what is late to order and what is late to arrive as figures that open onto
 * their purchases, the same in one sentence, and the way to the Plan's Purchases tab — in both
 * languages.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

// Tuesday 1 September 2026: a1 1–7 September, b1 8–11; this week runs to Sunday the 6th.
const TODAY = '2026-09-01';

const PLAN = snapshot({
  stages: [stage('s1', 1, 'Kitchen'), stage('s2', 2, 'Finishes')],
  activities: [
    { ...activity('a1', 's1', 1, 5), name: 'Strip out' },
    { ...activity('b1', 's2', 1, 4), name: 'Lay the tiles' },
  ],
  dependencies: [link('l1', 'a1', 'b1')],
});

const WITH_PURCHASES: WorkSnapshot = {
  ...PLAN,
  purchases: [
    // Needed on the 8th: 21 days — late to order since 18 August.
    purchase('p1', 1, 's2', 21, { name: 'Worktop' }),
    // Needed on the 8th: 3 days — order by the 5th, this week.
    purchase('p2', 2, 's2', 3, { name: 'Grout' }),
    // Needed on the 8th: 1 day — order by the 7th, next week.
    purchase('p3', 3, 's2', 1, { name: 'Spacers' }),
    // Ordered on 20 August, 5 days: expected on the 25th.
    purchase('p4', 4, 's1', 5, {
      name: 'Hinges',
      events: [purchaseEvent(1, 'ordered', '2026-08-20')],
    }),
  ],
};

const openPurchases = vi.fn();
const NAVIGATION: Navigation = {
  openDocuments: () => undefined,
  openDiary: () => undefined,
  openPlan: () => undefined,
  openPaymentPlan: () => undefined,
  openSnapshot: () => undefined,
  openBackup: () => undefined,
  openSchedule: () => undefined,
  openChanges: () => undefined,
  openSnags: () => undefined,
  openPurchases,
  openMeeting: () => undefined,
  openMinutes: () => undefined,
};

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(of: WorkSnapshot, language: Language) {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens: 'owner' });
  client.setQueryData(keys.diary, []);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <NavigationContext.Provider value={NAVIGATION}>
            <PurchasesCard snapshot={of} scheduled={schedule(of)} today={TODAY} />
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
  invoke.mockImplementation((command: string) =>
    Promise.resolve(command === 'diary_list' ? [] : null),
  );
  openPurchases.mockReset();
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
    title: 'To order this week',
    sentence:
      '2 purchases to order this week. 1 of them is late to order. 1 ordered purchase is late to arrive.',
    row: /^Worktop — For Lay the tiles — Finishes — Order by: August 18, 2026 — 14 days late — Late to order$/,
  },
  'pt-BR': {
    title: 'Encomendar esta semana',
    sentence:
      '2 compras a encomendar esta semana. 1 delas está atrasada para encomendar. 1 compra encomendada está atrasada para chegar.',
    row: /^Worktop — Para Lay the tiles — Finishes — Encomendar até: 18 de agosto de 2026 — 14 dias de atraso — Atrasado para encomendar$/,
  },
} as const;

describe.each(['en', 'pt-BR'] as const)('the To order this week card, in %s', (language) => {
  const words = WORDS[language];

  it('is not shown while the work has no purchase', () => {
    render(PLAN, language);
    expect(host.querySelector('[data-testid="dashboard-purchases"]')).toBeNull();
  });

  it('shows the three figures, the sentence, and opens onto the purchases', () => {
    render(WITH_PURCHASES, language);
    expect(find('dashboard-purchases').textContent).toContain(words.title);
    expect(find('purchases-week-value').textContent).toBe('2');
    expect(find('purchases-late-value').textContent).toBe('1');
    expect(find('purchases-arriving-late-value').textContent).toBe('1');
    expect(find('purchases-sentence').textContent).toBe(words.sentence);

    act(() => find('purchases-late-value').click());
    const rows = [...find('purchases-late').querySelectorAll('li')];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toMatch(words.row);
  });

  it('leads to the Plan’s Purchases tab', () => {
    render(WITH_PURCHASES, language);
    act(() => find('dashboard-purchases-open').click());
    expect(openPurchases).toHaveBeenCalledTimes(1);
  });
});
