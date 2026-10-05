import { Save20Regular } from '@fluentui/react-icons';
import { useId, useState, type FormEvent } from 'react';

import { useToday } from '@/app/today';
import { useAddWarranty, useUpdateWarranty } from '@/data/queries';
import {
  AFTERCARE_LIMITS,
  validateWarrantyDraft,
  type Warranty,
  type WarrantyDraft,
} from '@/domain/aftercare';
import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { ChoiceGroup } from '@/ui/ChoiceGroup';
import { DateField } from '@/ui/DateField';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { TextArea } from '@/ui/TextArea';

import { AftercareTargetSelect } from './AftercareTargetSelect';
import { aftercareProblemsText, targetOf, targetValue, workFinishedOn } from './aftercareWords';

/** How a warranty's length is typed: a number of months, or of years (kept as months). */
type LengthUnit = 'months' | 'years';
const UNITS = ['months', 'years'] as const satisfies readonly LengthUnit[];

interface Fields {
  readonly title: string;
  readonly target: string;
  readonly givenBy: string;
  readonly startsOn: string;
  /** Typed: a whole number, read when it is sent. */
  readonly length: string;
  readonly unit: LengthUnit;
  readonly documentId: string;
  readonly note: string;
}

function fieldsOf(snapshot: WorkSnapshot, warranty: Warranty | null, today: string): Fields {
  if (warranty === null) {
    return {
      title: '',
      target: targetValue('work', snapshot.work.workId),
      givenBy: '',
      // The paper of a finished work usually starts the day it was handed over.
      startsOn: workFinishedOn(snapshot) ?? today,
      length: '',
      unit: 'months',
      documentId: '',
      note: '',
    };
  }
  const inYears = warranty.months % 12 === 0;
  return {
    title: warranty.title,
    target: targetValue(warranty.targetKind, warranty.targetId),
    givenBy: warranty.givenBy ?? '',
    startsOn: warranty.startsOn,
    length: String(inYears ? warranty.months / 12 : warranty.months),
    unit: inYears ? 'years' : 'months',
    documentId: warranty.documentId ?? '',
    note: warranty.note ?? '',
  };
}

const orNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());

/** Whole months typed, as a number of months; anything else is not a length, and the domain says so. */
function monthsOf(text: string, unit: LengthUnit): number {
  if (!/^\d+$/.test(text.trim())) return Number.NaN;
  return Number(text.trim()) * (unit === 'years' ? 12 : 1);
}

/**
 * A warranty written down (slice G4, decision 3; pt "garantia"): what it is for, what it covers —
 * the whole work, a room or a stage — who gives it, the day it starts (the day the work finished
 * when every stage is closed, else today), how long — a whole number of months or years, kept as
 * months — its paper, chosen among the documents filed as a warranty, and a note. The day it ends is
 * never a field: it is computed, and shown on the row once saved.
 *
 * The same fields add one (`warranty` is `null`) and write one whole. What the domain refuses
 * (`validateWarrantyDraft`) is said in one list (`warranty-problem`) before the host is asked; the
 * host's own refusal is said under the fields (`warranty-refused`), and what was typed stays.
 */
