// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackupSummary, RestoreReport } from '@/data/commands';

import { RestoreDialog } from './RestoreDialog';
import { dismissRestored, useRestored } from './restored';

/**
 * Restore a backup, rendered and pressed (F11, decision 2): the manifest is read and shown before
 * anything is restored; a refusal is the host's sentence inside the dialog, which stays open with
 * what was typed; a restore hands its report on for the Dashboard, before the work is read again.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const FILE = 'C:\\backups\\bathroom.ridgebeam';
const FOLDER = 'C:\\works\\bathroom-restored';

const SUMMARY: BackupSummary = {
  workId: 'work-1',
  workName: 'Sample work',
  createdAt: '2026-09-20T10:00:00.000Z',
  app: 'Ridgebeam 0.1.0',
  schemaVersion: 9,
  files: 4,
  bytes: 3 * 1024 * 1024,
  archiveBytes: 2 * 1024 * 1024,
  recentFolder: null,
};

const REPORT: RestoreReport = {
  workId: 'work-1',
  folder: FOLDER,
  entries: 3,
  chainOk: true,
  documents: 2,
  mismatched: [],
  missing: [],
  movedRecentFrom: null,
};

let host: HTMLDivElement;
let root: Root;
const closed = vi.fn();

/** What the Dashboard would read, written where the test can see it. */
function Watch() {
  const report = useRestored('work-1');
  return <output data-testid="watch">{report === null ? '' : JSON.stringify(report)}</output>;
}

const restored = (): RestoreReport | null => {
  const text = find('watch').textContent ?? '';
  return text === '' ? null : (JSON.parse(text) as RestoreReport);
};

function find(testId: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
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
  closed.mockReset();
  dismissRestored();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <RestoreDialog onClose={closed} />
        <Watch />
      </QueryClientProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Restore a backup', () => {
  it('reads the manifest and shows what the file holds before anything is restored', async () => {
    invoke.mockImplementation((command: string) =>
      command === 'backup_inspect' ? Promise.resolve(SUMMARY) : Promise.resolve(null),
    );
    type(find('restore-file'), FILE);
    act(() => find('restore-file').dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await settle();
    expect(invoke).toHaveBeenCalledWith('backup_inspect', { path: FILE });
    const preview = find('restore-preview').textContent ?? '';
    expect(preview).toContain('Sample work');
    expect(preview).toContain('Ridgebeam 0.1.0');
    expect(preview).toContain('4 files');
    expect(invoke.mock.calls.map(([command]) => command)).not.toContain('backup_restore');
  });

  it('refuses a file that is not a backup before the host is asked', async () => {
    type(find('restore-file'), 'C:\\backups\\notes.zip');
    type(find('restore-folder'), FOLDER);
    act(() => find('restore-confirm').click());
    await settle();
    expect(find('restore-problem').textContent).toContain('.ridgebeam');
    expect(invoke.mock.calls.map(([command]) => command)).not.toContain('backup_restore');
  });

  it('says the host’s refusal inside the dialog, which stays open with what was typed', async () => {
    invoke.mockImplementation((command: string) =>
      command === 'backup_restore'
        ? Promise.reject({
            kind: 'invalid_input',
            message: 'The backup was changed: documents/ab.jpg is not what its list says.',
          })
        : Promise.resolve(SUMMARY),
    );
    type(find('restore-file'), FILE);
    type(find('restore-folder'), FOLDER);
    act(() => find('restore-confirm').click());
    await settle();
    expect(invoke).toHaveBeenCalledWith('backup_restore', { path: FILE, folder: FOLDER });
    expect(find('restore-problem').textContent).toContain('is not what its list says');
    expect((find('restore-folder') as HTMLInputElement).value).toBe(FOLDER);
    expect(closed).not.toHaveBeenCalled();
    expect(restored()).toBeNull();
  });

  it('hands the report on for the Dashboard when the restore holds', async () => {
    invoke.mockImplementation((command: string) =>
      command === 'backup_restore' ? Promise.resolve(REPORT) : Promise.resolve(null),
    );
    type(find('restore-file'), FILE);
    type(find('restore-folder'), FOLDER);
    act(() => find('restore-confirm').click());
    await settle();
    expect(restored()).toEqual(REPORT);
  });

  it('closes on Escape', () => {
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
