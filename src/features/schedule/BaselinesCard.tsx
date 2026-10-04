import { useId, useState, type ReactNode } from 'react';

import {
  compareBaselines,
  comparisonFigures,
  defaultPair,
  explainedByChanges,
  type Comparison,
  type MoneyChange,
} from '@/domain/baselines';
import type { Figure, ReportRow } from '@/domain/figure';
import { workingCalendarOf, type WorkSnapshot } from '@/domain/plan';
import type { MessageKey, PluralBase } from '@/i18n';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';
import { Select } from '@/ui/Select';

import {
  changeDaysText,
  changeRowTitle,
  changeStateText,
  decidedImpactSentence,
  moneyMoveText,
} from '../plan/changeWords';
import { useDaysText } from './days';

/** How the summary line counts each of the comparison's figures, by the figure's id. */
const SUMMARY: Record<string, PluralBase> = {
  'baselines:datesMoved': 'baselines.summary.datesMoved',
  'baselines:durationsChanged': 'baselines.summary.durationsChanged',
  'baselines:activitiesAdded': 'baselines.summary.activitiesAdded',
  'baselines:activitiesRemoved': 'baselines.summary.activitiesRemoved',
  'baselines:stagesAdded': 'baselines.summary.stagesAdded',
  'baselines:stagesRemoved': 'baselines.summary.stagesRemoved',
  'baselines:changes': 'baselines.summary.changes',
};

/**
 * Every baseline of the work, and any two of them compared (F8, ADR-028).
 *
 * The list: each baseline with its number, the day it was taken, why — the reason its replanning
 * gave, or "the approval" for the first — its finish and the money planned then, or that the money
 * was not recorded (a baseline taken before F8 has none, and it is never read as zero).
 *
 * The comparison is the domain's: the pair is put in order of number whatever order it was chosen
 * in, and the card says so; the same baseline twice is refused with a sentence and nothing is
 * compared. What changed is said as counted figures — "3 dates moved · 1 activity added" — each
 * with its rows under it, in full, never behind a click: this is the list a person reads to explain
 * the plan's history. Money changed, and the reasons given between the two, close it.
 */
