import { ErrorCircle16Regular, Warning16Regular } from '@fluentui/react-icons';
import { useId } from 'react';

import type { WorkSnapshot } from '@/domain/plan';
import {
  RUNWAY_LABEL_KEYS,
  type Runway,
  type RunwayChance,
  type RunwayRow,
  type RunwayShortRow,
} from '@/domain/runway';
import { useI18n, type I18n } from '@/i18n/useI18n';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';

import {
  runwayChanceText,
  runwayMethodText,
  runwayNotes,
  runwayRowText,
  runwaySentenceText,
  useRunway,
} from './runwayWords';

/* The drawing's own coordinate system: drawing units, not CSS. */
const WIDTH = 640;
const HEIGHT = 120;
const PAD = { left: 8, right: 8, top: 10, bottom: 18 };

/**
 * **Will the money last?** (slice E2, decision 4): the money that will come in against the money that
 * will go out, week by week from this week to the finish, said first in one sentence — "The money
 * lasts to the end, with $X to spare" or "Money runs short in the week of 16 Nov — $4,200 short" — then
 * the chance, when the schedule has ranges to vary ("3 in 10 chances that the money runs short before
 * the work ends"), then what the sentence leaves out: money expected and late, which is not counted;
 * money with no day yet; cost lines not priced.
 *
 * Every number opens onto its rows: the money on hand, the money at the end (each week's ins and outs,
 * under its week), the week it runs short, the funds that are late. The balance is drawn as one line
 * over the weeks with zero dashed, `role="img"` described by the sentence; the table under it, one row
 * a week, is the reading a screen reader and a careful person use — a week below zero says "short" in
 * words, with an icon, never by colour alone. A projection, not a promise: the card says so.
 */
export function RunwayCard({ snapshot }: { snapshot: WorkSnapshot }) {
  const i18n = useI18n();
  const { t } = i18n;
  const result = useRunway(snapshot);

  return (
    <div data-testid="runway-card">
      <Card title={t('money.runway.title')}>
        {result === null ? (
          <p className="text-body text-fg-tertiary">{t('money.runway.reading')}</p>
        ) : (
          <RunwayBody
            i18n={i18n}
            snapshot={snapshot}
            runway={result.runway}
            chance={result.chance}
          />
        )}
      </Card>
    </div>
  );
}

