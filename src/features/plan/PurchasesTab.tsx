import {
  Add20Regular,
  ArrowUndo20Regular,
  BoxCheckmark20Regular,
  Cart20Regular,
  Clock16Regular,
  Delete20Regular,
  Edit20Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useToday } from '@/app/today';
import { useDiary, useRemovePurchase } from '@/data/queries';
import type { Purchase, PurchaseEventKind, WorkSnapshot } from '@/domain/plan';
import {
  PURCHASE_FLAG_KEYS,
  PURCHASE_STATE_KEYS,
  purchaseFlags,
  purchaseRows,
  type PurchaseRow,
  type PurchaseState,
} from '@/domain/purchases';
import { schedule } from '@/domain/schedule';
import type { MessageKey } from '@/i18n/en';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Modal } from '@/ui/Modal';

import { PurchaseEventDialog, type PurchaseToRecord } from './PurchaseEventDialog';
import { PurchaseForm } from './PurchaseForm';
import {
  purchaseAfterNeededText,
  purchaseEventText,
  purchaseFellThroughText,
  purchaseLate,
  purchaseLeadText,
  purchaseNeededForText,
  purchaseNeededOnText,
  purchaseOrderByText,
  purchaseOrderText,
} from './purchaseWords';

/** The groups of the list, in order: what is to order first, what was delivered last. */
const GROUPS: ReadonlyArray<{ state: PurchaseState; key: MessageKey }> = [
  { state: 'to-order', key: 'purchases.group.toOrder' },
  { state: 'ordered', key: 'purchases.group.ordered' },
  { state: 'delivered', key: 'purchases.group.delivered' },
];

const DONE_KEYS = {
  ordered: 'purchases.done.ordered',
  delivered: 'purchases.done.delivered',
  cancelled: 'purchases.done.cancelled',
} as const satisfies Record<PurchaseEventKind, MessageKey>;

/**
 * The Plan's **Purchases** tab (slice G2, decision 3; pt "Compras"): what the work must buy that takes
 * time to arrive, each with how long the supplier takes, and the day to order it by — computed from
 * when what needs it starts **as things stand** (E3's forecast), never typed.
 *
 * **Add a purchase…** above; then the purchases by where they stand — to order, ordered and waiting
 * to arrive, delivered — each with what needs it, its lead time, the day it is needed, the day to
 * order by or when it is expected, and its flags in words and with an icon, never colour alone
 * (`[data-purchase-id]`, `data-state`, `data-late`). A purchase to order offers **Mark as ordered…**;
 * an ordered one **Mark as delivered…** and **The order fell through…** — each a fact on the record,
 * with its day. While nothing has happened to it, a purchase can be edited and removed; afterwards
 * it stays as written, and the row says why.
 *
 * Every day and flag is the domain's `purchaseRows`, computed here from the plan, its schedule and the
 * diary; the tab adds words only. After adding, saving or recording, the focus goes to the row.
 */
