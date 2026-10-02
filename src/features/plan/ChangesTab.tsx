import {
  CalendarArrowRight20Regular,
  Checkmark20Regular,
  Dismiss20Regular,
  DocumentAdd20Regular,
  ArrowUndo20Regular,
} from '@fluentui/react-icons';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useNavigation } from '@/app/navigation';
import { useToday } from '@/app/today';
import {
  changeImpact,
  changeOrderRows,
  waitsTooLong,
  type ChangeOrder,
  type ChangeOrderRow,
} from '@/domain/changes';
import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useLens, useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';

import {
  askedByText,
  changeCostText,
  changeNameCapital,
  changeRowTitle,
  changeStateText,
  decidedImpactSentence,
  effectText,
  impactSentence,
  problemsText,
  waitedText,
} from './changeWords';
import { DecideChangeDialog, type ChangeToDecide } from './DecideChangeDialog';
import { RaiseChangeForm } from './RaiseChangeForm';

/**
 * The Plan's **Changes** tab (slice E1, decision 6): once the plan is approved, nothing changes
 * without a price and a date. Every change order of the work, newest first — its number and title,
 * who asked, where it stands, what it costs and what it does to the finish — with **Raise a
 * change…** above them and **Approve…**, **Decline…** and **Withdraw…** on each one still waiting.
 *
 * A waiting change's days are the domain's `changeImpact` of the plan as it is now, said as what
 * approving it today would do; a decided one's are the impact its decision froze, never recomputed
 * (an approved change is already in the plan, and asking again would count it twice). A change is
 * never edited: a mistake is withdrawn and raised again, and the record keeps both.
 *
 * Before the plan is approved there are no change orders — the plan is still being written — so the
 * raise button is disabled **with the sentence that says why** beside it, never on its own (§10).
 *
 * After an approval the tab says, where the person is looking, that the replanning is open with the
 * change applied and that the next baseline closes it, and offers **Go to the Schedule**.
 */
