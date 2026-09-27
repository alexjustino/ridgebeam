import {
  moneyOfWork,
  overCommittedFigure,
  type MoneyRow,
  type OverCommittedRow,
} from '@/domain/money';
import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';

const TOTALS = ['planned', 'committed', 'paid'] as const;

/**
 * The money on the front door (slice F6): the work's planned, committed and paid, each opening onto
 * the cost lines, commitments or payments it adds up — the same figures the Money page shows — and
 * how many stages were paid over what was committed, opening onto them with the excess. Paying over
 * is allowed and flagged, never refused (ADR-024).
 */
export function MoneyCard({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t, money, number, day } = useI18n();
  const term = useTerms();
  const work = moneyOfWork(snapshot);
  const over = overCommittedFigure(snapshot);
  const currency = snapshot.work.currency;

  return (
    <Card>
      <div className="grid gap-4 md:grid-cols-4">
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
      </div>
    </Card>
  );
}
