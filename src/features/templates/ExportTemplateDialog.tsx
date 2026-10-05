import { ArrowExportLtr20Regular, FolderOpen20Regular, Save20Regular } from '@fluentui/react-icons';
import { save } from '@tauri-apps/plugin-dialog';
import { useId, useState, type FormEvent } from 'react';

import { useToday } from '@/app/today';
import { LIBRARY } from '@/data/library';
import {
  useDiary,
  useMyTemplates,
  useMyTemplatesFolder,
  useSaveMyTemplate,
  useWriteTemplate,
} from '@/data/queries';
import type { WorkSnapshot } from '@/domain/plan';
import { learnedCounts } from '@/domain/schedule/actuals';
import { exportTemplate, keyFrom, templateText } from '@/domain/templates/export';
import { TEMPLATE_LIMITS } from '@/domain/templates/format';
import { parseTemplate } from '@/domain/templates/validate';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { ChoiceGroup } from '@/ui/ChoiceGroup';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';

type Numbers = 'strip' | 'keep' | 'learned';
const NUMBERS: readonly Numbers[] = ['strip', 'keep', 'learned'];

type Where = 'mine' | 'file';
const WHERE: readonly Where[] = ['mine', 'file'];

/** Where the template went, as the dialog says it once it is done. */
type Done =
  | { readonly where: 'file'; readonly path: string }
  | { readonly where: 'mine'; readonly id: string };

