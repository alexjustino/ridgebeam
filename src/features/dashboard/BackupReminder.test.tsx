// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavigationContext, type Navigation } from '@/app/navigation';
import type { LastBackup } from '@/data/commands';
import { keys } from '@/data/queries';
import { activity, entry, snapshot, stage } from '@/domain/__fixtures__/plan';
import type { DiaryEntry } from '@/domain/diary';
import type { WorkSnapshot } from '@/domain/plan';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { BUILT_IN_SETTINGS } from '@/data/commands';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { BackupReminder } from './BackupReminder';

/**
 * The backup reminder on the front door (U1, decision 3): said quietly when the work was never
 * backed up or the backup is more than a week old and the work changed since; nothing while the
 * facts are still being read; "Back up now…" goes to the one flow that writes a backup, with the
 * focus on its path; "Not now" puts it off for this session, for this work only.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const TODAY = '2026-09-10';

/** A work with one activity, under its own id: "Not now" is kept per work for the session. */
function work(workId: string, parts: Partial<WorkSnapshot> = {}): WorkSnapshot {
  const base = snapshot({
    stages: [stage('s', 1)],
    activities: [activity('a', 's', 1, 2, null)],
    ...parts,
  });
  return { ...base, work: { ...base.work, workId } };
}

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
const gone = vi.fn();
const openBackup = vi.fn();

const NAVIGATION: Navigation = {
  openDocuments: () => undefined,
  openDiary: () => undefined,
  openPlan: () => undefined,
  openPaymentPlan: () => undefined,
  openSnapshot: () => undefined,
  openBackup,
  openSchedule: () => undefined,
  openChanges: () => undefined,
  openSnags: () => undefined,
  openPurchases: () => undefined,
  openMeeting: () => undefined,
  openMinutes: () => undefined,
};

/** The host as the reminder asks it: the last backup, and the diary. */
function host_(last: LastBackup | null | Error, entries: DiaryEntry[] = []) {
  invoke.mockImplementation((command: string) => {
    if (command === 'backup_last') {
      return last instanceof Error ? Promise.reject(last) : Promise.resolve(last);
    }
    if (command === 'diary_list') return Promise.resolve(entries);
    return Promise.reject(new Error(`not expected: ${command}`));
  });
}

function render(of: WorkSnapshot, language: Language = 'en') {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <NavigationContext.Provider value={NAVIGATION}>
            <BackupReminder snapshot={of} today={TODAY} onGone={gone} />
          </NavigationContext.Provider>
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

/** Two queries answer, each in its own tick: let a few ticks pass so both have. */
async function settle() {
  for (let tick = 0; tick < 5; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const find = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

beforeEach(() => {
  invoke.mockReset();
  gone.mockReset();
  openBackup.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the backup reminder', () => {
  it('says, quietly, that a work with a plan in it has never been backed up', async () => {
    host_(null);
    render(work('never'));
    // Nothing on a guess: the last backup has not been read yet.
    expect(find('dashboard-backup')).toBeNull();
    await settle();
    const line = find('dashboard-backup');
    expect(line?.textContent).toContain('This work has never been backed up on this machine.');
    expect(line?.getAttribute('data-kind')).toBe('never');
    // Muted, never red: no state colour, no role that would read it as an alert.
    expect(line?.className).not.toMatch(/danger|caution/);
    expect(line?.querySelector('[role="alert"]')).toBeNull();
  });

  it('says nothing of an empty work', async () => {
    host_(null);
    render(work('empty', { stages: [], activities: [] }));
    await settle();
    expect(find('dashboard-backup')).toBeNull();
  });

  it('says how old the backup is when the work changed after it', async () => {
    host_({ day: '2026-09-01' }, [entry(1, '2026-09-05')]);
    render(work('stale'));
    await settle();
    expect(find('dashboard-backup')?.textContent).toContain(
      'The last backup was 9 days ago, and the work has changed since.',
    );
  });

  it('says nothing of a recent backup, nor of an old one of a work nobody touched', async () => {
    host_({ day: '2026-09-03' }, [entry(1, '2026-09-05')]);
    render(work('recent'));
    await settle();
    expect(find('dashboard-backup')).toBeNull();

    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host_({ day: '2026-09-01' });
    render(work('untouched'));
    await settle();
    expect(find('dashboard-backup')).toBeNull();
  });

  it('says nothing when the last backup could not be read', async () => {
    host_(new Error('host silent'));
    render(work('unread'));
    await settle();
    expect(find('dashboard-backup')).toBeNull();
  });

  it('goes to the backup on "Back up now…"', async () => {
    host_(null);
    render(work('now'));
    await settle();
    expect(find('dashboard-backup-now')?.textContent).toBe('Back up now…');
    act(() => find('dashboard-backup-now')?.click());
    expect(openBackup).toHaveBeenCalledTimes(1);
  });

  it('puts it off for this session on "Not now", for this work only', async () => {
    host_(null);
    render(work('later'));
    await settle();
    act(() => find('dashboard-backup-later')?.click());
    expect(find('dashboard-backup')).toBeNull();
    expect(gone).toHaveBeenCalledTimes(1);
    // Back on the dashboard, still put off.
    act(() => root.unmount());
    root = createRoot(host);
    render(work('later'));
    await settle();
    expect(find('dashboard-backup')).toBeNull();
    // Another work is reminded as before.
    render(work('another'));
    await settle();
    expect(find('dashboard-backup')).not.toBeNull();
  });

  it('says it in Portuguese', async () => {
    host_({ day: '2026-09-01' }, [entry(1, '2026-09-05')]);
    render(work('pt'), 'pt-BR');
    await settle();
    expect(find('dashboard-backup')?.textContent).toContain(
      'A última cópia de segurança foi há 9 dias, e a obra mudou desde então.',
    );
    expect(find('dashboard-backup-now')?.textContent).toBe('Fazer a cópia de segurança agora…');
    expect(find('dashboard-backup-later')?.textContent).toBe('Agora não');
  });
});

describe('Settings opened from the reminder', () => {
  it('puts the focus on the backup’s path field, and lets the request go', async () => {
    host_(null);
    // As in the product: nothing goes stale on a timer, so the cached work is the work.
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(keys.work, work('settings'));
    client.setQueryData(keys.settings, BUILT_IN_SETTINGS);
    const taken = vi.fn();
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <main>
            <SettingsPage settings={BUILT_IN_SETTINGS} initialFocus="backup" onFocusTaken={taken} />
          </main>
        </QueryClientProvider>,
      ),
    );
    await settle();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('backup-path');
    expect(taken).toHaveBeenCalledTimes(1);
  });
});
