import { useMemo } from 'react';

import { useDiary } from '@/data/queries';
import { breakdown } from '@/domain/arrangements';
import type { WorkSnapshot } from '@/domain/plan';
import {
  ACTUALS_LABEL_KEYS,
  ACTUALS_PROBLEM_KEYS,
  activityActuals,
  type ActualRow,
} from '@/domain/schedule/actuals';
import { useI18n } from '@/i18n/useI18n';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';
import { InfoBar } from '@/ui/InfoBar';

import { actualDaysText, actualSentence } from './actualsWords';

/**
 * **Planned and actual** (slice G3, decision 4): for every activity the diary says started, what the
 * plan gave it beside what it took — or has taken so far — with the difference as a number with its
 * unit and a word, never colour alone, and whether it fell inside the range it was given.
 *
 * Three figures open onto their rows (DESIGN_SYSTEM §2, _a number can be opened_): the activities
 * finished (`actuals-finished`), those that took longer than planned (`actuals-longer`) and those
 * outside the range they were given (`actuals-outside`). Then a row per activity that started, in
 * plan order (`[data-actual-id]`, with `data-state`, `data-took`, `data-so-far`, `data-planned`,
 * `data-difference` and `data-in-range`), each said in the same words as the figures' rows.
 *
 * Every number is the domain's (`activityActuals`), from the plan and the diary, on the work's
 * calendar; the card adds words only. A work where nothing has started says so and where the answer
 * comes from; a work whose days cannot be counted says why, and invents none (ADR-047).
 */
export function ActualsCard({
  snapshot,
  today,
}: {
  snapshot: WorkSnapshot;
  /** The day it is asked on: what a running activity has taken "so far" is counted to it. */
  today: string;
}) {
  const i18n = useI18n();
  const { t, number, describeError } = i18n;
  const diary = useDiary(true);
  const actuals = useMemo(
    () => (diary.data === undefined ? null : activityActuals(snapshot, diary.data, today)),
    [diary.data, snapshot, today],
  );
  const numbers = useMemo(
    () => new Map(breakdown(snapshot).map((row) => [row.id, row.number])),
    [snapshot],
  );

  const renderRow = (row: ActualRow) => (
    <>
      <span className="font-semibold text-fg">{row.title}</span>
      <span aria-hidden="true"> — </span>
      <span>{actualSentence(i18n, row)}</span>
    </>
  );

  const started = actuals === null ? [] : actuals.rows.filter((row) => row.state !== 'not-started');

  return (
    <div data-testid="schedule-actuals">
      <Card title={t(ACTUALS_LABEL_KEYS.title)} description={t('schedule.actuals.lead')}>
        {diary.isError ? (
          <InfoBar severity="danger" title={t('common.hostSilent')}>
            {describeError(diary.error)}
          </InfoBar>
        ) : actuals === null ? (
          <p className="text-body text-fg-secondary">{t('schedule.actuals.reading')}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {actuals.problem !== null && (
              <div data-testid="actuals-problem" data-problem={actuals.problem}>
                <InfoBar severity="caution" title={t('schedule.actuals.problemTitle')}>
                  {t(ACTUALS_PROBLEM_KEYS[actuals.problem])}
                </InfoBar>
              </div>
            )}

            {started.length === 0 ? (
              <p data-testid="actuals-empty" className="text-body text-fg-secondary">
                {t('schedule.actuals.empty')}
              </p>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-3">
                  <FigureRow<ActualRow>
                    testId="actuals-finished"
                    size="title"
                    figure={actuals.finished}
                    label={t(ACTUALS_LABEL_KEYS.finished)}
                    value={number(actuals.finished.value)}
                    rowsLabel={t('schedule.actuals.finished.rows')}
                    renderRow={renderRow}
                  />
                  <FigureRow<ActualRow>
                    testId="actuals-longer"
                    size="title"
                    figure={actuals.longer}
                    label={t(ACTUALS_LABEL_KEYS.longer)}
                    value={number(actuals.longer.value)}
                    rowsLabel={t('schedule.actuals.longer.rows')}
                    renderRow={renderRow}
                  />
                  <FigureRow<ActualRow>
                    testId="actuals-outside"
                    size="title"
                    figure={actuals.outside}
                    label={t(ACTUALS_LABEL_KEYS.outside)}
                    value={number(actuals.outside.value)}
                    rowsLabel={t('schedule.actuals.outside.rows')}
                    renderRow={renderRow}
                  />
                </div>

                <ol aria-label={t('schedule.actuals.rows')} className="flex flex-col gap-2">
                  {started.map((row) => {
                    const days = actualDaysText(i18n, row);
                    return (
                      <li
                        key={row.activityId}
                        data-actual-id={row.activityId}
                        data-state={row.state}
                        data-took={row.tookDays ?? ''}
                        data-so-far={row.soFarDays ?? ''}
                        data-planned={row.planned ?? ''}
                        data-difference={row.differenceDays ?? ''}
                        data-in-range={row.inRange === null ? '' : String(row.inRange)}
                        className="flex gap-3 text-body"
                      >
                        <span className="w-10 shrink-0 text-fg-secondary tabular-nums">
                          {numbers.get(row.activityId) ?? ''}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="font-semibold text-fg">{row.title}</span>
                          <span className="text-fg">{actualSentence(i18n, row)}</span>
                          {days !== null && (
                            <span className="text-caption text-fg-tertiary">{days}</span>
                          )}
                          {row.problem === 'invalid-day' && (
                            <span className="text-caption text-fg-secondary">
                              {t(ACTUALS_PROBLEM_KEYS['invalid-day'])}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