export function BaselinesCard({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t, day, money } = useI18n();
  const term = useTerms();
  const selectA = useId();
  const selectB = useId();
  const baselines = [...snapshot.baselines].sort((x, y) => x.number - y.number);
  const fallback = defaultPair(baselines);
  const [chosen, setChosen] = useState<{ a: number; b: number } | null>(null);
  const known = (number: number) => baselines.some((baseline) => baseline.number === number);
  // The last two until a person chooses; a choice that no longer names a baseline falls back.
  const pair = chosen !== null && known(chosen.a) && known(chosen.b) ? chosen : fallback;
  const currency = snapshot.work.currency;
  const title = t('baselines.title');

  if (baselines.length === 0) return null;

  const result =
    pair === null
      ? null
      : compareBaselines(
          baselines,
          pair.a,
          pair.b,
          workingCalendarOf(snapshot),
          snapshot.changeOrders,
        );

  const name = (number: number) =>
    t('baselines.name', { baseline: term('baseline', { capital: true }), number });

  return (
    <div data-testid="baselines-card">
      <Card title={title} description={t('baselines.description')}>
        <ol aria-label={title} className="flex flex-col">
          {baselines.map((baseline) => (
            <li
              key={baseline.id}
              data-baseline-number={baseline.number}
              className="grid gap-x-4 gap-y-0.5 border-t border-stroke-subtle py-2 first:border-t-0 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
            >
              <span className="font-semibold text-fg">{name(baseline.number)}</span>
              <span className="min-w-0 text-body text-fg">
                <span className="block">
                  {baseline.reason === null ? t('baselines.approval') : baseline.reason}
                </span>
                <span className="block text-caption text-fg-tertiary">
                  {t('baselines.takenOn', { day: day(baseline.takenAt.slice(0, 10)) })}
                </span>
              </span>
              <span className="text-body text-fg-secondary sm:text-right">
                <span className="block">
                  {t('baselines.finish', {
                    day:
                      baseline.finishDate === null
                        ? t('baselines.noFinish')
                        : day(baseline.finishDate),
                  })}
                </span>
                <span className="block">
                  {baseline.plannedCents === null
                    ? t('baselines.money.notRecorded')
                    : t('baselines.money', { amount: money(baseline.plannedCents, currency) })}
                </span>
              </span>
            </li>
          ))}
        </ol>

        {pair === null ? (
          <p className="mt-3 text-body text-fg-tertiary">{t('baselines.compare.needsTwo')}</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3 border-t border-stroke-subtle pt-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <span className="flex flex-col gap-1">
                <label htmlFor={selectA} className="text-caption font-semibold text-fg-secondary">
                  {t('baselines.compare.a')}
                </label>
                <Select
                  id={selectA}
                  data-testid="compare-a"
                  value={String(pair.a)}
                  onChange={(event) => setChosen({ a: Number(event.target.value), b: pair.b })}
                >
                  {baselines.map((baseline) => (
                    <option key={baseline.id} value={String(baseline.number)}>
                      {name(baseline.number)}
                    </option>
                  ))}
                </Select>
              </span>
              <span className="flex flex-col gap-1">
                <label htmlFor={selectB} className="text-caption font-semibold text-fg-secondary">
                  {t('baselines.compare.b')}
                </label>
                <Select
                  id={selectB}
                  data-testid="compare-b"
                  value={String(pair.b)}
                  onChange={(event) => setChosen({ a: pair.a, b: Number(event.target.value) })}
                >
                  {baselines.map((baseline) => (
                    <option key={baseline.id} value={String(baseline.number)}>
                      {name(baseline.number)}
                    </option>
                  ))}
                </Select>
              </span>
            </div>

            {result !== null && !result.ok && (
              <div
                data-testid={
                  result.problem.code === 'same-baseline' ? 'compare-same' : 'compare-unknown'
                }
              >
                <InfoBar severity="caution" title={t('baselines.problem.title')}>
                  {t(result.problem.messageKey, {
                    baseline: term('baseline'),
                    number: result.problem.number,
                  })}
                </InfoBar>
              </div>
            )}
            {result !== null && result.ok && (
              <ComparisonView
                comparison={result.comparison}
                currency={currency}
                name={name}
                changeOrders={snapshot.changeOrders}
              />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/** One comparison: the summary line, the finish, each figure with its rows, money, the reasons. */
function ComparisonView({
  comparison,
  currency,
  name,
  changeOrders,
}: {
  comparison: Comparison;
  currency: string;
  name: (number: number) => string;
  changeOrders: WorkSnapshot['changeOrders'];
}) {
  const i18n = useI18n();
  const { t, tp, day } = i18n;
  // What of the move the change orders approved between the two explain (E1), when any were.
  const explained = comparison.changes.rows.length === 0 ? null : explainedByChanges(comparison);
  const term = useTerms();
  const days = useDaysText();
  const figures = comparisonFigures(comparison);
  const heading = t('baselines.compare.heading', {
    from: name(comparison.earlier.number),
    to: name(comparison.later.number),
  });
  const finish = comparison.finishMoved;
  const dayOr = (value: string | null) => (value === null ? t('baselines.noFinish') : day(value));

  return (
    <section data-testid="compare-result" aria-label={heading} className="flex flex-col gap-3">
      <div>
        <h3 className="text-body-lg font-semibold text-fg">{heading}</h3>
        {comparison.swapped && (
          <p className="text-caption text-fg-tertiary">{t('baselines.compare.swapped')}</p>
        )}
      </div>

      <p className="text-body text-fg">
        {figures.length === 0
          ? t('baselines.summary.nothing')
          : figures.map((figure) => tp(SUMMARY[figure.id]!, figure.value)).join(' · ')}
        <span aria-hidden="true"> · </span>
        <MoneyText change={comparison.money} currency={currency} short />
      </p>

      <p data-testid="compare-finish" className="text-body text-fg">
        {finish === null
          ? t('baselines.finish.same', {
              finish: term('finishDate', { capital: true }),
              day: dayOr(comparison.later.finishDate),
            })
          : t('baselines.finish.moved', {
              finish: term('finishDate', { capital: true }),
              from: dayOr(finish.from),
              to: dayOr(finish.to),
              days: finish.days === null ? t('baselines.days.uncounted') : days(finish.days),
            })}
      </p>

      <Rows figure={comparison.datesMoved} attribute="data-compare-moved">
        {(row) => (
          <>
            <span className="font-semibold text-fg">{row.name}</span>
            <span aria-hidden="true"> — </span>
            <span>{row.stageName}</span>
            <span aria-hidden="true"> — </span>
            <span>
              {row.change === 'moved'
                ? t('baselines.row.moved', {
                    from: dayOr(row.from),
                    to: dayOr(row.to),
                    days: row.days === null ? t('baselines.days.uncounted') : days(row.days),
                  })
                : row.change === 'placed'
                  ? t('baselines.row.placed', { to: dayOr(row.to) })
                  : t('baselines.row.unplaced', { from: dayOr(row.from) })}
            </span>
            {row.nameThen !== row.name && (
              <span className="block text-caption text-fg-tertiary">
                {t('baselines.row.renamed', { name: row.nameThen })}
              </span>
            )}
          </>
        )}
      </Rows>
      <Rows figure={comparison.durationsChanged} attribute="data-compare-duration">
        {(row) => (
          <>
            <span className="font-semibold text-fg">{row.name}</span>
            <span aria-hidden="true"> — </span>
            <span>{row.stageName}</span>
            <span aria-hidden="true"> — </span>
            <span>
              {t('baselines.row.duration', {
                from:
                  row.from === null
                    ? t('baselines.row.noDuration')
                    : tp('plan.checklist.days', row.from),
                to:
                  row.to === null
                    ? t('baselines.row.noDuration')
                    : tp('plan.checklist.days', row.to),
              })}
            </span>
          </>
        )}
      </Rows>
      <Rows figure={comparison.activitiesAdded} attribute="data-compare-added">
        {(row) => (
          <>
            <span className="font-semibold text-fg">{row.name}</span>
            <span aria-hidden="true"> — </span>
            <span>{row.stageName}</span>
            <span aria-hidden="true"> — </span>
            <span>{t('baselines.row.finishing', { day: dayOr(row.finish) })}</span>
          </>
        )}
      </Rows>
      <Rows figure={comparison.activitiesRemoved} attribute="data-compare-removed">
        {(row) => (
          <>
            <span className="font-semibold text-fg">{row.name}</span>
            <span aria-hidden="true"> — </span>
            <span>{row.stageName}</span>
            <span aria-hidden="true"> — </span>
            <span>{t('baselines.row.wasFinishing', { day: dayOr(row.finish) })}</span>
          </>
        )}
      </Rows>
      <Rows figure={comparison.stagesAdded} attribute="data-compare-stage-added">
        {(row) => <span className="font-semibold text-fg">{row.name}</span>}
      </Rows>
      <Rows figure={comparison.stagesRemoved} attribute="data-compare-stage-removed">
        {(row) => <span className="font-semibold text-fg">{row.name}</span>}
      </Rows>

      <Rows figure={comparison.changes} attribute="data-compare-change">
        {(row) => {
          const change = changeOrders.find((each) => each.id === row.changeOrderId);
          return (
            <>
              <span className="font-semibold text-fg">{changeRowTitle(i18n, row)}</span>
              <span aria-hidden="true"> — </span>
              <span>
                {change === undefined
                  ? t('changes.state.approved', { day: day(row.decidedOn) })
                  : t('baselines.row.change', {
                      state: changeStateText(i18n, change),
                      impact: decidedImpactSentence(i18n, change, currency) ?? '',
                    })}
              </span>
            </>
          );
        }}
      </Rows>
      {explained !== null && (
        <p data-testid="compare-changes" className="text-body text-fg">
          {t('baselines.changes.explained', {
            cost: moneyMoveText(i18n, explained.costCents, currency),
            days: changeDaysText(i18n, explained.days),
          })}
        </p>
      )}

      <p data-testid="compare-money" className="text-body text-fg">
        <MoneyText change={comparison.money} currency={currency} />
      </p>

      <div className="flex flex-col gap-1">
        <h4 className="text-body font-semibold text-fg">{t('baselines.reasons')}</h4>
        <ol className="flex flex-col gap-1">
          {comparison.reasons.map((reason, index) => (
            <li key={index} data-compare-reason className="text-body text-fg-secondary">
              {reason}
            </li>
          ))}
          {comparison.unexplained.map((number) => (
            <li
              key={`none:${number}`}
              data-compare-unexplained
              className="text-body text-fg-tertiary"
            >
              {t('baselines.reason.none', { name: name(number) })}
            </li>
          ))}
        </ol>
      </div>
      <p className="text-caption text-fg-tertiary">{t('baselines.compare.note')}</p>
    </section>
  );
}

/** One counted figure of the comparison, its label and its count, and every row under it. */
function Rows<Row extends ReportRow>({
  figure,
  attribute,
  children,
}: {
  figure: Figure<Row>;
  attribute: string;
  children: (row: Row) => ReactNode;
}) {
  const { t, number } = useI18n();
  if (figure.rows.length === 0) return null;
  const label = t(figure.label as MessageKey);
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-body font-semibold text-fg">
        {t('baselines.figure.line', { label, count: number(figure.value) })}
      </h4>
      <ul aria-label={label} className="flex flex-col gap-1 border-l border-stroke-subtle pl-3">
        {figure.rows.map((row) => (
          <li
            key={row.key}
            {...{ [attribute]: row.itemId ?? row.key }}
            className="text-body text-fg-secondary"
          >
            {children(row)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Money planned then and later, with the change in its sign and in words — or that it was not recorded. */
function MoneyText({
  change,
  currency,
  short = false,
}: {
  change: MoneyChange;
  currency: string;
  short?: boolean;
}) {
  const { t, money } = useI18n();
  if (change === 'not recorded') {
    return <>{t('baselines.money.change.notRecorded')}</>;
  }
  const delta =
    change.delta === 0
      ? t('baselines.money.delta.none')
      : change.delta > 0
        ? t('baselines.money.delta.more', { amount: money(change.delta, currency) })
        : t('baselines.money.delta.less', { amount: money(-change.delta, currency) });
  if (short) return <>{t('baselines.money.short', { delta })}</>;
  return (
    <>
      {t('baselines.money.change', {
        from: money(change.from, currency),
        to: money(change.to, currency),
        delta,
      })}
    </>
  );
}
