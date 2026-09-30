import { useId } from 'react';

import { addCalendarDays } from '@/domain/calendar';
import type { ChanceRow } from '@/domain/figure';
import {
  naturalFrequency,
  PROBABILITY_MESSAGE_KEYS,
  PROBABILITY_RUNS,
  type FinishProbability,
  type FinishProbabilityResult,
} from '@/domain/schedule/probability';
import {
  baselineChanceText,
  criticalText,
  driverRangeText,
  frequencyPercent,
  frequencyShort,
  frequencyText,
  headlineText,
  planChanceText,
} from '@/features/reports/compose/words';
import type { MessageKey } from '@/i18n/en';
import { useI18n, type I18n } from '@/i18n/useI18n';
import { useLens } from '@/i18n/useTerm';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';

/* The chart's own coordinate system: drawing units, not CSS. */
const WIDTH = 640;
const HEIGHT = 200;
const PAD = { left: 64, right: 12, top: 12, bottom: 24 };

/** Whole calendar days from one `YYYY-MM-DD` to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** One row a week from the earliest finish to the latest, and the latest itself. */
function weekly(result: FinishProbability): string[] {
  const rows: string[] = [];
  for (let day = result.earliest; day < result.latest; day = addCalendarDays(day, 7)) {
    rows.push(day);
  }
  rows.push(result.latest);
  return rows;
}

/**
 * **When will it really finish?** (D1, decisions 5 and 6; ADR-035.)
 *
 * The plan's finish date takes every duration as certain. This card takes the ranges the person
 * gave — optimistic and pessimistic working days on any activity — and says what the domain's
 * seeded simulation (`finishProbability`) found, in natural frequencies: the headline "8 in 10
 * chances of finishing by 14 November 2026" (`finish-p80`), then the same for a half and nine
 * tenths of the runs (`finish-p50`, `finish-p90`), the chance of the plan's own date
 * (`finish-plan-chance`) and of the latest baseline's (`finish-baseline-chance`). Each carries its
 * date as `data-day` and the chance as `data-chance`, for a reader that must not parse a localised
 * date. The engineer's lens adds which percentile it is and the share of runs, in percent — the
 * owner's and the architect's say only "N in 10" (decision 5).
 *
 * The headline is a figure that opens onto what it depends on: the drivers, then the activities
 * counted as certain (DESIGN_SYSTEM §2, _a number can be opened_). The chart is the cumulative
 * chance by date — a picture of the table under it, one row a week, which is its accessible reading
 * (§8, _a chart says what it left out_). The drivers (`[data-driver]`) are the activities whose
 * range moves the finish most. The card says how many activities it counted as certain
 * (`finish-certain`), how many it left out, how it was computed, and what it does not model.
 *
 * Nothing here is stored, and nothing here changes the plan's dates: the card reads the schedule and
 * writes nothing.
 */
export function FinishProbabilityCard({ result }: { result: FinishProbabilityResult | null }) {
  const { t } = useI18n();

  return (
    <div data-testid="finish-probability">
      <Card title={t(PROBABILITY_MESSAGE_KEYS.title)}>
        <p className="mb-3 max-w-3xl text-body text-fg-secondary">
          {t('schedule.probability.lead')}
        </p>
        {result === null ? (
          <p className="text-body text-fg-tertiary">{t('common.working')}</p>
        ) : !result.ok ? (
          <p data-testid="finish-probability-problem" className="text-body text-fg">
            {t(result.messageKey as MessageKey)}
          </p>
        ) : (
          <Simulated result={result} />
        )}
      </Card>
    </div>
  );
}

