import type { Figure } from '@/domain/figure';
import type { SlipRow } from '@/domain/schedule/slip';
import { useI18n } from '@/i18n/useI18n';
import { useTerm } from '@/i18n/useTerm';
import { FigureRow } from '@/ui/FigureRow';

import { useDaysText } from './days';

/**
 * The slip: how far the finish date has moved against the latest baseline, in working days, and
 * — pressed — every activity whose own finish moved, each with its days and its two dates
 * (DESIGN_SYSTEM §2, a number can be opened). The same figure, with the same rows, on the Schedule
 * page and on the dashboard: one computation, two places, never two readings.
 */
export function SlipFigure({
  figure,
  size = 'display',
}: {
  figure: Figure<SlipRow>;
  size?: 'display' | 'title';
}) {
  const { t, day } = useI18n();
  const label = useTerm('slip', { capital: true });
  const days = useDaysText();

  return (
    <FigureRow<SlipRow>
      testId="slip"
      size={size}
      figure={figure}
      label={label}
      value={days(figure.value)}
      rowsLabel={t('slip.rows')}
      renderRow={(row) => (
        <>
          <span className="font-semibold text-fg">{row.name}</span>
          <span aria-hidden="true"> — </span>
          {row.change === 'moved' && (
            <>
              <span>{days(row.days)}</span>
              <span aria-hidden="true"> — </span>
              <span>
                {t('slip.row.moved', {
                  baseline: day(row.baselineFinish ?? ''),
                  current: day(row.currentFinish ?? ''),
                })}
              </span>
            </>
          )}
          {row.change === 'added' && <span>{t('slip.row.added')}</span>}
          {row.change === 'removed' && <span>{t('slip.row.removed')}</span>}
          {row.change === 'unplaced' && <span>{t('slip.row.unplaced')}</span>}
          {row.change === 'placed' && (
            <span>{t('slip.row.placed', { current: day(row.currentFinish ?? '') })}</span>
          )}
        </>
      )}
    />
  );
}