export function ChangesTab({ snapshot }: { snapshot: WorkSnapshot }) {
  const i18n = useI18n();
  const { t } = i18n;
  const term = useTerms();
  const today = useToday();
  const navigation = useNavigation();
  const reason = useId();
  const [raising, setRaising] = useState(false);
  const [deciding, setDeciding] = useState<ChangeToDecide | null>(null);
  const [approved, setApproved] = useState<ChangeOrder | null>(null);
  // The change whose row takes the focus once the answer to its decision has been drawn.
  const focusNext = useRef<string | null>(null);
  const raiseButton = useRef<HTMLButtonElement>(null);
  const toSchedule = useRef<HTMLButtonElement>(null);
  const rowsRef = useRef(new Map<string, HTMLLIElement>());

  const approvedPlan = snapshot.work.approvedAt !== null;
  const rows = useMemo(() => changeOrderRows(snapshot, today), [snapshot, today]);
  const byId = new Map(snapshot.changeOrders.map((change) => [change.id, change]));
  const newestFirst = [...rows].reverse();

  // After a decision the focus goes where the person must look next: the way to the Schedule after
  // an approval, the change itself after a decline or a withdrawal — never left on a button that is
  // gone.
  useEffect(() => {
    if (approved !== null) toSchedule.current?.focus();
  }, [approved]);
  useEffect(() => {
    if (focusNext.current === null) return;
    rowsRef.current.get(focusNext.current)?.focus();
    focusNext.current = null;
  }, [snapshot]);

  const decided = (done: ChangeToDecide) => {
    const name = changeNameCapital(i18n, term, done.change);
    setDeciding(null);
    if (done.outcome === 'approved') {
      announce(`${t('changes.approved.title', { name })} ${t('changes.approved.body')}`);
      setApproved(done.change);
    } else {
      announce(
        t(done.outcome === 'declined' ? 'changes.decided.declined' : 'changes.decided.withdrawn', {
          name,
        }),
      );
      focusNext.current = done.change.id;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-body text-fg-secondary">
        {t('changes.lead', { changeOrder: term('changeOrder') })}
      </p>

      {approved !== null && (
        <div data-testid="change-approved">
          <InfoBar
            severity="success"
            title={t('changes.approved.title', {
              name: changeNameCapital(i18n, term, approved),
            })}
          >
            <p>{t('changes.approved.body')}</p>
            <div className="mt-2">
              <Button
                ref={toSchedule}
                icon={<CalendarArrowRight20Regular />}
                data-testid="change-to-schedule"
                onClick={navigation.openSchedule}
              >
                {t('changes.approved.schedule')}
              </Button>
            </div>
          </InfoBar>
        </div>
      )}

      {raising ? (
        <RaiseChangeForm
          snapshot={snapshot}
          onDone={() => {
            setRaising(false);
            setApproved(null);
          }}
          onCancel={() => {
            setRaising(false);
            requestAnimationFrame(() => raiseButton.current?.focus());
          }}
        />
      ) : (
        <div className="flex flex-col items-start gap-1">
          <Button
            ref={raiseButton}
            appearance="accent"
            icon={<DocumentAdd20Regular />}
            data-testid="change-raise"
            disabled={!approvedPlan}
            aria-describedby={approvedPlan ? undefined : reason}
            onClick={() => setRaising(true)}
          >
            {t('changes.raise')}
          </Button>
          {!approvedPlan && (
            <p
              id={reason}
              data-testid="change-raise-locked"
              className="text-body text-fg-secondary"
            >
              {t('changes.raise.locked', { changeOrder: term('changeOrder') })}
            </p>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p data-testid="changes-none" className="text-body text-fg-tertiary">
          {t('changes.none')}
        </p>
      ) : (
        <ul aria-label={t('changes.list')} className="flex flex-col gap-3">
          {newestFirst.map((row) => {
            const change = byId.get(row.changeOrderId);
            if (change === undefined) return null;
            return (
              <ChangeRow
                key={change.id}
                ref={(element) => {
                  if (element === null) rowsRef.current.delete(change.id);
                  else rowsRef.current.set(change.id, element);
                }}
                snapshot={snapshot}
                change={change}
                row={row}
                onDecide={(outcome) => setDeciding({ change, outcome })}
              />
            );
          })}
        </ul>
      )}

      <DecideChangeDialog
        snapshot={snapshot}
        deciding={deciding}
        onClose={() => setDeciding(null)}
        onDecided={decided}
      />
    </div>
  );
}

/**
 * One change order: its number and title, who asked, where it stands, its stage, what it does, what
 * it costs and how far it moves the finish — and, while it waits, the three ways to decide it.
 */
function ChangeRow({
  ref,
  snapshot,
  change,
  row,
  onDecide,
}: {
  ref: (element: HTMLLIElement | null) => void;
  snapshot: WorkSnapshot;
  change: ChangeOrder;
  row: ChangeOrderRow;
  onDecide: (outcome: ChangeToDecide['outcome']) => void;
}) {
  const i18n = useI18n();
  const { t, day } = i18n;
  const term = useTerms();
  const ownerWords = useLens() === 'owner';
  const currency = snapshot.work.currency;
  const pending = change.decision === null;
  const heading = useId();

  // A waiting change is asked of the plan as it is now; a decided one says what its decision froze.
  const live = useMemo(
    () => (pending ? changeImpact(snapshot, change) : null),
    [pending, snapshot, change],
  );
  const days = pending
    ? live === null || !live.ok
      ? null
      : t('changes.row.ifApproved', { impact: impactSentence(i18n, live.impact, currency) })
    : change.decision?.outcome === 'approved'
      ? t('changes.row.decided', { impact: decidedImpactSentence(i18n, change, currency) ?? '' })
      : t('changes.row.notApplied', {
          impact: decidedImpactSentence(i18n, change, currency) ?? '',
        });
  const waited = waitedText(i18n, row.waitedDays, waitsTooLong(row));

  return (
    <li
      ref={ref}
      tabIndex={-1}
      data-change-id={change.id}
      data-state={row.state}
      aria-labelledby={heading}
    >
      <Card>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 id={heading} className="text-body-lg font-semibold text-fg">
              {changeRowTitle(i18n, change)}
            </h3>
            <span
              data-testid="change-state"
              className={[
                'rounded-md px-2 py-0.5 text-caption text-fg',
                row.state === 'pending'
                  ? waitsTooLong(row)
                    ? 'bg-caution-subtle'
                    : 'bg-info-subtle'
                  : row.state === 'approved'
                    ? 'bg-success-subtle'
                    : 'bg-card-hover',
              ].join(' ')}
            >
              {changeStateText(i18n, change)}
              {waited !== null && ` · ${waited}`}
            </span>
          </div>
          <p className="text-body text-fg-secondary">
            {[
              askedByText(i18n, snapshot, change, ownerWords),
              row.stageName === null
                ? null
                : t('changes.row.stage', {
                    stage: term('stage', { capital: true }),
                    name: row.stageName,
                  }),
              t('changes.row.raised', { day: day(change.raisedOn), author: change.authorName }),
            ]
              .filter((part) => part !== null)
              .join(' · ')}
          </p>
          {change.description !== null && change.description.trim() !== '' && (
            <p className="text-body whitespace-pre-line text-fg">{change.description}</p>
          )}
          {change.effects.length > 0 && (
            <ul
              aria-label={t('changes.effects.list')}
              className="flex flex-col gap-0.5 border-l border-stroke-subtle pl-3"
            >
              {change.effects.map((effect, index) => (
                <li key={index} className="text-body text-fg-secondary">
                  {effectText(i18n, snapshot, effect)}
                </li>
              ))}
            </ul>
          )}
          {/* A change declined or withdrawn cost nothing: its price is said once, as what it would have cost. */}
          {(pending || change.decision?.outcome === 'approved') && (
            <p data-testid="change-cost-text" className="text-body text-fg">
              {changeCostText(i18n, change.costCents, currency)}
            </p>
          )}
          {days !== null && (
            <p data-testid="change-days" className="text-body text-fg">
              {days}
            </p>
          )}
          {live !== null && !live.ok && (
            <InfoBar severity="caution" title={t('changes.impact.refused')}>
              <ul className="flex flex-col gap-0.5">
                {problemsText(i18n, term, live.problems).map((each) => (
                  <li key={each}>{each}</li>
                ))}
              </ul>
            </InfoBar>
          )}
          {change.decision !== null && change.decision.note !== null && (
            <p className="text-body text-fg-secondary">
              {t('changes.row.note', { note: change.decision.note })}
            </p>
          )}
          {change.decision?.outcome === 'approved' && (
            <p className="text-caption text-fg-tertiary">{t('changes.row.applied')}</p>
          )}
          {pending && (
            <div
              role="group"
              aria-label={t('changes.row.actions', { name: changeRowTitle(i18n, change) })}
              className="grid grid-cols-3 gap-2 lg:flex"
            >
              <Button
                icon={<Checkmark20Regular />}
                data-testid="change-approve"
                onClick={() => onDecide('approved')}
              >
                {t('changes.approve')}
              </Button>
              <Button
                icon={<Dismiss20Regular />}
                data-testid="change-decline"
                onClick={() => onDecide('declined')}
              >
                {t('changes.decline')}
              </Button>
              <Button
                icon={<ArrowUndo20Regular />}
                data-testid="change-withdraw"
                onClick={() => onDecide('withdrawn')}
              >
                {t('changes.withdraw')}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </li>
  );
}
