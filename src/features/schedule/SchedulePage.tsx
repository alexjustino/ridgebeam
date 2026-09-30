import { useMemo, useState } from 'react';

import { useDiary } from '@/data/queries';
import { progress } from '@/domain/diary';
import { breakdown } from '@/domain/arrangements';
import { latestBaseline, type WorkSnapshot } from '@/domain/plan';
import { schedule } from '@/domain/schedule';
import { ganttLayout } from '@/domain/schedule/gantt';
import { naturalFrequency } from '@/domain/schedule/probability';
import { slip } from '@/domain/schedule/slip';
import { criticalText, frequencyShort, UNPLACED_KEYS } from '@/features/reports/compose/words';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Card } from '@/ui/Card';
import { Checkbox } from '@/ui/Checkbox';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';

import { BaselineCard } from './BaselineCard';
import { BaselinesCard } from './BaselinesCard';
import { FinishProbabilityCard } from './FinishProbabilityCard';
import { Gantt } from './Gantt';
import { toGanttView } from './ganttView';
import { SlipFigure } from './SlipFigure';
import { useFinishProbability } from './useFinishProbability';
import { WhatIfCard } from './WhatIfCard';

/**
 * The schedule: the plan on the working calendar (SPEC §2.3, slice F2).
 *
 * Everything on this page is computed from the snapshot by the domain, every time — the dates, the
 * critical path, the Gantt's geometry, the slip — so no two readings can disagree. The page adds
 * words and one act: approving the plan, which keeps today's schedule as baseline 1, for good. A
 * plan whose links make a loop is not drawn: the page says so, and where to fix it. An activity
 * the calendar cannot place is listed with its reason, never dropped.
 *
 * Slice F8 adds the rest of a baseline's life (ADR-027, ADR-028): the baseline card becomes the
 * way to replan an approved plan, with a reason; **Baselines** lists every one and compares any
 * two; **What if** recomputes the schedule in memory with durations or lags that are not the
 * plan's, and says it is not saved — nothing it shows is written, and the Gantt stays the plan's.
 *
 * Slice D1 adds **When will it really finish?** after the finish and baseline cards: the finish as a
 * probability, from the ranges given (`FinishProbabilityCard`). The same simulation gives the Gantt
 * each activity's criticality index — in every bar's sentence, "critical in 8 of 10 runs", and, when
 * **Shade each bar by how often it is critical** (`gantt-criticality`) is ticked, as a shade over the
 * bar with the share in words beside its name. The toggle is the page's, for this visit: nothing is
 * stored, and the plan's own critical path is drawn as before.
 */
