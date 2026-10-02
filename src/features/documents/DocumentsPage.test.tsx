// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { snapshot } from '@/domain/__fixtures__/plan';
import { DropZone } from '@/features/shell/DropZone';

import { DocumentsPage } from './DocumentsPage';

/**
 * Files dropped on Documents (U1, decision 1): drop is choose — they go through the same command
 * as **Add to the work**, with the kind the form says, and whatever the host refuses and whatever
 * the drop left out are named in the one list beside the control.
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

const WORK = snapshot();
let host: HTMLDivElement;
let root: Root;

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
    if (command === 'document_add') {
      return Promise.resolve({
        snapshot: WORK,
        refused: [{ fileName: 'huge.png', reason: 'it is larger than 25 MB' }],
      });
    }
    return Promise.reject(new Error(`not expected: ${command}`));
  });
  webview.handler = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <DropZone destination="documents" workOpen>
          <DocumentsPage snapshot={WORK} initialTarget={null} />
        </DropZone>
      </QueryClientProvider>,
    ),
  );
});

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
