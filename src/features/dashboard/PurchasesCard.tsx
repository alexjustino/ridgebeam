import { ArrowRight20Regular } from '@fluentui/react-icons';
import { useMemo } from 'react';

import { useNavigation } from '@/app/navigation';
import { useDiary } from '@/data/queries';
import type { WorkSnapshot } from '@/domain/plan';
import { PURCHASE_LABEL_KEYS, purchaseFigures, type PurchaseRow } from '@/domain/purchases';
import type { Schedule } from '@/domain/schedule';
import { purchaseRowLine, purchaseSentence } from '@/features/plan/purchaseWords';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';
import { InfoBar } from '@/ui/InfoBar';

/**
 * **To order this week** on the front door (slice G2, decision 3): how many purchases are to order
 * this week, the late ones included (`purchases-week`), how many are late to order (`purchases-late`)
 * and how many were ordered and are late to arrive (`purchases-arriving-late`) — each a number that
 * opens onto its purchases, with the day to order by or the day expected and the flags in words — and
 * the same in one sentence, with the way to the Plan's Purchases tab.
 *
 * **Hidden while the work has no purchase**: a work that buys nothing with a lead time has nothing to
 * say here. Every number is the domain's `purchaseFigures`, from the plan, its schedule and the diary
 * — the forecast, so the days move when the work slips — and the card adds words only.
 */
export function PurchasesCard({
  snapshot,
  scheduled,
  today,
}: {
  snapshot: WorkSnapshot;
  scheduled: Schedule;
  today: string;
}) {
  const i18n = useI18n();
  const { t, number, describeError } = i18n;
  const term = useTerms();
  const navigation = useNavigation();
  const diary = useDiary(true);
  const figures = useMemo(
    () =>
      diary.data === undefined ? null : purchaseFigures(snapshot, scheduled, diary.data, today),
    [diary.data, snapshot, scheduled, today],
  );
  if (snapshot.purchases.length === 0) return null;

  const renderRow = (row: PurchaseRow) => <span>{purchaseRowLine(i18n, term, row)}</span>;

  return (
    <div data-testid="dashboard-purchases">
      <Card
        title={t('dashboard.purchases.title')}
        actions={
          <Button
            icon={<ArrowRight20Regular />}
            data-testid="dashboard-purchases-open"
            className="shrink-0"
            onClick={navigation.openPurchases}
          >
            {t('dashboard.purchases.open')}
          </Button>
        }
      >
        {diary.isError ? (
          <InfoBar severity="danger" title={t('common.hostSilent')}>
            {describeError(diary.error)}
          </InfoBar>
        ) : figures === null ? (
          <p className="text-body text-fg-secondary">{t('dashboard.purchases.reading')}</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <FigureRow<PurchaseRow>
                testId="purchases-week"
                size="title"
                figure={figures.toOrderThisWeek}
                label={t(PURCHASE_LABEL_KEYS.toOrderThisWeek)}
                value={number(figures.toOrderThisWeek.value)}
                rowsLabel={t('purchases.figure.week.rows')}
                renderRow={renderRow}
              />
              <FigureRow<PurchaseRow>
                testId="purchases-late"
                size="title"
                figure={figures.lateToOrder}
                label={t(PURCHASE_LABEL_KEYS.lateToOrder)}
                value={number(figures.lateToOrder.value)}
                rowsLabel={t('purchases.figure.late.rows')}
                renderRow={renderRow}
              />
              <FigureRow<PurchaseRow>
                testId="purchases-arriving-late"
                size="title"
                figure={figures.lateToArrive}
                label={t(PURCHASE_LABEL_KEYS.lateToArrive)}
                value={number(figures.lateToArrive.value)}
                rowsLabel={t('purchases.figure.arriving.rows')}
                renderRow={renderRow}
              />
            </div>
            <p data-testid="purchases-sentence" className="mt-3 text-body text-fg">
              {purchaseSentence(i18n, figures)}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