function Simulated({ result }: { result: FinishProbability }) {
  const i18n = useI18n();
  const { t, number, day } = i18n;
  const engineer = useLens() === 'engineer';
  const { counts } = result;

  /** "8 in 10 chances of finishing by …", with "(P80)" and the share of runs for the engineer. */
  const byDate = (date: string, percentile: number, withPercent: boolean) => {
    const frequency = naturalFrequency(result.chanceBy(date));
    const sentence = headlineText(i18n, { date, frequency }, engineer ? { percentile } : null);
    return engineer && withPercent
      ? t('schedule.probability.engineer.percent', {
          sentence,
          percent: frequencyPercent(i18n, frequency),
        })
      : sentence;
  };
  // A percentile that falls on the headline's own day would repeat its "8 in 10" under another
  // label ("8 in 10 chances by 9 October (P50)"), which reads as a contradiction: the runs cluster
  // on that day. Say that instead.
  const percentileLine = (date: string, percentile: 50 | 90) => {
    if (date !== result.p80) return byDate(date, percentile, true);
    const sentence = t(
      percentile === 50 ? 'schedule.probability.sameDay.p50' : 'schedule.probability.sameDay.p90',
      { date: day(date) },
    );
    return engineer
      ? t('schedule.probability.engineer.percentile', { sentence, percentile })
      : sentence;
  };
  const withShare = (sentence: string, chance: number) =>
    engineer
      ? t('schedule.probability.engineer.after', {
          sentence,
          percent: frequencyPercent(i18n, naturalFrequency(chance)),
        })
      : sentence;

  return (
    <div className="flex flex-col gap-4">
      {result.allCertain ? (
        <div className="flex flex-col gap-1">
          <p
            data-testid="finish-p80"
            data-day={result.p80}
            data-chance={result.headline.chance}
            className="text-subtitle font-semibold text-fg"
          >
            {day(result.p80)}
          </p>
          <p data-testid="finish-certain" className="text-body text-fg">
            {t(PROBABILITY_MESSAGE_KEYS.allCertain)}
          </p>
        </div>
      ) : (
        <>
          <div data-testid="finish-p80" data-day={result.p80} data-chance={result.headline.chance}>
            <FigureRow<ChanceRow>
              testId="finish-p80-figure"
              size="title"
              figure={result.figures.p80}
              label={t(PROBABILITY_MESSAGE_KEYS.figure.p80)}
              value={byDate(result.p80, 80, false)}
              rowsLabel={t('schedule.probability.rows')}
              renderRow={(row) => (
                <>
                  <span className="font-semibold text-fg">{row.title}</span>
                  <span aria-hidden="true"> — </span>
                  <span>
                    {row.role === 'driver'
                      ? t('schedule.probability.row.driver')
                      : t('schedule.probability.row.certain')}
                  </span>
                  {engineer && row.role === 'driver' && row.share !== null && (
                    <>
                      <span aria-hidden="true"> — </span>
                      <span>
                        {t('schedule.probability.row.correlation', {
                          value: number(Math.round(row.share * 100) / 100),
                        })}
                      </span>
                    </>
                  )}
                </>
              )}
            />
          </div>

          <ul
            aria-label={t('schedule.probability.dates')}
            className="flex flex-col gap-1 text-body"
          >
            <li
              data-testid="finish-p50"
              data-day={result.p50}
              data-chance={result.chanceBy(result.p50)}
              className="text-fg"
            >
              {percentileLine(result.p50, 50)}
            </li>
            <li
              data-testid="finish-p90"
              data-day={result.p90}
              data-chance={result.chanceBy(result.p90)}
              className="text-fg"
            >
              {percentileLine(result.p90, 90)}
            </li>
            {result.plan !== null && (
              <li
                data-testid="finish-plan-chance"
                data-day={result.plan.date}
                data-chance={result.plan.chance}
                className="text-fg"
              >
                {withShare(planChanceText(i18n, result.plan), result.plan.chance)}
              </li>
            )}
            {result.baseline !== null && (
              <li
                data-testid="finish-baseline-chance"
                data-day={result.baseline.date}
                data-chance={result.baseline.chance}
                className="text-fg"
              >
                {withShare(baselineChanceText(i18n, result.baseline), result.baseline.chance)}
              </li>
            )}
          </ul>

          <ChanceChart result={result} engineer={engineer} />

          <Drivers result={result} engineer={engineer} />

          {counts.certain > 0 && (
            <p data-testid="finish-certain" className="text-body text-fg-secondary">
              {t(PROBABILITY_MESSAGE_KEYS.certainCount, {
                certain: number(counts.certain),
                total: number(counts.total),
              })}
            </p>
          )}
        </>
      )}

      {counts.unplaced > 0 && (
        <p data-testid="finish-unplaced" className="text-body text-fg-secondary">
          {t(PROBABILITY_MESSAGE_KEYS.unplacedCount, { unplaced: number(counts.unplaced) })}
        </p>
      )}

      <div className="flex flex-col gap-0.5 border-t border-stroke-subtle pt-2 text-caption text-fg-tertiary">
        {/* With nothing ranged every run is the plan: there is no method to state. */}
        {!result.allCertain && (
          <>
            <p data-testid="finish-method">
              {t(PROBABILITY_MESSAGE_KEYS.method, { runs: number(result.runs) })}
            </p>
            {result.capped && (
              <p>
                {t(PROBABILITY_MESSAGE_KEYS.capped, {
                  runs: number(result.runs),
                  max: number(PROBABILITY_RUNS),
                })}
              </p>
            )}
            <p>{t(PROBABILITY_MESSAGE_KEYS.leftOut)}</p>
          </>
        )}
        <p>{t('schedule.probability.note')}</p>
      </div>
    </div>
  );
}

