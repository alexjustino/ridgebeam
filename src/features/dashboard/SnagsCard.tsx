import { ArrowRight20Regular } from '@fluentui/react-icons';
import { useMemo } from 'react';

import { useNavigation } from '@/app/navigation';
import type { WorkSnapshot } from '@/domain/plan';
import { SNAG_LABEL_KEYS, snagFigures, type SnagRow } from '@/domain/snags';
import {
  snagDueText,
  snagGroupLabel,
  snagRowTitle,
  snagSentence,
  snagWhoText,
} from '@/features/plan/snagWords';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';

/**
 * **Still to fix** on the front door (slice E4, decision 5): how many snags are open
 * (`snags-open`) and how many of them are past their day (`snags-overdue`), and the open ones by who
 * must fix them — each a figure that opens onto its snags — with what is open and on whom in one
 * sentence, and the way to the Plan's Snags tab.
 *
 * **Hidden when there has never been a snag**: a work that has found nothing wrong has nothing to
 * say here. Once one has been raised the card stays, and with nothing open it says how every snag was
 * closed. Every number is the domain's `snagFigures`; the card adds words only.
 */
export function SnagsCard({ snapshot, today }: { snapshot: WorkSnapshot; today: string }) {
  const i18n = useI18n();
  const { t, number } = i18n;
  const navigation = useNavigation();
  const figures = useMemo(() => snagFigures(snapshot, today), [snapshot, today]);
  if (figures.raised === 0) return null;

  const renderRow = (row: SnagRow) => {
    const due = snagDueText(i18n, row);
    return (
      <>
        <span className="font-semibold text-fg">{snagRowTitle(i18n, row)}</span>
        <span aria-hidden="true"> — </span>
        <span>{snagWhoText(i18n, row)}</span>
        {due !== null && (
          <>
            <span aria-hidden="true"> — </span>
            <span>{due}</span>
          </>
        )}
      </>
    );
  };

  return (
    <div data-testid="dashboard-snags">
      <Card
        title={t('dashboard.snags.title')}
        actions={
          <Button
            icon={<ArrowRight20Regular />}
            data-testid="dashboard-snags-open"
            className="shrink-0"
            onClick={navigation.openSnags}
          >
            {t('dashboard.snags.open')}
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <FigureRow<SnagRow>
            testId="snags-open"
            size="title"
            figure={figures.open}
            label={t(SNAG_LABEL_KEYS.open)}
            value={number(figures.open.value)}
            rowsLabel={t('snags.figure.open.rows')}
            renderRow={renderRow}
          />
          <FigureRow<SnagRow>
            testId="snags-overdue"
            size="title"
            figure={figures.overdue}
            label={t(SNAG_LABEL_KEYS.overdue)}
            value={number(figures.overdue.value)}
            rowsLabel={t('snags.figure.overdue.rows')}
            renderRow={renderRow}
          />
        </div>
        {figures.byPerson.length > 0 && (
          <section data-testid="snags-by-person" className="mt-3 flex flex-col gap-1">
            <h3 className="text-body font-semibold text-fg">{t('snags.byPerson')}</h3>
            <ul className="flex flex-col gap-1">
              {figures.byPerson.map((group) => {
                const label = snagGroupLabel(i18n, group);
                return (
                  <li key={group.key} data-snag-person={group.personId ?? 'nobody'}>
                    <FigureRow<SnagRow>
                      testId="snags-person"
                      size="inline"
                      figure={group.open}
                      label={label}
                      value={number(group.open.value)}
                      rowsLabel={t('snags.figure.group.rows', { name: label })}
                      renderRow={renderRow}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <p data-testid="snags-sentence" className="mt-3 text-body text-fg">
          {snagSentence(i18n, figures)}
        </p>
      </Card>
    </div>
  );
}
