import { ChevronDown16Regular, ChevronRight16Regular } from '@fluentui/react-icons';
import { useId, useMemo, useState, type ReactNode } from 'react';

import { useDiary } from '@/data/queries';
import {
  delayLedger,
  DELAY_LABEL_KEYS,
  type DelayCauseRow,
  type DelayPartyRow,
  type DelayTraceRow,
} from '@/domain/delay';
import type { WorkSnapshot } from '@/domain/plan';
import type { Schedule } from '@/domain/schedule';
import type { SlipRow } from '@/domain/schedule/slip';
import { slipRowText } from '@/features/reports/compose/words';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';
import { InfoBar } from '@/ui/InfoBar';

import {
  delayCauseText,
  delayDaysValue,
  delayLeftText,
  delayPartyRowText,
  delayResidualText,
  delayStatusText,
  delayTraceText,
} from './delayWords';

/**
 * **Why is it late?** on the front door (slice E3, decision 4): how many working days the work
 * finishes after its baseline as things stand (`delay-total`), and each of those days put down to a
 * cause (`delay-by-cause`) and to whoever the record names (`delay-by-party`) — every line a number
 * that opens onto the days and the changes it was made from, the readiness rules' idiom. What the
 * record does not explain is a line of its own and a sentence (`delay-unexplained`), never hidden;
 * a work on time or ahead says so in words and no cause is made up; before approval the card says
 * it needs an approved plan.
 *
 * Every number is the domain's `delayLedger`, computed here from the plan, its schedule and the
 * diary, every time; the card adds words only.
 */
export function DelayCard({
  snapshot,
  scheduled,
  today,
}: {
  snapshot: WorkSnapshot;
  scheduled: Schedule;
  today: string;
}) {
  const i18n = useI18n();
  const { t, number, describeError } = i18n;
  const term = useTerms();
  const diary = useDiary(true);
  const ledger = useMemo(
    () => (diary.data === undefined ? null : delayLedger(snapshot, scheduled, diary.data, today)),
    [diary.data, snapshot, scheduled, today],
  );

  const body = (): ReactNode => {
    if (diary.isError) {
      return (
        <InfoBar severity="danger" title={t('common.hostSilent')}>
          {describeError(diary.error)}
        </InfoBar>
      );
    }
    if (ledger === null) return <p className="text-body text-fg-secondary">{t('delay.reading')}</p>;
    const figures = ledger.status === 'late' ? ledger.figures : null;
    const left = delayLeftText(i18n, ledger);
    return (
      <div className="flex flex-col gap-3">
        <p data-testid="delay-status" data-status={ledger.status} className="text-body-lg text-fg">
          {delayStatusText(i18n, term, ledger)}
        </p>
        {figures !== null && (
          <>
            <FigureRow<SlipRow>
              testId="delay-total"
              size="title"
              figure={figures.total}
              label={t(DELAY_LABEL_KEYS.total)}
              value={number(figures.total.value)}
              rowsLabel={t('delay.rows.total')}
              renderRow={(row) => (
                <>
                  <span className="font-semibold text-fg">{row.name}</span>
                  <span aria-hidden="true"> — </span>
                  <span>{slipRowText(i18n, row)}</span>
                </>
              )}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <LedgerList<DelayCauseRow>
                testId="delay-by-cause"
                heading={t(DELAY_LABEL_KEYS.byCause)}
                rows={figures.byCause.rows}
                label={(row) => delayCauseText(i18n, row)}
                mark={(row) => ({ 'data-delay-cause': row.cause })}
                rowsLabel={(name) => t('delay.rows.cause', { cause: name })}
                residual={(row) =>
                  row.cause === 'unexplained' || row.cause === 'made-up' ? row.cause : null
                }
                snapshot={snapshot}
              />
              <LedgerList<DelayPartyRow>
                testId="delay-by-party"
                heading={t(DELAY_LABEL_KEYS.byParty)}
                rows={figures.byParty.rows}
                label={(row) => delayPartyRowText(i18n, row)}
                mark={(row) => ({ 'data-delay-party': row.key })}
                rowsLabel={(name) => t('delay.rows.party', { party: name })}
                residual={(row) => row.residual}
                snapshot={snapshot}
              />
            </div>
          </>
        )}
        {left !== null && (
          <p
            data-testid="delay-unexplained"
            data-days={ledger.unexplainedDays > 0 ? ledger.unexplainedDays : -ledger.madeUpDays}
            className="text-body font-semibold text-fg"
          >
            {left}
          </p>
        )}
        {figures !== null && <p className="text-caption text-fg-tertiary">{t('delay.caveat')}</p>}
      </div>
    );
  };

  return (
    <div data-testid="delay-card">
      <Card title={t(DELAY_LABEL_KEYS.title)}>{body()}</Card>
    </div>
  );
}

