import { ArrowExportLtr20Regular, FolderOpen20Regular } from '@fluentui/react-icons';
import { save } from '@tauri-apps/plugin-dialog';
import { useId, useState, type FormEvent } from 'react';

import { LIBRARY } from '@/data/library';
import { useWriteTemplate } from '@/data/queries';
import type { WorkSnapshot } from '@/domain/plan';
import { exportTemplate, keyFrom, templateText } from '@/domain/templates/export';
import { parseTemplate } from '@/domain/templates/validate';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { ChoiceGroup } from '@/ui/ChoiceGroup';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';

type Numbers = 'strip' | 'keep';
const NUMBERS: readonly Numbers[] = ['strip', 'keep'];

/**
 * Export the work as a template (F9, ADR-030): its shape — stages, activities, rooms, links, checks,
 * decisions and cost lines — in the language on screen, with its numbers stripped (the default:
 * something to share) or kept (this work's own, to start the next one like it). The domain builds the
 * template and checks it as any file would be checked; the host writes it.
 *
 * The file is chosen in the system's save dialog or typed (`export-path`); the dialog only fills the
 * field. A file that exists is replaced only when the save dialog chose it, because the dialog asked
 * first — a typed path never replaces one. Success is said in the dialog with the path
 * (`export-done`) and announced; the dialog stays open, so the focus stays where it was.
 */
export function ExportTemplateDialog({
  snapshot,
  open,
  onClose,
}: {
  snapshot: WorkSnapshot;
  open: boolean;
  onClose: () => void;
}) {
  const { t, language, describeError } = useI18n();
  const term = useTerms();
  const write = useWriteTemplate();
  const ids = useId();
  const [numbers, setNumbers] = useState<Numbers>('strip');
  const [path, setPath] = useState('');
  // The path the save dialog returned: the one file the person agreed may be replaced.
  const [chosen, setChosen] = useState<string | null>(null);
  const [dialogFailed, setDialogFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const id = keyFrom(snapshot.work.name);

  const close = () => {
    write.reset();
    onClose();
  };

  const choose = async () => {
    try {
      const picked = await save({
        defaultPath: path.trim() === '' ? `${id}.json` : path.trim(),
        filters: [{ name: t('templates.file.filter'), extensions: ['json'] }],
      });
      setDialogFailed(false);
      if (typeof picked === 'string') {
        setPath(picked);
        setChosen(picked);
      }
    } catch {
      setDialogFailed(true);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDone(null);
    const target = path.trim();
    if (!/\.json$/i.test(target)) {
      setProblem(t('templates.export.invalid.path'));
      return;
    }
    const template = exportTemplate(snapshot, {
      numbers,
      language,
      id,
      title: snapshot.work.name,
    });
    const text = templateText(template);
    // What is written must be a template this product would read back: checked as any file is.
    const check = parseTemplate(text, 'file', LIBRARY);
    if (!check.ok) {
      setProblem(
        check.problems
          .slice(0, 3)
          .map((each) => `${t(each.key, each.detail)} (${each.path})`)
          .join(' '),
      );
      return;
    }
    setProblem(null);
    write.mutate(
      { path: target, text, overwrite: chosen === target },
      {
        onSuccess: () => {
          setDone(target);
          announce(t('templates.export.done', { path: target }));
        },
        onError: (error) => setProblem(describeError(error)),
      },
    );
  };

  const title = t('templates.export.title', { template: term('template') });

  return (
    <Modal open={open} label={title} onClose={close} width="lg">
      <form
        aria-labelledby={`${ids}-title`}
        className="flex min-h-0 flex-col"
        noValidate
        onSubmit={submit}
      >
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
          <div>
            <h2 id={`${ids}-title`} className="text-subtitle font-semibold text-fg">
              {title}
            </h2>
            <p className="mt-1 text-body text-fg-secondary">{t('templates.export.lead')}</p>
          </div>

          <div className="flex flex-col gap-2">
            <div data-testid="export-numbers">
              <ChoiceGroup
                label={t('templates.export.numbers')}
                options={NUMBERS}
                value={numbers}
                onChange={(next) => {
                  setNumbers(next);
                  setDone(null);
                }}
                labels={{ strip: t('templates.export.strip'), keep: t('templates.export.keep') }}
              />
            </div>
            <p className="text-caption text-fg-secondary">
              {numbers === 'strip'
                ? t('templates.export.strip.hint')
                : t('templates.export.keep.hint')}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-path`} className="text-caption font-semibold text-fg-secondary">
              {t('templates.export.path')}
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input
                id={`${ids}-path`}
                data-testid="export-path"
                className="font-mono"
                spellCheck={false}
                autoComplete="off"
                aria-describedby={`${ids}-hint`}
                value={path}
                onChange={(event) => {
                  setPath(event.target.value);
                  setDone(null);
                }}
              />
              <Button icon={<FolderOpen20Regular />} onClick={() => void choose()}>
                {t('templates.export.choose')}
              </Button>
            </div>
            <span id={`${ids}-hint`} className="text-caption text-fg-tertiary">
              {dialogFailed ? t('work.dialogUnavailable') : t('templates.export.pathHint')}
            </span>
          </div>

          {problem !== null && (
            <div data-testid="export-problem">
              <InfoBar severity="danger" title={t('templates.export.problem')}>
                {problem}
              </InfoBar>
            </div>
          )}
          {done !== null && (
            <div data-testid="export-done">
              <InfoBar severity="success" title={t('templates.export.doneTitle')}>
                <span data-selectable className="font-mono break-all">
                  {done}
                </span>
              </InfoBar>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-stroke-subtle p-4">
          <Button onClick={close} disabled={write.isPending}>
            {done === null ? t('common.cancel') : t('common.close')}
          </Button>
          <Button
            type="submit"
            appearance="accent"
            icon={<ArrowExportLtr20Regular />}
            data-testid="export-confirm"
            disabled={write.isPending}
          >
            {write.isPending ? t('common.working') : t('templates.export.confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
