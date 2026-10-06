// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_SETTINGS } from '@/data/commands';
import { keys } from '@/data/queries';
import {
  activity,
  entry,
  snag,
  snagClosure,
  snapshot,
  stage,
  worked,
} from '@/domain/__fixtures__/plan';
import type { DiaryEntry, Photo } from '@/domain/diary';
import type { Document, WorkSnapshot } from '@/domain/plan';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { DiaryViews } from './DiaryPage';
import { forgetDiaryView } from './diaryView';

/**
 * The Diary's second view, **In photos** (slice G6, decision 5), rendered and pressed in both
 * languages: the switch starts on day by day; pressed, each room's photos run first to last —
 * the diary's, the hidden-work check's, a snag's problem and its fix — with the room's span, a
 * month's name where the month changes, and every photo the diary's own labelled button with its
 * day and what it shows under it. The view lasts for the session. A work with no photo says where
 * its story will come from. Every name is synthetic.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const hash = (n: number) => n.toString(16).padStart(64, '0');

const image = (n: number): Document => ({
  id: `doc-${n}`,
  fileHash: hash(n),
  fileName: `photo-${n}.jpg`,
  mediaType: 'image/jpeg',
  bytes: 2048,
  width: 800,
  height: 600,
  kind: 'photo',
  title: `photo-${n}.jpg`,
  addedOn: '2026-08-30',
  authorName: 'Sample author',
  createdAt: '2026-08-30T12:00:00.000Z',
  links: [],
});

const photo = (n: number): Photo => ({
  fileHash: hash(n),
  fileName: `photo-${n}.jpg`,
  bytes: 2048,
  width: 800,
  height: 600,
  thumbnail: true,
});

const WORK: WorkSnapshot = snapshot({
  rooms: [
    { id: 'r1', position: 1, name: 'Sample bathroom' },
    { id: 'r2', position: 2, name: 'Sample kitchen' },
  ],
  stages: [stage('s1', 1, 'Rough-in')],
  activities: [
    { ...activity('a1', 's1', 1, 2), name: 'Tiling', roomIds: ['r1'] },
    { ...activity('a2', 's1', 2, 2), name: 'Cabinets', roomIds: ['r2'] },
  ],
  checks: [
    {
      id: 'k1',
      stageId: 's1',
      gate: 'close',
      position: 1,
      name: 'Pipes photographed',
      needsPhoto: true,
    },
  ],
  checkAnswers: [
    {
      id: 'ans1',
      checkId: 'k1',
      seq: 1,
      answer: 'yes',
      reason: null,
      photoHash: hash(5),
      authorName: 'Sample author',
      answeredAt: '2026-09-01T15:00:00.000Z',
    },
  ],
  snags: [
    snag('n1', 1, 's1', {
      title: 'Cracked tile',
      activityId: 'a1',
      raisedOn: '2026-09-03',
      photoHash: hash(6),
      closure: snagClosure('fixed', '2026-09-04', hash(7)),
    }),
  ],
  documents: [1, 2, 3, 4, 5, 6, 7].map(image),
});

/** Written out of day order, as a diary can be: the story is told by day all the same. */
const ENTRIES: readonly DiaryEntry[] = [
  entry(1, '2026-09-05', { done: [worked('a1')], photos: [photo(3)] }),
  entry(2, '2026-08-30', { done: [worked('a1')], photos: [photo(1)] }),
  entry(3, '2026-09-02', { done: [worked('a2')], photos: [photo(2)] }),
  // Naming no activity: told in the last section, what touches no room.
  entry(4, '2026-09-06', { photos: [photo(4)] }),
];

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

/** The same work before any photo: no check answered with one, no snag. */
const BARE: WorkSnapshot = { ...WORK, checkAnswers: [], snags: [] };

function render(
  entries: readonly DiaryEntry[] = ENTRIES,
  language: Language = 'en',
  plan: WorkSnapshot = WORK,
) {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens: 'owner' });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <DiaryViews snapshot={plan} entries={entries} onCorrect={() => undefined} />
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

