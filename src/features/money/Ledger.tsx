import {
  Add20Regular,
  ArrowUndo20Regular,
  Dismiss16Regular,
  Save20Regular,
} from '@fluentui/react-icons';
import { useId, useState, type FormEvent } from 'react';

import { useToday } from '@/app/today';
import { LIMITS } from '@/data/commands';
import { useAddPayment, useReversePayment } from '@/data/queries';
import { paymentPreview, type PaymentPreview } from '@/domain/milestones';
import {
  reversalDraft,
  validatePayment,
  type PaymentDraft,
  type PaymentProblem,
} from '@/domain/money';
import { stagesInOrder, type Payment, type WorkSnapshot } from '@/domain/plan';
import { PhotoThumb } from '@/features/diary/PhotoThumb';
import type { MessageKey } from '@/i18n/en';
import { toCents } from '@/i18n/format';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { DateField } from '@/ui/DateField';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { Select } from '@/ui/Select';
import { TextArea } from '@/ui/TextArea';

import { aheadWarningText, usePaymentPlans } from './paymentPlanWords';

const PROBLEM_KEYS: Record<PaymentProblem['code'], MessageKey> = {
  'invalid-day': 'diary.problem.invalidDay',
  'future-day': 'money.problem.futureDay',
  'no-stage': 'money.problem.noStage',
  'unknown-stage': 'money.problem.unknown',
  'unknown-person': 'money.problem.unknown',
  'unknown-commitment': 'money.problem.unknown',
  'commitment-of-another-stage': 'money.problem.otherStage',
  'invalid-amount': 'money.invalid.amount',
  'amount-not-positive': 'money.problem.notPositive',
  'reverses-unknown': 'money.problem.cannotReverse',
  'reverses-a-reversal': 'money.problem.cannotReverse',
  'already-reversed': 'money.problem.alreadyReversed',
  'reversal-not-negative': 'money.problem.cannotReverse',
  'reversal-exceeds': 'money.problem.reversalExceeds',
  'reversal-without-note': 'money.problem.reversalNote',
  'what-for-too-long': 'money.problem.tooLong',
};

/**
 * The payments ledger (slice F6): append-only, newest first, each payment with its day, amount,
 * stage, who was paid, what it was for and its receipt. A payment is never edited: a mistake is
 * reversed — a new, negative payment that names it and says why, once per payment (ADR-023). The
 * domain checks a payment before the host is asked; the host refuses what it must in its words.
 *
 * **A warning comes before the act it warns about** (slice D2, decision 4): while a payment naming a
 * commitment is typed, the form shows what that commitment's payment plan has earned, what was paid
 * and what would be paid, due and ahead after it (`paymentPreview`), and — when it would put the
 * owner ahead of the work — a caution that says by how much, and which milestone is not earned yet.
 * **Record the payment** stays pressable: money is a fact, and whether to pay is the person's.
 */
export function Ledger({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t } = useI18n();
  const [reversing, setReversing] = useState<Payment | null>(null);
  const [problem, setProblem] = useState<string[]>([]);
  const payments = [...snapshot.payments].sort((a, b) => b.seq - a.seq);
  const reversedBy = new Map(
    snapshot.payments
      .filter((payment) => payment.reversesSeq !== null)
      .map((payment) => [payment.reversesSeq!, payment.seq]),
  );

  return (
    <div className="flex flex-col gap-3">
      <PaymentForm snapshot={snapshot} problem={problem} onProblem={setProblem} />
      <Card title={t('money.ledger.title')}>
        {payments.length === 0 ? (
          <EmptyState
            title={t('money.ledger.emptyTitle')}
            description={t('money.ledger.emptyDescription')}
          />
        ) : (
          <ol className="flex flex-col">
            {payments.map((payment) => (
              <PaymentLine
                key={payment.seq}
                payment={payment}
                snapshot={snapshot}
                reversedBySeq={reversedBy.get(payment.seq) ?? null}
                onReverse={() => setReversing(payment)}
              />
            ))}
          </ol>
        )}
      </Card>
      <ReverseDialog
        payment={reversing}
        snapshot={snapshot}
        onClose={() => setReversing(null)}
        onRefused={(sentence) => {
          setProblem([sentence]);
          setReversing(null);
        }}
      />
    </div>
  );
}

