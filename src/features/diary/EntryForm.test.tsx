// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { correction, entry, person, snapshot } from '@/domain/__fixtures__/plan';
import type { DiaryEntry } from '@/domain/diary';
import { schedule } from '@/domain/schedule';
import { DropZone } from '@/features/shell/DropZone';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { EntryForm } from './EntryForm';

/**
 * The diary's form, for the first real week (U1): "Same people as {day}" ticks the people of the
 * latest entry — adding to what is ticked, never unticking — and says how many are gone from the
 * plan; and photos dropped on the Diary join the entry being written, as if chosen.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const webview = vi.hoisted(() => ({
  handler: null as null | ((event: { payload: unknown }) => void),
}));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: (event: { payload: unknown }) => void) => {
      webview.handler = handler;
      return Promise.resolve(() => undefined);
    },
  }),
}));

const TODAY = '2026-09-03';
const WORK = snapshot({
  people: [person('tiler', 'Sample tiler'), person('mason', 'Sample mason'), person('helper')],
});

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(
  entries: readonly DiaryEntry[],
  {
    correcting = null,
    language = 'en',
  }: { correcting?: DiaryEntry | null; language?: Language } = {},
) {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <DropZone destination="diary" workOpen>
            <EntryForm
              snapshot={WORK}
              scheduled={schedule(WORK)}
              entries={entries}
              today={TODAY}
              correcting={correcting}
              onDone={() => undefined}
            />
          </DropZone>
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

const find = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const pressed = (id: string) => find(`entry-present-${id}`)?.getAttribute('aria-pressed');

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  invoke.mockReset();
  webview.handler = null;
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the same people as last time', () => {
  const yesterday = [
    entry(1, '2026-09-01', { present: ['helper'] }),
    entry(2, '2026-09-02', { present: ['tiler', 'mason'] }),
  ];

  it('is not offered before any entry says who was on site', () => {
    render([]);
    expect(find('entry-same-people')).toBeNull();
    render([entry(1, '2026-09-02', { lostDay: true })]);
    expect(find('entry-same-people')).toBeNull();
  });

  it('names the day of the latest entry as the diary names days', () => {
    render(yesterday);
    expect(find('entry-same-people')?.textContent).toBe(
      `Same people as ${build('en', 'en').day('2026-09-02')}`,
    );
  });

  it('ticks those people, adding to what is ticked and never unticking', () => {
    render(yesterday);
    act(() => find('entry-present-helper')?.click());
    act(() => find('entry-present-tiler')?.click());
    expect([pressed('tiler'), pressed('mason'), pressed('helper')]).toEqual([
      'true',
      'false',
      'true',
    ]);
    act(() => find('entry-same-people')?.click());
    expect([pressed('tiler'), pressed('mason'), pressed('helper')]).toEqual([
      'true',
      'true',
      'true',
    ]);
    // Pressed again, it still unticks nobody.
    act(() => find('entry-same-people')?.click());
    expect(pressed('tiler')).toBe('true');
    expect(find('entry-same-people-missing')).toBeNull();
  });

  it('says how many of them are no longer in the plan, and skips them', () => {
    render([entry(1, '2026-09-02', { present: ['tiler', 'gone', 'left'] })]);
    act(() => find('entry-same-people')?.click());
    expect(pressed('tiler')).toBe('true');
    const missing = find('entry-same-people-missing');
    expect(missing?.textContent).toBe('2 of them are no longer in the plan.');
    expect(find('entry-same-people')?.getAttribute('aria-describedby')).toBe(missing?.id);
  });

  it('follows the correction rather than the entry it corrects', () => {
    render([
      entry(1, '2026-09-02', { present: ['tiler'] }),
      correction(2, 1, '2026-09-02', { present: ['mason'] }),
    ]);
    act(() => find('entry-same-people')?.click());
    expect([pressed('tiler'), pressed('mason')]).toEqual(['false', 'true']);
  });

  it('is not offered on a correction, which restates its own day', () => {
    render(yesterday, { correcting: yesterday[1]! });
    expect(find('entry-same-people')).toBeNull();
  });

  it('says it in Portuguese', () => {
    render([entry(1, '2026-09-02', { present: ['tiler', 'gone'] })], { language: 'pt-BR' });
    expect(find('entry-same-people')?.textContent).toBe(
      `Mesma turma de ${build('pt-BR', 'pt-BR').day('2026-09-02')}`,
    );
    act(() => find('entry-same-people')?.click());
    expect(find('entry-same-people-missing')?.textContent).toBe(
      '1 dessas pessoas não está mais no plano.',
    );
  });
});

describe('photos dropped on the Diary', () => {
  it('join the entry being written, with "More…" opened, and the rest named', async () => {
    render([]);
    await settle();
    expect(find('entry-note')).toBeNull();
    act(() =>
      webview.handler?.({
        payload: { type: 'drop', paths: ['C:\\sample\\a.jpg', 'C:\\sample\\Week 1'] },
      }),
    );
    expect(find('entry-note')).not.toBeNull();
    expect(host.querySelector('[data-pending-photo="C:\\\\sample\\\\a.jpg"]')).not.toBeNull();
    expect(find('entry-photo-left')?.textContent).toBe(
      'Week 1 was left out: it is a folder, or not a kind of file taken here.',
    );
    // Nothing reaches the host until the entry is saved, as with a chosen photo.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('are listed once, however often they are dropped', async () => {
    render([]);
    await settle();
    const drop = () =>
      act(() => webview.handler?.({ payload: { type: 'drop', paths: ['C:\\sample\\a.jpg'] } }));
    drop();
    drop();
    expect(host.querySelectorAll('[data-pending-photo]')).toHaveLength(1);
    expect(find('entry-photo-left')).toBeNull();
  });
});

describe('why a day was lost (E3)', () => {
  const draftSent = () =>
    (
      invoke.mock.calls.find(([command]) => command === 'diary_entry_add')?.[1] as {
        draft: Record<string, unknown>;
      }
    )?.draft;

  function openLost() {
    act(() => find('entry-more')?.click());
    expect(find('entry-lost-cause')).toBeNull();
    act(() => find('entry-lost-day')?.click());
  }

  it('asks why only once no work was possible, with the seven causes', () => {
    render([]);
    openLost();
    const values = [...host.querySelectorAll('[data-testid="entry-lost-cause"] [data-value]')].map(
      (option) => option.getAttribute('data-value'),
    );
    expect(values).toEqual([
      'weather',
      'decision',
      'absence',
      'material',
      'owner',
      'access',
      'other',
    ]);
    expect(find('entry-lost-cause')?.textContent).toContain('Waiting for a decision');
    // Who is asked only for a cause that can name somebody.
    act(() => host.querySelector<HTMLElement>('[data-value="decision"]')?.click());
    expect(find('entry-lost-party')).toBeNull();
    act(() => host.querySelector<HTMLElement>('[data-value="absence"]')?.click());
    expect(find('entry-lost-party')).not.toBeNull();
    // Unticked, the day is not lost, and the question goes with it.
    act(() => find('entry-lost-day')?.click());
    expect(find('entry-lost-cause')).toBeNull();
  });

  it('sends the cause and who in the draft', async () => {
    invoke.mockResolvedValue(entry(1, TODAY, { lostDay: true }));
    render([]);
    openLost();
    act(() => host.querySelector<HTMLElement>('[data-value="absence"]')?.click());
    const party = find('entry-lost-party') as HTMLSelectElement;
    act(() => {
      party.value = 'tiler';
      party.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => find('entry-save')?.click());
    await settle();
    expect(draftSent()).toMatchObject({
      lostDay: true,
      lostCause: 'absence',
      lostPartyPersonId: 'tiler',
    });
  });

  it('sends no person for a cause that names nobody, and nothing at all for a day not lost', async () => {
    invoke.mockResolvedValue(entry(1, TODAY));
    render([]);
    openLost();
    act(() => host.querySelector<HTMLElement>('[data-value="absence"]')?.click());
    const party = find('entry-lost-party') as HTMLSelectElement;
    act(() => {
      party.value = 'tiler';
      party.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => host.querySelector<HTMLElement>('[data-value="weather"]')?.click());
    act(() => find('entry-save')?.click());
    await settle();
    expect(draftSent()).toMatchObject({ lostCause: 'weather', lostPartyPersonId: null });

    invoke.mockReset();
    invoke.mockResolvedValue(entry(2, TODAY));
    render([]);
    act(() => find('entry-save')?.click());
    await settle();
    expect(draftSent()).toMatchObject({ lostDay: false, lostCause: null, lostPartyPersonId: null });
  });

  it('opens a correction with the cause and who it restates', () => {
    const lost = entry(1, '2026-09-02', {
      lostDay: true,
      lostCause: 'material',
      lostPartyPersonId: 'mason',
    });
    render([lost], { correcting: lost });
    expect(host.querySelector('[data-value="material"]')?.getAttribute('aria-checked')).toBe(
      'true',
    );
    expect((find('entry-lost-party') as HTMLSelectElement).value).toBe('mason');
  });

  it('says it in Portuguese', () => {
    render([], { language: 'pt-BR' });
    openLost();
    const text = find('entry-lost-cause')?.textContent ?? '';
    for (const word of [
      'Por quê?',
      'Clima',
      'Esperando uma decisão',
      'A equipe não veio',
      'O material não chegou',
      'Pedido do dono',
      'Sem acesso à obra',
      'Outro',
    ]) {
      expect(text).toContain(word);
    }
  });
});