export function WarrantyForm({
  snapshot,
  warranty,
  onDone,
  onCancel,
}: {
  snapshot: WorkSnapshot;
  warranty: Warranty | null;
  /** Saved: the warranty's id (the one just added, for a new one). */
  onDone: (warrantyId: string | null) => void;
  onCancel: () => void;
}) {
  const i18n = useI18n();
  const { t, number, describeError } = i18n;
  const today = useToday();
  const add = useAddWarranty();
  const update = useUpdateWarranty();
  const field = useId();
  const id = (name: string) => `${field}-${name}`;
  const [fields, setFields] = useState<Fields>(() => fieldsOf(snapshot, warranty, today));
  const [pending, setPending] = useState(false);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const set = (patch: Partial<Fields>) => setFields((now) => ({ ...now, ...patch }));
  const papers = snapshot.documents.filter((document) => document.kind === 'warranty');
  const busy = add.isPending || update.isPending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRefusal(null);
    const target = targetOf(fields.target);
    const draft: WarrantyDraft = {
      id: warranty?.id ?? null,
      title: fields.title.trim(),
      targetKind: target.targetKind,
      targetId: target.targetId,
      givenBy: orNull(fields.givenBy),
      startsOn: fields.startsOn,
      months: monthsOf(fields.length, fields.unit),
      documentId: fields.documentId === '' ? null : fields.documentId,
      note: orNull(fields.note),
    };
    const found = aftercareProblemsText(i18n, validateWarrantyDraft(snapshot, draft));
    // A day typed halfway is not "no day": the field says what is wrong, and nothing is sent.
    if (pending) found.unshift(t('aftercare.field.dayUnfinished'));
    setProblems(found);
    if (found.length > 0) return;
    const wire = {
      targetKind: draft.targetKind,
      targetId: draft.targetId,
      title: draft.title,
      givenBy: draft.givenBy,
      startsOn: draft.startsOn,
      months: draft.months,
      documentId: draft.documentId,
      note: draft.note,
    };
    if (warranty === null) {
      const before = new Set(snapshot.warranties.map((each) => each.id));
      add.mutate(wire, {
        onSuccess: (next) => {
          const added = next.warranties.find((each) => !before.has(each.id)) ?? null;
          announce(t('aftercare.warranty.added', { name: draft.title }));
          onDone(added?.id ?? null);
        },
        onError: (error) => setRefusal(describeError(error)),
      });
    } else {
      update.mutate(
        { ...wire, id: warranty.id },
        {
          onSuccess: () => {
            announce(t('aftercare.warranty.saved', { name: draft.title }));
            onDone(warranty.id);
          },
          onError: (error) => setRefusal(describeError(error)),
        },
      );
    }
  };

  return (
    <form data-testid="warranty-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={id('title')} className="text-caption font-semibold text-fg-secondary">
          {t('aftercare.warranty.field.title')}
        </label>
        <Input
          id={id('title')}
          data-testid="warranty-title"
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
            testId="warranty-target"
            value={fields.target}
            onChange={(target) => set({ target })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id('given-by')} className="text-caption font-semibold text-fg-secondary">
            {t('aftercare.warranty.field.givenBy')}
          </label>
          <Input
            id={id('given-by')}
            data-testid="warranty-given-by"
            aria-describedby={id('given-by-hint')}
            maxLength={AFTERCARE_LIMITS.givenBy}
            value={fields.givenBy}
            onChange={(event) => set({ givenBy: event.target.value })}
          />
          <span id={id('given-by-hint')} className="text-caption text-fg-tertiary">
            {t('aftercare.warranty.field.givenBy.hint')}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id('starts')} className="text-caption font-semibold text-fg-secondary">
            {t('aftercare.warranty.field.starts')}
          </label>
          <DateField
            id={id('starts')}
            data-testid="warranty-starts"
            value={fields.startsOn}
            onChange={(startsOn) => set({ startsOn })}
            onPendingChange={setPending}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id('length')} className="text-caption font-semibold text-fg-secondary">
            {t('aftercare.warranty.field.length')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={id('length')}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              className="max-w-28"
              data-testid="warranty-length"
              aria-required="true"
              aria-describedby={id('length-hint')}
              value={fields.length}
              onChange={(event) => set({ length: event.target.value })}
            />
            <div data-testid="warranty-unit">
              <ChoiceGroup<LengthUnit>
                compact
                label={t('aftercare.warranty.field.unit')}
                options={UNITS}
                value={fields.unit}
                onChange={(unit) => set({ unit })}
                labels={{
                  months: t('aftercare.unit.months'),
                  years: t('aftercare.unit.years'),
                }}
              />
            </div>
          </div>
          <span id={id('length-hint')} className="text-caption text-fg-tertiary">
            {t('aftercare.warranty.field.length.hint')}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={id('document')} className="text-caption font-semibold text-fg-secondary">
          {t('aftercare.warranty.field.document')}
        </label>
        <Select
          id={id('document')}
          data-testid="warranty-document"
          aria-describedby={id('document-hint')}
          value={fields.documentId}
          onChange={(event) => set({ documentId: event.target.value })}
        >
          <option value="">{t('aftercare.warranty.field.document.none')}</option>
          {papers.map((document) => (
            <option key={document.id} value={document.id}>
              {document.title === document.fileName
                ? document.title
                : t('reports.handover.documents.file', {
                    title: document.title,
                    file: document.fileName,
                  })}
            </option>
          ))}
        </Select>
        <span id={id('document-hint')} className="text-caption text-fg-tertiary">
          {t('aftercare.warranty.field.document.hint')}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={id('note')} className="text-caption font-semibold text-fg-secondary">
          {t('aftercare.field.note')}
        </label>
        <TextArea
          id={id('note')}
          data-testid="warranty-note"
          rows={2}
          maxLength={AFTERCARE_LIMITS.note}
          aria-describedby={id('note-hint')}
          value={fields.note}
          onChange={(event) => set({ note: event.target.value })}
        />
        <span id={id('note-hint')} className="text-caption text-fg-tertiary">
          {t('aftercare.warranty.field.note.hint', { max: number(AFTERCARE_LIMITS.note) })}
        </span>
      </div>

      {problems.length > 0 && (
        <div data-testid="warranty-problem">
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
        <div data-testid="warranty-refused">
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
          data-testid="warranty-save"
          disabled={busy}
        >
          {busy ? t('common.working') : t('aftercare.warranty.save')}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