/**
 * The drivers: the activities whose drawn duration moves the finish most, strongest first, each
 * with its range and how often it was critical — and, for the engineer, its rank correlation.
 */
function Drivers({ result, engineer }: { result: FinishProbability; engineer: boolean }) {
  const i18n = useI18n();
  const { t, number } = i18n;
  const often = new Map(result.criticality.map((each) => [each.activityId, each.frequency]));

  return (
    <section aria-labelledby="finish-drivers" className="flex flex-col gap-1">
      <h3 id="finish-drivers" className="text-body font-semibold text-fg">
        {t('schedule.probability.drivers')}
      </h3>
      {result.drivers.length === 0 ? (
        <p className="text-body text-fg-tertiary">{t('schedule.probability.drivers.none')}</p>
      ) : (
        <>
          <p className="text-caption text-fg-tertiary">{t('schedule.probability.drivers.lead')}</p>
          <ol className="flex flex-col gap-1">
            {result.drivers.map((driver) => {
              const frequency = often.get(driver.activityId);
              return (
                <li
                  key={driver.activityId}
                  data-driver
                  data-activity-id={driver.activityId}
                  className="text-body text-fg-secondary"
                >
                  <span className="font-semibold text-fg">{driver.name}</span>
                  <span aria-hidden="true"> — </span>
                  <span>{driverRangeText(i18n, driver)}</span>
                  {frequency !== undefined && (
                    <>
                      <span aria-hidden="true"> — </span>
                      <span>{criticalText(i18n, frequency)}</span>
                    </>
                  )}
                  {engineer && (
                    <>
                      <span aria-hidden="true"> — </span>
                      <span>
                        {t('schedule.probability.row.correlation', {
                          value: number(Math.round(driver.correlation * 100) / 100),
                        })}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

/**
 * The cumulative chance of having finished, by date: a step line from the earliest finish any run
 * gave to the latest, the plan's date dashed, the headline's date dotted — told apart by dash and
 * named in words in the legend. The table under it, one row a week, is the same numbers read out.
 */
function ChanceChart({ result, engineer }: { result: FinishProbability; engineer: boolean }) {
  const i18n = useI18n();
  const { t, day } = i18n;
  const described = useId();
  const plan = result.plan?.date ?? null;
  const from = plan !== null && plan < result.earliest ? plan : result.earliest;
  const to = plan !== null && plan > result.latest ? plan : result.latest;
  const span = Math.max(1, daysBetween(from, to));
  const x = (date: string) =>
    PAD.left + (daysBetween(from, date) / span) * (WIDTH - PAD.left - PAD.right);
  const y = (chance: number) => PAD.top + (1 - chance) * (HEIGHT - PAD.top - PAD.bottom);
  const steps = [
    `M ${x(from)} ${y(0)}`,
    ...result.distribution.map((point) => `H ${x(point.date)} V ${y(point.chance)}`),
    `H ${x(to)}`,
  ].join(' ');
  const rows = weekly(result);

  return (
    <section aria-labelledby="finish-chart" className="flex flex-col gap-3">
      <h3 id="finish-chart" className="text-body font-semibold text-fg">
        {t('schedule.probability.chart.title')}
      </h3>
      <p id={described} className="text-caption text-fg-secondary">
        {t('schedule.probability.chart.description', {
          earliest: day(result.earliest),
          latest: day(result.latest),
        })}
      </p>
      <svg
        data-testid="finish-chart"
        role="img"
        aria-label={t('schedule.probability.chart.title')}
        aria-describedby={described}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full rounded-md border border-stroke-subtle bg-card"
      >
        {[0.5, 1].map((share) => (
          <g key={share}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(share)}
              y2={y(share)}
              className="stroke-stroke-subtle"
            />
            <text
              x={PAD.left - 6}
              y={y(share) + 4}
              textAnchor="end"
              className="fill-fg-tertiary text-caption"
            >
              {frequencyShort(i18n, naturalFrequency(share))}
            </text>
          </g>
        ))}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(0)}
          y2={y(0)}
          className="stroke-stroke-strong"
        />
        {plan !== null && (
          <line
            data-marker="plan"
            x1={x(plan)}
            x2={x(plan)}
            y1={PAD.top}
            y2={y(0)}
            strokeDasharray="6 4"
            className="stroke-fg-secondary [stroke-width:1.5]"
          />
        )}
        <line
          data-marker="headline"
          x1={x(result.p80)}
          x2={x(result.p80)}
          y1={PAD.top}
          y2={y(0)}
          strokeDasharray="2 3"
          className="stroke-fg [stroke-width:1.5]"
        />
        <path d={steps} fill="none" className="stroke-accent [stroke-width:2.5]" />
        <text x={PAD.left} y={HEIGHT - 6} className="fill-fg-tertiary text-caption">
          {day(from)}
        </text>
        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 6}
          textAnchor="end"
          className="fill-fg-tertiary text-caption"
        >
          {day(to)}
        </text>
      </svg>
      <ul className="grid gap-x-6 gap-y-1 text-caption text-fg-secondary sm:grid-cols-3">
        <li className="flex items-center gap-2">
          <svg width="28" height="8" aria-hidden="true" className="shrink-0">
            <line x1="1" x2="27" y1="4" y2="4" className="stroke-accent [stroke-width:2.5]" />
          </svg>
          {t('schedule.probability.legend.curve')}
        </li>
        {plan !== null && (
          <li className="flex items-center gap-2">
            <svg width="28" height="8" aria-hidden="true" className="shrink-0">
              <line
                x1="1"
                x2="27"
                y1="4"
                y2="4"
                strokeDasharray="6 4"
                className="stroke-fg-secondary [stroke-width:1.5]"
              />
            </svg>
            {t('schedule.probability.legend.plan')}
          </li>
        )}
        <li className="flex items-center gap-2">
          <svg width="28" height="8" aria-hidden="true" className="shrink-0">
            <line
              x1="1"
              x2="27"
              y1="4"
              y2="4"
              strokeDasharray="2 3"
              className="stroke-fg [stroke-width:1.5]"
            />
          </svg>
          {t('schedule.probability.legend.headline', {
            chance: frequencyText(i18n, result.headline.frequency),
          })}
        </li>
      </ul>
      <table data-testid="finish-table" className="w-full border-collapse text-body">
        <caption className="mb-1 text-left text-caption font-semibold text-fg-secondary">
          {t('schedule.probability.table')}
        </caption>
        <thead>
          <tr className="text-left text-caption text-fg-tertiary">
            <th scope="col" className="py-1 font-semibold">
              {t('schedule.probability.table.by')}
            </th>
            <th scope="col" className="py-1 text-right font-semibold">
              {t('schedule.probability.table.chance')}
            </th>
            {engineer && (
              <th scope="col" className="py-1 text-right font-semibold">
                {t('schedule.probability.table.percent')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((date) => (
            <ChanceTableRow
              key={date}
              i18n={i18n}
              date={date}
              chance={result.chanceBy(date)}
              engineer={engineer}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ChanceTableRow({
  i18n,
  date,
  chance,
  engineer,
}: {
  i18n: I18n;
  date: string;
  chance: number;
  engineer: boolean;
}) {
  const frequency = naturalFrequency(chance);
  return (
    <tr data-chance-row={date} className="border-t border-stroke-subtle">
      <th scope="row" className="py-1 text-left font-normal text-fg">
        {i18n.day(date)}
      </th>
      <td className="py-1 text-right text-fg">{frequencyText(i18n, frequency)}</td>
      {engineer && (
        <td className="py-1 text-right tabular-nums text-fg">
          {frequencyPercent(i18n, frequency)}
        </td>
      )}
    </tr>
  );
}