export function SchedulePage({ snapshot }: { snapshot: WorkSnapshot }) {
  const i18n = useI18n();
  const { t, tp, day } = i18n;
  const term = useTerms();

  const scheduled = useMemo(() => schedule(snapshot), [snapshot]);
  const baseline = latestBaseline(snapshot);
  const numbers = new Map(breakdown(snapshot).map((row) => [row.id, row.number]));
  const names = new Map(snapshot.activities.map((activity) => [activity.id, activity.name]));
  const layout = useMemo(
    () =>
      scheduled.calendar === null || scheduled.cyclic
        ? null
        : ganttLayout(scheduled, snapshot, scheduled.calendar, baseline),
    [scheduled, snapshot, baseline],
  );
  const diary = useDiary(true);
  const progressById = useMemo(() => progress(snapshot, diary.data ?? []), [snapshot, diary.data]);
  const probability = useFinishProbability(snapshot, scheduled);
  const [shade, setShade] = useState(false);
  // How often each activity was critical, when some range makes the runs differ: with no range,
  // every run is the plan, and "critical in 10 of 10 runs" would only repeat the critical path.
  const criticality = useMemo(
    () =>
      probability === null || !probability.ok || probability.allCertain
        ? null
        : new Map(probability.criticality.map((each) => [each.activityId, each.index])),
    [probability],
  );
  const view =
    layout === null
      ? null
      : toGanttView(
          layout,
          {
            spoken: (bar) => {
              const sentence = t(bar.critical ? 'schedule.bar.critical' : 'schedule.bar', {
                number: bar.number,
                name: bar.name,
                days: tp('plan.checklist.days', bar.durationDays),
                start: day(bar.start),
                finish: day(bar.finish),
              });
              const known = bar.progress;
              const said =
                known?.state === 'finished' && known.finishedOn !== null
                  ? t('schedule.bar.finished', { sentence, day: day(known.finishedOn) })
                  : known?.state === 'started' && known.startedOn !== null
                    ? t('schedule.bar.started', { sentence, day: day(known.startedOn) })
                    : sentence;
              return bar.criticality === null
                ? said
                : t('schedule.bar.criticality', {
                    sentence: said,
                    critical: criticalText(i18n, naturalFrequency(bar.criticality)),
                  });
            },
            share: (index) => frequencyShort(i18n, naturalFrequency(index)),
          },
          progressById,
          criticality,
        );
  const slipped = baseline === null ? null : slip(scheduled, baseline);
  const hasBars = view !== null && view.rows.some((row) => row.kind === 'bar');

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">{t('nav.schedule')}</h1>
        <p className="mt-1 text-body-lg text-fg">{snapshot.work.name}</p>
        <p className="mt-1 max-w-3xl text-body text-fg-secondary">{t('schedule.lead')}</p>
      </header>

      {scheduled.cyclic && (
        <div data-testid="schedule-cyclic">
          <InfoBar severity="danger" title={term('schedule', { capital: true })}>
            {t('schedule.cyclic')}
          </InfoBar>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={term('finishDate', { capital: true })}>
          <p data-testid="schedule-finish" className="text-subtitle font-semibold text-fg">
            {scheduled.finishDate !== null
              ? day(scheduled.finishDate)
              : scheduled.cyclic
                ? t('dashboard.finish.cyclic')
                : t('dashboard.finish.unknown')}
          </p>
          {baseline !== null && (
            <p className="mt-1 text-body text-fg-secondary">
              {t('dashboard.baselineFinish', {
                baseline: term('baseline', { capital: true }),
                number: baseline.number,
                day: baseline.finishDate === null ? '—' : day(baseline.finishDate),
              })}
            </p>
          )}
          <p className="mt-2 text-caption text-fg-tertiary">{t('dashboard.finish.scheduled')}</p>
        </Card>

        <BaselineCard snapshot={snapshot} scheduled={scheduled} />
      </div>

      <FinishProbabilityCard result={probability} />

      {slipped !== null && (
        <Card>
          <SlipFigure figure={slipped} />
        </Card>
      )}

      {view !== null && hasBars ? (
        <section aria-labelledby="schedule-gantt" className="flex flex-col gap-2">
          <h2 id="schedule-gantt" className="text-subtitle font-semibold text-fg">
            {term('schedule', { capital: true })}
          </h2>
          {criticality !== null && (
            <label className="flex items-center gap-2 self-start text-body text-fg">
              <Checkbox
                testId="gantt-criticality"
                label={t('schedule.criticality.toggle')}
                checked={shade}
                onChange={setShade}
              />
              <span>{t('schedule.criticality.toggle')}</span>
            </label>
          )}
          <Gantt view={view} label={t('schedule.gantt')} shade={shade && criticality !== null} />
          <ul className="grid gap-x-6 gap-y-1 text-caption text-fg-secondary sm:grid-cols-2">
            <li className="flex items-center gap-2">
              <svg width="28" height="12" aria-hidden="true" className="shrink-0">
                <rect
                  x="1"
                  y="1"
                  width="26"
                  height="10"
                  rx="2"
                  className="fill-accent stroke-fg [stroke-width:2]"
                />
              </svg>
              {t('schedule.legend.critical')}
            </li>
            <li className="flex items-center gap-2">
              <svg width="28" height="12" aria-hidden="true" className="shrink-0">
                <rect
                  x="1"
                  y="1"
                  width="26"
                  height="10"
                  rx="2"
                  className="fill-accent-subtle stroke-accent"
                />
              </svg>
              {t('schedule.legend.plain')}
            </li>
            <li className="flex items-center gap-2">
              <svg width="28" height="12" aria-hidden="true" className="shrink-0">
                <rect
                  x="1"
                  y="6"
                  width="26"
                  height="4"
                  rx="2"
                  className="fill-stroke-strong opacity-60"
                />
              </svg>
              {t('schedule.legend.baseline')}
            </li>
            <li className="flex items-center gap-2">
              <svg width="28" height="12" aria-hidden="true" className="shrink-0">
                <rect
                  x="1"
                  y="0"
                  width="26"
                  height="12"
                  className="fill-card-hover stroke-stroke-subtle"
                />
              </svg>
              {t('schedule.legend.shaded')}
            </li>
            <li className="flex items-center gap-2">
              <svg width="28" height="12" aria-hidden="true" className="shrink-0">
                <rect x="1" y="3" width="26" height="6" rx="3" className="fill-success" />
              </svg>
              {t('schedule.legend.done')}
            </li>
            {shade && criticality !== null && (
              <li className="flex items-center gap-2">
                <svg width="28" height="12" aria-hidden="true" className="shrink-0">
                  <rect
                    x="1"
                    y="1"
                    width="26"
                    height="10"
                    rx="2"
                    className="fill-danger opacity-70"
                  />
                </svg>
                {t('schedule.legend.criticality')}
              </li>
            )}
          </ul>
        </section>
      ) : (
        !scheduled.cyclic && (
          <Card>
            <EmptyState
              title={t('schedule.empty.title')}
              description={t('schedule.empty.description')}
            />
          </Card>
        )
      )}

      {scheduled.inert.length > 0 && (
        <InfoBar severity="info" title={term('dependency', { capital: true })}>
          {tp('schedule.inert', scheduled.inert.length)}
        </InfoBar>
      )}

      <Card title={term('criticalPath', { capital: true })}>
        {scheduled.longestChain.length === 0 ? (
          <p className="text-body text-fg-tertiary">{t('schedule.critical.none')}</p>
        ) : (
          <ol
            data-critical-path
            aria-label={t('schedule.critical.rows')}
            className="flex flex-col gap-1"
          >
            {scheduled.longestChain.map((id) => {
              const dates = scheduled.dates.get(id);
              return (
                <li key={id} data-critical-id={id} className="flex gap-3 text-body">
                  <span className="w-10 shrink-0 text-fg-secondary tabular-nums">
                    {numbers.get(id) ?? ''}
                  </span>
                  <span className="min-w-0 flex-1 font-semibold text-fg">{names.get(id)}</span>
                  {dates !== undefined && (
                    <span className="text-fg-secondary">
                      {[day(dates.start), day(dates.finish)].join(' → ')}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <WhatIfCard snapshot={snapshot} scheduled={scheduled} />

      <BaselinesCard snapshot={snapshot} />

      {scheduled.unplaced.length > 0 && (
        <Card title={t('schedule.unplaced.title')}>
          <ul className="flex flex-col gap-1">
            {scheduled.unplaced.map((row) => (
              <li
                key={row.activityId}
                data-unplaced-id={row.activityId}
                className="flex gap-3 text-body"
              >
                <span className="w-10 shrink-0 text-fg-secondary tabular-nums">
                  {numbers.get(row.activityId) ?? ''}
                </span>
                <span className="min-w-0 flex-1 font-semibold text-fg">
                  {names.get(row.activityId)}
                </span>
                <span className="text-fg-secondary">{t(UNPLACED_KEYS[row.reason])}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
