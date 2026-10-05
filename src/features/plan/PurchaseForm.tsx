import { Save20Regular } from '@fluentui/react-icons';
import { useId, useState, type FormEvent } from 'react';

import { useAddPurchase, useUpdatePurchase } from '@/data/queries';
import { activitiesInOrder, stagesInOrder, type Purchase, type WorkSnapshot } from '@/domain/plan';
import {
  PURCHASE_LIMITS,
  purchasesInOrder,
  validatePurchaseDraft,
  type PurchaseDraft,
} from '@/domain/purchases';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { TextArea } from '@/ui/TextArea';

import { purchaseProblemsText } from './purchaseWords';

/** The fields of a purchase, as typed: shared by adding one and writing one whole. */
interface Fields {
  readonly name: string;
  readonly stageId: string;
  readonly activityId: string;
  readonly quantity: string;
  readonly supplier: string;
  /** Typed: whole calendar days, read when it is sent. */
  readonly lead: string;
  readonly note: string;
}

function fieldsOf(purchase: Purchase | null): Fields {
  return {
    name: purchase?.name ?? '',
    stageId: purchase?.stageId ?? '',
    activityId: purchase?.activityId ?? '',
    quantity: purchase?.quantity ?? '',
    supplier: purchase?.supplier ?? '',
    lead: purchase === null ? '' : String(purchase.leadDays),
    note: purchase?.note ?? '',
  };
}

const orNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());

