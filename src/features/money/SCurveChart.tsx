import { useId, useMemo } from 'react';

import { useToday } from '@/app/today';
import { sCurve, type SCurveDay } from '@/domain/money';
import type { WorkSnapshot } from '@/domain/plan';
import { schedule } from '@/domain/schedule';
import { useI18n } from '@/i18n/useI18n';
import { Card } from '@/ui/Card';

/* The chart's own coordinate system: drawing units, not CSS. */
const WIDTH = 640;
const HEIGHT = 220;
const PAD = { left: 8, right: 8, top: 12, bottom: 20 };

/** The last day of each week of the curve, and the curve's last day: what the table reads out. */
function weekly(days: readonly SCurveDay[]): SCurveDay[] {
  const rows = days.filter((_, index) => index % 7 === 6);
  const last = days.at(-1);
  if (last !== undefined && rows.at(-1) !== last) rows.push(last);
  return rows;
}

/**
 * The S-curve (slice F6): money planned against money paid, cumulative, over the work's days.
 *
 * Two series told apart by colour **and** by dash — planned solid, paid dashed — and named in
 * words in the legend (DESIGN_SYSTEM §2: never colour alone). The drawing is one image with a
 * sentence that names both totals and the last day; the table under it, week by week, is the
 * accessible reading of the same numbers. Money that is not on the calendar yet is counted on the
 * start day, and the chart says which lines it put there (a chart says what it left out).
 */
export function SCurveChart({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t, money, day } = useI18n();
  const today = useToday();
  const described = useId();
  const curve = useMemo(
    () => sCurve(snapshot, schedule(snapshot), snapshot.payments, today),
    [snapshot, today],
  );
  const currency = snapshot.work.currency;
  const days = curve.days;
  const top = Math.max(curve.totals.planned, curve.totals.paid, 1);
  const x = (index: number) =>
    PAD.left +
    (days.length <= 1 ? 0 : (index / (days.length - 1)) * (WIDTH - PAD.left - PAD.right));
  const y = (cents: number) => PAD.top + (1 - cents / top) * (HEIGHT - PAD.top - PAD.bottom);
  const line = (pick: (row: SCurveDay) => number) =>
    days.map((row, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(pick(row))}`).join(' ');
  const last = days.at(-1);

  return (
    <Card title={t('money.curve.title')}>
      {days.length === 0 || last === undefined ? (
        <p className="text-body text-fg-tertiary">{t('money.curve.empty')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p id={described} className="text-caption text-fg-secondary">
            {t('money.curve.description', {
              planned: money(curve.totals.planned, currency),
              paid: money(curve.totals.paid, currency),
              day: day(last.day),
            })}
          </p>
          <svg
            data-testid="s-curve"
            role="img"
            aria-label={t('money.curve.title')}
            aria-describedby={described}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-auto w-full rounded-md border border-stroke-subtle bg-card"
          >
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={HEIGHT - PAD.bottom}
              y2={HEIGHT - PAD.bottom}
              className="stroke-stroke-subtle"
            />
            <path
              d={line((row) => row.planned)}
              fill="none"
              className="stroke-accent [stroke-width:2.5]"
            />
            <path
              d={line((row) => row.paid)}
              fill="none"
              strokeDasharray="6 4"
              className="stroke-fg [stroke-width:2]"
            />
            <text x={PAD.left} y={HEIGHT - 4} className="fill-fg-tertiary text-caption">
              {day(days[0]!.day)}
            </text>
            <text
              x={WIDTH - PAD.right}
              y={HEIGHT - 4}
              textAnchor="end"
              className="fill-fg-tertiary text-caption"
            >
              {day(last.day)}
            </text>
          </svg>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-caption text-fg-secondary">
            <li className="flex items-center gap-2">
              <svg width="28" height="8" aria-hidden="true">
                <line x1="1" x2="27" y1="4" y2="4" className="stroke-accent [stroke-width:2.5]" />
              </svg>
              {t('money.curve.planned')}
            </li>
            <li className="flex items-center gap-2">
              <svg width="28" height="8" aria-hidden="true">
                <line
                  x1="1"
                  x2="27"
                  y1="4"
                  y2="4"
                  strokeDasharray="6 4"
                  className="stroke-fg [stroke-width:2]"
                />
              </svg>
              {t('money.curve.paid')}
            </li>
          </ul>
          {curve.unscheduled.length > 0 && (
            <p className="text-caption text-fg-secondary">
              {t('money.curve.unscheduled', {
                labels: curve.unscheduled
                  .map((id) => snapshot.costLines.find((line) => line.id === id)?.label ?? id)
                  .join(', '),
              })}
            </p>
          )}
          <table className="w-full border-collapse text-body">
            <caption className="mb-1 text-left text-caption font-semibold text-fg-secondary">
              {t('money.curve.table')}
            </caption>
            <thead>
              <tr className="text-left text-caption text-fg-tertiary">
                <th scope="col" className="py-1 font-semibold">
                  {t('money.curve.week')}
                </th>
                <th scope="col" className="py-1 text-right font-semibold">
                  {t('money.figure.planned')}
                </th>
                <th scope="col" className="py-1 text-right font-semibold">
                  {t('money.figure.paid')}
                </th>
              </tr>
            </thead>
            <tbody>
              {weekly(days).map((row) => (
                <tr
                  key={row.day}
                  data-s-curve-row={row.day}
                  className="border-t border-stroke-subtle"
                >
                  <th scope="row" className="py-1 text-left font-normal text-fg">
                    {day(row.day)}
                  </th>
                  <td className="py-1 text-right tabular-nums text-fg">
                    {money(row.planned, currency)}
                  </td>
                  <td className="py-1 text-right tabular-nums text-fg">
                    {money(row.paid, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