/**
 * Export the work as a template (F9, ADR-030): its shape — stages, activities, rooms, links, checks,
 * decisions and cost lines — in the language on screen, with its numbers stripped (the default:
 * something to share), kept (this work's own, to start the next one like it), or — slice G3 —
 * **learned from this work**: every finished activity's duration becomes a range that holds what was
 * planned and what the diary says it took (ADR-047). The domain builds the template and checks it as
 * any file would be checked; the host writes it.
 *
 * **Where** it goes: **My templates** (`export-where` `mine`, first when the choice is learned) — a
 * folder of the application data the template picker offers under Your templates, named by an id
 * proposed from the work's name (`export-id`) and saved with `export-save`; an id already there asks
 * before replacing it (`export-replace-confirm`) — or **A file** (`file`), as before: chosen in the
 * system's save dialog or typed (`export-path`), the dialog only filling the field. A file that exists
 * is replaced only when the save dialog chose it, because the dialog asked first — a typed path never
 * replaces one. Success is said in the dialog with where it went (`export-done`) and announced; the
 * dialog stays open, so the focus stays where it was.
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
  const i18n = useI18n();
  const { t, tp, language, describeError } = i18n;
  const term = useTerms();
  const write = useWriteTemplate();
  const keep = useSaveMyTemplate();
  const ids = useId();
  const today = useToday();
  const diary = useDiary(true);
  const [numbers, setNumbers] = useState<Numbers>('strip');
  // The place the person chose; until they choose, it follows the numbers (mine when learned).
  const [whereChosen, setWhereChosen] = useState<Where | null>(null);
  const where: Where = whereChosen ?? (numbers === 'learned' ? 'mine' : 'file');
  const mine = useMyTemplates(where === 'mine');
  const folder = useMyTemplatesFolder(where === 'mine');
  const [path, setPath] = useState('');
  // The path the save dialog returned: the one file the person agreed may be replaced.
  const [chosen, setChosen] = useState<string | null>(null);
  const [dialogFailed, setDialogFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // A template of yours with this id is already there: asked before it is written over.
  const [replacing, setReplacing] = useState<{ id: string; text: string } | null>(null);

  const fileId = keyFrom(snapshot.work.name);
  const proposed = keyFrom(snapshot.work.name, 'my-work', TEMPLATE_LIMITS.idChars);
  const [idField, setIdField] = useState(proposed);
  // What will be saved: the field, made an id the same way the proposal was.
  const mineId = keyFrom(idField, proposed, TEMPLATE_LIMITS.idChars);

  const counts = diary.data === undefined ? null : learnedCounts(snapshot, diary.data, today);
  const pending = write.isPending || keep.isPending;

  const close = () => {
    write.reset();
    keep.reset();
    onClose();
  };

  const changed = () => {
    setDone(null);
    setProblem(null);
  };

  const choose = async () => {
    try {
      const picked = await save({
        defaultPath: path.trim() === '' ? `${fileId}.json` : path.trim(),
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

  /** The template's text, checked as any file is; `null` with the problem said when it is not. */
  const textFor = (id: string): string | null => {
    const entries = diary.data;
    if (numbers === 'learned' && (entries === undefined || counts === null)) {
      setProblem(
        diary.isError ? describeError(diary.error) : t('templates.export.learned.reading'),
      );
      return null;
    }
    const template = exportTemplate(snapshot, {
      numbers,
      language,
      id,
      title: snapshot.work.name,
      ...(numbers === 'learned' && entries !== undefined && counts !== null
        ? {
            learnedFrom: { entries, today },
            // In the work's language — the one the template is written in.
            summary: tp('templates.export.learned.summary', counts.total, {
              work: snapshot.work.name,
              finished: counts.finished,
            }),
          }
        : {}),
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
      return null;
    }
    return text;
  };

  const saveMine = (id: string, text: string, overwrite: boolean) => {
    keep.mutate(
      { id, text, overwrite },
      {
        onSuccess: () => {
          setDone({ where: 'mine', id });
          announce(t('templates.export.savedMine', { id }));
        },
        onError: (error) => setProblem(describeError(error)),
      },
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDone(null);
    if (where === 'mine') {
      const text = textFor(mineId);
      if (text === null) return;
      setProblem(null);
      if (mine.data?.templates.some((each) => each.id === mineId)) {
        setReplacing({ id: mineId, text });
        return;
      }
      saveMine(mineId, text, false);
      return;
    }
    const target = path.trim();
    if (!/\.json$/i.test(target)) {
      setProblem(t('templates.export.invalid.path'));
      return;
    }
    const text = textFor(fileId);
    if (text === null) return;
    setProblem(null);
    write.mutate(
      { path: target, text, overwrite: chosen === target },
      {
        onSuccess: () => {
          setDone({ where: 'file', path: target });
          announce(t('templates.export.done', { path: target }));
        },
        onError: (error) => setProblem(describeError(error)),
      },
    );
  };

  const title = t('templates.export.title', { template: term('template') });
  const hint =
    numbers === 'strip'
      ? t('templates.export.strip.hint')
      : numbers === 'keep'
        ? t('templates.export.keep.hint')
        : t('templates.export.learned.hint');

  return (
    <>
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
                    changed();
                  }}
                  labels={{
                    strip: t('templates.export.strip'),
                    keep: t('templates.export.keep'),
                    learned: t('templates.export.learned'),
                  }}
                />
              </div>
              <p className="text-caption text-fg-secondary">{hint}</p>
              {numbers === 'learned' && (
                <p data-testid="export-learned-counts" className="text-caption text-fg-secondary">
                  {counts === null
                    ? diary.isError
                      ? describeError(diary.error)
                      : t('templates.export.learned.reading')
                    : tp('templates.export.learned.counts', counts.total, {
                        finished: counts.finished,
                      })}
                </p>
              )}
            </div>

            <div data-testid="export-where">
              <ChoiceGroup
                label={t('templates.export.where')}
                options={WHERE}
                value={where}
                onChange={(next) => {
                  setWhereChosen(next);
                  changed();
                }}
                labels={{
                  mine: t('templates.export.where.mine'),
                  file: t('templates.export.where.file'),
                }}
              />
            </div>

            {where === 'mine' ? (
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${ids}-id`}
                  className="text-caption font-semibold text-fg-secondary"
                >
                  {t('templates.export.id')}
                </label>
                <Input
                  id={`${ids}-id`}
                  data-testid="export-id"
                  className="font-mono"
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby={`${ids}-id-hint`}
                  maxLength={TEMPLATE_LIMITS.idChars * 2}
                  value={idField}
                  onChange={(event) => {
                    setIdField(event.target.value);
                    changed();
                  }}
                />
                <span id={`${ids}-id-hint`} className="text-caption text-fg-tertiary">
                  {t('templates.export.idHint', { file: `${mineId}.json` })}
                </span>
                {folder.data !== undefined && (
                  <span className="text-caption text-fg-tertiary">
                    {t('templates.mine.folder')}{' '}
                    <span
                      data-testid="export-folder"
                      data-selectable
                      className="font-mono break-all"
                    >
                      {folder.data}
                    </span>
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${ids}-path`}
                  className="text-caption font-semibold text-fg-secondary"
                >
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
            )}

            {problem !== null && (
              <div data-testid="export-problem">
                <InfoBar severity="danger" title={t('templates.export.problem')}>
                  {problem}
                </InfoBar>
              </div>
            )}
            {done !== null && (
              <div data-testid="export-done" data-where={done.where}>
                {done.where === 'file' ? (
                  <InfoBar severity="success" title={t('templates.export.doneTitle')}>
                    <span data-selectable className="font-mono break-all">
                      {done.path}
                    </span>
                  </InfoBar>
                ) : (
                  <InfoBar severity="success" title={t('templates.export.savedMineTitle')}>
                    {t('templates.export.savedMine', { id: done.id })}
                  </InfoBar>
                )}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-stroke-subtle p-4">
            <Button onClick={close} disabled={pending}>
              {done === null ? t('common.cancel') : t('common.close')}
            </Button>
            {where === 'mine' ? (
              <Button
                type="submit"
                appearance="accent"
                icon={<Save20Regular />}
                data-testid="export-save"
                disabled={pending}
              >
                {pending ? t('common.working') : t('templates.export.save')}
              </Button>
            ) : (
              <Button
                type="submit"
                appearance="accent"
                icon={<ArrowExportLtr20Regular />}
                data-testid="export-confirm"
                disabled={pending}
              >
                {pending ? t('common.working') : t('templates.export.confirm')}
              </Button>
            )}
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={open && replacing !== null}
        over
        danger
        title={t('templates.export.replace.title', { id: replacing?.id ?? '' })}
        confirmLabel={t('templates.export.replace.confirm')}
        confirmTestId="export-replace-confirm"
        pending={keep.isPending}
        onCancel={() => setReplacing(null)}
        onConfirm={() => {
          if (replacing === null) return;
          setReplacing(null);
          saveMine(replacing.id, replacing.text, true);
        }}
      >
        {t('templates.export.replace.body', { id: replacing?.id ?? '' })}
      </ConfirmDialog>
    </>
  );
}
