import { DocumentText20Regular, FolderOpen20Regular } from '@fluentui/react-icons';
import { open } from '@tauri-apps/plugin-dialog';
import { useId, useState } from 'react';

import { TEMPLATE_PROBLEM_KEYS, type TemplateProblem } from '@/domain/templates/validate';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

import { countsText } from './plan';
import { EMPTY_PLAN, FROM_FILE, type TemplateChoice } from './useTemplateChoice';

/** How many of a file's problems are listed before the rest are counted. */
const PROBLEMS_SHOWN = 8;

/**
 * The template picker (F9): an empty plan, a template of the library by its title, or a file — and,
 * under it, what the choice starts: its summary, how many stages, activities, decisions and checks
 * it writes, and that it is a starting point with ranges, never a quote (DESIGN_SYSTEM §8).
 *
 * A file is chosen in the system's dialog or typed as a path — the dialog only fills the field, the
 * field is what is read (the pattern of the work's folder). What the domain or the host refuses is
 * said under the picker, every problem with where in the file it is (`template-problem`).
 *
 * The same picker is the New work form's and the empty breakdown's; `hostProblem` is a refusal the
 * host gave for the plan itself, which belongs here too.
 */
export function TemplatePicker({
  state,
  hostProblem = null,
}: {
  state: TemplateChoice;
  hostProblem?: string | null;
}) {
  const { t, tp, describeError } = useI18n();
  const id = useId();
  const [dialogFailed, setDialogFailed] = useState(false);
  const { choice, file, preview } = state;

  const choose = async () => {
    try {
      const chosen = await open({
        multiple: false,
        directory: false,
        filters: [{ name: t('templates.file.filter'), extensions: ['json'] }],
      });
      setDialogFailed(false);
      if (typeof chosen === 'string') state.setPath(chosen);
    } catch {
      setDialogFailed(true);
    }
  };

  const problems: readonly TemplateProblem[] =
    file?.status === 'read' && !file.validation.ok ? file.validation.problems : [];
  // A template with no stage passes as a file, but has no plan to start: said, and not previewed.
  const stageless = preview !== null && preview.counts.stages === 0;
  const refusal =
    hostProblem ??
    (file?.status === 'failed'
      ? describeError(file.error)
      : state.pathMissing
        ? t('templates.file.pathMissing')
        : stageless
          ? t(TEMPLATE_PROBLEM_KEYS.empty)
          : null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-choice`} className="text-caption font-semibold text-fg-secondary">
          {t('templates.field')}
        </label>
        <Select
          id={`${id}-choice`}
          data-testid="work-template"
          value={choice}
          onChange={(event) => state.setChoice(event.target.value)}
        >
          {/* An empty plan first, then the library by title, then a file. */}
          {state.allowsEmpty && <option value={EMPTY_PLAN}>{t('templates.empty')}</option>}
          {state.entries.length > 0 && (
            <optgroup label={t('templates.library')}>
              {state.entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </optgroup>
          )}
          <option value={FROM_FILE}>{t('templates.fromFile')}</option>
        </Select>
      </div>

      {choice === FROM_FILE && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-path`} className="text-caption font-semibold text-fg-secondary">
            {t('templates.file.path')}
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              id={`${id}-path`}
              data-testid="template-path"
              className="font-mono"
              spellCheck={false}
              autoComplete="off"
              aria-describedby={`${id}-path-hint`}
              value={state.path}
              onChange={(event) => state.setPath(event.target.value)}
            />
            <Button icon={<FolderOpen20Regular />} onClick={() => void choose()}>
              {t('templates.file.choose')}
            </Button>
          </div>
          <span id={`${id}-path-hint`} className="text-caption text-fg-tertiary">
            {dialogFailed
              ? t('work.dialogUnavailable')
              : file?.status === 'reading'
                ? t('templates.file.reading')
                : t('templates.file.hint')}
          </span>
        </div>
      )}

      {choice === EMPTY_PLAN ? (
        <p className="text-caption text-fg-tertiary">{t('templates.preview.empty')}</p>
      ) : (
        preview !== null &&
        !stageless && (
          <div
            data-testid="template-preview"
            className="flex gap-3 rounded-lg border border-stroke-subtle bg-layer p-3"
          >
            <DocumentText20Regular
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-fg-tertiary"
            />
            <div className="flex min-w-0 flex-col gap-1">
              {preview.summary !== null && preview.summary !== '' && (
                <p className="text-body text-fg">{preview.summary}</p>
              )}
              <p className="text-body font-semibold text-fg">{countsText(preview.counts, tp)}</p>
              <p className="text-caption text-fg-secondary">{t('templates.preview.notQuote')}</p>
            </div>
          </div>
        )
      )}

      {(refusal !== null || problems.length > 0) && (
        <div data-testid="template-problem">
          <InfoBar severity="danger" title={t('templates.problem.title')}>
            {refusal !== null && <p>{refusal}</p>}
            {problems.length > 0 && <ProblemList problems={problems} />}
          </InfoBar>
        </div>
      )}
    </div>
  );
}

/** A file's problems: each sentence, and where in the file it is, as JSON path writes it. */
function ProblemList({ problems }: { problems: readonly TemplateProblem[] }) {
  const { t, tp } = useI18n();
  const shown = problems.slice(0, PROBLEMS_SHOWN);
  return (
    <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
      {shown.map((problem, index) => (
        <li key={`${problem.path}:${problem.key}:${index}`}>
          <span>{t(problem.key, problem.detail)}</span>{' '}
          <span data-selectable className="font-mono text-caption break-all text-fg-tertiary">
            {problem.path}
          </span>
        </li>
      ))}
      {problems.length > shown.length && (
        <li>{tp('templates.problem.more', problems.length - shown.length)}</li>
      )}
    </ul>
  );
}
