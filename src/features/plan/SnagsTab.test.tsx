// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { today } from '@/app/today';
import { BUILT_IN_SETTINGS, type DocumentsAdded } from '@/data/commands';
import { keys } from '@/data/queries';
import { activity, person, snag, snagClosure, snapshot, stage } from '@/domain/__fixtures__/plan';
import type { Document, WorkSnapshot } from '@/domain/plan';
import type { LensChoice } from '@/domain/settings';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { SnagsTab } from './SnagsTab';

/**
 * The Plan's Snags tab (slice E4, decision 5), rendered and pressed in both languages: nothing to
 * raise on a plan with no stage, with the sentence that says why; a snag raised with its photo — the
 * file added through the documents' intake first, the snag sent naming its hash with the host's
 * keys; a refused photo named under its field with nothing raised; the list open first, a snag past
 * its day marked in words; **Fix…** refused without a photo inside its dialog and sent with one; and
 * **Withdraw…** refused without a reason and sent with it.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const HASH = 'a'.repeat(64);
const FIX_HASH = 'b'.repeat(64);
const PHOTO = 'C:\\Users\\sample\\Pictures\\crack.jpg';
const FIX_PHOTO = 'C:\\Users\\sample\\Pictures\\fixed.jpg';

const BASE = snapshot({
  people: [person('p1', 'Sample tiler')],
  stages: [stage('s1', 1, 'Rough-in'), stage('s2', 2, 'Finishes')],
  activities: [
    { ...activity('a1', 's1', 1, 2), name: 'Wiring' },
    { ...activity('a2', 's2', 1, 3), name: 'Tiling', responsibleId: 'p1' },
  ],
});

function photoDocument(id: string, hash: string, fileName: string): Document {
  return {
    id,
    fileHash: hash,
    fileName,
    mediaType: 'image/jpeg',
    bytes: 1000,
    width: 640,
    height: 480,
    kind: 'photo',
    title: fileName,
    addedOn: today(),
    authorName: 'Sample author',
    createdAt: `${today()}T12:00:00.000Z`,
    links: [{ targetKind: 'work', targetId: BASE.work.workId }],
  };
}

/** Two open snags — one past its day — and one fixed, raised long ago. */
const LISTED: WorkSnapshot = {
  ...BASE,
  documents: [photoDocument('d1', HASH, 'crack.jpg'), photoDocument('d2', FIX_HASH, 'fixed.jpg')],
  snags: [
    snag('n1', 1, 's2', {
      title: 'Cracked tile',
      raisedOn: '2020-01-01',
      personId: 'p1',
      photoHash: HASH,
      closure: snagClosure('fixed', '2020-01-03', FIX_HASH),
    }),
    snag('n2', 2, 's2', {
      title: 'Door sticks',
      raisedOn: '2020-01-01',
      dueOn: '2020-01-02',
      personId: 'p1',
    }),
    snag('n3', 3, 's1', { title: 'Socket loose', raisedOn: '2020-01-01' }),
  ],
};

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
/** What the host answers to a command that answers with the plan. */
let next: WorkSnapshot;
/** What `document_add` answers. */
let added: DocumentsAdded;

