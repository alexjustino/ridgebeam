// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReportDocument } from '@/data/commands';
import { meeting, person, snapshot } from '@/domain/__fixtures__/plan';
import type { WorkSnapshot } from '@/domain/plan';
import { LANGUAGES, type Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { stringsOf } from './compose/document';
import { ReportsPage } from './ReportsPage';

/**
 * The meeting minutes card on Reports (G1, decision 4), in both languages: before any meeting it
 * says where minutes come from and offers nothing to write; with meetings, it takes the focus when
 * the dashboard asked for it, chooses a meeting — the last one first — and writes its minutes
 * through `report_pdf_write` as a `minutes` document, then names the file and offers **Open**.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }));

const HELD: WorkSnapshot = snapshot({
  work: { ...snapshot().work, name: 'Sample kitchen' },
  people: [person('p1', 'Sample tiler')],
  meetings: [
    meeting('mt1', 1, '2026-09-04', { notes: 'First meeting.' }),
    meeting('mt2', 2, '2026-09-11', { notes: 'Second meeting.' }),
  ],
});

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function answer(command: string): unknown {
  switch (command) {
    case 'diary_list':
      return [];
    case 'diary_verify':
      return { intact: true, entries: 0 };
    case 'report_pdf_write':
      return { path: 'C:\\out\\minutes.pdf', bytes: 2048, pages: 1 };
    default:
      return null;
  }
}

function render(of: WorkSnapshot, language: Language) {
  act(() =>
    root.render(
      <I18nContext.Provider value={build(language, language)}>
        <QueryClientProvider client={client}>
          <main>
            <ReportsPage snapshot={of} initialFocus="meeting-minutes" onFocusTaken={() => {}} />
          </main>
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

function set(element: HTMLElement, value: string) {
  const prototype =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

async function settle() {
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
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

describe.each(LANGUAGES)('the meeting minutes card, in %s', (language) => {
  const { t } = build(language, language);

  it('says where minutes come from before any meeting, and writes nothing', async () => {
    render(snapshot(), language);
    await settle();
    expect(find('meeting-minutes-none').textContent).toBe(t('reports.minutes.none'));
    expect(host.querySelector('[data-testid="meeting-minutes-write"]')).toBeNull();
  });

  it('takes the focus, chooses a meeting and writes its minutes as a PDF', async () => {
    render(HELD, language);
    await settle();
    expect(document.activeElement).toBe(find('meeting-minutes-path'));
    const choose = find('meeting-minutes-choose') as HTMLSelectElement;
    // The last meeting first.
    expect(choose.value).toBe('mt2');
    set(choose, 'mt1');
    set(find('meeting-minutes-path'), 'C:\\out\\minutes.pdf');
    act(() => find('meeting-minutes-write').click());
    await settle();
    const call = invoke.mock.calls.find(([command]) => command === 'report_pdf_write');
    expect(call).toBeDefined();
    const args = call![1] as { path: string; document: ReportDocument; overwrite: boolean };
    expect(args.path).toBe('C:\\out\\minutes.pdf');
    expect(args.overwrite).toBe(false);
    expect(args.document.kind).toBe('minutes');
    expect(args.document.language).toBe(language);
    expect(stringsOf(args.document)).toContain('First meeting.');
    expect(find('meeting-minutes-done').textContent).toContain('minutes.pdf');
  });
});