export function PurchasesTab({ snapshot }: { snapshot: WorkSnapshot }) {
  const i18n = useI18n();
  const { t, describeError } = i18n;
  const term = useTerms();
  const today = useToday();
  const diary = useDiary(true);
  const remove = useRemovePurchase();
  const reason = useId();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [removing, setRemoving] = useState<Purchase | null>(null);
  const [recording, setRecording] = useState<PurchaseToRecord | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const focusNext = useRef<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const rowsRef = useRef(new Map<string, HTMLLIElement>());

  const scheduled = useMemo(() => schedule(snapshot), [snapshot]);
  const rows = useMemo(
    () => (diary.data === undefined ? null : purchaseRows(snapshot, scheduled, diary.data, today)),
    [diary.data, snapshot, scheduled, today],
  );
  const byId = new Map(snapshot.purchases.map((purchase) => [purchase.id, purchase]));
  const hasStage = snapshot.stages.length > 0;

  const register = useCallback((purchaseId: string, element: HTMLLIElement | null) => {
    if (element === null) rowsRef.current.delete(purchaseId);
    else rowsRef.current.set(purchaseId, element);
  }, []);

  useEffect(() => {
    if (focusNext.current === null) return;
    rowsRef.current.get(focusNext.current)?.focus();
    focusNext.current = null;
  }, [snapshot, rows]);

  const confirmRemove = () => {
    if (removing === null) return;
    const gone = removing;
    remove.mutate(gone.id, {
      onSuccess: () => {
        setRemoving(null);
        setRefusal(null);
        announce(t('purchases.removed', { name: gone.name }));
        requestAnimationFrame(() => addButton.current?.focus());
      },
      onError: (error) => {
        setRemoving(null);
        setRefusal(describeError(error));
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-body text-fg-secondary">{t('purchases.lead')}</p>

      {adding ? (
        <Card
          title={t('purchases.form.title')}
          description={t('purchases.form.lead', { stage: term('stage') })}
        >
          <PurchaseForm
            snapshot={snapshot}
            purchase={null}
            onDone={(purchaseId) => {
              setAdding(false);
              focusNext.current = purchaseId;
            }}
            onCancel={() => {
              setAdding(false);
              requestAnimationFrame(() => addButton.current?.focus());
            }}
          />
        </Card>
      ) : (
        <div className="flex flex-col items-start gap-1">
          <Button
            ref={addButton}
            appearance="accent"
            icon={<Add20Regular />}
            data-testid="purchase-add"
            disabled={!hasStage}
            aria-describedby={hasStage ? undefined : reason}
            onClick={() => setAdding(true)}
          >
            {t('purchases.add')}
          </Button>
          {!hasStage && (
            <p
              id={reason}
              data-testid="purchase-add-locked"
              className="text-body text-fg-secondary"
            >
              {t('purchases.add.noStage', { stage: term('stage') })}
            </p>
          )}
        </div>
      )}

      {refusal !== null && (
        <div data-testid="purchase-remove-refused">
          <InfoBar severity="danger" title={t('purchases.remove.refused')}>
            {refusal}
          </InfoBar>
        </div>
      )}

      {diary.isError ? (
        <InfoBar severity="danger" title={t('common.hostSilent')}>
          {describeError(diary.error)}
        </InfoBar>
      ) : rows === null ? (
        <p className="text-body text-fg-secondary">{t('dashboard.purchases.reading')}</p>
      ) : rows.length === 0 ? (
        <p data-testid="purchases-none" className="text-body text-fg-tertiary">
          {t('purchases.none')}
        </p>
      ) : (
        GROUPS.map((group) => {
          const inGroup = rows.filter((row) => row.state === group.state);
          if (inGroup.length === 0) return null;
          return (
            <section
              key={group.state}
              data-purchase-group={group.state}
              className="flex flex-col gap-2"
            >
              <h3 className="text-body-lg font-semibold text-fg">{t(group.key)}</h3>
              <ul aria-label={t(group.key)} className="flex flex-col gap-3">
                {inGroup.map((row) => (
                  <PurchaseLine
                    key={row.purchaseId}
                    ref={(element) => register(row.purchaseId, element)}
                    row={row}
                    purchase={byId.get(row.purchaseId)}
                    onRecord={(purchase, kind) => setRecording({ purchase, kind })}
                    onEdit={setEditing}
                    onRemove={setRemoving}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}

      {/* Mounted only while open, so each opening starts from the purchase as it is now. */}
      {editing !== null && (
        <Modal
          open
          label={t('purchases.form.editTitle', { name: editing.name })}
          onClose={() => setEditing(null)}
          width="lg"
        >
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
            <h2 className="text-body-lg font-semibold text-fg">
              {t('purchases.form.editTitle', { name: editing.name })}
            </h2>
            <PurchaseForm
              snapshot={snapshot}
              purchase={editing}
              onDone={(purchaseId) => {
                setEditing(null);
                focusNext.current = purchaseId;
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        </Modal>
      )}
      {recording !== null && (
        <PurchaseEventDialog
          snapshot={snapshot}
          recording={recording}
          onClose={() => setRecording(null)}
          onRecorded={(recorded) => {
            setRecording(null);
            announce(t(DONE_KEYS[recorded.kind], { name: recorded.purchase.name }));
            focusNext.current = recorded.purchase.id;
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={removing === null ? '' : t('purchases.remove.title', { name: removing.name })}
        confirmLabel={t('purchases.remove.confirm')}
        confirmTestId="purchase-remove-confirm"
        danger
        pending={remove.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      >
        <p>{t('purchases.remove.body')}</p>
      </ConfirmDialog>
    </div>
  );
}

/**
 * One purchase: its name and where it stands, what needs it, how much and from whom, its lead time,
 * the day it is needed and the day to order by — or when it is expected, or when it arrived — its
 * flags in words with an icon, its story, and the ways forward from where it stands.
 */
function PurchaseLine({
  ref,
  row,
  purchase,
  onRecord,
  onEdit,
  onRemove,
}: {
  ref: (element: HTMLLIElement | null) => void;
  row: PurchaseRow;
  purchase: Purchase | undefined;
  onRecord: (purchase: Purchase, kind: PurchaseEventKind) => void;
  onEdit: (purchase: Purchase) => void;
  onRemove: (purchase: Purchase) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const term = useTerms();
  const heading = useId();
  const flags = purchaseFlags(row);
  const late = purchaseLate(row);
  const orderBy = purchaseOrderByText(i18n, term, row);
  const order = purchaseOrderText(i18n, row);
  const neededOn = purchaseNeededOnText(i18n, row);
  const after = purchaseAfterNeededText(i18n, row);
  const fellThrough = purchaseFellThroughText(i18n, row);
  const events = purchase === undefined ? [] : [...purchase.events].sort((a, b) => a.seq - b.seq);
  const untouched = purchase !== undefined && purchase.events.length === 0;

  return (
    <li
      ref={ref}
      tabIndex={-1}
      data-purchase-id={row.purchaseId}
      data-state={row.state}
      data-late={late ? 'true' : 'false'}
      data-this-week={row.orderThisWeek ? 'true' : 'false'}
      aria-labelledby={heading}
    >
      <Card>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h4 id={heading} className="text-body-lg font-semibold text-fg">
              {row.name}
            </h4>
            <span
              data-testid="purchase-state"
              className={[
                'rounded-md px-2 py-0.5 text-caption text-fg',
                row.state === 'delivered' ? 'bg-success-subtle' : 'bg-card-hover',
              ].join(' ')}
            >
              {t(PURCHASE_STATE_KEYS[row.state] as MessageKey)}
            </span>
          </div>
          <p className="text-body text-fg-secondary">
            {[
              purchaseNeededForText(i18n, row),
              row.quantity === null
                ? null
                : t('purchases.row.quantity', { quantity: row.quantity }),
              row.supplier === null
                ? null
                : t('purchases.row.supplier', { supplier: row.supplier }),
            ]
              .filter((part) => part !== null)
              .join(' · ')}
          </p>
          <p className="text-body text-fg-secondary">
            {[purchaseLeadText(i18n, term, row), row.state === 'delivered' ? null : neededOn]
              .filter((part) => part !== null)
              .join(' · ')}
          </p>
          {(orderBy ?? order) !== null && (
            <p
              data-testid="purchase-day"
              data-order-by={row.orderBy ?? ''}
              data-expected={row.expectedOn ?? ''}
              className={late ? 'text-body font-semibold text-fg' : 'text-body text-fg'}
            >
              {orderBy ?? order}
            </p>
          )}
          {flags.length > 0 && (
            <ul data-testid="purchase-flags" className="flex flex-wrap gap-2">
              {flags.map((flag) => {
                const bad = flag !== 'orderThisWeek';
                return (
                  <li
                    key={flag}
                    data-flag={flag}
                    className={[
                      'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-caption text-fg',
                      bad ? 'bg-caution-subtle' : 'bg-info-subtle',
                    ].join(' ')}
                  >
                    {bad ? (
                      <Warning16Regular aria-hidden="true" className="text-caution" />
                    ) : (
                      <Clock16Regular aria-hidden="true" className="text-info" />
                    )}
                    {t(PURCHASE_FLAG_KEYS[flag] as MessageKey)}
                  </li>
                );
              })}
            </ul>
          )}
          {after !== null && (
            <p data-testid="purchase-after-needed" className="text-body text-fg">
              {after}
            </p>
          )}
          {row.done && row.state !== 'delivered' && (
            <p className="text-body text-fg-secondary">{t('purchases.row.done')}</p>
          )}
          {fellThrough !== null && <p className="text-body text-fg-secondary">{fellThrough}</p>}
          {row.note !== null && <p className="text-body whitespace-pre-line text-fg">{row.note}</p>}
          {events.length > 0 && (
            <ol
              aria-label={t('purchases.row.history', { name: row.name })}
              data-testid="purchase-history"
              className="flex flex-col gap-0.5 border-l border-stroke-subtle pl-3"
            >
              {events.map((event) => (
                <li
                  key={event.seq}
                  data-event-seq={event.seq}
                  className="text-caption text-fg-secondary"
                >
                  {purchaseEventText(i18n, event)}
                  {event.note !== null && (
                    <>
                      <span aria-hidden="true"> — </span>
                      {t('purchases.history.note', { note: event.note })}
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
          {purchase !== undefined && row.state !== 'delivered' && (
            <div
              role="group"
              aria-label={t('purchases.row.actions', { name: row.name })}
              className="grid grid-cols-2 gap-2 lg:flex"
            >
              {row.state === 'to-order' ? (
                <Button
                  icon={<Cart20Regular />}
                  data-testid="purchase-ordered"
                  onClick={() => onRecord(purchase, 'ordered')}
                >
                  {t('purchases.ordered')}
                </Button>
              ) : (
                <>
                  <Button
                    icon={<BoxCheckmark20Regular />}
                    data-testid="purchase-delivered"
                    onClick={() => onRecord(purchase, 'delivered')}
                  >
                    {t('purchases.delivered')}
                  </Button>
                  <Button
                    icon={<ArrowUndo20Regular />}
                    data-testid="purchase-cancel"
                    onClick={() => onRecord(purchase, 'cancelled')}
                  >
                    {t('purchases.cancel')}
                  </Button>
                </>
              )}
            </div>
          )}
          {purchase !== undefined &&
            (untouched ? (
              <div className="flex items-center gap-1">
                <IconButton
                  data-testid="purchase-edit"
                  icon={<Edit20Regular />}
                  label={t('purchases.edit', { name: row.name })}
                  onClick={() => onEdit(purchase)}
                />
                <IconButton
                  data-testid="purchase-remove"
                  icon={<Delete20Regular />}
                  label={t('purchases.remove', { name: row.name })}
                  onClick={() => onRemove(purchase)}
                />
              </div>
            ) : (
              <p className="text-caption text-fg-tertiary">{t('purchases.locked')}</p>
            ))}
        </div>
      </Card>
    </li>
  );
}
