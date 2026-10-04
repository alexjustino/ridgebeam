import { useMemo } from 'react';

import { useDiary } from '@/data/queries';
import { latestBaseline, type WorkSnapshot } from '@/domain/plan';
import type { Schedule } from '@/domain/schedule';
import { forecast, FORECAST_LABEL_KEYS } from '@/domain/schedule/forecast';
import { signedDays } from '@/features/plan/changeWords';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';

import {
  forecastAssumesText,
  forecastNoBaselineText,
  forecastPlanText,
  forecastSentence,
} from './forecastWords';

/**
 * **As things stand** (slice E3, decision 4): when the work finishes from what the diary records,
 * beside the plan's own date, never in its place.
 *
 * Three dates, each labelled as what it is — the finish by the forecast (`forecast-finish`), the
 * plan's finish, and how many working days the forecast lies from the baseline's finish and from the
 * plan's — then the same in words: against the baseline (`forecast-against-baseline`), "As things
 * stand it finishes on 23 Oct — 5 working days after the baseline's 16 Oct.", and against the plan's
 * date (`forecast-against-plan`), which says the plan's date is a different answer. What the forecast
 * assumes and what it leaves out is said under it, always (§8, a projection says what it counts).
 *
 * The forecast is the domain's (`forecast`), computed here from the plan, its schedule and the
 * diary, every time: the Gantt, the slip and the finish card above stay the plan's.
 */
export function ForecastCard({
  snapshot,
  scheduled,
  today,
}: {
  snapshot: WorkSnapshot;
  scheduled: Schedule;
  /** The day it is asked on: the forecast's "today". */
  today: string;
}) {
  const i18n = useI18n();
  const { t, day, describeError } = i18n;
  const term = useTerms();
  const diary = useDiary(true);
  const result = useMemo(
    () => (diary.data === undefined ? null : forecast(snapshot, scheduled, diary.data, today)),
    [diary.data, snapshot, scheduled, today],
  );

  return (
    <div data-testid="forecast-card">
      <Card title={t(FORECAST_LABEL_KEYS.title)} description={t('schedule.forecast.lead')}>
        {diary.isError ? (
          <InfoBar severity="danger" title={t('common.hostSilent')}>
            {describeError(diary.error)}
          </InfoBar>
        ) : result === null ? (
          <p className="text-body text-fg-secondary">{t('schedule.forecast.reading')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 text-body">
              <dt className="text-fg-secondary">{t(FORECAST_LABEL_KEYS.finish)}</dt>
              <dd
                data-testid="forecast-finish"
                data-day={result.finishDate ?? ''}
                className="text-right font-semibold text-fg tabular-nums"
              >
                {result.finishDate === null ? '—' : day(result.finishDate)}
              </dd>
              <dt className="text-fg-secondary">{t('schedule.forecast.planFinish')}</dt>
              <dd data-testid="forecast-plan-finish" className="text-right text-fg tabular-nums">
                {result.planFinish === null ? '—' : day(result.planFinish)}
              </dd>
              {result.daysAgainstBaseline !== null && (
                <>
                  <dt className="text-fg-secondary">{t(FORECAST_LABEL_KEYS.againstBaseline)}</dt>
                  <dd
                    data-testid="forecast-against-baseline-days"
                    className="text-right text-fg tabular-nums"
                  >
                    {signedDays(i18n, result.daysAgainstBaseline)}
                  </dd>
                </>
              )}
              {result.daysAgainstPlan !== null && (
                <>
                  <dt className="text-fg-secondary">{t(FORECAST_LABEL_KEYS.againstPlan)}</dt>
                  <dd
                    data-testid="forecast-against-plan-days"
                    className="text-right text-fg tabular-nums"
                  >
                    {signedDays(i18n, result.daysAgainstPlan)}
                  </dd>
                </>
              )}
            </dl>
            <p
              data-testid="forecast-against-baseline"
              data-days={result.daysAgainstBaseline ?? ''}
              className="text-body-lg text-fg"
            >
              {forecastSentence(i18n, term, result)}
            </p>
            {result.problem === null && latestBaseline(snapshot) === null && (
              <p className="text-body text-fg-secondary">{forecastNoBaselineText(i18n, term)}</p>
            )}
            {result.problem === null && forecastPlanText(i18n, term, result) !== null && (
              <p data-testid="forecast-against-plan" className="text-body text-fg-secondary">
                {forecastPlanText(i18n, term, result)}
              </p>
            )}
            <p data-testid="forecast-assumes" className="text-caption text-fg-tertiary">
              {forecastAssumesText(i18n, term, result, snapshot.activities.length)}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
