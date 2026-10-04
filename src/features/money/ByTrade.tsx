import { moneyByTrade } from '@/domain/money';
import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';

import { MoneyCell } from './MoneyCell';

const COLUMNS = ['committed', 'paid', 'owed'] as const;

/**
 * Money by trade (slice F6): what was agreed with and paid to each trade — the person's trade on
 * the plan — and what is still owed, each opening onto its rows. People with no trade are one
 * group, "No trade yet", listed only when it holds something. Planned money has no trade — a cost
 * line is a stage's or an activity's, not a person's — so it is shown by stage, not here.
 */
export function ByTrade({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t } = useI18n();
  const term = useTerms();
  const trades = moneyByTrade(snapshot);

  if (trades.every((trade) => trade.committed.rows.length === 0 && trade.paid.rows.length === 0)) {
    return (
      <Card>
        <EmptyState
          title={term('trade', { capital: true })}
          description={t('money.byTrade.empty')}
        />
      </Card>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {trades.map((trade) => {
        const name = trade.trade ?? t('money.trade.none');
        return (
          <li key={trade.trade ?? ''} data-money-trade={trade.trade ?? ''}>
            <Card>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_repeat(3,9rem)]">
                <h2 className="text-body font-semibold text-fg">{name}</h2>
                {COLUMNS.map((column) => (
                  <div key={column} className="flex flex-col gap-0.5">
                    <span aria-hidden="true" className="text-caption text-fg-tertiary">
                      {column === 'owed' ? t('money.figure.owed') : term(column, { capital: true })}
                    </span>
                    <MoneyCell
                      name={column}
                      figure={trade[column]}
                      label={t('money.valueOf', {
                        figure:
                          column === 'owed'
                            ? t('money.figure.owed')
                            : term(column, { capital: true }),
                        name,
                      })}
                      currency={snapshot.work.currency}
                    />
                  </div>
                ))}
              </div>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