async function settle() {
  for (let tick = 0; tick < 5; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function option(value: 'days' | 'story'): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(
    `[data-testid="diary-view"] [role="radio"][data-value="${value}"]`,
  );
  if (found === null) throw new Error(`no ${value}`);
  return found;
}

function press(element: HTMLElement) {
  act(() => element.click());
}

const story = () => host.querySelector<HTMLElement>('[data-testid="diary-story"]');
const sections = () => [...host.querySelectorAll<HTMLElement>('[data-story-section]')];
const section = (key: string) => {
  const found = host.querySelector<HTMLElement>(`[data-story-section][data-key="${key}"]`);
  if (found === null) throw new Error(`no section ${key}`);
  return found;
};
const photos = (within: HTMLElement) => [
  ...within.querySelectorAll<HTMLElement>('[data-story-photo]'),
];
const calls = (command: string) =>
  invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args as unknown);

beforeEach(() => {
  forgetDiaryView();
  invoke.mockReset();
  invoke.mockImplementation((command: string) => {
    if (command === 'settings_get') return Promise.resolve(null);
    if (command === 'photo_thumbnail') return Promise.resolve('data:image/png;base64,AAAA');
    return Promise.resolve(null);
  });
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
  forgetDiaryView();
});

describe('the view switch', () => {
  it('starts on day by day, and offers In photos beside it', () => {
    render();
    expect(option('days').getAttribute('aria-checked')).toBe('true');
    expect(option('days').textContent).toBe('Day by day');
    expect(option('story').getAttribute('aria-checked')).toBe('false');
    expect(option('story').textContent).toBe('In photos');
    expect(story()).toBeNull();
    expect(host.querySelectorAll('[data-diary-day]').length).toBeGreaterThan(0);
  });

  it('shows the work in photos when pressed, and day by day again', () => {
    render();
    press(option('story'));
    expect(option('story').getAttribute('aria-checked')).toBe('true');
    expect(story()).not.toBeNull();
    expect(host.querySelector('[data-diary-day]')).toBeNull();
    press(option('days'));
    expect(story()).toBeNull();
    expect(host.querySelectorAll('[data-diary-day]').length).toBeGreaterThan(0);
  });

  it('comes before the view it changes, in reading and Tab order', () => {
    render();
    press(option('story'));
    const order = option('story').compareDocumentPosition(story()!);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('remembers the view for the session: leaving the Diary and coming back keeps it', () => {
    render();
    press(option('story'));
    act(() => root.unmount());
    root = createRoot(host);
    render();
    expect(story()).not.toBeNull();
    expect(option('story').getAttribute('aria-checked')).toBe('true');
  });
});

describe('In photos', () => {
  beforeEach(() => {
    render();
    press(option('story'));
  });

  it('tells the rooms in room order, and what touches no room last', () => {
    expect(sections().map((each) => each.dataset.key)).toEqual(['room:r1', 'room:r2', 'other']);
    expect(section('room:r1').querySelector('h3')?.textContent).toBe('Sample bathroom');
    expect(section('room:r2').querySelector('h3')?.textContent).toBe('Sample kitchen');
    expect(section('other').querySelector('h3')?.textContent).toBe('Elsewhere in the work');
  });

  it('runs every photo of a room first to last, by day, whatever order it was written in', () => {
    const bathroom = photos(section('room:r1'));
    const days = bathroom.map((each) => each.dataset.day);
    expect(days).toEqual(['2026-08-30', '2026-09-01', '2026-09-03', '2026-09-04', '2026-09-05']);
    expect([...days].sort()).toEqual(days);
    expect(bathroom.map((each) => each.dataset.kind)).toEqual([
      'diary',
      'hidden-work',
      'snag-problem',
      'snag-fix',
      'diary',
    ]);
    expect(photos(section('room:r2')).map((each) => each.dataset.day)).toEqual([
      '2026-09-01',
      '2026-09-02',
    ]);
    expect(photos(section('other')).map((each) => each.dataset.day)).toEqual(['2026-09-06']);
  });

  it('says each room’s span, and names each month where the photos span more than one', () => {
    const bathroom = section('room:r1');
    expect(bathroom.textContent).toContain('From August 30, 2026 to September 5, 2026 · 5 photos');
    expect(
      [...bathroom.querySelectorAll<HTMLElement>('[data-story-month]')].map(
        (each) => each.textContent,
      ),
    ).toEqual(['August 2026', 'September 2026']);
    expect(section('room:r2').querySelector('[data-story-month]')).toBeNull();
    expect(section('other').textContent).toContain('On September 6, 2026 · 1 photo');
  });

  it('captions each photo with its day and what it shows, in words', () => {
    const captions = photos(section('room:r1')).map((each) => each.querySelector('p')?.textContent);
    expect(captions).toEqual([
      'Aug 30, 2026Tiling',
      'Sep 1, 2026Hidden work: Pipes photographed',
      'Sep 3, 2026Snag #1 — the problem',
      'Sep 4, 2026Snag #1 — fixed',
      'Sep 5, 2026Tiling',
    ]);
    expect(photos(section('other'))[0]?.querySelector('p')?.textContent).toBe(
      'Sep 6, 2026From the diary',
    );
  });

  it('opens a photo on the diary’s own labelled button, never a bare click on the image', async () => {
    await settle();
    const first = photos(section('room:r1'))[0]!;
    const button = first.querySelector<HTMLButtonElement>('[data-testid="photo-open"]')!;
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-label')).toBe('Open photo-1.jpg');
    expect(first.querySelector('img')?.getAttribute('alt')).toBe(
      'Photo photo-1.jpg, August 30, 2026',
    );
    press(button);
    await settle();
    expect(calls('photo_open')).toEqual([{ hash: hash(1) }]);
  });

  it('asks the host once for each photo’s thumbnail, however many rooms show it', async () => {
    await settle();
    // The hidden-work photo is in both rooms' stories: one thumbnail, asked once.
    expect(photos(section('room:r2'))[0]?.dataset.kind).toBe('hidden-work');
    const asked = calls('photo_thumbnail').map((args) => (args as { hash: string }).hash);
    expect(new Set(asked).size).toBe(asked.length);
    expect(new Set(asked)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7].map(hash)));
  });

  it('wraps its photos in reading order, never in a strip that scrolls sideways', () => {
    for (const list of host.querySelectorAll<HTMLElement>('[data-story-section] ol')) {
      expect(list.className).toContain('flex-wrap');
      expect(list.className).not.toMatch(/overflow-x/);
    }
  });
});

