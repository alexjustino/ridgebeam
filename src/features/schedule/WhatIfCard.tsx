import { Add20Regular, Delete20Regular, Dismiss20Regular } from '@fluentui/react-icons';
import { useId, useMemo, useState, type FormEvent } from 'react';

import { breakdown } from '@/domain/arrangements';
import { latestBaseline, type WorkSnapshot } from '@/domain/plan';
import { schedule, type Schedule } from '@/domain/schedule';
import { slip } from '@/domain/schedule/slip';
import {
  putOverride,
  validateOverride,
  whatIfDelta,
  withOverrides,
  WHAT_IF_LIMIT_DAYS,
  type Override,
  type WhatIfProblem,
  type WhatIfRow,
} from '@/domain/schedule/whatIf';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

import { useEndpointName } from '../plan/endpoints';

/**
 * What if (F8, ADR-028): the schedule worked out again, in memory, with durations or lags that
 * are not the plan's — "when would we finish if the foundations took ten days?".
 *
 * Nothing here is written. The overrides are this card's own state, gone when the page is left or
 * **Clear** is pressed; the domain recomputes the schedule from a copy of the snapshot, and the
 * Gantt above stays the plan's. The card says so in a sentence that never goes away, because a
 * what-if that looks saved is the one mistake this card must not allow. To keep one, a person
 * replans with a reason and makes the edit in the breakdown.
 *
 * What it shows is two differences: against today's plan (a figure that opens onto every activity
 * whose finish moves) and against the latest baseline. An override the domain refuses — an
 * activity of a closed stage, a duration out of range — is said with its sentence and not added.
 */