function render(of: WorkSnapshot, language: Language = 'en', lens: LensChoice = 'owner') {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <SnagsTab snapshot={of} />
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

function find(selector: string, within: ParentNode = document.body): HTMLElement {
  const found = within.querySelector<HTMLElement>(
    selector.startsWith('[') ? selector : `[data-testid="${selector}"]`,
  );
  if (found === null) throw new Error(`no ${selector}`);
  return found;
}

function set(element: HTMLElement, value: string) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

async function settle() {
  for (let tick = 0; tick < 5; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const calls = (command: string) =>
  invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args as unknown);

beforeEach(() => {
  invoke.mockReset();
  next = BASE;
  added = { snapshot: BASE, refused: [], added: [] };
  invoke.mockImplementation((command: string) => {
    if (command === 'settings_get') return Promise.resolve(null);
    if (command === 'photo_thumbnail') return Promise.resolve('');
    if (command === 'document_add') return Promise.resolve(added);
    return Promise.resolve(next);
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
});

const WORDS = {
  en: {
    noStage: /raised on a stage: add one to the plan first/,
    none: /No snag has been raised/,
    overdue: 'Open, past its day',
    overdueBy: /Overdue by [\d,.]+ days — it was due on/,
    fix: 'Fix…',
    withdraw: 'Withdraw…',
    photoRequired: 'A snag is fixed only with a photo of it fixed: add one above.',
    reason: 'Say why it is withdrawn.',
    fixed: /Fixed on .* by Sample author/,
    who: 'To fix it: Sample tiler',
    converting: 'Will be converted to JPEG',
  },
  'pt-BR': {
    noStage: /é anotada numa etapa: acrescente uma ao plano primeiro/,
    none: /Nenhuma pendência foi anotada/,
    overdue: 'Aberta, vencida',
    overdueBy: /Vencida há [\d,.]+ dias — vencia em/,
    fix: 'Resolver…',
    withdraw: 'Retirar…',
    photoRequired: 'Uma pendência só é resolvida com uma foto do conserto: adicione uma acima.',
    reason: 'Diga por que ela está sendo retirada.',
    fixed: /Resolvida em .* por Sample author/,
    who: 'Quem conserta: Sample tiler',
    converting: 'Será convertida para JPEG',
  },
} as const;

describe.each(['en', 'pt-BR'] as const)('the Snags tab, in %s', (language) => {
  const words = WORDS[language];

  it('raises nothing on a plan with no stage, and says why beside the button', () => {
    render(snapshot(), language);
    const raise = find('snag-raise') as HTMLButtonElement;
    expect(raise.disabled).toBe(true);
    const reason = find('snag-raise-locked');
    expect(reason.textContent).toMatch(words.noStage);
    expect(raise.getAttribute('aria-describedby')).toBe(reason.id);
    expect(find('snags-none').textContent).toMatch(words.none);
  });

  it('raises a snag with its photo: the file goes in as a document first, then the snag names its hash', async () => {
    render(BASE, language);
    act(() => find('snag-raise').click());
    set(find('snag-title'), '  Cracked tile  ');
    set(find('snag-stage'), 's2');
    // Choosing an activity offers its responsible as who must fix it.
    set(find('snag-activity'), 'a2');
    expect((find('snag-person') as HTMLSelectElement).value).toBe('p1');
    set(find('snag-due'), '2099-12-31');
    set(find('snag-photo-path'), PHOTO);
    act(() => find('snag-photo-add').click());
    expect(find('[data-pending-photo]').textContent).toContain('crack.jpg');
    added = {
      snapshot: { ...BASE, documents: [photoDocument('d1', HASH, 'crack.jpg')] },
      refused: [],
      added: [{ fileName: 'crack.jpg', fileHash: HASH, convertedFrom: null }],
    };
    act(() => find('snag-save').click());
    await settle();
    expect(calls('document_add')).toEqual([{ paths: [PHOTO], kind: 'photo', target: null }]);
    expect(calls('snag_raise')).toEqual([
      {
        draft: {
          raisedOn: today(),
          title: 'Cracked tile',
          description: null,
          stageId: 's2',
          activityId: 'a2',
          personId: 'p1',
          dueOn: '2099-12-31',
          photoHash: HASH,
        },
      },
    ]);
  });

  it('says a HEIC chosen for the snag will be converted to JPEG, and a JPEG says nothing (G5)', () => {
    render(BASE, language);
    act(() => find('snag-raise').click());
    set(find('snag-photo-path'), 'C:/sample/IMG_0001.HEIC');
    act(() => find('snag-photo-add').click());
    const note = () =>
      host.querySelector('[data-pending-photo] [data-testid="photo-converted-note"]');
    expect(note()?.textContent).toBe(words.converting);
    set(find('snag-photo-path'), PHOTO);
    act(() => find('snag-photo-add').click());
    expect(find('[data-pending-photo]').textContent).toContain('crack.jpg');
    expect(note()).toBeNull();
  });

  it('refuses a due day typed only halfway, rather than saving the snag with no due day', async () => {
    render(BASE, language);
    act(() => find('snag-raise').click());
    set(find('snag-title'), 'Cracked tile');
    set(find('snag-stage'), 's2');
    set(find('snag-due'), language === 'en' ? 'Dec 31' : '31/12');
    act(() => find('snag-save').click());
    await settle();
    expect(find('snag-problem').textContent).toMatch(
      language === 'en' ? /not a whole day yet/ : /ainda não é um dia completo/,
    );
    expect(calls('snag_raise')).toEqual([]);
  });

  it('says what the snag lacks before anything is added or sent', async () => {
    render(BASE, language);
    act(() => find('snag-raise').click());
    act(() => find('snag-save').click());
    await settle();
    expect(find('snag-problem').textContent).toBeTruthy();
    expect(calls('document_add')).toEqual([]);
    expect(calls('snag_raise')).toEqual([]);
  });

  it('names a refused photo under its field, in the host’s words, and raises nothing', async () => {
    render(BASE, language);
    act(() => find('snag-raise').click());
    set(find('snag-title'), 'Cracked tile');
    set(find('snag-stage'), 's1');
    set(find('snag-photo-path'), PHOTO);
    act(() => find('snag-photo-add').click());
    added = {
      snapshot: BASE,
      refused: [{ fileName: 'crack.jpg', reason: 'crack.jpg is too big.' }],
      added: [],
    };
    act(() => find('snag-save').click());
    await settle();
    expect(find('snag-photo-refused').textContent).toContain('crack.jpg is too big.');
    expect(calls('snag_raise')).toEqual([]);
  });

  it('lists the open snags first, one past its day marked in words, the fixed one with both photos', () => {
    render(LISTED, language);
    const rows = [...document.body.querySelectorAll<HTMLElement>('[data-snag-id]')];
    expect(rows.map((row) => row.getAttribute('data-snag-id'))).toEqual(['n2', 'n3', 'n1']);
    expect(rows.map((row) => row.getAttribute('data-state'))).toEqual(['open', 'open', 'fixed']);
    const late = rows[0]!;
    expect(late.getAttribute('data-overdue')).toBe('true');
    expect(find('snag-state', late).textContent).toContain(words.overdue);
    expect(find('snag-due-text', late).textContent).toMatch(words.overdueBy);
    expect(late.textContent).toContain(words.who);
    expect(find('snag-fix', late).textContent).toBe(words.fix);
    expect(find('snag-withdraw', late).textContent).toBe(words.withdraw);
    const done = rows[2]!;
    expect(done.querySelector('[data-testid="snag-fix"]')).toBeNull();
    expect(find('snag-closure', done).textContent).toMatch(words.fixed);
    const photos = find('snag-photos', done);
    expect(
      [...photos.querySelectorAll('[data-photo-hash]')].map((each) =>
        each.getAttribute('data-photo-hash'),
      ),
    ).toEqual([HASH, FIX_HASH]);
  });

  it('refuses a fix without a photo inside the dialog, and fixes it with one', async () => {
    render(LISTED, language);
    act(() => find('snag-fix', find('[data-snag-id="n3"]')).click());
    const dialog = find('snag-close');
    expect(dialog.getAttribute('data-outcome')).toBe('fixed');
    act(() => find('snag-confirm', dialog).click());
    await settle();
    expect(find('snag-close-problem').textContent).toContain(words.photoRequired);
    expect(calls('snag_close')).toEqual([]);
    expect(calls('document_add')).toEqual([]);

    set(find('snag-fix-photo-path'), FIX_PHOTO);
    act(() => find('snag-fix-photo-add').click());
    set(find('snag-note'), '  Re-seated.  ');
    added = {
      snapshot: {
        ...LISTED,
        documents: [...LISTED.documents, photoDocument('d3', 'c'.repeat(64), 'fixed.jpg')],
      },
      refused: [],
      added: [{ fileName: 'fixed.jpg', fileHash: 'c'.repeat(64), convertedFrom: null }],
    };
    act(() => find('snag-confirm').click());
    await settle();
    expect(calls('document_add')).toEqual([{ paths: [FIX_PHOTO], kind: 'photo', target: null }]);
    expect(calls('snag_close')).toEqual([
      {
        closure: {
          snagId: 'n3',
          outcome: 'fixed',
          closedOn: today(),
          photoHash: 'c'.repeat(64),
          note: 'Re-seated.',
        },
      },
    ]);
  });

  it('refuses a withdrawal without its reason, and withdraws it with one', async () => {
    render(LISTED, language);
    act(() => find('snag-withdraw', find('[data-snag-id="n2"]')).click());
    const dialog = find('snag-close');
    expect(dialog.getAttribute('data-outcome')).toBe('withdrawn');
    expect(dialog.querySelector('[data-testid="snag-fix-photo-path"]')).toBeNull();
    act(() => find('snag-confirm', dialog).click());
    await settle();
    expect(find('snag-close-problem').textContent).toContain(words.reason);
    expect(calls('snag_close')).toEqual([]);

    set(find('snag-note'), 'Raised twice');
    act(() => find('snag-confirm').click());
    await settle();
    expect(calls('document_add')).toEqual([]);
    expect(calls('snag_close')).toEqual([
      {
        closure: {
          snagId: 'n2',
          outcome: 'withdrawn',
          closedOn: today(),
          photoHash: null,
          note: 'Raised twice',
        },
      },
    ]);
  });
});
