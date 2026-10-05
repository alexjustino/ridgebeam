// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentsAdded } from '@/data/commands';
import { snapshot } from '@/domain/__fixtures__/plan';
import { DropZone } from '@/features/shell/DropZone';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { DocumentsPage } from './DocumentsPage';

/**
 * Files dropped on Documents (U1, decision 1): drop is choose — they go through the same command
 * as **Add to the work**, with the kind the form says, and whatever the host refuses and whatever
 * the drop left out are named in the one list beside the control.
 *
 * A photo from an iPhone (G5): the dialog offers HEIC and HEIF, a HEIC waiting to be added says it
 * will be converted to JPEG, and once the host answers, each photo it converted is named.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const dialog = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => dialog);

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

const WORK = snapshot();
const HASH = 'a'.repeat(64);
let host: HTMLDivElement;
let root: Root;
/** What `document_add` answers. */
let answer: DocumentsAdded;

async function settle() {
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string) => {
    if (command === 'diary_list') return Promise.resolve([]);
    if (command === 'document_add') return Promise.resolve(answer);
    return Promise.reject(new Error(`not expected: ${command}`));
  });
  answer = {
    snapshot: WORK,
    refused: [{ fileName: 'huge.png', reason: 'it is larger than 25 MB' }],
    added: [{ fileName: 'quote.pdf', fileHash: HASH, convertedFrom: null }],
  };
  dialog.open.mockReset();
  dialog.open.mockResolvedValue(null);
  webview.handler = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  render('en');
});

function render(language: Language) {
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nContext.Provider value={build(language, language)}>
          <DropZone destination="documents" workOpen>
            <DocumentsPage snapshot={WORK} initialTarget={null} />
          </DropZone>
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('files dropped on Documents', () => {
  it('are added through the same command as the form, and every refusal is named', async () => {
    await settle();
    const paths = ['C:\\sample\\quote.pdf', 'C:\\sample\\huge.png', 'C:\\sample\\Week 1'];
    act(() => webview.handler?.({ payload: { type: 'drop', paths } }));
    await settle();
    expect(invoke).toHaveBeenCalledWith('document_add', {
      paths: ['C:\\sample\\quote.pdf', 'C:\\sample\\huge.png'],
      kind: 'other',
      target: null,
    });
    const problem = host.querySelector('[data-testid="documents-problem"]')?.textContent ?? '';
    expect(problem).toContain('huge.png: it is larger than 25 MB');
    expect(problem).toContain(
      'Week 1 was left out: it is a folder, or not a kind of file taken here.',
    );
  });

  it('asks nothing of the host when nothing dropped can be taken', async () => {
    await settle();
    act(() => webview.handler?.({ payload: { type: 'drop', paths: ['C:\\sample\\Week 1'] } }));
    await settle();
    expect(invoke.mock.calls.map(([command]) => command)).not.toContain('document_add');
    expect(host.querySelector('[data-testid="documents-drop-left"]')).not.toBeNull();
  });
});

describe('a photo from an iPhone (G5)', () => {
  const HEIC = 'C:/sample/IMG_0001.HEIC';
  const find = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  function choose(path: string) {
    const field = find('document-path') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, path);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => find('document-path-add')?.click());
  }

  const pending = (path: string) =>
    [...host.querySelectorAll<HTMLElement>('[data-pending-document]')].find(
      (row) => row.dataset.pendingDocument === path,
    );

  it('is offered by the dialog: HEIC and HEIF, with the photos and PDFs', async () => {
    await settle();
    const button = [...host.querySelectorAll('button')].find(
      (each) => each.textContent === 'Choose files…',
    );
    expect(button, 'the dialog button').toBeDefined();
    act(() => button?.click());
    await settle();
    const [options] = dialog.open.mock.calls[0] as [{ filters: { extensions: string[] }[] }];
    const extensions = options.filters.flatMap((filter) => filter.extensions);
    expect(extensions).toEqual(expect.arrayContaining(['heic', 'heif', 'jpg', 'png', 'pdf']));
  });

  it('says, while it waits, that it will be converted to JPEG — and a JPEG says nothing', async () => {
    await settle();
    choose(HEIC);
    choose('C:/sample/tile.jpg');
    const note = pending(HEIC)?.querySelector('[data-testid="photo-converted-note"]');
    expect(note?.textContent).toBe('Will be converted to JPEG');
    expect(
      pending('C:/sample/tile.jpg')?.querySelector('[data-testid="photo-converted-note"]'),
    ).toBeNull();
  });

  it('names each photo the host converted once it is added, and only those', async () => {
    answer = {
      snapshot: WORK,
      refused: [],
      added: [
        { fileName: 'IMG_0001.HEIC', fileHash: HASH, convertedFrom: 'HEIC' },
        { fileName: 'tile.jpg', fileHash: 'b'.repeat(64), convertedFrom: null },
      ],
    };
    await settle();
    choose(HEIC);
    choose('C:/sample/tile.jpg');
    act(() => find('documents-add')?.click());
    await settle();
    const lines = [...host.querySelectorAll('[data-testid="photo-converted"]')].map(
      (line) => line.textContent,
    );
    expect(lines).toEqual(['IMG_0001.HEIC was converted from HEIC to JPEG.']);
    expect(find('photos-converted')?.textContent).toContain('One photo was converted to JPEG');
    expect(find('documents-problem')).toBeNull();
  });

  it('says nothing about converting when nothing was converted', async () => {
    await settle();
    choose('C:/sample/quote.pdf');
    act(() => find('documents-add')?.click());
    await settle();
    expect(find('photos-converted')).toBeNull();
  });

  it('says it in Portuguese', async () => {
    answer = {
      snapshot: WORK,
      refused: [],
      added: [
        { fileName: 'IMG_0001.HEIC', fileHash: HASH, convertedFrom: 'HEIC' },
        { fileName: 'IMG_0002.HEIF', fileHash: 'b'.repeat(64), convertedFrom: 'HEIF' },
      ],
    };
    render('pt-BR');
    await settle();
    choose(HEIC);
    expect(pending(HEIC)?.textContent).toContain('Será convertida para JPEG');
    choose('C:/sample/IMG_0002.HEIF');
    act(() => find('documents-add')?.click());
    await settle();
    const lines = [...host.querySelectorAll('[data-testid="photo-converted"]')].map(
      (line) => line.textContent,
    );
    expect(lines).toEqual([
      'IMG_0001.HEIC foi convertida de HEIC para JPEG.',
      'IMG_0002.HEIF foi convertida de HEIF para JPEG.',
    ]);
    expect(find('photos-converted')?.textContent).toContain('2 fotos foram convertidas para JPEG');
  });
});