function RunwayBody({
  i18n,
  snapshot,
  runway,
  chance,
}: {
  i18n: I18n;
  snapshot: WorkSnapshot;
  runway: Runway;
  chance: RunwayChance;
}) {
  const { t, money, day, number } = i18n;
  const ids = useId();
  const currency = snapshot.work.currency;
  const notes = runwayNotes(i18n, runway, currency);
  const method = runwayMethodText(i18n, chance);
  const { end, short, late } = runway.figures;
  // Each row of "Money at the end" under its week: the opening's under "to date".
  const weekOf = new Map<string, { id: string; label: string; order: number }>();
  for (const row of runway.opening.rows) {
    weekOf.set(row.key, { id: 'to-date', label: t('money.runway.toDate'), order: -1 });
  }
  for (const week of runway.weeks) {
    for (const row of week.rows) {
      weekOf.set(row.key, {
        id: week.from,
        label: t('money.runway.weekOf', { day: day(week.from) }),
        order: week.index,
      });
    }
  }
  const renderRow = (row: RunwayRow) => {
    const parts = runwayRowText(i18n, row, snapshot);
    return (
      <>
        <span className="font-semibold text-fg">{parts.title}</span>
        <span aria-hidden="true"> — </span>
        <span>{parts.kind}</span>
        <span aria-hidden="true"> — </span>
        <span>{parts.when}</span>
        <span aria-hidden="true"> — </span>
        <span className="tabular-nums">{money(row.amountCents, currency)}</span>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p
        id={`${ids}-sentence`}
        data-testid="runway-sentence"
        data-state={runway.state}
        className="flex items-start gap-2 text-body-lg font-semibold text-fg"
      >
        {runway.state === 'short' && (
          <ErrorCircle16Regular aria-hidden="true" className="mt-1 shrink-0 text-danger" />
        )}
        <span>{runwaySentenceText(i18n, runway.sentence, currency)}</span>
      </p>
      <p
        data-testid="runway-chance"
        data-chance={chance.ok && chance.kind === 'chance' ? chance.frequency.n : undefined}
        className="text-body text-fg"
      >
        {runwayChanceText(i18n, chance)}
        {method !== null && <span className="block text-caption text-fg-tertiary">{method}</span>}
      </p>
      {notes.length > 0 && (
        <ul data-testid="runway-notes" className="flex flex-col gap-0.5">
          {notes.map((note, index) => (
            <li key={index} className="flex items-start gap-1 text-body text-fg-secondary">
              {index === 0 && runway.figures.late.value > 0 && (
                <Warning16Regular aria-hidden="true" className="mt-0.5 shrink-0 text-caution" />
              )}
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <FigureRow<RunwayRow>
          testId="runway-opening"
          size="title"
          figure={runway.opening}
          label={t(RUNWAY_LABEL_KEYS.opening)}
          value={money(runway.opening.value, currency)}
          rowsLabel={t('money.runway.rows')}
          renderRow={renderRow}
        />
        {runway.shortWeek === null ? (
          <FigureRow<RunwayRow>
            testId="runway-end"
            size="title"
            figure={end}
            label={t(RUNWAY_LABEL_KEYS.end)}
            value={money(end.value, currency)}
            rowsLabel={t('money.runway.rows')}
            groupBy={(row) => weekOf.get(row.key) ?? { id: 'other', label: '', order: 1e6 }}
            renderRow={renderRow}
          />
        ) : (
          <FigureRow<RunwayShortRow>
            testId="runway-short"
            size="title"
            figure={short}
            label={t(RUNWAY_LABEL_KEYS.short)}
            value={day(runway.shortWeek.from)}
            rowsLabel={t('money.runway.rows')}
            renderRow={(row) => (
              <>
                <span className="font-semibold text-fg">
                  {t('money.runway.weekRange', { from: day(row.from), to: day(row.to) })}
                </span>
                <span aria-hidden="true"> — </span>
                <span>
                  {t('money.runway.shortBy', { amount: money(row.shortByCents, currency) })}
                </span>
              </>
            )}
          />
        )}
        {late.value > 0 && (
          <FigureRow<RunwayRow>
            testId="runway-late"
            size="title"
            figure={late}
            label={t(RUNWAY_LABEL_KEYS.late)}
            value={number(late.value)}
            rowsLabel={t('money.runway.rows')}
            renderRow={renderRow}
          />
        )}
      </div>

      {runway.weeks.length > 1 && (
        <BalanceDrawing i18n={i18n} runway={runway} describedBy={`${ids}-sentence`} />
      )}

      <div
        tabIndex={0}
        aria-label={t('money.runway.table')}
        className="max-h-80 overflow-y-auto rounded-md"
      >
        <table className="w-full border-collapse text-body">
          <caption className="mb-1 text-left text-caption font-semibold text-fg-secondary">
            {t('money.runway.table')}
          </caption>
          <thead>
            <tr className="text-left text-caption text-fg-tertiary">
              <th scope="col" className="py-1 font-semibold">
                {t('money.runway.week')}
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                {t('money.runway.in')}
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                {t('money.runway.out')}
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                {t('money.runway.closing')}
              </th>
            </tr>
          </thead>
          <tbody>
            {runway.weeks.map((week) => (
              <tr
                key={week.from}
                data-testid="runway-week"
                data-week={week.from}
                data-short={week.short ? '' : undefined}
                className="border-t border-stroke-subtle"
              >
                <th scope="row" className="py-1 text-left font-normal text-fg">
                  {day(week.from)}
                </th>
                <td className="py-1 text-right tabular-nums text-fg">{money(week.in, currency)}</td>
                <td className="py-1 text-right tabular-nums text-fg">
                  {money(week.out, currency)}
                </td>
                <td
                  className={`py-1 text-right tabular-nums ${week.short ? 'font-semibold text-fg' : 'text-fg'}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {week.short && (
                      <ErrorCircle16Regular aria-hidden="true" className="text-danger" />
                    )}
                    {/* A short week says its shortfall once — "$700.00 short", never "-$700.00 short". */}
                    {week.short
                      ? t('money.runway.shortBy', { amount: money(-week.closing, currency) })
                      : money(week.closing, currency)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-fg-tertiary">{t('money.runway.caveat')}</p>
    </div>
  );
}

/**
 * The balance at the end of each week as one line, zero dashed under it, a week below zero marked by
 * a square on the line as well as by the danger colour — the sentence says it in words.
 */
function BalanceDrawing({
  i18n,
  runway,
  describedBy,
}: {
  i18n: I18n;
  runway: Runway;
  describedBy: string;
}) {
  const { t, day } = i18n;
  const weeks = runway.weeks;
  const values = weeks.map((week) => week.closing);
  const top = Math.max(0, ...values, 1);
  const bottom = Math.min(0, ...values);
  const x = (index: number) =>
    PAD.left + (index / Math.max(1, weeks.length - 1)) * (WIDTH - PAD.left - PAD.right);
  const y = (cents: number) =>
    PAD.top + ((top - cents) / (top - bottom)) * (HEIGHT - PAD.top - PAD.bottom);
  const path = weeks
    .map((week, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(week.closing)}`)
    .join(' ');

  return (
    <div className="flex flex-col gap-1">
      <svg
        data-testid="runway-drawing"
        role="img"
        aria-label={t('money.runway.drawing')}
        aria-describedby={describedBy}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full rounded-md border border-stroke-subtle bg-card"
      >
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(0)}
          y2={y(0)}
          strokeDasharray="4 4"
          className="stroke-fg-tertiary"
        />
        <path d={path} fill="none" className="stroke-accent [stroke-width:2.5]" />
        {weeks.map((week, index) =>
          week.short ? (
            <rect
              key={week.from}
              x={x(index) - 3}
              y={y(week.closing) - 3}
              width={6}
              height={6}
              className="fill-danger"
            />
          ) : null,
        )}
        <text x={PAD.left} y={HEIGHT - 4} className="fill-fg-tertiary text-caption">
          {day(weeks[0]!.from)}
        </text>
        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 4}
          textAnchor="end"
          className="fill-fg-tertiary text-caption"
        >
          {day(weeks.at(-1)!.from)}
        </text>
      </svg>
      <p className="text-caption text-fg-secondary">{t('money.runway.legend')}</p>
    </div>
  );
}
