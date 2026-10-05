import { useId, useState, type FormEvent } from 'react';

import { useToday } from '@/app/today';
import { useAddMaintenanceDone } from '@/data/queries';
import {
  AFTERCARE_LIMITS,
  validateMaintenanceDone,
  type MaintenanceTask,
} from '@/domain/aftercare';
import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { DateField } from '@/ui/DateField';
import { InfoBar } from '@/ui/InfoBar';
import { Modal } from '@/ui/Modal';
import { TextArea } from '@/ui/TextArea';

import { aftercareProblemsText } from './aftercareWords';

/**
 * Recording that a maintenance task was done, once (slice G4, decision 3): **Mark as done…** asks
 * the day it was done (today, unless changed; never after today, nor before the last time it was
 * done) and an optional note, and says before the button is pressed that the record is kept as it
 * is and that the next due day is counted from it. Nothing here removes anything, so nothing takes
 * the danger tone; the button repeats the verb.
 *
 * What the domain refuses (`validateMaintenanceDone`) is said inside the dialog
 * (`maintenance-done-problem`) and nothing is sent; a day typed only halfway is said the same way.
 * The host's own refusal is said in the dialog (`maintenance-done-refused`), which stays open with
 * what was typed.
 */
export function MaintenanceDoneDialog({
  snapshot,
  task,
  onClose,
  onRecorded,
}: {
  snapshot: WorkSnapshot;
  task: MaintenanceTask;
  onClose: () => void;
  onRecorded: (task: MaintenanceTask) => void;
}) {
  const i18n = useI18n();
  const { t, number, describeError } = i18n;
  const today = useToday();
  const add = useAddMaintenanceDone();
  const field = useId();
  const [day, setDay] = useState(today);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState('');
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const title = t('aftercare.done.title', { name: task.title });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRefusal(null);
    const trimmed = note.trim();
    const record = { taskId: task.id, doneOn: day, note: trimmed === '' ? null : trimmed };
    const found = aftercareProblemsText(i18n, validateMaintenanceDone(snapshot, record, today));
    if (pending) found.unshift(t('aftercare.field.dayUnfinished'));
    setProblems(found);
    if (found.length > 0) return;
    add.mutate(record, {
      onSuccess: () => onRecorded(task),
      onError: (error) => setRefusal(describeError(error)),
    });
  };

  return (
    <Modal open label={title} onClose={add.isPending ? () => undefined : onClose}>
      <form
        data-testid="maintenance-done-dialog"
        noValidate
        className="flex flex-col gap-4 p-5"
        onSubmit={submit}
      >
        <h2 className="text-body-lg font-semibold text-fg">{title}</h2>
        <p className="text-body text-fg-secondary">{t('aftercare.done.body')}</p>
        <div className="flex max-w-56 flex-col gap-1">
          <label htmlFor={`${field}-day`} className="text-caption font-semibold text-fg-secondary">
            {t('aftercare.done.day')}
          </label>
          <DateField
            id={`${field}-day`}
            data-testid="maintenance-done-day"
            max={today}
            value={day}
            onChange={setDay}
            onPendingChange={setPending}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${field}-note`} className="text-caption font-semibold text-fg-secondary">
            {t('aftercare.field.note')}
          </label>
          <TextArea
            id={`${field}-note`}
            data-testid="maintenance-done-note"
            rows={2}
            maxLength={AFTERCARE_LIMITS.doneNote}
            aria-describedby={`${field}-note-hint`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <span id={`${field}-note-hint`} className="text-caption text-fg-tertiary">
            {t('aftercare.done.note.hint', { max: number(AFTERCARE_LIMITS.doneNote) })}
          </span>
        </div>
        {problems.length > 0 && (
          <div data-testid="maintenance-done-problem">
            <InfoBar severity="caution" title={t('aftercare.done.problem')}>
              <ul className="flex flex-col gap-0.5">
                {problems.map((each) => (
                  <li key={each}>{each}</li>
                ))}
              </ul>
            </InfoBar>
          </div>
        )}
        {refusal !== null && (
          <div data-testid="maintenance-done-refused">
            <InfoBar severity="danger" title={t('aftercare.done.refused')}>
              {refusal}
            </InfoBar>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={add.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            appearance="accent"
            data-testid="maintenance-done-confirm"
            disabled={add.isPending}
          >
            {add.isPending ? t('common.working') : t('aftercare.done.confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
