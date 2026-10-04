import { ArrowRight20Regular } from '@fluentui/react-icons';

import { useNavigation } from '@/app/navigation';
import {
  CHANGE_LABEL_KEYS,
  changeTally,
  type ChangeCostRow,
  type ChangeDaysRow,
  type ChangeWaitingRow,
} from '@/domain/changes';
import type { WorkSnapshot } from '@/domain/plan';
import {
  signedDays,
  changeRowTitle,
  finishMoveText,
  tallySentence,
  waitedText,
} from '@/features/plan/changeWords';
import { useI18n } from '@/i18n/useI18n';
import { useLens } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';

/**
 * The standing tally of change orders on the front door (slice E1, decision 5): what the approved
 * changes added to the money (`changes-cost`) and to the finish, in working days (`changes-days`),
 * and how many wait for a decision (`changes-waiting`) — each a figure opening onto its changes, the
 * waiting ones with how long each has waited — and under them the tally in words, with who asked.
 *
 * **Hidden before the plan is approved**: until then there are no change orders, because the plan is
 * still being written. Every number is the domain's `changeTally`; the money and the days of an
 * approved change are the ones its decision froze, never worked out again.
 */
export function ChangesCard({ snapshot, today }: { snapshot: WorkSnapshot; today: string }) {
  const i18n = useI18n();
  const { t, number, money, day } = i18n;
  const ownerWords = useLens() === 'owner';
  const navigation = useNavigation();
  if (snapshot.work.approvedAt === null) return null;

  const tally = changeTally(snapshot, today);
  const currency = snapshot.work.currency;
  const { cost, days, waiting } = tally.figures;

  return (
    <div data-testid="dashboard-changes">
      <Card
        title={t('dashboard.changes.title')}
        actions={
          <Button
            icon={<ArrowRight20Regular />}
            data-testid="dashboard-changes-open"
            className="shrink-0"
            onClick={navigation.openChanges}
          >
            {t('dashboard.changes.open')}
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <FigureRow<ChangeCostRow>
            testId="changes-cost"
            size="title"
            figure={cost}
            label={t(CHANGE_LABEL_KEYS.cost)}
            value={money(cost.value, currency)}
            rowsLabel={t('changes.figure.cost.rows')}
            renderRow={(row) => (
              <>
                <span className="font-semibold text-fg">{changeRowTitle(i18n, row)}</span>
                {row.day !== null && (
                  <>
                    <span aria-hidden="true"> — </span>
                    <span>{day(row.day)}</span>
                  </>
                )}
                <span aria-hidden="true"> — </span>
                <span className="tabular-nums">
                  {row.priced ? money(row.amountCents, currency) : t('changes.row.unpriced')}
                </span>
              </>
            )}
          />
          <FigureRow<ChangeDaysRow>
            testId="changes-days"
            size="title"
            figure={days}
            label={t(CHANGE_LABEL_KEYS.days)}
            value={signedDays(i18n, days.value)}
            rowsLabel={t('changes.figure.days.rows')}
            renderRow={(row) => (
              <>
                <span className="font-semibold text-fg">{changeRowTitle(i18n, row)}</span>
                <span aria-hidden="true"> — </span>
                <span>{finishMoveText(i18n, { ...row, days: row.daysDelta })}</span>
              </>
            )}
          />
          <FigureRow<ChangeWaitingRow>
            testId="changes-waiting"
            size="title"
            figure={waiting}
            label={t(CHANGE_LABEL_KEYS.waiting)}
            value={number(waiting.value)}
            rowsLabel={t('changes.figure.waiting.rows')}
            renderRow={(row) => (
              <>
                <span className="font-semibold text-fg">{changeRowTitle(i18n, row)}</span>
                <span aria-hidden="true"> — </span>
                <span>{waitedText(i18n, row.waitedDays, row.tooLong) ?? day(row.raisedOn)}</span>
              </>
            )}
          />
        </div>
        <p data-testid="changes-tally" className="mt-3 text-body text-fg">
          {tallySentence(i18n, tally, currency, ownerWords)}
        </p>
        <p className="mt-1 text-caption text-fg-tertiary">
          {t('changes.tally.decided', {
            approved: number(tally.approved),
            declined: number(tally.declined),
            withdrawn: number(tally.withdrawn),
            pending: number(tally.pending),
          })}
        </p>
      </Card>
    </div>
  );
}
