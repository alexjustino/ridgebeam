// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import type { Destination } from './destinations';
import type { DropPlace } from './drop';
import { DropNotice, DropZone } from './DropZone';
import { useDropTarget, type DropHandler } from './dropTarget';

/**
 * The one listener for files dropped from Explorer (U1, decision 1), with Tauri's webview event
 * stood in for: the overlay says what a drop would do on this screen and goes on leave and drop;
 * a drop is handed to the place on screen that takes files; anywhere else a sentence says where to
 * drop, and nothing is taken. Outside Tauri the shell is the same shell, without drops.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Payload =
  | { type: 'enter'; paths: string[] }
  | { type: 'over' }
  | { type: 'drop'; paths: string[] }
  | { type: 'leave' };

const webview = vi.hoisted(() => ({
  handler: null as null | ((event: { payload: unknown }) => void),
  stop: vi.fn(),
  outside: false,
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => {
    if (webview.outside) throw new TypeError('no Tauri here');
    return {
      onDragDropEvent: (handler: (event: { payload: unknown }) => void) => {
        webview.handler = handler;
        return Promise.resolve(webview.stop);
      },
    };
  },
}));

const PHOTO = 'C:\\sample\\site.jpg';
const PHOTO_2 = 'C:\\sample\\site 2.png';
const FOLDER = 'C:\\sample\\Week 1';

let host: HTMLDivElement;
let root: Root;

function Target({ place, onDrop }: { place: DropPlace; onDrop: DropHandler }) {
  useDropTarget(place, onDrop);
  return null;
}

function render(
  destination: Destination,
  {
    workOpen = true,
    target = null,
    language = 'en',
  }: {
    workOpen?: boolean;
    target?: { place: DropPlace; onDrop: DropHandler } | null;
    language?: Language;
  } = {},
) {
  act(() =>
    root.render(
      <I18nContext.Provider value={build(language, language)}>
        <DropZone destination={destination} workOpen={workOpen}>
          {target !== null && <Target place={target.place} onDrop={target.onDrop} />}
          <DropNotice />
        </DropZone>
      </I18nContext.Provider>,
    ),
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function fire(payload: Payload) {
  act(() => webview.handler?.({ payload }));
}

const find = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

beforeEach(() => {
  webview.handler = null;
  webview.stop.mockReset();
  webview.outside = false;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('dropping files on the window', () => {
  it('says, while files hover, what a drop will do on the Diary — and what it leaves out', async () => {
    render('diary', { target: { place: 'diary', onDrop: vi.fn() } });
    await settle();
    expect(find('drop-hint')).toBeNull();
    fire({ type: 'enter', paths: [PHOTO, FOLDER] });
    const hint = find('drop-hint');
    expect(hint?.getAttribute('aria-live')).toBe('polite');
    expect(hint?.textContent).toContain('Drop to add this photo to the entry being written.');
    expect(hint?.textContent).toContain(
      'Week 1 will be left out: it is a folder, or not a kind of file taken here.',
    );
    fire({ type: 'over' });
    expect(find('drop-hint')).not.toBeNull();
    fire({ type: 'leave' });
    expect(find('drop-hint')).toBeNull();
  });

  it('hands a drop to the place on screen, through what its dialog would have chosen', async () => {
    const onDrop = vi.fn();
    render('diary', { target: { place: 'diary', onDrop } });
    await settle();
    fire({ type: 'enter', paths: [PHOTO, PHOTO_2, FOLDER] });
    fire({ type: 'drop', paths: [PHOTO, PHOTO_2, FOLDER] });
    expect(onDrop).toHaveBeenCalledWith([PHOTO, PHOTO_2], ['Week 1']);
    expect(find('drop-hint')).toBeNull();
    expect(find('drop-status')).toBeNull();
  });

  it('says on Documents that the files join the work’s documents', async () => {
    const onDrop = vi.fn();
    render('documents', { target: { place: 'documents', onDrop } });
    await settle();
    fire({ type: 'enter', paths: [PHOTO, PHOTO_2] });
    expect(find('drop-hint')?.textContent).toContain(
      'Drop to add these 2 files to the work’s documents.',
    );
    fire({ type: 'drop', paths: [PHOTO, PHOTO_2] });
    expect(onDrop).toHaveBeenCalledWith([PHOTO, PHOTO_2], []);
  });

  it('takes nothing on another screen, and says where files can be dropped', async () => {
    const onDrop = vi.fn();
    render('money', { target: { place: 'diary', onDrop } });
    await settle();
    fire({ type: 'enter', paths: [PHOTO] });
    const sentence = 'This screen takes no files. Drop photos on the Diary, or files on Documents.';
    expect(find('drop-hint')?.textContent).toContain(sentence);
    fire({ type: 'drop', paths: [PHOTO] });
    expect(onDrop).not.toHaveBeenCalled();
    expect(find('drop-status')?.textContent).toContain(sentence);
    act(() => find('drop-status-close')?.click());
    expect(find('drop-status')).toBeNull();
  });

  it('takes nothing with no work open, and says to open one', async () => {
    render('dashboard', { workOpen: false });
    await settle();
    fire({ type: 'drop', paths: [PHOTO] });
    expect(find('drop-status')?.textContent).toContain(
      'No work is open. Open one, then drop photos on the Diary, or files on Documents.',
    );
  });

  it('takes nothing on the Diary while its form is not on screen, and says so', async () => {
    render('diary');
    await settle();
    fire({ type: 'drop', paths: [PHOTO] });
    expect(find('drop-status')).not.toBeNull();
  });

  it('lets the sentence go when the screen changes', async () => {
    render('money');
    await settle();
    fire({ type: 'drop', paths: [PHOTO] });
    expect(find('drop-status')).not.toBeNull();
    render('plan');
    expect(find('drop-status')).toBeNull();
  });

  it('says it in Portuguese', async () => {
    render('diary', { target: { place: 'diary', onDrop: vi.fn() }, language: 'pt-BR' });
    await settle();
    fire({ type: 'enter', paths: [PHOTO, PHOTO_2] });
    expect(find('drop-hint')?.textContent).toContain(
      'Solte para adicionar estas 2 fotos à entrada que está sendo escrita.',
    );
    render('money', { language: 'pt-BR' });
    fire({ type: 'drop', paths: [PHOTO] });
    expect(find('drop-status')?.textContent).toContain(
      'Esta tela não recebe arquivos. Solte fotos no Diário, ou arquivos em Documentos.',
    );
  });

  it('takes a photo for the snag being raised or fixed on the Plan, and says so while hovering', async () => {
    const onDrop = vi.fn();
    render('plan', { target: { place: 'snag', onDrop } });
    await settle();
    fire({ type: 'enter', paths: [PHOTO] });
    expect(find('drop-hint')?.textContent).toContain('Drop to use this photo for the snag.');
    fire({ type: 'drop', paths: [PHOTO, FOLDER] });
    expect(onDrop).toHaveBeenCalledWith([PHOTO], ['Week 1']);
    expect(find('drop-status')).toBeNull();
  });

  it('says on the Plan, with no snag open, where a photo goes — and takes nothing', async () => {
    render('plan', { language: 'pt-BR' });
    await settle();
    fire({ type: 'enter', paths: [PHOTO] });
    expect(find('drop-hint')?.textContent).toContain('Abra Anotar uma pendência…');
    fire({ type: 'drop', paths: [PHOTO] });
    expect(find('drop-status')?.textContent).toContain('na aba Pendências');
  });

  it('stops listening when the shell goes', async () => {
    render('diary');
    await settle();
    act(() => root.unmount());
    expect(webview.stop).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });

  it('is the same shell outside Tauri, without drops', async () => {
    webview.outside = true;
    render('diary');
    await settle();
    expect(webview.handler).toBeNull();
    expect(find('drop-hint')).toBeNull();
  });
});
