import { CheckmarkCircle20Regular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { useTakeBaseline } from '@/data/queries';
import { breakdown } from '@/domain/arrangements';
import { latestBaseline, type WorkSnapshot } from '@/domain/plan';
import { baselineDraft, schedule, type UnplacedReason } from '@/domain/schedule';
import { ganttLayout } from '@/domain/schedule/gantt';
import { slip } from '@/domain/schedule/slip';
import type { MessageKey } from '@/i18n/en';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';

import { Gantt } from './Gantt';
import { toGanttView } from './ganttView';
import { SlipFigure } from './SlipFigure';

const UNPLACED: Record<UnplacedReason, MessageKey> = {
  'no-duration': 'schedule.unplaced.noDuration',
  'no-stage': 'schedule.unplaced.noStage',
  'invalid-calendar': 'schedule.unplaced.invalidCalendar',
  'invalid-start': 'schedule.unplaced.invalidStart',
  cyclic: 'schedule.unplaced.cyclic',
};

/**
 * The schedule: the plan on the working calendar (SPEC §2.3, slice F2).
 *
 * Everything on this page is computed from the snapshot by the domain, every time — the dates, the
 * critical path, the Gantt's geometry, the slip — so no two readings can disagree. The page adds
 * words and one act: approving the plan, which keeps today's schedule as baseline 1, for good. A
 * plan whose links make a loop is not drawn: the page says so, and where to fix it. An activity
 * the calendar cannot place is listed with its reason, never dropped.
 */
export function SchedulePage({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t, tp, day, describeError } = useI18n();
  const term = useTerms();
  const take = useTakeBaseline();
  const [refusal, setRefusal] = useState<string | null>(null);

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
  const view =
    layout === null
      ? null
      : toGanttView(layout, {
          spoken: (bar) =>
            t(bar.critical ? 'schedule.bar.critical' : 'schedule.bar', {
              number: bar.number,
              name: bar.name,
              days: tp('plan.checklist.days', bar.durationDays),
              start: day(bar.start),
              finish: day(bar.finish),
            }),
        });
  const slipped = baseline === null ? null : slip(scheduled, baseline);
  const hasBars = view !== null && view.rows.some((row) => row.kind === 'bar');

  const approve = () => {
    const draft = baselineDraft(snapshot, scheduled);
    take.mutate(
      {
        rows: draft.rows.map((row) => ({
          activityId: row.activityId,
          start: row.start,
          finish: row.finish,
        })),
        finishDate: draft.finishDate,
      },
      {
        onSuccess: (next) => {
          setRefusal(null);
          const taken = latestBaseline(next);
          if (taken !== null) {
            announce(
              t('schedule.approvedOn', { day: day(taken.takenAt.slice(0, 10)) }) +
                ` · ${term('baseline', { capital: true })} ${taken.number}`,
            );
          }
        },
        onError: (error) => setRefusal(describeError(error)),
      },
    );
  };

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

        <Card title={term('baseline', { capital: true })}>
          {snapshot.work.approvedAt === null || baseline === null ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-body text-fg-secondary">
                {scheduled.cyclic ? t('schedule.approve.cannot') : t('schedule.approve.note')}
              </p>
              <Button
                appearance="accent"
                icon={<CheckmarkCircle20Regular />}
                data-testid="plan-approve"
                disabled={take.isPending || scheduled.cyclic}
                onClick={approve}
              >
                {take.isPending ? t('common.working') : t('schedule.approve')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-body-lg font-semibold text-fg">
                {t('schedule.approvedOn', { day: day(snapshot.work.approvedAt.slice(0, 10)) })}
                <span aria-hidden="true"> · </span>
                {term('baseline', { capital: true })}{' '}
                <span data-testid="baseline-number">{baseline.number}</span>
              </p>
              <p className="text-caption text-fg-tertiary">{t('schedule.approved.note')}</p>
            </div>
          )}
          {refusal !== null && (
            <div className="mt-3">
              <InfoBar severity="danger" title={t('schedule.approveRefused')}>
                {refusal}
              </InfoBar>
            </div>
          )}
        </Card>
      </div>

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
          <Gantt view={view} label={t('schedule.gantt')} />
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
                <span className="text-fg-secondary">{t(UNPLACED[row.reason])}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
