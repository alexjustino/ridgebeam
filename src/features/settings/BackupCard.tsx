import { useCallback, useState } from 'react';

import type { BackupWritten } from '@/data/commands';
import { useBackupLast, useWriteBackup } from '@/data/queries';
import type { WorkSnapshot } from '@/domain/plan';
import { keyFrom } from '@/domain/templates/export';
import { sizeText } from '@/features/documents/size';
import { PathForm, ProblemBar } from '@/features/reports/PathForm';
import { useSaveTarget } from '@/features/reports/useSaveTarget';
import { useI18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';

/**
 * This work (slice F11, decision 4): the open work written out as one `.ridgebeam` file — its
 * database, its documents and photos, and a manifest with every file's hash — and the day it was
 * last backed up on this machine.
 *
 * The path follows the reports' rule (F9, F10): typed or chosen in the save dialog, and a file that
 * is already there is replaced only when the dialog chose it. The card says plainly that the file is
 * not encrypted: it holds everything the work holds, and is kept as the work folder is kept.
 */
export function BackupCard({ snapshot }: { snapshot: WorkSnapshot }) {
  const i18n = useI18n();
  const { t, tp, day, describeError } = i18n;
  const last = useBackupLast(true);
  const write = useWriteBackup();
  const [done, setDone] = useState<BackupWritten | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const suggested = useCallback(
    () => t('backup.file', { work: keyFrom(snapshot.work.name, 'work') }),
    [snapshot.work.name, t],
  );
  const target = useSaveTarget('ridgebeam', suggested);

  const clear = () => {
    setDone(null);
    setProblem(null);
  };

  const submit = () => {
    clear();
    const where = target.target();
    if (!where.ok) {
      setProblem(where.problem);
      return;
    }
    write.mutate(
      { path: where.path, overwrite: where.overwrite },
      {
        onSuccess: (file) => {
          setDone(file);
          announce(t('backup.done.announce', { path: file.path }));
        },
        onError: (error) => setProblem(describeError(error)),
      },
    );
  };

  const lastText = last.isError
    ? describeError(last.error)
    : last.data === undefined
      ? t('common.working')
      : last.data === null
        ? t('backup.last.never')
        : t('backup.last.on', { day: day(last.data.day) });

  return (
    <Card title={t('settings.work.title')} description={t('settings.work.description')}>
      <div className="flex flex-col gap-3">
        <p className="text-body font-semibold text-fg">{snapshot.work.name}</p>
        <p className="text-body text-fg-secondary">{t('backup.holds')}</p>
        <p className="text-caption text-fg-tertiary">{t('backup.notEncrypted')}</p>
        <p data-testid="backup-last" className="text-body text-fg">
          {lastText}
        </p>
        <PathForm
          target={target}
          testId="backup-path"
          writeTestId="backup-write"
          writeLabel={t('backup.write')}
          writing={write.isPending}
          onEdited={clear}
          onWrite={submit}
        />
        {problem !== null && <ProblemBar testId="backup-problem" problem={problem} />}
        {done !== null && (
          <div data-testid="backup-done">
            <InfoBar severity="success" title={t('backup.done.title')}>
              <p>
                <span data-selectable className="font-mono break-all">
                  {done.path}
                </span>
              </p>
              <p className="mt-1 text-fg-secondary">
                {t('backup.done.detail', {
                  size: sizeText(i18n, done.bytes),
                  files: tp('backup.done.files', done.files),
                })}
              </p>
              {done.leftOut.length > 0 && (
                <div className="mt-1 text-fg-secondary">
                  <p>{tp('backup.done.leftOut', done.leftOut.length)}</p>
                  <ul data-selectable className="ml-4 list-disc font-mono break-all">
                    {done.leftOut.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </InfoBar>
          </div>
        )}
      </div>
    </Card>
  );
}