/** Whole days typed, as a number; anything else is not a lead time, and the domain says so. */
function leadOf(text: string): number {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

/**
 * A purchase written down (slice G2, decision 3): what to buy, the stage it is for, the activity of
 * that stage that needs it (optional — the stage's first one otherwise), how much in the person's own
 * words, from whom, the lead time in **calendar** days, and a note. The day to order by is never a
 * field: it is computed, and shown on the row once saved (§8, _a deadline is never typed_).
 *
 * The same fields add one (`purchase` is `null`) and write one whole. What the domain refuses
 * (`validatePurchaseDraft`) is said in one list (`purchase-problem`) before the host is asked; the
 * host's own refusal is said under the fields (`purchase-refused`), and what was typed stays.
 */
export function PurchaseForm({
  snapshot,
  purchase,
  onDone,
  onCancel,
}: {
  snapshot: WorkSnapshot;
  /** The purchase being written whole; `null` to add one. */
  purchase: Purchase | null;
  /** Saved: the purchase's id (the one just added, for a new one). */
  onDone: (purchaseId: string | null) => void;
  onCancel: () => void;
}) {
  const i18n = useI18n();
  const { t, number, describeError } = i18n;
  const term = useTerms();
  const add = useAddPurchase();
  const update = useUpdatePurchase();
  const field = useId();
  const id = (name: string) => `${field}-${name}`;
  const [fields, setFields] = useState<Fields>(() => fieldsOf(purchase));
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const set = (patch: Partial<Fields>) => setFields((now) => ({ ...now, ...patch }));

  const stages = stagesInOrder(snapshot);
  const activities = activitiesInOrder(snapshot).filter((each) => each.stageId === fields.stageId);
  const busy = add.isPending || update.isPending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRefusal(null);
    const draft: PurchaseDraft = {
      id: purchase?.id ?? null,
      stageId: fields.stageId,
      activityId: fields.activityId === '' ? null : fields.activityId,
      name: fields.name.trim(),
      quantity: orNull(fields.quantity),
      supplier: orNull(fields.supplier),
      leadDays: leadOf(fields.lead),
      note: orNull(fields.note),
    };
    const found = purchaseProblemsText(i18n, term, validatePurchaseDraft(snapshot, draft));
    setProblems(found);
    if (found.length > 0) return;
    const wire = {
      stageId: draft.stageId,
      activityId: draft.activityId,
      name: draft.name,
      quantity: draft.quantity,
      supplier: draft.supplier,
      leadDays: draft.leadDays,
      note: draft.note,
    };
    if (purchase === null) {
      add.mutate(wire, {
        onSuccess: (next) => {
          // The host puts a new purchase last.
          const added = purchasesInOrder(next).at(-1) ?? null;
          announce(t('purchases.added', { name: draft.name }));
          onDone(added?.id ?? null);
        },
        onError: (error) => setRefusal(describeError(error)),
      });
    } else {
      update.mutate(
        { ...wire, id: purchase.id },
        {
          onSuccess: () => {
            announce(t('purchases.saved', { name: draft.name }));
            onDone(purchase.id);
          },
          onError: (error) => setRefusal(describeError(error)),
        },
      );
    }
  };

  return (
    <form data-testid="purchase-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">
          {t('purchases.field.name')}
        </span>
        <Input
          data-testid="purchase-name"
          aria-required="true"
          maxLength={PURCHASE_LIMITS.name}
          value={fields.name}
          onChange={(event) => set({ name: event.target.value })}
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={id('stage')} className="text-caption font-semibold text-fg-secondary">
            {term('stage', { capital: true })}
          </label>
          <Select
            id={id('stage')}
            data-testid="purchase-stage"
            aria-required="true"
            value={fields.stageId}
            onChange={(event) => set({ stageId: event.target.value, activityId: '' })}
          >
            <option value="">{t('purchases.field.stage.choose', { stage: term('stage') })}</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id('activity')} className="text-caption font-semibold text-fg-secondary">
            {t('purchases.field.activity', { activity: term('activity', { capital: true }) })}
          </label>
          <Select
            id={id('activity')}
            data-testid="purchase-activity"
            aria-describedby={id('activity-hint')}
            value={fields.activityId}
            onChange={(event) => set({ activityId: event.target.value })}
          >
            <option value="">{t('purchases.field.activity.none', { stage: term('stage') })}</option>
            {activities.map((activity) => (
              <option key={activity.id} value={activity.id}>
                {activity.name}
              </option>
            ))}
          </Select>
          <span id={id('activity-hint')} className="text-caption text-fg-tertiary">
            {t('purchases.field.activity.hint')}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id('quantity')} className="text-caption font-semibold text-fg-secondary">
            {t('purchases.field.quantity')}
          </label>
          <Input
            id={id('quantity')}
            data-testid="purchase-quantity"
            aria-describedby={id('quantity-hint')}
            maxLength={PURCHASE_LIMITS.quantity}
            value={fields.quantity}
            onChange={(event) => set({ quantity: event.target.value })}
          />
          <span id={id('quantity-hint')} className="text-caption text-fg-tertiary">
            {t('purchases.field.quantity.hint')}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id('supplier')} className="text-caption font-semibold text-fg-secondary">
            {t('purchases.field.supplier')}
          </label>
          <Input
            id={id('supplier')}
            data-testid="purchase-supplier"
            maxLength={PURCHASE_LIMITS.supplier}
            value={fields.supplier}
            onChange={(event) => set({ supplier: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id('lead')} className="text-caption font-semibold text-fg-secondary">
            {t('purchases.field.lead', { leadTime: term('leadTime', { capital: true }) })}
          </label>
          <Input
            id={id('lead')}
            type="number"
            inputMode="numeric"
            min={0}
            max={PURCHASE_LIMITS.leadDays}
            step={1}
            data-testid="purchase-lead"
            aria-required="true"
            aria-describedby={id('lead-hint')}
            value={fields.lead}
            onChange={(event) => set({ lead: event.target.value })}
          />
          <span id={id('lead-hint')} className="text-caption text-fg-tertiary">
            {t('purchases.field.lead.hint')}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={id('note')} className="text-caption font-semibold text-fg-secondary">
          {t('purchases.field.note')}
        </label>
        <TextArea
          id={id('note')}
          data-testid="purchase-note"
          rows={2}
          maxLength={PURCHASE_LIMITS.note}
          aria-describedby={id('note-hint')}
          value={fields.note}
          onChange={(event) => set({ note: event.target.value })}
        />
        <span id={id('note-hint')} className="text-caption text-fg-tertiary">
          {t('purchases.field.note.hint', { max: number(PURCHASE_LIMITS.note) })}
        </span>
      </div>

      {problems.length > 0 && (
        <div data-testid="purchase-problem">
          <InfoBar severity="caution" title={t('purchases.problem.title')}>
            <ul className="flex flex-col gap-0.5">
              {problems.map((each) => (
                <li key={each}>{each}</li>
              ))}
            </ul>
          </InfoBar>
        </div>
      )}
      {refusal !== null && (
        <div data-testid="purchase-refused">
          <InfoBar severity="danger" title={t('purchases.refused')}>
            {refusal}
          </InfoBar>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button
          type="submit"
          appearance="accent"
          icon={<Save20Regular />}
          data-testid="purchase-save"
          disabled={busy}
        >
          {busy ? t('common.working') : t('purchases.save')}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
