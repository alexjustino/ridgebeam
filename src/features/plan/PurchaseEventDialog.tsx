import { useId, useState, type FormEvent } from 'react';

import { useToday } from '@/app/today';
import { useAddPurchaseEvent } from '@/data/queries';
import type { Purchase, PurchaseEventKind, WorkSnapshot } from '@/domain/plan';
import { PURCHASE_LIMITS, validatePurchaseEvent } from '@/domain/purchases';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { DateField } from '@/ui/DateField';
import { InfoBar } from '@/ui/InfoBar';
import { Modal } from '@/ui/Modal';
import { TextArea } from '@/ui/TextArea';

import { purchaseProblemsText } from './purchaseWords';

/** What is being recorded: the purchase, and what happened to it. */
export interface PurchaseToRecord {
  readonly purchase: Purchase;
  readonly kind: PurchaseEventKind;
}

/** What was recorded, for the caller to say and to keep as an outcome. */
export interface PurchaseRecorded extends PurchaseToRecord {
  readonly day: string;
}

const KEYS = {
  ordered: {
    title: 'purchases.dialog.ordered.title',
    body: 'purchases.dialog.ordered.body',
    day: 'purchases.dialog.ordered.day',
    confirm: 'purchases.dialog.ordered.confirm',
  },
  delivered: {
    title: 'purchases.dialog.delivered.title',
    body: 'purchases.dialog.delivered.body',
    day: 'purchases.dialog.delivered.day',
    confirm: 'purchases.dialog.delivered.confirm',
  },
  cancelled: {
    title: 'purchases.dialog.cancelled.title',
    body: 'purchases.dialog.cancelled.body',
    day: 'purchases.dialog.cancelled.day',
    confirm: 'purchases.dialog.cancelled.confirm',
  },
} as const;

/**
 * Recording what happened to a purchase, once (slice G2, decision 3): **Mark as ordered…**, **Mark
 * as delivered…** or **The order fell through…** — each asks for the day it happened (today, unless
 * changed; never after today) and an optional note, and says what recording it does before the
 * button is pressed. The Plan's Purchases tab and the meeting open this same dialog, so the two
 * cannot disagree.
 *
 * What the domain refuses (`validatePurchaseEvent`: a day after today, a day before the last thing
 * recorded, an event out of order) is said inside the dialog (`purchase-event-problem`) and nothing
 * is sent; a day typed only halfway is said the same way, never sent as "no day". The host's own
 * refusal is said in the dialog (`purchase-event-refused`), which stays open with what was typed.
 * Nothing here removes anything, so nothing takes the danger tone; the button repeats the verb.
 */
export function PurchaseEventDialog({
  snapshot,
  recording,
  onClose,
  onRecorded,
}: {
  snapshot: WorkSnapshot;
  recording: PurchaseToRecord;
  onClose: () => void;
  onRecorded: (recorded: PurchaseRecorded) => void;
}) {
  const i18n = useI18n();
  const { t, number, describeError } = i18n;
  const term = useTerms();
  const today = useToday();
  const add = useAddPurchaseEvent();
  const field = useId();
  const [day, setDay] = useState(today);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState('');
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);

  const { purchase, kind } = recording;
  const keys = KEYS[kind];
  const title = t(keys.title, { name: purchase.name });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRefusal(null);
    const trimmed = note.trim();
    const draft = { purchaseId: purchase.id, kind, day, note: trimmed === '' ? null : trimmed };
    const found = purchaseProblemsText(i18n, term, validatePurchaseEvent(snapshot, draft, today));
    // A day typed halfway is not "no day": the field says what is wrong, and nothing is sent.
    if (pending) found.unshift(t('purchases.dialog.dayUnfinished'));
    setProblems(found);
    if (found.length > 0) return;
    add.mutate(draft, {
      onSuccess: () => onRecorded({ purchase, kind, day }),
      onError: (error) => setRefusal(describeError(error)),
    });
  };

  return (
    <Modal open label={title} onClose={add.isPending ? () => undefined : onClose}>
      <form
        data-testid="purchase-event"
        data-kind={kind}
        noValidate
        className="flex flex-col gap-4 p-5"
        onSubmit={submit}
      >
        <h2 className="text-body-lg font-semibold text-fg">{title}</h2>
        <p className="text-body text-fg-secondary">
          {t(keys.body, { leadTime: term('leadTime') })}
        </p>
        <div className="flex max-w-56 flex-col gap-1">
          <label htmlFor={`${field}-day`} className="text-caption font-semibold text-fg-secondary">
            {t(keys.day)}
          </label>
          <DateField
            id={`${field}-day`}
            data-testid="purchase-event-day"
            max={today}
            value={day}
            onChange={setDay}
            onPendingChange={setPending}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${field}-note`} className="text-caption font-semibold text-fg-secondary">
            {t('purchases.dialog.note')}
          </label>
          <TextArea
            id={`${field}-note`}
            data-testid="purchase-event-note"
            rows={2}
            maxLength={PURCHASE_LIMITS.eventNote}
            aria-describedby={`${field}-note-hint`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <span id={`${field}-note-hint`} className="text-caption text-fg-tertiary">
            {t('purchases.dialog.note.hint', { max: number(PURCHASE_LIMITS.eventNote) })}
          </span>
        </div>
        {problems.length > 0 && (
          <div data-testid="purchase-event-problem">
            <InfoBar severity="caution" title={t('purchases.dialog.problem')}>
              <ul className="flex flex-col gap-0.5">
                {problems.map((each) => (
                  <li key={each}>{each}</li>
                ))}
              </ul>
            </InfoBar>
          </div>
        )}
        {refusal !== null && (
          <div data-testid="purchase-event-refused">
            <InfoBar severity="danger" title={t('purchases.dialog.refused')}>
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
            data-testid="purchase-event-confirm"
            disabled={add.isPending}
          >
            {add.isPending ? t('common.working') : t(keys.confirm)}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
