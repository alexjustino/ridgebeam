import {
  Add20Regular,
  ArrowUndo20Regular,
  Delete20Regular,
  Edit20Regular,
  MoneyHand20Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useId, useState, type FormEvent } from 'react';

import { useToday } from '@/app/today';
import { LIMITS, type FundingDraft } from '@/data/commands';
import {
  useAddFunding,
  useAddReceipt,
  useRemoveFunding,
  useReverseReceipt,
  useUpdateFunding,
} from '@/data/queries';
import { isIsoDay } from '@/domain/calendar';
import {
  FUNDING_LABEL_KEYS,
  fundingInOrder,
  fundingStatuses,
  type FundingStatus,
  type ReceiptRow,
} from '@/domain/funding';
import type { Funding as Fund, FundingReceipt, WorkSnapshot } from '@/domain/plan';
import type { MessageKey } from '@/i18n/en';
import { fromCents, toCents } from '@/i18n/format';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';
import { FigureRow } from '@/ui/FigureRow';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { Select } from '@/ui/Select';
import { TextArea } from '@/ui/TextArea';

type Outcome = { kept: () => void; refused: (error: unknown) => void };

/**
 * Funding (slice E2, pt "recursos"): where the money for the work comes from — savings on hand, a
 * loan's tranches, a client's instalments — each expected on a day, and the money actually received.
 *
 * **Funding is plan, receipts are facts** (decision 1). An expected sum is written, edited and — while
 * no receipt names it — removed; **Mark as received…** records what arrived, on the day it arrived,
 * as a receipt. Receipts are a ledger exactly like the payments': kept for good, newest first, a
 * mistake reversed — a new negative receipt that names it, once — never edited.
 *
 * Each expected sum says what was received against it, as a figure that opens onto its receipts, and
 * its state in words: received in full, part received, late — expected on a day already past and not
 * received, which **Will the money last?** does not count — or not received yet.
 */