/**
 * One reading of the ledger — by cause, or by party — as lines: each says what it is and its
 * working days, and opens onto the days and changes it was made from (the readiness rules' idiom,
 * DESIGN_SYSTEM §2: a number can be opened). A residual line — not explained, made up — has no trace
 * by definition, and says so instead.
 */
function LedgerList<Row extends DelayCauseRow | DelayPartyRow>({
  testId,
  heading,
  rows,
  label,
  mark,
  rowsLabel,
  residual,
  snapshot,
}: {
  testId: string;
  heading: string;
  rows: readonly Row[];
  label: (row: Row) => string;
  mark: (row: Row) => Record<string, string>;
  rowsLabel: (name: string) => string;
  residual: (row: Row) => 'unexplained' | 'made-up' | null;
  snapshot: WorkSnapshot;
}) {
  const headingId = useId();
  return (
    <section data-testid={testId} aria-labelledby={headingId} className="flex flex-col gap-1">
      <h3 id={headingId} className="text-body font-semibold text-fg">
        {heading}
      </h3>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <LedgerLine
            key={row.key}
            name={label(row)}
            days={row.days}
            attributes={mark(row)}
            rowsLabel={rowsLabel(label(row))}
            residual={residual(row)}
            trace={row.trace}
            snapshot={snapshot}
          />
        ))}
      </ul>
    </section>
  );
}

function LedgerLine({
  name,
  days,
  attributes,
  rowsLabel,
  residual,
  trace,
  snapshot,
}: {
  name: string;
  days: number;
  attributes: Record<string, string>;
  rowsLabel: string;
  residual: 'unexplained' | 'made-up' | null;
  trace: readonly DelayTraceRow[];
  snapshot: WorkSnapshot;
}) {
  const i18n = useI18n();
  const [open, setOpen] = useState(false);
  const rows = useId();

  return (
    <li {...attributes} data-days={days} className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={rows}
        onClick={() => setOpen((now) => !now)}
        className="flex items-center gap-2 rounded-md px-1 py-1 text-left text-body text-fg transition-colors duration-100 ease-easy hover:bg-card-hover"
      >
        <span aria-hidden="true" className="inline-grid text-fg-tertiary">
          {open ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
        </span>
        <span className={residual === 'unexplained' ? 'font-semibold' : ''}>{name}</span>
        <span aria-hidden="true" className="text-fg-tertiary">
          ·
        </span>
        <span className="font-semibold tabular-nums">{delayDaysValue(i18n, days)}</span>
      </button>
      <div id={rows} hidden={!open} className="ml-7 border-l border-stroke-subtle pl-3">
        {residual !== null ? (
          <p className="text-caption text-fg-secondary">{delayResidualText(i18n, residual)}</p>
        ) : (
          <ul aria-label={rowsLabel} className="flex flex-col gap-0.5">
            {trace.map((row) => (
              <li key={row.key} className="text-body text-fg-secondary">
                {delayTraceText(i18n, snapshot, row)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
