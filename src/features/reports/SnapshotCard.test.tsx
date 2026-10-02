// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavigationContext, type Navigation } from '@/app/navigation';
import type { ReportDocument } from '@/data/commands';
import { activity, entry, person, snapshot, stage } from '@/domain/__fixtures__/plan';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { LANGUAGES, type Language } from '@/i18n/index';
import { termFor } from '@/i18n/terms';
import { build, I18nContext } from '@/i18n/useI18n';

import { ReportsPage } from './ReportsPage';

/**
 * The owner's snapshot on screen (D4, decision 4): the dashboard's button asks to go to the card,
 * the card takes the focus on its path field, writes through `report_html_write` with the document
 * composed in the owner's words, names the file it wrote and its size, and says a refusal on the
 * card — in both languages.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }));

const WORK = snapshot({
  work: { ...snapshot().work, name: 'Sample kitchen' },
  people: [person('p1', 'Sample joiner')],
  stages: [{ ...stage('s1', 1, 'Cabinets'), startedAt: '2026-09-01T09:00:00.000Z' }],
  activities: [{ ...activity('a1', 's1', 1, 2, 'p1'), name: 'Take out the old cabinets' }],
});

const NAVIGATION: Navigation = {
  openDocuments: () => undefined,
  openDiary: () => undefined,
  openPlan: () => undefined,
  openPaymentPlan: () => undefined,
  openSnapshot: vi.fn(),
  openBackup: () => undefined,
  openSchedule: () => undefined,
  openChanges: () => undefined,
};

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function answer(command: string): unknown {
  switch (command) {
    case 'diary_list':
      return [entry(1, '2026-09-01', { note: 'The old cabinets are out.' })];
    case 'diary_verify':
      return { intact: true, entries: 1 };
    case 'report_html_write':
      return { path: 'C:\\out\\kitchen.html', bytes: 2.5 * 1024 * 1024 };
    default:
      return null;
  }
}

function render(language: Language, page: 'reports' | 'dashboard') {
  act(() =>
    root.render(
      <I18nContext.Provider value={build(language, language)}>
        <QueryClientProvider client={client}>
          <NavigationContext.Provider value={NAVIGATION}>
            <main>
              {page === 'reports' ? (
                <ReportsPage snapshot={WORK} initialFocus="snapshot" onFocusTaken={() => {}} />
              ) : (
                <DashboardPage
                  snapshot={WORK}
                  onClose={() => undefined}
                  closing={false}
                  closeError={null}
                />
              )}
            </main>
          </NavigationContext.Provider>
        </QueryClientProvider>
      </I18nContext.Provider>,
    ),
  );
}

function find(testId: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`no ${testId}`);
  return found;
}

function type(element: HTMLElement, text: string) {
  const input = element as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => answer(command));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe.each(LANGUAGES)('the owner’s snapshot card, in %s', (language) => {
  const { t } = build(language, language);

  it('takes the focus on its path field when the dashboard asked for it', async () => {
    render(language, 'reports');
    await settle();
    expect(document.activeElement).toBe(find('snapshot-path'));
    // The card is named by the glossary's term after its article: "The owner's snapshot", "O
    // retrato da obra".
    const title = t('reports.snapshot.title', {
      snapshot: termFor(language, 'owner', 'snapshot'),
    });
    expect([...host.querySelectorAll('h2, h3')].map((each) => each.textContent)).toContain(title);
  });

  it('writes the snapshot as HTML, then names the file and its size', async () => {
    render(language, 'reports');
    await settle();
    type(find('snapshot-path'), 'C:\\out\\kitchen.html');
    act(() => find('snapshot-write').click());
    await settle();
    const call = invoke.mock.calls.find(([command]) => command === 'report_html_write');
    expect(call).toBeDefined();
    const args = call![1] as {
      path: string;
      document: ReportDocument;
      overwrite: boolean;
      created_at: string;
    };
    expect(args.path).toBe('C:\\out\\kitchen.html');
    // A typed path is never an agreement to replace a file.
    expect(args.overwrite).toBe(false);
    expect(args.document.kind).toBe('snapshot');
    expect(args.document.language).toBe(language);
    expect(args.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const done = find('snapshot-done');
    expect(done.textContent).toContain('kitchen.html');
    expect(find('snapshot-done-size').textContent).toContain(
      t('documents.size.mb', { value: language === 'en' ? '2.5' : '2,5' }),
    );
  });

  it('refuses a path that is not .html on the card, before the host is asked', async () => {
    render(language, 'reports');
    await settle();
    type(find('snapshot-path'), 'C:\\out\\kitchen.pdf');
    act(() => find('snapshot-write').click());
    await settle();
    expect(find('snapshot-problem').textContent).toContain(
      t('reports.invalid.extension', { extension: 'html' }),
    );
    expect(invoke.mock.calls.some(([command]) => command === 'report_html_write')).toBe(false);
  });

  it('says the host’s refusal on the card', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'report_html_write') {
        throw { kind: 'invalid_input', message: 'The snapshot holds more than 60 photos.' };
      }
      return answer(command);
    });
    render(language, 'reports');
    await settle();
    type(find('snapshot-path'), 'C:\\out\\kitchen.html');
    act(() => find('snapshot-write').click());
    await settle();
    expect(find('snapshot-problem').textContent).toContain('60');
    expect(host.querySelector('[data-testid="snapshot-done"]')).toBeNull();
  });

  it('is reached from the dashboard’s button', async () => {
    render(language, 'dashboard');
    await settle();
    act(() => find('dashboard-snapshot').click());
    expect(NAVIGATION.openSnapshot).toHaveBeenCalled();
  });
});
