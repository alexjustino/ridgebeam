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
  changeDecision,
  changeOrder,
  person,
  snapshot,
  stage,
} from '@/domain/__fixtures__/plan';
import type { WorkSnapshot } from '@/domain/plan';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { ChangesCard } from './ChangesCard';

/**
 * The dashboard's Changes card (slice E1): hidden before the plan is approved; after, the approved
 * changes' money and working days and the count of those waiting, each a figure that opens onto its
 * changes, with the tally in words and who asked — in both languages.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const TODAY = '2026-09-30';

const BASE = snapshot({
  people: [person('p1', 'Sample electrician')],
  stages: [stage('s1', 1)],
  activities: [activity('a1', 's1', 1, 2)],
});

const APPROVED: WorkSnapshot = {
  ...BASE,
  work: { ...BASE.work, approvedAt: '2026-09-01T12:00:00.000Z' },
  changeOrders: [
    changeOrder('co1', 1, 's1', '2026-09-10', {
      title: 'Extra socket',
      costCents: 300_00,
      decision: changeDecision('approved', '2026-09-11', {
        finishBefore: '2026-09-02',
        finishAfter: '2026-09-04',
        daysDelta: 2,
        costCents: 300_00,
      }),
    }),
    changeOrder('co2', 2, 's1', '2026-09-12', {
      title: 'Bathtub',
      askedBy: 'person',
      askedByPersonId: 'p1',
      decision: changeDecision('declined', '2026-09-13'),
    }),
    changeOrder('co3', 3, 's1', '2026-09-20', { title: 'Niche in the shower' }),
  ],
};

const openChanges = vi.fn();
const NAVIGATION: Navigation = {
  openDocuments: () => undefined,
  openDiary: () => undefined,
  openPlan: () => undefined,
  openPaymentPlan: () => undefined,
  openSnapshot: () => undefined,
  openBackup: () => undefined,
  openSchedule: () => undefined,
  openChanges,
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
            <ChangesCard snapshot={of} today={TODAY} />
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
  openChanges.mockReset();
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
    days: '+2',
    tally: /1 change approved: R\$\s?300\.00 more and 2 working days later\./,
    you: 'you (2)',
    title: 'Changes',
  },
  'pt-BR': {
    days: '+2',
    tally: /1 aditivo aprovado: R\$\s?300,00 a mais e 2 dias úteis depois\./,
    you: 'você (2)',
    title: 'Aditivos',
  },
} as const;

describe.each(['en', 'pt-BR'] as const)('the Changes card, in %s', (language) => {
  const words = WORDS[language];

  it('is not shown before the plan is approved', () => {
    render(BASE, language);
    expect(host.querySelector('[data-testid="dashboard-changes"]')).toBeNull();
  });

  it('shows the tally as figures that open onto their changes, and says it in words', () => {
    render(APPROVED, language);
    const card = find('dashboard-changes');
    expect(card.textContent).toContain(words.title);
    expect(find('changes-cost-value').textContent).toMatch(/300/);
    expect(find('changes-days-value').textContent).toBe(words.days);
    expect(find('changes-waiting-value').textContent).toBe('1');

    act(() => find('changes-waiting-value').click());
    const rows = [...host.querySelectorAll('[data-testid="changes-waiting-row"]')];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Niche in the shower');

    const tally = find('changes-tally').textContent ?? '';
    expect(tally).toMatch(words.tally);
    // The owner asked for two of them, in the owner's words; the electrician for one.
    expect(tally).toContain(words.you);
    expect(tally).toContain('Sample electrician (1)');

    act(() => find('dashboard-changes-open').click());
    expect(openChanges).toHaveBeenCalledTimes(1);
  });
});
