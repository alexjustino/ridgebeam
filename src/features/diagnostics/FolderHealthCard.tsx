import { DocumentSearch20Regular } from '@fluentui/react-icons';

import { useFolderHealth, useVerifyDocuments } from '@/data/queries';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';

/**
 * The work folder's health (slice F7): its size, the files in `documents/` and `thumbnails/`, and —
 * on a press — every document read again and hashed against its row, because the diary's chain
 * checks the rows and not the bytes. Files no row names are listed and kept; Ridgebeam never
 * deletes them. Rows whose file is missing are listed with the file they expect.
 */
export function FolderHealthCard() {
  const { t, tp, number, describeError } = useI18n();
  const health = useFolderHealth(true);
  const verify = useVerifyDocuments();
  const report = verify.data ?? null;
  const bad = report === null ? 0 : report.mismatched.length + report.missing.length;

  const status =
    report === null
      ? t('diagnostics.documents.notYet')
      : bad > 0
        ? tp('diagnostics.documents.bad', bad)
        : report.checked === 0
          ? t('diagnostics.documents.none')
          : tp('diagnostics.documents.ok', report.checked);

  const size = health.data?.folderBytes ?? null;

  return (
    <div data-testid="folder-health">
      <Card title={t('diagnostics.folder.title')} description={t('diagnostics.folder.description')}>
        {health.isError ? (
          <InfoBar severity="danger" title={t('common.hostSilent')}>
            {describeError(health.error)}
          </InfoBar>
        ) : (
          health.data !== undefined && (
            <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
              <dt className="text-fg-tertiary">{t('diagnostics.folder.size')}</dt>
              <dd className="text-fg tabular-nums">
                {size === null
                  ? ''
                  : size >= 1024 * 1024
                    ? t('documents.size.mb', {
                        value: number(Math.round((size / 1024 / 1024) * 10) / 10),
                      })
                    : t('documents.size.kb', {
                        value: number(Math.max(1, Math.round(size / 1024))),
                      })}
              </dd>
              <dt className="text-fg-tertiary">{t('diagnostics.folder.documents')}</dt>
              <dd className="text-fg tabular-nums">{number(health.data.documentFiles)}</dd>
              <dt className="text-fg-tertiary">{t('diagnostics.folder.thumbnails')}</dt>
              <dd className="text-fg tabular-nums">{number(health.data.thumbnailFiles)}</dd>
            </dl>
          )
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            icon={<DocumentSearch20Regular />}
            data-testid="documents-verify"
            disabled={verify.isPending}
            onClick={() => verify.mutate()}
          >
            {verify.isPending ? t('common.working') : t('diagnostics.documents.verify')}
          </Button>
          <span
            data-testid="documents-status"
            className={bad > 0 ? 'text-body font-semibold text-danger' : 'text-body text-fg'}
          >
            {status}
          </span>
        </div>
        {report !== null && bad > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5 text-caption text-fg-secondary">
            {report.mismatched.map((row) => (
              <li key={row.id}>{t('diagnostics.documents.mismatched', { name: row.fileName })}</li>
            ))}
            {report.missing.map((row) => (
              <li key={row.id} data-selectable>
                {t('diagnostics.documents.missing', { name: row.fileName })}
              </li>
            ))}
          </ul>
        )}
        {report !== null && report.orphans.length > 0 && (
          <div className="mt-2 text-caption text-fg-secondary">
            <p>{t('diagnostics.documents.orphans')}</p>
            <ul className="ml-4 list-disc font-mono" data-selectable>
              {report.orphans.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}
        {verify.isError && (
          <div className="mt-2">
            <InfoBar severity="danger" title={t('common.hostSilent')}>
              {describeError(verify.error)}
            </InfoBar>
          </div>
        )}
      </Card>
    </div>
  );
}
