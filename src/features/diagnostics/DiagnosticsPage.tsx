import { Copy20Regular, ShieldCheckmark20Regular } from '@fluentui/react-icons';
import { useId, useState } from 'react';

import {
  useAccentRamp,
  useDiagnostics,
  useDiagnosticsSummary,
  useSystemInfo,
  useVerifyDiary,
} from '@/data/queries';
import type { MigrationApplied } from '@/data/commands';
import { useI18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';
import { TextArea } from '@/ui/TextArea';

import { FolderHealthCard } from './FolderHealthCard';

/**
 * Diagnostics.
 *
 * It exists to make the product's claims checkable rather than asserted: which binary is running,
 * where its own database is and at which schema, whether the data folder was relocated, and —
 * when a work is open — its folder, its database, its schema and the pragmas the data model
 * promises (WAL, synchronous FULL, foreign keys on) — read back from the connection, not repeated
 * from the code that set them — and whether the accent is Windows's or the built-in one. It lists
 * only what exists; nothing here is
 * a promise about a later slice. What a person changes lives in Settings; this page only shows —
 * and, for a bug report, **Copy the diagnostics** puts the same facts on the clipboard as plain
 * text (F11, decision 5).
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

      <CopySummary />

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
                <Row
                  label={t('diagnostics.migrations')}
                  value={migrationsText(report.app.migrations, t('diagnostics.migrations.none'))}
                  mono
                />
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
            <Row
              label={t('diagnostics.migrations')}
              value={migrationsText(report.work.migrations, t('diagnostics.migrations.none'))}
              mono
            />
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
      {report !== null && report.work !== null && <DiaryCard />}
      {report !== null && report.work !== null && <FolderHealthCard />}
    </div>
  );
}

/**
 * Copy the diagnostics: the host writes them as plain text and the clipboard takes it, through the
 * browser's own clipboard — no plugin. The text keeps the folders as this machine names them, and
 * the sentence beside the button says so, so nobody sends a path without knowing. A clipboard that
 * refuses shows the text itself, selectable, rather than a failure with nothing to take away.
 */
function CopySummary() {
  const { t, describeError } = useI18n();
  const summary = useDiagnosticsSummary();
  const hint = useId();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [text, setText] = useState<string | null>(null);

  const copy = () => {
    setState('idle');
    summary.mutate(undefined, {
      onSuccess: (written) => {
        setText(written);
        navigator.clipboard.writeText(written).then(
          () => {
            setState('copied');
            announce(t('diagnostics.copy.done'));
          },
          () => setState('failed'),
        );
      },
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          icon={<Copy20Regular />}
          data-testid="diagnostics-copy"
          aria-describedby={hint}
          disabled={summary.isPending}
          onClick={copy}
        >
          {summary.isPending ? t('common.working') : t('diagnostics.copy')}
        </Button>
        {state === 'copied' && (
          <span data-testid="diagnostics-copied" className="text-body text-fg">
            {t('diagnostics.copy.done')}
          </span>
        )}
      </div>
      <p id={hint} className="text-caption text-fg-tertiary">
        {t('diagnostics.copy.note')}
      </p>
      {summary.isError && (
        <InfoBar severity="danger" title={t('common.hostSilent')}>
          {describeError(summary.error)}
        </InfoBar>
      )}
      {state === 'failed' && text !== null && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${hint}-text`} className="text-caption text-fg-secondary">
            {t('diagnostics.copy.failed')}
          </label>
          <TextArea
            id={`${hint}-text`}
            data-testid="diagnostics-copy-text"
            readOnly
            rows={8}
            className="font-mono text-caption"
            value={text}
          />
        </div>
      )}
    </div>
  );
}

/** The migrations a database has been through, by number and name: "1 001_work · 2 002_money". */
function migrationsText(migrations: readonly MigrationApplied[], none: string): string {
  if (migrations.length === 0) return none;
  return migrations.map((each) => `${each.number} ${each.name}`).join(' · ');
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

/**
 * The diary's chain, verified on a press (slice F4): the host recomputes every entry's hash and
 * every link to the one before, and says how many entries it read and whether the chain holds —
 * or at which entry, and why, it does not. Stated as what it is: tamper-evidence, not proof.
 */
function DiaryCard() {
  const { t, tp, describeError } = useI18n();
  const verify = useVerifyDiary();
  const report = verify.data ?? null;

  const status =
    report === null
      ? t('diagnostics.diary.notYet')
      : report.intact
        ? report.entries === 0
          ? t('diagnostics.diary.empty')
          : tp('diagnostics.diary.intact', report.entries)
        : t('diagnostics.diary.broken', {
            seq: report.brokenAt,
            reason:
              report.problem === 'contents'
                ? t('diagnostics.diary.problem.contents')
                : report.problem === 'link'
                  ? t('diagnostics.diary.problem.link')
                  : report.problem === 'missing'
                    ? t('diagnostics.diary.problem.missing')
                    : report.reason,
          });

  return (
    <Card title={t('diagnostics.diary.title')} description={t('diary.chain.note')}>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          icon={<ShieldCheckmark20Regular />}
          data-testid="diary-verify"
          disabled={verify.isPending}
          onClick={() => verify.mutate()}
        >
          {verify.isPending ? t('common.working') : t('diagnostics.diary.verify')}
        </Button>
        <span
          data-testid="chain-status"
          data-intact={report === null ? undefined : String(report.intact)}
          className={
            report !== null && !report.intact
              ? 'text-body font-semibold text-danger'
              : 'text-body text-fg'
          }
        >
          {status}
        </span>
      </div>
      {verify.isError && (
        <div className="mt-3">
          <InfoBar severity="danger" title={t('common.hostSilent')}>
            {describeError(verify.error)}
          </InfoBar>
        </div>
      )}
    </Card>
  );
}