export function Funding({ snapshot, outcome }: { snapshot: WorkSnapshot; outcome: Outcome }) {
  const { t } = useI18n();
  const term = useTerms();
  const today = useToday();
  const [receiving, setReceiving] = useState<{ fundingId: string | null } | null>(null);
  const [editing, setEditing] = useState<Fund | null>(null);
  const [reversing, setReversing] = useState<FundingReceipt | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const statuses = fundingStatuses(snapshot, today);
  const receipts = [...snapshot.fundingReceipts].sort((a, b) => b.seq - a.seq);
  const reversedBy = new Map(
    snapshot.fundingReceipts
      .filter((receipt) => receipt.reversesSeq !== null)
      .map((receipt) => [receipt.reversesSeq!, receipt.seq]),
  );

  return (
    <div className="flex flex-col gap-3">
      <Card title={t('money.funding.title')}>
        <p className="mb-3 max-w-3xl text-body text-fg-secondary">{t('money.funding.lead')}</p>
        <AddFunding snapshot={snapshot} outcome={outcome} />
        {statuses.length === 0 ? (
          <EmptyState
            title={t('money.funding.emptyTitle')}
            description={t('money.funding.emptyDescription')}
          />
        ) : (
          <ul aria-label={term('funding', { capital: true })} className="mt-3 flex flex-col gap-2">
            {statuses.map((status) => (
              <FundRow
                key={status.funding.id}
                status={status}
                snapshot={snapshot}
                outcome={outcome}
                onReceive={() => setReceiving({ fundingId: status.funding.id })}
                onEdit={() => setEditing(status.funding)}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={t('money.receipts.title')}
        actions={
          <Button
            icon={<MoneyHand20Regular />}
            data-testid="receipt-add"
            onClick={() => setReceiving({ fundingId: null })}
          >
            {t('money.receipts.add')}
          </Button>
        }
      >
        {problem !== null && (
          <div className="mb-2" data-testid="receipt-problem">
            <InfoBar severity="caution" title={t('money.receipt.problem')}>
              {problem}
            </InfoBar>
          </div>
        )}
        {receipts.length === 0 ? (
          <EmptyState
            title={t('money.receipts.emptyTitle')}
            description={t('money.receipts.emptyDescription')}
          />
        ) : (
          <ol aria-label={t('money.receipts.title')} className="flex flex-col">
            {receipts.map((receipt) => (
              <ReceiptLine
                key={receipt.seq}
                receipt={receipt}
                snapshot={snapshot}
                reversedBySeq={reversedBy.get(receipt.seq) ?? null}
                onReverse={() => setReversing(receipt)}
              />
            ))}
          </ol>
        )}
      </Card>

      <ReceiveDialog
        key={receiving === null ? 'closed' : `open:${receiving.fundingId ?? ''}`}
        open={receiving !== null}
        fundingId={receiving?.fundingId ?? null}
        snapshot={snapshot}
        onClose={() => setReceiving(null)}
        onKept={() => {
          setProblem(null);
          outcome.kept();
        }}
      />
      <EditDialog
        key={editing === null ? 'closed' : `edit:${editing.id}`}
        fund={editing}
        snapshot={snapshot}
        onClose={() => setEditing(null)}
        onKept={outcome.kept}
      />
      <ReverseReceiptDialog
        key={reversing === null ? 'closed' : `reverse:${reversing.seq}`}
        receipt={reversing}
        onClose={() => setReversing(null)}
        onRefused={(sentence) => {
          setProblem(sentence);
          setReversing(null);
        }}
      />
    </div>
  );
}

type FundState = 'received' | 'part' | 'late' | 'expected';

/**
 * What a fund is now, from the domain's status: received in full, late — its day is past and money
 * is still missing, which the projection does not count — part received, or not received yet.
 */
function stateOf(status: FundingStatus): FundState {
  if (status.remainingCents === 0) return 'received';
  if (status.late) return 'late';
  return status.received.value > 0 ? 'part' : 'expected';
}

function FundRow({
  status,
  snapshot,
  outcome,
  onReceive,
  onEdit,
}: {
  status: FundingStatus;
  snapshot: WorkSnapshot;
  outcome: Outcome;
  onReceive: () => void;
  onEdit: () => void;
}) {
  const { t, money, day } = useI18n();
  const remove = useRemoveFunding();
  const currency = snapshot.work.currency;
  const { funding: fund, received } = status;
  const state = stateOf(status);
  const rest = money(status.remainingCents, currency);
  const stateText =
    state === 'received'
      ? t('money.funding.state.received')
      : state === 'late'
        ? received.value > 0
          ? t('money.funding.state.partLate', { rest, day: day(fund.expectedOn) })
          : t('money.funding.state.late', { day: day(fund.expectedOn) })
        : state === 'part'
          ? t('money.funding.state.part', { rest })
          : t('money.funding.state.expected');

  return (
    <li
      data-funding-id={fund.id}
      data-state={state}
      className="flex flex-col gap-1 rounded-md border border-stroke-subtle px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 text-body text-fg">
          <span className="font-semibold">{fund.label}</span>
          <span aria-hidden="true"> · </span>
          <span className="tabular-nums">{money(fund.amountCents, currency)}</span>
          <span aria-hidden="true"> · </span>
          <span>{t('money.funding.expectedOn', { day: day(fund.expectedOn) })}</span>
          {fund.source !== null && (
            <>
              <span aria-hidden="true"> · </span>
              <span>{t('money.funding.from', { source: fund.source })}</span>
            </>
          )}
        </span>
        <div className="flex items-center gap-1">
          {state !== 'received' && (
            <Button
              size="compact"
              icon={<MoneyHand20Regular />}
              data-testid="funding-receive"
              onClick={onReceive}
            >
              {t('money.funding.receive')}
            </Button>
          )}
          <IconButton
            data-testid="funding-edit"
            icon={<Edit20Regular />}
            label={t('money.funding.edit', { name: fund.label })}
            onClick={onEdit}
          />
          {status.removable && (
            <IconButton
              data-testid="funding-remove"
              icon={<Delete20Regular />}
              label={t('money.funding.remove', { name: fund.label })}
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(fund.id, { onSuccess: outcome.kept, onError: outcome.refused })
              }
            />
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <FigureRow<ReceiptRow>
          testId="funding-received"
          size="inline"
          figure={received}
          label={t(FUNDING_LABEL_KEYS.received)}
          value={money(received.value, currency)}
          rowsLabel={t('money.funding.receivedRows')}
          renderRow={(row) => (
            <>
              <span className="font-semibold text-fg">
                {t('money.receipt.header', {
                  seq: row.seq,
                  day: day(row.day ?? ''),
                  amount: money(row.amountCents, currency),
                })}
              </span>
              {row.reversesSeq !== null && (
                <>
                  <span aria-hidden="true"> — </span>
                  <span>{t('money.receipt.reverses', { seq: row.reversesSeq })}</span>
                </>
              )}
              {row.title !== '' && (
                <>
                  <span aria-hidden="true"> — </span>
                  <span>{row.title}</span>
                </>
              )}
            </>
          )}
        />
        <span
          data-testid="funding-state"
          className={`flex items-center gap-1 text-caption ${state === 'late' ? 'text-fg' : 'text-fg-secondary'}`}
        >
          {state === 'late' && <Warning16Regular aria-hidden="true" className="text-caution" />}
          {stateText}
        </span>
      </div>
      {fund.note !== null && <p className="text-caption text-fg-secondary">{fund.note}</p>}
      {!status.removable && (
        <p className="text-caption text-fg-tertiary">{t('money.funding.locked')}</p>
      )}
    </li>
  );
}

/** The fields of an expected sum, as typed: shared by Add and Edit. */
interface FundFields {
  label: string;
  source: string;
  amount: string;
  expectedOn: string;
  note: string;
}

/** The fields as a draft, or the sentences that say what is wrong with them. */
function readFields(
  fields: FundFields,
  t: (key: MessageKey) => string,
): { draft: FundingDraft } | { problems: string[] } {
  const problems: string[] = [];
  const cents = toCents(fields.amount);
  if (fields.label.trim() === '') problems.push(t('money.funding.problem.label'));
  if (cents === null) problems.push(t('money.invalid.amount'));
  else if (cents <= 0) problems.push(t('money.funding.problem.notPositive'));
  if (!isIsoDay(fields.expectedOn)) problems.push(t('money.funding.problem.day'));
  if (problems.length > 0) return { problems };
  return {
    draft: {
      label: fields.label.trim(),
      source: fields.source.trim() === '' ? null : fields.source.trim(),
      amountCents: cents!,
      expectedOn: fields.expectedOn,
      note: fields.note.trim() === '' ? null : fields.note.trim(),
    },
  };
}

function FundFieldset({
  fields,
  onChange,
  currency,
  describedBy,
  layout,
}: {
  fields: FundFields;
  onChange: (fields: FundFields) => void;
  currency: string;
  describedBy: string | undefined;
  layout: 'row' | 'dialog';
}) {
  const { t } = useI18n();
  const set = (patch: Partial<FundFields>) => onChange({ ...fields, ...patch });
  return (
    <div
      className={
        layout === 'row'
          ? 'grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem_10rem]'
          : 'grid gap-3 sm:grid-cols-2'
      }
    >
      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">
          {t('money.funding.label')}
        </span>
        <Input
          data-testid="funding-label"
          aria-describedby={describedBy}
          maxLength={LIMITS.fundingLabel}
          placeholder={t('money.funding.labelHint')}
          value={fields.label}
          onChange={(event) => set({ label: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">
          {t('money.funding.source')}
        </span>
        <Input
          data-testid="funding-source"
          maxLength={LIMITS.fundingSource}
          placeholder={t('money.funding.sourceHint')}
          value={fields.source}
          onChange={(event) => set({ source: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">
          {t('money.costLine.amountIn', { currency })}
        </span>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          data-testid="funding-amount"
          aria-describedby={describedBy}
          value={fields.amount}
          onChange={(event) => set({ amount: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-fg-secondary">
          {t('money.funding.expected')}
        </span>
        <Input
          type="date"
          data-testid="funding-expected"
          aria-describedby={describedBy}
          value={fields.expectedOn}
          onChange={(event) => set({ expectedOn: event.target.value })}
        />
      </label>
      <label
        className={`flex flex-col gap-1 ${layout === 'row' ? 'md:col-span-4' : 'sm:col-span-2'}`}
      >
        <span className="text-caption font-semibold text-fg-secondary">
          {t('money.funding.note')}
        </span>
        <Input
          data-testid="funding-note"
          maxLength={LIMITS.fundingNote}
          value={fields.note}
          onChange={(event) => set({ note: event.target.value })}
        />
      </label>
    </div>
  );
}

function AddFunding({ snapshot, outcome }: { snapshot: WorkSnapshot; outcome: Outcome }) {
  const { t, describeError } = useI18n();
  const today = useToday();
  const add = useAddFunding();
  const hint = useId();
  const empty: FundFields = { label: '', source: '', amount: '', expectedOn: today, note: '' };
  const [fields, setFields] = useState<FundFields>(empty);
  const [problems, setProblems] = useState<string[]>([]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const read = readFields(fields, t);
    if ('problems' in read) {
      setProblems(read.problems);
      return;
    }
    setProblems([]);
    add.mutate(read.draft, {
      onSuccess: () => {
        outcome.kept();
        setFields({ ...empty, expectedOn: fields.expectedOn });
      },
      onError: (error) => setProblems([describeError(error)]),
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <FundFieldset
        fields={fields}
        onChange={setFields}
        currency={snapshot.work.currency}
        describedBy={problems.length > 0 ? hint : undefined}
        layout="row"
      />
      {problems.length > 0 && (
        <div id={hint} data-testid="funding-problem">
          <InfoBar severity="caution" title={t('money.funding.problem')}>
            <ul className="flex flex-col gap-0.5">
              {problems.map((each, index) => (
                <li key={index}>{each}</li>
              ))}
            </ul>
          </InfoBar>
        </div>
      )}
      <div>
        <Button
          type="submit"
          icon={<Add20Regular />}
          data-testid="funding-add"
          disabled={add.isPending}
        >
          {add.isPending ? t('common.working') : t('money.funding.add')}
        </Button>
      </div>
    </form>
  );
}

function EditDialog({
  fund,
  snapshot,
  onClose,
  onKept,
}: {
  fund: Fund | null;
  snapshot: WorkSnapshot;
  onClose: () => void;
  onKept: () => void;
}) {
  const { t, describeError } = useI18n();
  const update = useUpdateFunding();
  const hint = useId();
  const [fields, setFields] = useState<FundFields>(() => ({
    label: fund?.label ?? '',
    source: fund?.source ?? '',
    amount: fund === null ? '' : fromCents(fund.amountCents),
    expectedOn: fund?.expectedOn ?? '',
    note: fund?.note ?? '',
  }));
  const [problems, setProblems] = useState<string[]>([]);

  return (
    <Modal
      open={fund !== null}
      label={fund === null ? '' : t('money.funding.editTitle', { name: fund.label })}
      onClose={onClose}
    >
      {fund !== null && (
        <form
          noValidate
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const read = readFields(fields, t);
            if ('problems' in read) {
              setProblems(read.problems);
              return;
            }
            setProblems([]);
            // A refusal keeps what was typed, with the host's sentence under it (§10).
            update.mutate(
              { ...read.draft, id: fund.id },
              {
                onSuccess: () => {
                  onKept();
                  onClose();
                },
                onError: (error) => setProblems([describeError(error)]),
              },
            );
          }}
        >
          <h2 className="text-body-lg font-semibold text-fg">
            {t('money.funding.editTitle', { name: fund.label })}
          </h2>
          <FundFieldset
            fields={fields}
            onChange={setFields}
            currency={snapshot.work.currency}
            describedBy={problems.length > 0 ? hint : undefined}
            layout="dialog"
          />
          {problems.length > 0 && (
            <div id={hint}>
              <InfoBar severity="caution" title={t('money.funding.problem')}>
                {problems.join(' ')}
              </InfoBar>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} disabled={update.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              appearance="accent"
              data-testid="funding-save"
              disabled={update.isPending}
            >
              {update.isPending ? t('common.working') : t('money.funding.save')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/**
 * Money received: on the day it arrived, how much, against which expected sum — or none, money that
 * arrived unplanned. A day after today is refused before the host is asked.
 */
function ReceiveDialog({
  open,
  fundingId,
  snapshot,
  onClose,
  onKept,
}: {
  open: boolean;
  fundingId: string | null;
  snapshot: WorkSnapshot;
  onClose: () => void;
  onKept: () => void;
}) {
  const { t, describeError } = useI18n();
  const term = useTerms();
  const today = useToday();
  const add = useAddReceipt();
  const ids = useId();
  const [fund, setFund] = useState(fundingId ?? '');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(today);
  const [note, setNote] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const funds = fundingInOrder(snapshot);
  const named = funds.find((each) => each.id === fund);
  const title =
    named === undefined
      ? t('money.receipt.title')
      : t('money.receipt.titleOf', { name: named.label });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cents = toCents(amount);
    const found: string[] = [];
    if (cents === null) found.push(t('money.invalid.amount'));
    else if (cents <= 0) found.push(t('money.receipt.problem.notPositive'));
    if (!isIsoDay(day)) found.push(t('money.receipt.problem.day'));
    else if (day > today) found.push(t('money.receipt.problem.futureDay'));
    if (found.length > 0) {
      setProblems(found);
      return;
    }
    setProblems([]);
    add.mutate(
      {
        fundingId: fund === '' ? null : fund,
        amountCents: cents!,
        day,
        note: note.trim() === '' ? null : note.trim(),
      },
      {
        onSuccess: () => {
          onKept();
          onClose();
        },
        onError: (error) => setProblems([describeError(error)]),
      },
    );
  };

  return (
    <Modal open={open} label={title} onClose={onClose}>
      {open && (
        <form noValidate onSubmit={submit} className="flex flex-col gap-4 p-5">
          <h2 className="text-body-lg font-semibold text-fg">{title}</h2>
          <p className="text-body text-fg-secondary">{t('money.receipt.explain')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-caption font-semibold text-fg-secondary">
                {t('money.receipt.of', { funding: term('funding') })}
              </span>
              <Select
                data-testid="receipt-funding"
                value={fund}
                onChange={(event) => setFund(event.target.value)}
              >
                <option value="">{t('money.receipt.unplanned')}</option>
                {funds.map((each) => (
                  <option key={each.id} value={each.id}>
                    {each.label}
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
                data-testid="receipt-amount"
                aria-describedby={problems.length > 0 ? `${ids}-problem` : undefined}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption font-semibold text-fg-secondary">
                {t('money.receipt.day')}
              </span>
              <Input
                type="date"
                data-testid="receipt-day"
                max={today}
                aria-describedby={problems.length > 0 ? `${ids}-problem` : undefined}
                value={day}
                onChange={(event) => setDay(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-caption font-semibold text-fg-secondary">
                {t('money.receipt.note')}
              </span>
              <TextArea
                data-testid="receipt-note"
                maxLength={LIMITS.receiptNote}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </div>
          {problems.length > 0 && (
            <div id={`${ids}-problem`} data-testid="receipt-dialog-problem">
              <InfoBar severity="caution" title={t('money.receipt.problem')}>
                <ul className="flex flex-col gap-0.5">
                  {problems.map((each, index) => (
                    <li key={index}>{each}</li>
                  ))}
                </ul>
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
              data-testid="receipt-confirm"
              disabled={add.isPending}
            >
              {add.isPending ? t('common.working') : t('money.receipt.confirm')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ReceiptLine({
  receipt,
  snapshot,
  reversedBySeq,
  onReverse,
}: {
  receipt: FundingReceipt;
  snapshot: WorkSnapshot;
  reversedBySeq: number | null;
  onReverse: () => void;
}) {
  const { t, money, day } = useI18n();
  const fund = snapshot.funding.find((each) => each.id === receipt.fundingId);
  const reversal = receipt.reversesSeq !== null;

  return (
    <li
      data-receipt-seq={receipt.seq}
      className="flex flex-col gap-1 border-t border-stroke-subtle py-2 first:border-t-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-body font-semibold text-fg tabular-nums">
          {t('money.receipt.header', {
            seq: receipt.seq,
            day: day(receipt.day),
            amount: money(receipt.amountCents, snapshot.work.currency),
          })}
        </span>
        {reversal && (
          <span className="rounded-md bg-info-subtle px-2 py-0.5 text-caption text-fg">
            {t('money.receipt.reverses', { seq: receipt.reversesSeq! })}
          </span>
        )}
        {reversedBySeq !== null && (
          <span className="rounded-md bg-caution-subtle px-2 py-0.5 text-caption text-fg">
            {t('money.receipt.reversedBy', { seq: reversedBySeq })}
          </span>
        )}
      </div>
      <p className="text-body text-fg-secondary">
        {[
          fund === undefined
            ? receipt.fundingId === null
              ? t('money.receipt.unplannedRow')
              : ''
            : t('money.receipt.as', { name: fund.label }),
          receipt.note ?? '',
          t('money.payment.by', { author: receipt.authorName }),
        ]
          .filter((part) => part !== '')
          .join(' — ')}
      </p>
      {!reversal && reversedBySeq === null && (
        <div>
          <Button
            appearance="subtle"
            icon={<ArrowUndo20Regular />}
            data-testid="receipt-reverse"
            onClick={onReverse}
          >
            {t('money.reverse')}
          </Button>
        </div>
      )}
    </li>
  );
}

/** Reverse a receipt: a new negative receipt that names it, on a day not after today. Once. */
function ReverseReceiptDialog({
  receipt,
  onClose,
  onRefused,
}: {
  receipt: FundingReceipt | null;
  onClose: () => void;
  onRefused: (sentence: string) => void;
}) {
  const { t, describeError } = useI18n();
  const today = useToday();
  const reverse = useReverseReceipt();
  const field = useId();
  const [day, setDay] = useState(today);
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <Modal
      open={receipt !== null}
      label={receipt === null ? '' : t('money.receipt.reverseTitle', { seq: receipt.seq })}
      onClose={onClose}
    >
      {receipt !== null && (
        <form
          noValidate
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isIsoDay(day)) {
              setProblem(t('money.receipt.problem.day'));
              return;
            }
            if (day > today) {
              setProblem(t('money.receipt.problem.futureDay'));
              return;
            }
            setProblem(null);
            reverse.mutate(
              { seq: receipt.seq, day },
              { onSuccess: onClose, onError: (error) => onRefused(describeError(error)) },
            );
          }}
        >
          <h2 className="text-body-lg font-semibold text-fg">
            {t('money.receipt.reverseTitle', { seq: receipt.seq })}
          </h2>
          <p className="text-body text-fg-secondary">{t('money.receipt.reverseExplain')}</p>
          <label htmlFor={field} className="text-caption font-semibold text-fg-secondary">
            {t('money.receipt.reverseDay')}
          </label>
          <Input
            id={field}
            type="date"
            data-testid="receipt-reversal-day"
            max={today}
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
          {problem !== null && (
            <InfoBar severity="caution" title={t('money.receipt.problem')}>
              {problem}
            </InfoBar>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} disabled={reverse.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              appearance="accent"
              data-testid="receipt-reversal-confirm"
              disabled={reverse.isPending}
            >
              {reverse.isPending ? t('common.working') : t('money.receipt.reverseConfirm')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
