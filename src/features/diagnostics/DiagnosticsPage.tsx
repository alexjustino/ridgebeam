import { useAccentRamp, useDiagnostics, useSystemInfo } from '@/data/queries';
import { useI18n } from '@/i18n/useI18n';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';

/**
 * Diagnostics.
 *
 * It exists to make the product's claims checkable rather than asserted: which binary is running,
 * where its own database is and at which schema, whether the data folder was relocated, and —
 * when a work is open — its folder, its database, its schema and the pragmas the data model
 * promises (WAL, synchronous FULL, foreign keys on) — read back from the connection, not repeated
 * from the code that set them — and whether the accent is Windows's or the built-in one. It lists
 * only what exists; nothing here is
 * a promise about a later slice. What a person changes lives in Settings; this page only shows.
 */
export function DiagnosticsPage() {
  const { t, describeError } = useI18n();
  const system = useSystemInfo();
  const diagnostics = useDiagnostics();
  const accent = useAccentRamp();
  const info = system.data ?? null;
  const report = diagnostics.data ?? null;
  const failure = system.error ?? diagnostics.error;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">{t('nav.diagnostics')}</h1>
        <p className="mt-1 text-body text-fg-secondary">{t('diagnostics.lead')}</p>
      </header>

      {failure !== null && (
        <InfoBar severity="danger" title={t('common.hostSilent')}>
          {describeError(failure)}
        </InfoBar>
      )}

      <Card title={t('diagnostics.app.title')} description={t('diagnostics.app.description')}>
        {info === null && report === null ? (
          <div className="h-24 rounded-md bg-card-hover" />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
            {info !== null && (
              <>
                <Row label={t('diagnostics.version')} value={info.version} />
                <Row label={t('diagnostics.platform')} value={`${info.os} ${info.arch}`} />
                <Row label={t('diagnostics.dataDir')} value={info.appDataDir} mono />
              </>
            )}
            {report !== null && (
              <>
                <Row label={t('diagnostics.database')} value={report.app.databasePath} mono />
                <Row label={t('diagnostics.schema')} value={String(report.app.schemaVersion)} />
              </>
            )}
            {info !== null && (
              <Row
                label={t('diagnostics.relocated')}
                value={info.databaseRelocated ? t('common.yes') : t('common.no')}
              />
            )}
            {/* The accent is the person's; when Windows could not be asked, the screen says the
                colour is ours instead of passing it off as theirs (DESIGN_SYSTEM §2). */}
            {accent.data !== undefined && (
              <Row
                label={t('diagnostics.accent')}
                value={
                  accent.data.fromSystem
                    ? t('diagnostics.accentSystem')
                    : t('diagnostics.accentDefault')
                }
              />
            )}
          </dl>
        )}
        {info?.databaseRelocated === true && (
          <p className="mt-3 text-caption text-fg-secondary">{t('diagnostics.relocatedNote')}</p>
        )}
      </Card>

      {report !== null && report.work !== null && (
        <Card title={t('diagnostics.work.title')} description={t('diagnostics.work.description')}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
            <Row label={t('diagnostics.folder')} value={report.work.folder} mono />
            <Row label={t('diagnostics.database')} value={report.work.databasePath} mono />
            <Row label={t('diagnostics.schema')} value={String(report.work.schemaVersion)} />
            <Row label={t('diagnostics.journal')} value={report.work.journalMode.toUpperCase()} />
            <Row
              label={t('diagnostics.synchronous')}
              value={report.work.synchronous.toUpperCase()}
            />
            <Row
              label={t('diagnostics.foreignKeys')}
              value={report.work.foreignKeys ? t('common.on') : t('common.off')}
            />
          </dl>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-fg-tertiary">{label}</dt>
      <dd
        data-selectable
        className={`min-w-0 break-all text-fg ${mono ? 'font-mono text-caption' : ''}`}
      >
        {value}
      </dd>
    </>
  );
}
