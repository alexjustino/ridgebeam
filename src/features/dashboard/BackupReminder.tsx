import { useNavigation } from '@/app/navigation';
import { useBackupLast, useDiary } from '@/data/queries';
import { backupDue, workChanges } from '@/domain/backup';
import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';

import { useBackupLater } from './backupLater';

/**
 * The backup reminder (slice U1, decision 3): one quiet line under the dashboard's header when the
 * work has never been backed up on this machine, or the last backup is more than a week old and the
 * work has changed since — the domain's rule (`backupDue`), never the screen's.
 *
 * It is a reminder, not a warning: muted, never red, no icon of alarm. **Back up now…** goes to
 * Settings → This work with the focus on the backup's path field, so the backup is the one flow
 * that already writes one; the product never backs up on its own. **Not now** puts it off for this
 * session. A backup written is read again by the last-backup query, and the line is gone.
 *
 * Nothing is said while the last backup or the diary is still being read, or could not be read: a
 * reminder built on a guess would say "never" of a work that was backed up yesterday.
 */
export function BackupReminder({
  snapshot,
  today,
  onGone,
}: {
  snapshot: WorkSnapshot;
  today: string;
  /** Called after "Not now", so the focus goes somewhere rather than nowhere. */
  onGone: () => void;
}) {
  const { t, tp } = useI18n();
  const navigation = useNavigation();
  const last = useBackupLast(true);
  const diary = useDiary(true);
  const { putOff, notNow } = useBackupLater(snapshot.work.workId);

  if (putOff || last.isError || last.data === undefined || diary.data === undefined) return null;
  const due = backupDue({
    lastBackupAt: last.data?.day ?? null,
    today,
    ...workChanges(snapshot, diary.data),
  });
  if (due === null) return null;

  return (
    <div
      data-testid="dashboard-backup"
      data-kind={due.kind}
      className="flex flex-col gap-2 rounded-lg border border-stroke-subtle bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-body text-fg-secondary">
        {due.kind === 'never'
          ? t('dashboard.backup.never')
          : tp('dashboard.backup.stale', due.days)}
      </p>
      <div className="grid shrink-0 grid-cols-2 gap-2">
        <Button data-testid="dashboard-backup-now" onClick={navigation.openBackup}>
          {t('dashboard.backup.now')}
        </Button>
        <Button
          appearance="subtle"
          data-testid="dashboard-backup-later"
          onClick={() => {
            notNow();
            onGone();
          }}
        >
          {t('dashboard.backup.later')}
        </Button>
      </div>
    </div>
  );
}
