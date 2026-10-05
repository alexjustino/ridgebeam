import { Save20Regular } from '@fluentui/react-icons';
import { useId, useState, type FormEvent } from 'react';

import { useToday } from '@/app/today';
import { useAddMaintenance, useUpdateMaintenance } from '@/data/queries';
import {
  AFTERCARE_LIMITS,
  validateMaintenanceDraft,
  type MaintenanceDraft,
  type MaintenanceTask,
} from '@/domain/aftercare';
import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { DateField } from '@/ui/DateField';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { TextArea } from '@/ui/TextArea';

import { AftercareTargetSelect } from './AftercareTargetSelect';
import { aftercareProblemsText, targetOf, targetValue } from './aftercareWords';

interface Fields {
  readonly title: string;
  readonly target: string;
  /** Typed: whole calendar months, read when it is sent. */
  readonly every: string;
  readonly firstDueOn: string;
  readonly note: string;
}

function fieldsOf(snapshot: WorkSnapshot, task: MaintenanceTask | null, today: string): Fields {
  return {
    title: task?.title ?? '',
    target:
      task === null
        ? targetValue('work', snapshot.work.workId)
        : targetValue(task.targetKind, task.targetId),
    every: task === null ? '' : String(task.everyMonths),
    firstDueOn: task?.firstDueOn ?? today,
    note: task?.note ?? '',
  };
}

const orNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());

/** Whole months typed, as a number; anything else is not an interval, and the domain says so. */
function everyOf(text: string): number {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

/**
 * A maintenance task written down (slice G4, decision 3; pt "tarefa de manutenção"): what is to be
 * done, what it covers — the whole work, a room or a stage — every how many **calendar** months, the
 * day it is first due, and a note. The next due day is never a field: it is the first due day while
 * nothing is recorded done, then counted from the last time it was done, and shown on the row.
 *
 * The same fields add one (`task` is `null`) and write one whole — its interval too, done or not.
 * What the domain refuses (`validateMaintenanceDraft`) is said in one list (`maintenance-problem`)
 * before the host is asked; the host's own refusal under the fields (`maintenance-refused`).
 */
export function MaintenanceForm({
  snapshot,
  task,
  onDone,
  onCancel,
}: {
  snapshot: WorkSnapshot;
  task: MaintenanceTask | null;
  /** Saved: the task's id (the one just added, for a new one). */
  onDone: (taskId: string | null) => void;
  onCancel: () => void;
}) {
  const i18n = useI18n();
  const { t, number, describeError } = i18n;
  const today = useToday();
  const add = useAddMaintenance();
  const update = useUpdateMaintenance();
  const field = useId();
  const id = (name: string) => `${field}-${name}`;
  const [fields, setFields] = useState<Fields>(() => fieldsOf(snapshot, task, today));
  const [pending, setPending] = useState(false);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const set = (patch: Partial<Fields>) => setFields((now) => ({ ...now, ...patch }));
  const busy = add.isPending || update.isPending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRefusal(null);
    const target = targetOf(fields.target);
    const draft: MaintenanceDraft = {
      id: task?.id ?? null,
      title: fields.title.trim(),
      targetKind: target.targetKind,
      targetId: target.targetId,
      everyMonths: everyOf(fields.every),
      firstDueOn: fields.firstDueOn,
      note: orNull(fields.note),
    };
    const found = aftercareProblemsText(i18n, validateMaintenanceDraft(snapshot, draft));
    if (pending) found.unshift(t('aftercare.field.dayUnfinished'));
    setProblems(found);
    if (found.length > 0) return;
    const wire = {
      targetKind: draft.targetKind,
      targetId: draft.targetId,
      title: draft.title,
      everyMonths: draft.everyMonths,
      firstDueOn: draft.firstDueOn,
      note: draft.note,
    };
    if (task === null) {
      const before = new Set(snapshot.maintenance.map((each) => each.id));
      add.mutate(wire, {
        onSuccess: (next) => {
          const added = next.maintenance.find((each) => !before.has(each.id)) ?? null;
          announce(t('aftercare.task.added', { name: draft.title }));
          onDone(added?.id ?? null);
        },
        onError: (error) => setRefusal(describeError(error)),
      });
    } else {
      update.mutate(
        { ...wire, id: task.id },
        {
          onSuccess: () => {
            announce(t('aftercare.task.saved', { name: draft.title }));
            onDone(task.id);
          },
          onError: (error) => setRefusal(describeError(error)),
        },
      );
    }
  };

  return (
    <form
      data-testid="maintenance-form"
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={id('title')} className="text-caption font-semibold text-fg-secondary">
          {t('aftercare.task.field.title')}
        </label>
        <Input
          id={id('title')}
          data-testid="maintenance-title"
          aria-required="true"
          maxLength={AFTERCARE_LIMITS.title}
          value={fields.title}
          onChange={(event) => set({ title: event.target.value })}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={id('target')} className="text-caption font-semibold text-fg-secondary">
            {t('aftercare.field.target')}
          </label>
          <AftercareTargetSelect
            snapshot={snapshot}
            id={id('target')}
            testId="maintenance-target"
            value={fields.target}
            onChange={(target) => set({ target })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id('every')} className="text-caption font-semibold text-fg-secondary">
            {t('aftercare.task.field.every')}
          </label>
          <Input
            id={id('every')}
            type="number"
            inputMode="numeric"
            min={1}
            max={AFTERCARE_LIMITS.everyMonths}
            step={1}
            data-testid="maintenance-every"
            aria-required="true"
            aria-describedby={id('every-hint')}
            value={fields.every}
            onChange={(event) => set({ every: event.target.value })}
          />
          <span id={id('every-hint')} className="text-caption text-fg-tertiary">
            {t('aftercare.task.field.every.hint')}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id('first')} className="text-caption font-semibold text-fg-secondary">
            {t('aftercare.task.field.first')}
          </label>
          <DateField
            id={id('first')}
            data-testid="maintenance-first"
            aria-describedby={id('first-hint')}
            value={fields.firstDueOn}
            onChange={(firstDueOn) => set({ firstDueOn })}
            onPendingChange={setPending}
          />
          <span id={id('first-hint')} className="text-caption text-fg-tertiary">
            {t('aftercare.task.field.first.hint')}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={id('note')} className="text-caption font-semibold text-fg-secondary">
          {t('aftercare.field.note')}
        </label>
        <TextArea
          id={id('note')}
          data-testid="maintenance-note"
          rows={2}
          maxLength={AFTERCARE_LIMITS.note}
          aria-describedby={id('note-hint')}
          value={fields.note}
          onChange={(event) => set({ note: event.target.value })}
        />
        <span id={id('note-hint')} className="text-caption text-fg-tertiary">
          {t('aftercare.task.field.note.hint', { max: number(AFTERCARE_LIMITS.note) })}
        </span>
      </div>

      {problems.length > 0 && (
        <div data-testid="maintenance-problem">
          <InfoBar severity="caution" title={t('aftercare.problem.title')}>
            <ul className="flex flex-col gap-0.5">
              {problems.map((each) => (
                <li key={each}>{each}</li>
              ))}
            </ul>
          </InfoBar>
        </div>
      )}
      {refusal !== null && (
        <div data-testid="maintenance-refused">
          <InfoBar severity="danger" title={t('aftercare.refused')}>
            {refusal}
          </InfoBar>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button
          type="submit"
          appearance="accent"
          icon={<Save20Regular />}
          data-testid="maintenance-save"
          disabled={busy}
        >
          {busy ? t('common.working') : t('aftercare.task.save')}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