describe('a work with no photo', () => {
  it('says where its story will come from, room by room, rather than drawing empty rooms', () => {
    render([entry(1, '2026-09-01', { done: [worked('a1')] })], 'en', BARE);
    press(option('story'));
    expect(sections()).toEqual([]);
    expect(story()?.textContent).toContain(
      'No photos yet: photos added to the diary, to hidden-work checks and to snags are told here, room by room.',
    );
  });
});

describe('in Portuguese', () => {
  it('says the switch, the span, the snag and the empty sentence in Portuguese', () => {
    render(ENTRIES, 'pt-BR');
    expect(option('days').textContent).toBe('Dia a dia');
    expect(option('story').textContent).toBe('Em fotos');
    press(option('story'));
    const bathroom = section('room:r1');
    expect(bathroom.textContent).toContain(
      'De 30 de agosto de 2026 a 5 de setembro de 2026 · 5 fotos',
    );
    expect(bathroom.textContent).toContain('Pendência nº 1 — o problema');
    expect(bathroom.textContent).toContain('Pendência nº 1 — resolvida');
    expect(bathroom.textContent).toContain('Agosto de 2026');
    expect(section('other').querySelector('h3')?.textContent).toBe('No resto da obra');
  });

  it('says an empty story in Portuguese', () => {
    render([], 'pt-BR', BARE);
    press(option('story'));
    expect(story()?.textContent).toContain(
      'Nenhuma foto ainda: as fotos do diário, das verificações de serviço escondido e das pendências são contadas aqui, cômodo por cômodo.',
    );
  });
});