export function WhatIfCard({
  snapshot,
  scheduled,
}: {
  snapshot: WorkSnapshot;
  scheduled: Schedule;
}) {
  const { t, tp, day, number } = useI18n();
  const term = useTerms();
  const form = useId();
  const [overrides, setOverrides] = useState<readonly Override[]>([]);
  const [activityId, setActivityId] = useState('');
  const [duration, setDuration] = useState('');
  const [dependencyId, setDependencyId] = useState('');
  const [lag, setLag] = useState('');
  const [problems, setProblems] = useState<readonly string[]>([]);

  const numbers = useMemo(
    () => new Map(breakdown(snapshot).map((row) => [row.id, row.number])),
    [snapshot],
  );
  const endpointName = useEndpointName(snapshot, numbers);
  const names = new Map(snapshot.activities.map((activity) => [activity.id, activity.name]));
  const links = new Map(snapshot.dependencies.map((dependency) => [dependency.id, dependency]));

  // The overrides still valid against the plan as it is now: an activity removed since is dropped
  // rather than refusing the whole what-if.
  const kept = useMemo(
    () => overrides.filter((override) => validateOverride(snapshot, override).length === 0),
    [overrides, snapshot],
  );
  const result = useMemo(() => withOverrides(snapshot, kept), [snapshot, kept]);
  const after = useMemo(
    () => (result.ok && kept.length > 0 ? schedule(result.snapshot) : null),
    [result, kept],
  );
  const delta = after === null ? null : whatIfDelta(scheduled, after, scheduled.calendar);
  const baseline = latestBaseline(snapshot);
  const againstBaseline = after === null || baseline === null ? null : slip(after, baseline);

  const say = (found: readonly WhatIfProblem[]) =>
    setProblems([
      ...new Set(
        found.map((problem) => t(problem.messageKey, { max: number(WHAT_IF_LIMIT_DAYS) })),
      ),
    ]);

  const add = (override: Override) => {
    const found = validateOverride(snapshot, override);
    if (found.length > 0) {
      say(found);
      return false;
    }
    setProblems([]);
    setOverrides((now) => putOverride(now, override));
    return true;
  };

  const addDuration = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activityId === '') {
      setProblems([t('schedule.whatIf.chooseActivity')]);
      return;
    }
    const days = duration.trim() === '' ? Number.NaN : Number(duration);
    if (add({ kind: 'duration', activityId, durationDays: days })) setDuration('');
  };

  const addLag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (dependencyId === '') {
      setProblems([t('schedule.whatIf.chooseLink')]);
      return;
    }
    const days = lag.trim() === '' ? Number.NaN : Number(lag);
    if (add({ kind: 'lag', dependencyId, lagDays: days })) setLag('');
  };

  const clear = () => {
    setOverrides([]);
    setProblems([]);
  };

  const signed = (days: number) =>
    days === 0
      ? t('schedule.whatIf.days.none')
      : days > 0
        ? tp('schedule.whatIf.days.later', days)
        : tp('schedule.whatIf.days.earlier', -days);

  const describe = (override: Override): string => {
    if (override.kind === 'duration') {
      const activity = snapshot.activities.find((each) => each.id === override.activityId);
      return t('schedule.whatIf.row.duration', {
        name: names.get(override.activityId) ?? '',
        from:
          activity === undefined || activity.durationDays === null
            ? t('baselines.row.noDuration')
            : tp('plan.checklist.days', activity.durationDays),
        to: tp('plan.checklist.days', override.durationDays),
      });
    }
    const dependency = links.get(override.dependencyId);
    return t('schedule.whatIf.row.lag', {
      link:
        dependency === undefined
          ? ''
          : t('schedule.whatIf.link', {
              blocked: endpointName(dependency.blocked),
              blocker: endpointName(dependency.blocker),
            }),
      from: tp('plan.checklist.days', dependency?.lagDays ?? 0),
      to: tp('plan.checklist.days', override.lagDays),
    });
  };

  const title = term('whatIf', { capital: true });

  return (
    <Card title={title} description={t('schedule.whatIf.lead')}>
      <p data-testid="whatif-note" className="mb-3 text-body text-fg-secondary">
        {t('schedule.whatIf.note')}
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <form
          onSubmit={addDuration}
          noValidate
          aria-labelledby={`${form}-duration`}
          className="flex flex-col gap-1"
        >
          <span id={`${form}-duration`} className="text-caption font-semibold text-fg-secondary">
            {t('schedule.whatIf.duration')}
          </span>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-start gap-2">
            <Select
              data-testid="whatif-activity"
              aria-label={term('activity', { capital: true })}
              value={activityId}
              onChange={(event) => setActivityId(event.target.value)}
            >
              <option value="">{t('schedule.whatIf.chooseActivity')}</option>
              {scheduled.activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {[numbers.get(activity.id) ?? '', activity.name].join(' ').trim()}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={WHAT_IF_LIMIT_DAYS}
              step={1}
              data-testid="whatif-duration"
              aria-label={t('schedule.whatIf.durationDays', {
                duration: term('duration', { capital: true }),
              })}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
            <Button type="submit" icon={<Add20Regular />} data-testid="whatif-add">
              {t('schedule.whatIf.add')}
            </Button>
          </div>
        </form>

        {snapshot.dependencies.length > 0 && (
          <form
            onSubmit={addLag}
            noValidate
            aria-labelledby={`${form}-lag`}
            className="flex flex-col gap-1"
          >
            <span id={`${form}-lag`} className="text-caption font-semibold text-fg-secondary">
              {t('schedule.whatIf.lag')}
            </span>
            <div className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-start gap-2">
              <Select
                data-testid="whatif-link"
                aria-label={term('dependency', { capital: true })}
                value={dependencyId}
                onChange={(event) => setDependencyId(event.target.value)}
              >
                <option value="">{t('schedule.whatIf.chooseLink')}</option>
                {snapshot.dependencies.map((dependency) => (
                  <option key={dependency.id} value={dependency.id}>
                    {t('schedule.whatIf.link', {
                      blocked: endpointName(dependency.blocked),
                      blocker: endpointName(dependency.blocker),
                    })}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={WHAT_IF_LIMIT_DAYS}
                step={1}
                data-testid="whatif-lag"
                aria-label={t('schedule.whatIf.lagDays', { lag: term('lag', { capital: true }) })}
                value={lag}
                onChange={(event) => setLag(event.target.value)}
              />
              <Button type="submit" icon={<Add20Regular />} data-testid="whatif-add-lag">
                {t('schedule.whatIf.add')}
              </Button>
            </div>
          </form>
        )}
      </div>

      {problems.length > 0 && (
        <div data-testid="whatif-problem" className="mt-3">
          <InfoBar severity="caution" title={t('schedule.whatIf.refused')}>
            <ul className="flex flex-col gap-0.5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </InfoBar>
        </div>
      )}

      {kept.length > 0 && (
        <div className="mt-4 flex flex-col gap-3 border-t border-stroke-subtle pt-3">
          <ul aria-label={t('schedule.whatIf.rows')} className="flex flex-col gap-1">
            {kept.map((override) => {
              const text = describe(override);
              return (
                <li
                  key={override.kind === 'duration' ? override.activityId : override.dependencyId}
                  data-whatif-row
                  className="flex items-center gap-2 text-body text-fg"
                >
                  <span className="min-w-0 flex-1">{text}</span>
                  <IconButton
                    data-testid="whatif-remove"
                    icon={<Delete20Regular />}
                    label={t('schedule.whatIf.remove', { what: text })}
                    onClick={() => setOverrides((now) => now.filter((each) => each !== override))}
                  />
                </li>
              );
            })}
          </ul>

          {!result.ok || after === null || delta === null ? null : (
            <>
              <p className="text-body text-fg">
                <span className="text-fg-secondary">
                  {t('schedule.whatIf.finish', { finish: term('finishDate', { capital: true }) })}
                </span>{' '}
                <span data-testid="whatif-finish" className="text-subtitle font-semibold">
                  {after.finishDate === null
                    ? after.cyclic
                      ? t('dashboard.finish.cyclic')
                      : t('dashboard.finish.unknown')
                    : day(after.finishDate)}
                </span>
              </p>
              <FigureRow<WhatIfRow>
                testId="whatif-delta"
                size="title"
                figure={delta.moved}
                label={t('schedule.whatIf.againstPlan')}
                value={delta.days === null ? t('baselines.days.uncounted') : signed(delta.days)}
                rowsLabel={t('schedule.whatIf.movedRows')}
                renderRow={(row) => (
                  <>
                    <span className="font-semibold text-fg">{row.name}</span>
                    <span aria-hidden="true"> — </span>
                    {row.change === 'moved' ? (
                      <span>
                        {t('baselines.row.moved', {
                          from: day(row.beforeFinish ?? ''),
                          to: day(row.afterFinish ?? ''),
                          days: signed(row.days),
                        })}
                      </span>
                    ) : row.change === 'placed' ? (
                      <span>{t('baselines.row.placed', { to: day(row.afterFinish ?? '') })}</span>
                    ) : (
                      <span>
                        {t('baselines.row.unplaced', { from: day(row.beforeFinish ?? '') })}
                      </span>
                    )}
                  </>
                )}
              />
              {againstBaseline !== null && baseline !== null && (
                <p data-testid="whatif-delta-baseline" className="text-body text-fg-secondary">
                  {t('schedule.whatIf.againstBaseline', {
                    baseline: term('baseline', { capital: true }),
                    number: baseline.number,
                    days: signed(againstBaseline.value),
                  })}
                </p>
              )}
            </>
          )}

          <div>
            <Button icon={<Dismiss20Regular />} data-testid="whatif-clear" onClick={clear}>
              {t('schedule.whatIf.clear')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