function PaymentForm({
  snapshot,
  problem,
  onProblem,
}: {
  snapshot: WorkSnapshot;
  problem: string[];
  onProblem: (problems: string[]) => void;
}) {
  const { t, describeError } = useI18n();
  const term = useTerms();
  const today = useToday();
  const add = useAddPayment();
  const ids = useId();
  const [day, setDay] = useState(today);
  const [stageId, setStageId] = useState('');
  const [personId, setPersonId] = useState('');
  const [commitmentId, setCommitmentId] = useState('');
  const [amount, setAmount] = useState('');
  const [whatFor, setWhatFor] = useState('');
  const [receiptField, setReceiptField] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  const stages = stagesInOrder(snapshot);
  const commitments = snapshot.commitments.filter((each) => each.stageId === stageId);
  const { entries } = usePaymentPlans(snapshot);
  const typed = toCents(amount);
  const preview: PaymentPreview | null =
    entries === null || commitmentId === '' || typed === null || typed <= 0
      ? null
      : paymentPreview(snapshot, entries, today, {
          day,
          stageId: stageId === '' ? null : stageId,
          personId: personId === '' ? null : personId,
          commitmentId,
          amountCents: typed,
          whatFor: whatFor.trim(),
          reversesSeq: null,
        });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cents = toCents(amount);
    const draft: PaymentDraft = {
      day,
      stageId: stageId === '' ? null : stageId,
      personId: personId === '' ? null : personId,
      commitmentId: commitmentId === '' ? null : commitmentId,
      amountCents: cents ?? Number.NaN,
      whatFor: whatFor.trim(),
      reversesSeq: null,
    };
    const found = validatePayment(draft, today, snapshot);
    if (found.length > 0) {
      onProblem([...new Set(found.map((each) => t(PROBLEM_KEYS[each.code])))]);
      return;
    }
    onProblem([]);
    add.mutate(
      {
        day,
        stageId,
        personId: draft.personId,
        commitmentId: draft.commitmentId,
        amountCents: cents!,
        whatFor: draft.whatFor,
        receiptPath: receipt,
        receiptHash: null,
      },
      {
        onSuccess: () => {
          setAmount('');
          setWhatFor('');
          setReceipt(null);
          setReceiptField('');
        },
        onError: (error) => onProblem([describeError(error)]),
      },
    );
  };

  const field = (suffix: string) => `${ids}-${suffix}`;

  return (
    <Card title={t('money.payment.title')}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-3">
          <DateField
            label={t('money.payment.day')}
            data-testid="payment-day"
            max={today}
            value={day}
            onChange={setDay}
          />
          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">
              {term('stage', { capital: true })}
            </span>
            <Select
              data-testid="payment-stage"
              value={stageId}
              onChange={(event) => {
                setStageId(event.target.value);
                setCommitmentId('');
              }}
            >
              <option value="">{t('money.payment.chooseStage')}</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">
              {t('money.payment.person')}
            </span>
            <Select
              data-testid="payment-person"
              value={personId}
              onChange={(event) => setPersonId(event.target.value)}
            >
              <option value="">{t('money.payment.nobody')}</option>
              {snapshot.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">
              {t('money.payment.commitment')}
            </span>
            <Select
              data-testid="payment-commitment"
              value={commitmentId}
              onChange={(event) => setCommitmentId(event.target.value)}
            >
              <option value="">{t('money.payment.noCommitment')}</option>
              {commitments.map((commitment) => (
                <option key={commitment.id} value={commitment.id}>
                  {commitment.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">
              {t('money.costLine.amountIn', { currency: snapshot.work.currency })}
            </span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.01}
              data-testid="payment-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-caption font-semibold text-fg-secondary">
              {t('money.payment.what')}
            </span>
            <Input
              data-testid="payment-what"
              maxLength={LIMITS.whatFor}
              value={whatFor}
              onChange={(event) => setWhatFor(event.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={field('receipt')}
            className="text-caption font-semibold text-fg-secondary"
          >
            {t('money.payment.receipt')}
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              id={field('receipt')}
              data-testid="payment-receipt-path"
              className="font-mono"
              spellCheck={false}
              aria-describedby={field('receipt-hint')}
              value={receiptField}
              onChange={(event) => setReceiptField(event.target.value)}
            />
            <Button
              icon={<Add20Regular />}
              data-testid="payment-receipt-add"
              onClick={() => {
                if (receiptField.trim() !== '') setReceipt(receiptField.trim());
                setReceiptField('');
              }}
            >
              {t('diary.photos.add')}
            </Button>
          </div>
          <span id={field('receipt-hint')} className="text-caption text-fg-tertiary">
            {t('money.payment.receiptHint')}
          </span>
          {receipt !== null && (
            <div data-pending-photo={receipt} className="flex items-center gap-2 text-caption">
              <span className="min-w-0 flex-1 truncate font-mono">{receipt}</span>
              <button
                type="button"
                aria-label={t('diary.photos.remove', { name: receipt })}
                title={t('diary.photos.remove', { name: receipt })}
                onClick={() => setReceipt(null)}
                className="grid size-6 place-items-center rounded-sm hover:bg-card-hover"
              >
                <Dismiss16Regular aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
        {preview !== null && preview.kind !== 'none' && (
          <PaymentPreviewLines preview={preview} snapshot={snapshot} />
        )}
        {problem.length > 0 && (
          <div data-testid="payment-problem">
            <InfoBar severity="caution" title={t('money.payment.problem')}>
              <ul className="flex flex-col gap-0.5">
                {problem.map((each, index) => (
                  <li key={index}>{each}</li>
                ))}
              </ul>
            </InfoBar>
          </div>
        )}
        <div>
          <Button
            type="submit"
            appearance="accent"
            icon={<Save20Regular />}
            data-testid="payment-save"
            disabled={add.isPending}
          >
            {add.isPending ? t('common.working') : t('money.payment.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Where the payment being typed leaves its commitment's payment plan, and the warning when it puts
 * the owner ahead of the work. Computed from the domain's preview; nothing here adds up money.
 */
function PaymentPreviewLines({
  preview,
  snapshot,
}: {
  preview: Exclude<PaymentPreview, { kind: 'none' }>;
  snapshot: WorkSnapshot;
}) {
  const i18n = useI18n();
  const { t, money } = i18n;
  const currency = snapshot.work.currency;
  const label = snapshot.commitments.find((each) => each.id === preview.commitmentId)?.label ?? '';
  const warning = aheadWarningText(i18n, preview, currency);

  return (
    <>
      <div
        data-testid="payment-preview"
        className="flex flex-col gap-0.5 rounded-md border border-stroke-subtle bg-layer px-3 py-2"
      >
        {preview.kind === 'no-plan' ? (
          <p className="text-body text-fg-secondary">
            {t('money.paymentPreview.noPlan', { commitment: label })}
          </p>
        ) : (
          <>
            <p className="text-caption font-semibold text-fg-secondary">
              {t('money.paymentPreview.title', { commitment: preview.label })}
            </p>
            <p className="text-body text-fg tabular-nums">
              {t('money.paymentPreview.line', {
                earned: money(preview.earnedCents, currency),
                paid: money(preview.paidCents, currency),
                after: money(preview.paidAfterCents, currency),
              })}
            </p>
            <p className="text-body text-fg-secondary">
              {preview.aheadAfterCents > 0
                ? t('money.paymentPreview.aheadAfter', {
                    ahead: money(preview.aheadAfterCents, currency),
                  })
                : preview.dueAfterCents > 0
                  ? t('money.paymentPreview.due', { due: money(preview.dueAfterCents, currency) })
                  : t('money.paymentPreview.even')}
            </p>
          </>
        )}
      </div>
      {warning !== null && (
        <div data-testid="payment-ahead-warning">
          <InfoBar severity="caution" title={t('money.paymentPreview.warningTitle')}>
            <p>{warning}</p>
            <p className="mt-1">{t('money.paymentPreview.decision')}</p>
          </InfoBar>
        </div>
      )}
    </>
  );
}

function PaymentLine({
  payment,
  snapshot,
  reversedBySeq,
  onReverse,
}: {
  payment: Payment;
  snapshot: WorkSnapshot;
  reversedBySeq: number | null;
  onReverse: () => void;
}) {
  const { t, money, day } = useI18n();
  const stage = snapshot.stages.find((each) => each.id === payment.stageId);
  const person = snapshot.people.find((each) => each.id === payment.personId);
  const commitment = snapshot.commitments.find((each) => each.id === payment.commitmentId);
  const reversal = payment.reversesSeq !== null;

  return (
    <li
      data-payment-seq={payment.seq}
      className="flex flex-col gap-1 border-t border-stroke-subtle py-2 first:border-t-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-body font-semibold text-fg tabular-nums">
          {t('money.payment.header', {
            seq: payment.seq,
            day: day(payment.day),
            amount: money(payment.amountCents, snapshot.work.currency),
          })}
        </span>
        {reversal && (
          <span className="rounded-md bg-info-subtle px-2 py-0.5 text-caption text-fg">
            {t('money.payment.reverses', { seq: payment.reversesSeq! })}
          </span>
        )}
        {reversedBySeq !== null && (
          <span className="rounded-md bg-caution-subtle px-2 py-0.5 text-caption text-fg">
            {t('money.payment.reversedBy', { seq: reversedBySeq })}
          </span>
        )}
      </div>
      <p className="text-body text-fg-secondary">
        {[
          payment.whatFor,
          stage?.name ?? '',
          person === undefined ? '' : t('money.payment.to', { person: person.name }),
          commitment === undefined
            ? ''
            : t('money.payment.against', { commitment: commitment.label }),
          t('money.payment.by', { author: payment.authorName }),
        ]
          .filter((part) => part !== '')
          .join(' — ')}
      </p>
      {payment.receiptHash !== null && (
        <PhotoThumb
          size="sm"
          day={payment.day}
          photo={{
            fileHash: payment.receiptHash,
            fileName: payment.whatFor,
            bytes: 0,
            width: 0,
            height: 0,
            thumbnail: true,
          }}
        />
      )}
      {!reversal && reversedBySeq === null && (
        <div>
          <Button
            appearance="subtle"
            icon={<ArrowUndo20Regular />}
            data-testid="payment-reverse"
            onClick={onReverse}
          >
            {t('money.reverse')}
          </Button>
        </div>
      )}
    </li>
  );
}

function ReverseDialog({
  payment,
  snapshot,
  onClose,
  onRefused,
}: {
  payment: Payment | null;
  snapshot: WorkSnapshot;
  onClose: () => void;
  onRefused: (sentence: string) => void;
}) {
  const { t, describeError } = useI18n();
  const today = useToday();
  const reverse = useReversePayment();
  const field = useId();
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string[]>([]);

  const close = () => {
    setNote('');
    setProblem([]);
    onClose();
  };

  return (
    <Modal
      open={payment !== null}
      label={payment === null ? '' : t('money.reverse.title', { seq: payment.seq })}
      onClose={close}
    >
      {payment !== null && (
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const found = validatePayment(reversalDraft(payment, note, today), today, snapshot);
            if (found.length > 0) {
              setProblem([...new Set(found.map((each) => t(PROBLEM_KEYS[each.code])))]);
              return;
            }
            setProblem([]);
            reverse.mutate(
              { seq: payment.seq, note: note.trim() },
              {
                onSuccess: close,
                onError: (error) => {
                  setNote('');
                  onRefused(describeError(error));
                },
              },
            );
          }}
        >
          <h2 className="text-body-lg font-semibold text-fg">
            {t('money.reverse.title', { seq: payment.seq })}
          </h2>
          <p className="text-body text-fg-secondary">{t('money.reverse.explain')}</p>
          <label htmlFor={field} className="text-caption font-semibold text-fg-secondary">
            {t('money.reverse.note')}
          </label>
          <TextArea
            id={field}
            data-testid="reversal-note"
            aria-required="true"
            maxLength={LIMITS.whatFor}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {problem.length > 0 && (
            <InfoBar severity="caution" title={t('money.payment.problem')}>
              {problem.join(' ')}
            </InfoBar>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={close} disabled={reverse.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              appearance="accent"
              data-testid="reversal-confirm"
              disabled={reverse.isPending}
            >
              {reverse.isPending ? t('common.working') : t('money.reverse.confirm')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
