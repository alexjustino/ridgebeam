import { FolderOpen20Regular, Open20Regular } from '@fluentui/react-icons';
import { useId, type ReactNode } from 'react';

import type { WrittenFile } from '@/data/commands';
import { useOpenReport } from '@/data/queries';
import { sizeText } from '@/features/documents/size';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';

import { PATH_KEYS, type SaveTarget } from './useSaveTarget';

/**
 * One file's row on a card: the path field with **Choose…** beside it, the hint, and the button that
 * writes it. A form, so Enter in the field writes too. The field keeps what was typed whatever the
 * host answers, so a refused path can be corrected rather than typed again (DESIGN_SYSTEM §10).
 */
export function PathForm({
  target,
  testId,
  writeTestId,
  writeLabel,
  writing,
  disabled = false,
  onEdited,
  onWrite,
  children,
}: {
  target: SaveTarget;
  /** The field's test id — the contract with the end-to-end suite. */
  testId: string;
  writeTestId: string;
  writeLabel: string;
  writing: boolean;
  disabled?: boolean;
  /** The path changed: whatever was said about the last file no longer applies. */
  onEdited: () => void;
  onWrite: () => void;
  /** A line under the hint, for what this file is written with (the CSV's separator). */
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();

  return (
    <form
      noValidate
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (!writing && !disabled) onWrite();
      }}
    >
      <label htmlFor={`${id}-path`} className="text-caption font-semibold text-fg-secondary">
        {t(PATH_KEYS[target.kind])}
      </label>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          id={`${id}-path`}
          data-testid={testId}
          className="font-mono"
          spellCheck={false}
          autoComplete="off"
          aria-describedby={`${id}-hint`}
          value={target.path}
          onChange={(event) => {
            target.setPath(event.target.value);
            onEdited();
          }}
        />
        <Button
          icon={<FolderOpen20Regular />}
          className="justify-self-start"
          onClick={() => {
            void target.choose().then((picked) => {
              if (picked !== null) onEdited();
            });
          }}
        >
          {t('reports.choose')}
        </Button>
      </div>
      <span id={`${id}-hint`} className="text-caption text-fg-tertiary">
        {target.dialogFailed ? t('work.dialogUnavailable') : t('reports.pathHint')}
      </span>
      {children}
      <div className="mt-2">
        <Button
          type="submit"
          appearance="accent"
          data-testid={writeTestId}
          disabled={writing || disabled}
        >
          {writing ? t('common.working') : writeLabel}
        </Button>
      </div>
    </form>
  );
}

/** The last base name of a path, for a label that names the file. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * What was written, with its path, and **Open** — the host opens that file, and only a file a report
 * command wrote in this session (decision 8). A failure to open is said where the card says its
 * refusals, through `onOpenFailed`. `size` adds the file's size in words — the owner's snapshot
 * (D4), a file meant to be sent, says how big it is before somebody attaches it to a message.
 */
export function WrittenBar({
  testId,
  written,
  onOpenFailed,
  size = false,
}: {
  testId: string;
  written: WrittenFile;
  onOpenFailed: (error: unknown) => void;
  size?: boolean;
}) {
  const i18n = useI18n();
  const { tp, t } = i18n;
  const open = useOpenReport();

  return (
    <div data-testid={testId}>
      <InfoBar severity="success" title={t('reports.done.title')}>
        <p>
          <span data-selectable className="font-mono break-all">
            {written.path}
          </span>
          {written.pages !== undefined && (
            <span className="text-fg-secondary"> · {tp('reports.done.pages', written.pages)}</span>
          )}
          {size && (
            <span data-testid={`${testId}-size`} className="text-fg-secondary">
              {' · '}
              {sizeText(i18n, written.bytes)}
            </span>
          )}
        </p>
        <div className="mt-2">
          <Button
            icon={<Open20Regular />}
            data-testid="report-open"
            aria-label={t('reports.open.label', { name: baseName(written.path) })}
            disabled={open.isPending}
            onClick={() => open.mutate(written.path, { onError: onOpenFailed })}
          >
            {t('reports.open')}
          </Button>
        </div>
      </InfoBar>
    </div>
  );
}

/** A refusal, in the host's or the interface's own sentence, where the card's test id names it. */
export function ProblemBar({ testId, problem }: { testId: string; problem: string }) {
  const { t } = useI18n();
  return (
    <div data-testid={testId}>
      <InfoBar severity="danger" title={t('reports.problem')}>
        {problem}
      </InfoBar>
    </div>
  );
}
