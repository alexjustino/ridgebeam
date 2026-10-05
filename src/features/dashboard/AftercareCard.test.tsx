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
  maintenanceDone,
  maintenanceTask,
  snapshot,
  stage,
  warranty,
} from '@/domain/__fixtures__/plan';
import type { WorkSnapshot } from '@/domain/plan';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { AftercareCard } from './AftercareCard';
import { DashboardPage } from './DashboardPage';

/**
 * The dashboard's After the handover card (slice G4, decision 3), in both languages: hidden while
 * the work has no warranty and no task; then what is overdue, due in the next 30 days and ending in
 * the next 90 as figures that open onto their rows, with the day and how far it is in words; the way
 * to the calendar; and its place on the front door — first once every stage is closed, after the
 * readiness while the work is open.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = '2026-10-05';
vi.mock('@/app/today', () => ({ today: () => TODAY, useToday: () => TODAY }));

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }));

const OPEN = snapshot({
  work: { ...snapshot().work, workId: 'w1', name: 'Sample bathroom' },
  stages: [{ ...stage('s1', 1, 'Bathroom'), startedAt: '2026-09-01T09:00:00.000Z' }],
  activities: [{ ...activity('a1', 's1', 1, 2), name: 'Tile the walls' }],
});

const WITH_AFTERCARE: WorkSnapshot = {
  ...OPEN,
  warranties: [
    // Ends on 5 November 2026: in 31 days.
    warranty('w-valve', 1, '2024-11-05', 24, { title: 'Shower valve', targetId: 'w1' }),
    // Ends in 2030: active, not ending soon.
    warranty('w-roof', 2, '2026-01-10', 48, { title: 'Roof membrane', targetId: 'w1' }),
  ],
  maintenance: [
    // First due on 2 October: three days overdue.
    maintenanceTask('t-seal', 1, 12, '2026-10-02', { title: 'Reseal the shower', targetId: 'w1' }),
    // Done on 20 April, every 6 months: due on 20 October, in 15 days.
    maintenanceTask('t-gutter', 2, 6, '2026-01-01', {
      title: 'Clean the gutters',
      targetId: 'w1',
      done: [maintenanceDone(1, '2026-04-20')],
    }),
  ],
};

const FINISHED: WorkSnapshot = {
  ...WITH_AFTERCARE,
  stages: WITH_AFTERCARE.stages.map((each) => ({
    ...each,
    closedAt: '2026-09-25T17:00:00.000Z',
  })),
};

const openAftercare = vi.fn();
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
  openPurchases: () => undefined,
  openAftercare,
  openMeeting: () => undefined,
  openMinutes: () => undefined,
};

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(of: WorkSnapshot, language: Language, page: 'card' | 'dashboard' = 'card') {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens: 'owner' });
  client.setQueryData(keys.diary, []);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <NavigationContext.Provider value={NAVIGATION}>
            {page === 'card' ? (
              <AftercareCard snapshot={of} today={TODAY} />
            ) : (
              <DashboardPage
                snapshot={of}
                onClose={() => undefined}
                closing={false}
                closeError={null}
              />
            )}
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

/** Whether `a` comes before `b` in the page. */
const before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string) =>
    Promise.resolve(command === 'diary_list' ? [] : null),
  );
  openAftercare.mockReset();
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
    title: 'After the handover',
    overdueRow:
      'Reseal the shower — The whole work — First due on October 2, 2026 — 3 days overdue',
    endingRow: 'Shower valve — The whole work — Ends on November 5, 2026 — in 31 days',
  },
  'pt-BR': {
    title: 'Depois da entrega',
    overdueRow:
      'Reseal the shower — A obra toda — Vence pela primeira vez em 2 de outubro de 2026 — atrasada há 3 dias',
    endingRow: 'Shower valve — A obra toda — Termina em 5 de novembro de 2026 — daqui a 31 dias',
  },
} as const;

describe.each(['en', 'pt-BR'] as const)('the After the handover card, in %s', (language) => {
  const words = WORDS[language];

  it('is not shown while the work has no warranty and no task', () => {
    render(OPEN, language);
    expect(host.querySelector('[data-testid="dashboard-aftercare"]')).toBeNull();
  });

  it('shows what is overdue, due soon and ending soon, each opening onto its rows', () => {
    render(WITH_AFTERCARE, language);
    expect(find('dashboard-aftercare').textContent).toContain(words.title);
    expect(find('aftercare-overdue-value').textContent).toBe('1');
    expect(find('aftercare-soon-value').textContent).toBe('1');
    expect(find('aftercare-ending-value').textContent).toBe('1');

    act(() => find('aftercare-overdue-value').click());
    const overdue = [...find('aftercare-overdue').querySelectorAll('li')];
    expect(overdue.map((row) => row.textContent)).toEqual([words.overdueRow]);

    act(() => find('aftercare-ending-value').click());
    const ending = [...find('aftercare-ending').querySelectorAll('li')];
    expect(ending.map((row) => row.textContent)).toEqual([words.endingRow]);
  });

  it('leads to the calendar on the Handover tab', () => {
    render(WITH_AFTERCARE, language);
    act(() => find('dashboard-aftercare-open').click());
    expect(openAftercare).toHaveBeenCalledTimes(1);
  });
});

describe('its place on the dashboard', () => {
  it('is the first card once every stage is closed', () => {
    render(FINISHED, 'en', 'dashboard');
    const card = find('dashboard-aftercare');
    expect(before(card, find('readiness-sentence'))).toBe(true);
    // Nothing that is a card comes before it.
    const sections = [...host.querySelectorAll('section')];
    expect(sections[0]?.closest('[data-testid="dashboard-aftercare"]')).toBe(card);
  });

  it('sits after the readiness while the work is open', () => {
    render(WITH_AFTERCARE, 'en', 'dashboard');
    expect(before(find('readiness-sentence'), find('dashboard-aftercare'))).toBe(true);
  });
});
