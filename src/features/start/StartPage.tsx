import {
  Add20Regular,
  Building20Regular,
  FolderOpen20Regular,
  Warning20Regular,
} from '@fluentui/react-icons';
import { useState } from 'react';

import type { RecentWork } from '@/data/commands';
import { useOpenWork, useRecentWorks } from '@/data/queries';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';

import { NewWorkDialog, OpenWorkDialog } from './WorkDialogs';

/**
 * Start: what the window shows while no work is open.
 *
 * Three doors and nothing else — a new work, a work that already exists, and the works this
 * machine opened before. A recent work whose folder is gone is not dropped from the list and not
 * shown as if it were there: it says the folder is missing, where it was, and offers to open the
 * work from wherever it is now (DESIGN_SYSTEM §10: degrade visibly).
 */
export function StartPage({ onOpened }: { onOpened: () => void }) {
  const { t, describeError } = useI18n();
  const recent = useRecentWorks();
  const reopen = useOpenWork();
  const [dialog, setDialog] = useState<'new' | 'open' | null>(null);
  const [openFrom, setOpenFrom] = useState('');

  const openDialog = (folder: string) => {
    setOpenFrom(folder);
    setDialog('open');
  };

  return (
    <div data-testid="start" className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">{t('start.title')}</h1>
        <p className="mt-1 max-w-2xl text-body text-fg-secondary">{t('start.lead')}</p>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button
          appearance="accent"
          icon={<Add20Regular />}
          data-testid="new-work"
          onClick={() => setDialog('new')}
        >
          {t('start.new')}
        </Button>
        <Button
          icon={<FolderOpen20Regular />}
          data-testid="open-work"
          onClick={() => openDialog('')}
        >
          {t('start.open')}
        </Button>
      </div>

      <Card title={t('start.recent.title')}>
        {recent.isError ? (
          <InfoBar severity="danger" title={t('start.recent.unread')}>
            {describeError(recent.error)}
          </InfoBar>
        ) : recent.isPending ? (
          <div className="h-16 rounded-md bg-card-hover" />
        ) : recent.data.length === 0 ? (
          <EmptyState
            icon={<Building20Regular />}
            title={t('start.recent.emptyTitle')}
            description={t('start.recent.emptyDescription')}
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {recent.data.map((work) => (
              <RecentRow
                key={work.workId}
                work={work}
                busy={reopen.isPending}
                onOpen={() => reopen.mutate(work.folder, { onSuccess: onOpened })}
                onFind={() => openDialog('')}
              />
            ))}
          </ul>
        )}
        {reopen.isError && (
          <div className="mt-3">
            <InfoBar severity="danger" title={t('work.openRefused')}>
              {describeError(reopen.error)}
            </InfoBar>
          </div>
        )}
      </Card>

      {/* Mounted only while open, so each opening starts from what was just chosen. */}
      {dialog === 'new' && (
        <NewWorkDialog open onClose={() => setDialog(null)} onCreated={onOpened} />
      )}
      {dialog === 'open' && (
        <OpenWorkDialog
          open
          initialFolder={openFrom}
          onClose={() => setDialog(null)}
          onOpened={onOpened}
        />
      )}
    </div>
  );
}

function RecentRow({
  work,
  busy,
  onOpen,
  onFind,
}: {
  work: RecentWork;
  busy: boolean;
  onOpen: () => void;
  onFind: () => void;
}) {
  const { t, instant } = useI18n();

  if (!work.present) {
    return (
      <li className="flex flex-col gap-1 rounded-md border border-stroke-subtle p-3">
        <span className="text-body font-semibold text-fg">{work.name}</span>
        <span className="flex items-start gap-2 text-caption text-fg-secondary">
          <Warning20Regular aria-hidden="true" className="shrink-0 text-caution" />
          <span data-selectable className="min-w-0 break-all">
            {t('start.recent.missing', { folder: work.folder })}
          </span>
        </span>
        <div>
          <Button icon={<FolderOpen20Regular />} onClick={onFind}>
            {t('start.recent.find')}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        data-testid="recent-work"
        disabled={busy}
        onClick={onOpen}
        className={[
          'flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left',
          'transition-colors duration-100 ease-easy hover:bg-card-hover active:bg-card-active',
          'disabled:cursor-wait',
        ].join(' ')}
      >
        <span className="text-body font-semibold text-fg">{work.name}</span>
        <span className="w-full truncate font-mono text-caption text-fg-tertiary">
          {work.folder}
        </span>
        <span className="text-caption text-fg-tertiary">
          {t('start.recent.opened', { when: instant(work.openedAt) })}
        </span>
      </button>
    </li>
  );
}
