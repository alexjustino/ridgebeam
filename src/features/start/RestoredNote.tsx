import { Dismiss20Regular } from '@fluentui/react-icons';
import { useEffect, useRef } from 'react';

import { useI18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';

import { dismissRestored, firstShowing, useRestored } from './restored';

/**
 * What a restore found (`restore-done`), on the Dashboard of the work it restored, until dismissed:
 * "Restored: 3 entries, chain verified, 2 documents as recorded" — and, when the recent list knew
 * this work at another folder, that the list now points here and the old folder was left as it was.
 *
 * The Start screen and its dialog are gone once the work is open, so the focus comes here when the
 * sentence appears — a keyboard user lands on what happened, not on the top of the window — and
 * dismissing it (the button removes itself) sends the focus where the caller says.
 */
export function RestoredNote({ workId, onDismissed }: { workId: string; onDismissed: () => void }) {
  const { t, tp } = useI18n();
  const report = useRestored(workId);
  const region = useRef<HTMLDivElement>(null);

  const bad = report === null ? 0 : report.mismatched.length + report.missing.length;
  const whole = report !== null && report.chainOk && bad === 0;
  const summary =
    report === null
      ? ''
      : t('restore.done.summary', {
          entries: tp('restore.done.entries', report.entries),
          chain: report.chainOk ? t('restore.done.chainOk') : t('restore.done.chainBroken'),
          documents:
            bad > 0
              ? tp('restore.done.documentsBad', bad)
              : tp('restore.done.documents', report.documents),
        });

  useEffect(() => {
    if (summary === '' || !firstShowing()) return;
    announce(summary);
    region.current?.focus();
  }, [summary]);

  if (report === null) return null;

  return (
    <div ref={region} tabIndex={-1} data-testid="restore-done">
      <InfoBar severity={whole ? 'success' : 'caution'} title={t('restore.done.title')}>
        <p>{summary}</p>
        <p className="mt-1 text-fg-secondary">
          {t('restore.done.folder')}{' '}
          <span data-selectable className="font-mono break-all">
            {report.folder}
          </span>
        </p>
        {bad > 0 && (
          <ul className="mt-1 ml-4 list-disc">
            {report.mismatched.map((row) => (
              <li key={row.id}>{t('diagnostics.documents.mismatched', { name: row.fileName })}</li>
            ))}
            {report.missing.map((row) => (
              <li key={row.id}>{t('diagnostics.documents.missing', { name: row.fileName })}</li>
            ))}
          </ul>
        )}
        {report.movedRecentFrom !== null && (
          <p data-testid="restore-moved" className="mt-1 text-fg-secondary">
            {t('restore.done.moved', { folder: report.movedRecentFrom })}
          </p>
        )}
        <div className="mt-2">
          <Button
            icon={<Dismiss20Regular />}
            data-testid="restore-done-dismiss"
            onClick={() => {
              dismissRestored();
              onDismissed();
            }}
          >
            {t('restore.done.dismiss')}
          </Button>
        </div>
      </InfoBar>
    </div>
  );
}
