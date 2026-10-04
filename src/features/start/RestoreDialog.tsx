import { DocumentArrowUp20Regular } from '@fluentui/react-icons';
import { open as openFile } from '@tauri-apps/plugin-dialog';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import type { BackupSummary } from '@/data/commands';
import { useInspectBackup, useRestoreBackup } from '@/data/queries';
import { sizeText } from '@/features/documents/size';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';

import { FolderField } from './FolderField';
import { keepRestored } from './restored';
import { DialogFrame } from './WorkDialogs';

const EXTENSION = 'ridgebeam';

/**
 * Restore a backup (F11, decision 2): a `.ridgebeam` file, and the folder it becomes — empty, or not
 * there yet. A restore never overwrites anything; it makes a new work folder.
 *
 * Before anything is asked, the file's manifest is read (`backup_inspect`) and shown — which work,
 * when it was backed up and by which build, its schema, how many files and how large — so the person
 * sees what they are about to restore. The host checks every entry of the file against that manifest
 * and refuses the whole of it on the first thing that does not hold, leaving nothing behind; its
 * sentence is said here and the dialog stays open, with what was typed kept. On success the work
 * opens, and the Dashboard says what the restore found.
 */
export function RestoreDialog({ onClose }: { onClose: () => void }) {
  const i18n = useI18n();
  const { t, describeError } = i18n;
  const ids = useId();
  const inspect = useInspectBackup();
  const restore = useRestoreBackup(keepRestored);
  const [file, setFile] = useState('');
  const [folder, setFolder] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [dialogFailed, setDialogFailed] = useState(false);
  const [preview, setPreview] = useState<BackupSummary | null>(null);
  // The path the preview was read for, so the same file is not read again on every blur.
  const inspected = useRef<string | null>(null);

  const close = () => {
    inspect.reset();
    restore.reset();
    onClose();
  };

  const extensionProblem = (path: string): string | null =>
    path.toLowerCase().endsWith(`.${EXTENSION}`) && path.length > EXTENSION.length + 1
      ? null
      : t('reports.invalid.extension', { extension: EXTENSION });

  const read = (path: string) => {
    const trimmed = path.trim();
    if (trimmed === '' || trimmed === inspected.current) return;
    inspected.current = trimmed;
    setPreview(null);
    const wrong = extensionProblem(trimmed);
    if (wrong !== null) {
      setProblem(wrong);
      return;
    }
    setProblem(null);
    inspect.mutate(trimmed, {
      onSuccess: (summary) => {
        if (inspected.current === trimmed) setPreview(summary);
      },
      onError: (error) => {
        if (inspected.current === trimmed) setProblem(describeError(error));
      },
    });
  };

  const choose = async () => {
    try {
      const chosen = await openFile({
        multiple: false,
        directory: false,
        filters: [{ name: t('backup.filter'), extensions: [EXTENSION] }],
      });
      setDialogFailed(false);
      if (typeof chosen === 'string') {
        setFile(chosen);
        read(chosen);
      }
    } catch {
      setDialogFailed(true);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = file.trim();
    const where = folder.trim();
    const wrong =
      path === ''
        ? t('restore.invalid.file')
        : (extensionProblem(path) ?? (where === '' ? t('work.invalid.folder') : null));
    if (wrong !== null) {
      setProblem(wrong);
      return;
    }
    setProblem(null);
    restore.mutate(
      { path, folder: where },
      { onError: (error) => setProblem(describeError(error)) },
    );
  };

  const busy = restore.isPending;

  // A refusal is said at the end of the dialog's scrolling body; bring it into view, or the person
  // who pressed Restore sees nothing happen (F11: it sat below the fold).
  const problemAt = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (problem !== null) problemAt.current?.scrollIntoView({ block: 'nearest' });
  }, [problem]);

  return (
    <Modal open label={t('restore.title')} onClose={close} width="lg" height="fixed">
      <DialogFrame
        title={t('restore.title')}
        lead={t('restore.lead')}
        onSubmit={submit}
        actions={
          <>
            <Button onClick={close} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" appearance="accent" data-testid="restore-confirm" disabled={busy}>
              {busy ? t('common.working') : t('restore.confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-file`} className="text-caption font-semibold text-fg-secondary">
            {t('restore.file')}
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              id={`${ids}-file`}
              data-testid="restore-file"
              className="font-mono"
              spellCheck={false}
              autoComplete="off"
              aria-describedby={`${ids}-file-hint`}
              value={file}
              onChange={(event) => {
                setFile(event.target.value);
                setPreview(null);
                setProblem(null);
                inspected.current = null;
              }}
              onBlur={() => read(file)}
            />
            <Button icon={<DocumentArrowUp20Regular />} onClick={() => void choose()}>
              {t('reports.choose')}
            </Button>
          </div>
          <span id={`${ids}-file-hint`} className="text-caption text-fg-tertiary">
            {dialogFailed
              ? t('work.dialogUnavailable')
              : t('restore.file.hint', { extension: `.${EXTENSION}` })}
          </span>
        </div>

        {inspect.isPending && (
          <p className="text-caption text-fg-tertiary">{t('restore.preview.reading')}</p>
        )}
        {preview !== null && <Preview summary={preview} />}

        <FolderField
          value={folder}
          onChange={setFolder}
          label={t('restore.folder')}
          hint={t('restore.folder.hint')}
          testId="restore-folder"
        />

        <p className="text-caption text-fg-tertiary">{t('restore.never')}</p>

        {problem !== null && (
          <div ref={problemAt} data-testid="restore-problem">
            <InfoBar severity="danger" title={t('restore.refused')}>
              {problem}
            </InfoBar>
          </div>
        )}
      </DialogFrame>
    </Modal>
  );
}

/** What the file says it holds, read from its manifest — before anything is restored. */
function Preview({ summary }: { summary: BackupSummary }) {
  const i18n = useI18n();
  const { t, tp, instant } = i18n;
  return (
    <div
      data-testid="restore-preview"
      className="rounded-lg border border-stroke-subtle bg-layer p-3"
    >
      <p className="text-caption font-semibold text-fg-secondary">{t('restore.preview.title')}</p>
      <p className="mt-1 text-body-lg font-semibold text-fg">{summary.workName}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-body">
        <dt className="text-fg-tertiary">{t('restore.preview.created')}</dt>
        <dd className="text-fg">{instant(summary.createdAt)}</dd>
        <dt className="text-fg-tertiary">{t('restore.preview.app')}</dt>
        <dd className="text-fg">{summary.app}</dd>
        <dt className="text-fg-tertiary">{t('diagnostics.schema')}</dt>
        <dd className="font-mono text-caption text-fg">{String(summary.schemaVersion)}</dd>
        <dt className="text-fg-tertiary">{t('restore.preview.holds')}</dt>
        <dd className="text-fg">
          {t('restore.preview.files', {
            files: tp('backup.done.files', summary.files),
            size: sizeText(i18n, summary.bytes),
          })}
        </dd>
      </dl>
      {summary.recentFolder !== null && (
        <p data-testid="restore-preview-recent" className="mt-2 text-caption text-fg-secondary">
          {t('restore.preview.recent', { folder: summary.recentFolder })}
        </p>
      )}
    </div>
  );
}
