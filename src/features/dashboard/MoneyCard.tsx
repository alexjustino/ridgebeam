import { aheadFigure, dueFigure, MILESTONE_LABEL_KEYS, type PlanRow } from '@/domain/milestones';
import {
  moneyOfWork,
  overCommittedFigure,
  type MoneyRow,
  type OverCommittedRow,
} from '@/domain/money';
import type { WorkSnapshot } from '@/domain/plan';
import { RUNWAY_LABEL_KEYS, type RunwayRow, type RunwayShortRow } from '@/domain/runway';
import { pendingText, percentText, usePaymentPlans } from '@/features/money/paymentPlanWords';
import { runwayRowLine, runwaySentenceText, useRunwayOnly } from '@/features/money/runwayWords';
import { useI18n, type I18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';

const TOTALS = ['planned', 'committed', 'paid'] as const;

/**
 * The money on the front door (slice F6): the work's planned, committed and paid, each opening onto
 * the cost lines, commitments or payments it adds up — the same figures the Money page shows — and
 * how many stages were paid over what was committed, opening onto them with the excess. Paying over
 * is allowed and flagged, never refused (ADR-024).
 *
 * And, from the payment plans (slice D2): how many commitments were **paid ahead of the work**,
 * each with its excess and the milestone it waits for, and how much is **earned and not paid**, a
 * row per commitment. Under them, in words, what these two leave out: the commitments with no
 * payment plan, which are not evaluated, and the payments that name no commitment.
 *
 * And, from the funding (slice E2): **will the money last?** — a short value whose label says what
 * it is: the week the money runs short (its Monday), opening onto that week and by how much, or the
 * money left at the end, opening onto everything that comes in and goes out until then. The sentence
 * under it is the Money page's, from the same call.
 */
export function MoneyCard({ snapshot }: { snapshot: WorkSnapshot }) {
  const i18n = useI18n();
  const { t, tp, money, number, day } = i18n;
  const term = useTerms();
  const work = moneyOfWork(snapshot);
  const over = overCommittedFigure(snapshot);
  const { plans, entries, today } = usePaymentPlans(snapshot);
  const ahead = entries === null ? null : aheadFigure(snapshot, entries, today);
  const due = entries === null ? null : dueFigure(snapshot, entries, today);
  const currency = snapshot.work.currency;
  const commitmentOf = new Map(snapshot.commitments.map((each) => [each.id, each.label]));
  const runway = useRunwayOnly(snapshot);

  return (
    <Card>
      <div className="grid gap-4 md:grid-cols-3">
        {TOTALS.map((name) => (
          <FigureRow<MoneyRow>
            key={name}
            testId={`money-${name}`}
            size="title"
            figure={work[name]}
            label={term(name, { capital: true })}
            value={money(work[name].value, currency)}
            rowsLabel={t('dashboard.money.rows')}
            renderRow={(row) => (
              <>
                <span className="font-semibold text-fg">{row.label}</span>
                {row.day !== null && (
                  <>
                    <span aria-hidden="true"> — </span>
                    <span>{day(row.day)}</span>
                  </>
                )}
                <span aria-hidden="true"> — </span>
                <span className="tabular-nums">{money(row.amountCents, currency)}</span>
              </>
            )}
          />
        ))}
        <FigureRow<OverCommittedRow>
          testId="over-committed"
          size="title"
          figure={over}
          label={t('money.figure.overCommitted')}
          value={number(over.value)}
          rowsLabel={t('dashboard.overCommitted.rows')}
          renderRow={(row) => (
            <>
              <span className="font-semibold text-fg">{row.title}</span>
              <span aria-hidden="true"> — </span>
              <span>
                {t('money.overCommitted.mark', { amount: money(row.amountCents, currency) })}
              </span>
            </>
          )}
        />
        {ahead !== null && due !== null && (
          <>
            <FigureRow<PlanRow>
              testId="paid-ahead"
              size="title"
              figure={ahead}
              label={t(MILESTONE_LABEL_KEYS.paidAhead)}
              value={number(ahead.value)}
              rowsLabel={t('dashboard.paidAhead.rows')}
              renderRow={(row) => (
                <PlanRowText
                  i18n={i18n}
                  row={row}
                  name={commitmentOf.get(row.commitmentId) ?? row.title}
                  sentence={t('money.paymentPlan.paidAhead.mark', {
                    amount: money(row.amountCents, currency),
                  })}
                />
              )}
            />
            <FigureRow<PlanRow>
              testId="due-now"
              size="title"
              figure={due}
              label={t(MILESTONE_LABEL_KEYS.dueNow)}
              value={money(due.value, currency)}
              rowsLabel={t('dashboard.dueNow.rows')}
              renderRow={(row) => (
                <PlanRowText
                  i18n={i18n}
                  row={row}
                  name={commitmentOf.get(row.commitmentId) ?? row.title}
                  sentence={t('money.paymentPlan.dueNow.mark', {
                    amount: money(row.amountCents, currency),
                  })}
                />
              )}
            />
          </>
        )}
        {runway !== null &&
          runway.state !== 'nothing' &&
          (runway.shortWeek === null ? (
            <FigureRow<RunwayRow>
              testId="dashboard-runway"
              size="title"
              figure={runway.figures.end}
              label={t(RUNWAY_LABEL_KEYS.end)}
              value={money(runway.spare, currency)}
              rowsLabel={t('money.runway.rows')}
              renderRow={(row) => <span>{runwayRowLine(i18n, row, snapshot, currency)}</span>}
            />
          ) : (
            <FigureRow<RunwayShortRow>
              testId="dashboard-runway"
              size="title"
              figure={runway.figures.short}
              label={t(RUNWAY_LABEL_KEYS.short)}
              value={day(runway.shortWeek.from)}
              rowsLabel={t('money.runway.rows')}
              renderRow={(row) => (
                <>
                  <span className="font-semibold text-fg">
                    {t('money.runway.weekRange', { from: day(row.from), to: day(row.to) })}
                  </span>
                  <span aria-hidden="true"> — </span>
                  <span>
                    {t('money.runway.shortBy', { amount: money(row.shortByCents, currency) })}
                  </span>
                </>
              )}
            />
          ))}
      </div>
      {runway !== null && runway.state !== 'nothing' && (
        <p data-testid="dashboard-runway-sentence" className="mt-3 text-body text-fg">
          {runwaySentenceText(i18n, runway.sentence, currency)}
        </p>
      )}
      {plans !== null && (plans.noPlan.value > 0 || plans.outside.value > 0) && (
        <p data-testid="money-not-evaluated" className="mt-3 text-caption text-fg-tertiary">
          {[
            plans.noPlan.value > 0 ? tp('dashboard.money.noPlan', plans.noPlan.value) : null,
            plans.outside.value > 0 ? tp('dashboard.money.outside', plans.outside.value) : null,
          ]
            .filter((each) => each !== null)
            .join(' ')}
        </p>
      )}
    </Card>
  );
}

/** A commitment's row: its name, the mark in words, and the milestone it waits for. */
function PlanRowText({
  i18n,
  row,
  name,
  sentence,
}: {
  i18n: I18n;
  row: PlanRow;
  name: string;
  sentence: string;
}) {
  return (
    <>
      <span className="font-semibold text-fg">{name}</span>
      <span aria-hidden="true"> — </span>
      <span>{sentence}</span>
      {row.next !== null && (
        <>
          <span aria-hidden="true"> — </span>
          <span>
            {row.next.label} ({percentText(i18n, row.next.shareBp)}): {pendingText(i18n, row.next)}
          </span>
        </>
      )}
    </>
  );
}
