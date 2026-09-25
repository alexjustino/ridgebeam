import { Dismiss20Regular } from '@fluentui/react-icons';

import { finishDate, placeActivities, workingCalendarOf, type WorkSnapshot } from '@/domain/plan';
import {
  readiness,
  readinessFigure,
  READINESS_LABEL_KEY,
  sentenceParts,
  type MissingId,
  type ReadinessRow,
} from '@/domain/readiness';
import type { MessageKey } from '@/i18n/en';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';

import { FigureRow } from './FigureRow';

/** What each kind of missing row lacks, said on the row itself. */
const ROW_KEYS: Record<MissingId, MessageKey> = {
  'activity.duration': 'readiness.row.activity.duration',
  'activity.responsible': 'readiness.row.activity.responsible',
  'plan.activity': 'readiness.row.plan.activity',
};

/**
 * The dashboard: the product's front door, and in F0 exactly three things on it.
 *
 * Readiness — the number the product is built around — big, opening onto what the plan does not
 * know yet, with the sentence that says it in words; the finish date, computed from the plan on
 * the working calendar, or why there is none yet; and the calendar it was counted on. The
 * dashboard grows one figure per slice (SPEC §7); nothing is shown here before its slice makes
 * it true.
 *
 * Every number is computed here from the snapshot by the domain, every time — nothing about
 * readiness is stored — and the figure and the sentence are two readings of the same rows, so
 * they cannot disagree (DESIGN_SYSTEM §2).
 */
export function DashboardPage({
  snapshot,
  onClose,
  closing,
  closeError,
}: {
  snapshot: WorkSnapshot;
  onClose: () => void;
  closing: boolean;
  closeError: string | null;
}) {
  const { t, tp, number } = useI18n();
  const measure = readiness(snapshot);
  const figure = readinessFigure(measure);
  const parts = sentenceParts(measure.missing);
  const sentence =
    parts.length === 0
      ? t('readiness.complete')
      : parts.map((part) => tp(part.key, part.count)).join(' ');

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-fg">{t('nav.dashboard')}</h1>
          <p className="mt-1 text-subtitle text-fg">{snapshot.work.name}</p>
          {snapshot.work.place !== '' && (
            <p className="text-body text-fg-secondary">{snapshot.work.place}</p>
          )}
        </div>
        <Button
          icon={<Dismiss20Regular />}
          data-testid="work-close"
          onClick={onClose}
          disabled={closing}
        >
          {t('shell.workClose')}
        </Button>
      </header>

      {closeError !== null && (
        <InfoBar severity="danger" title={t('common.hostSilent')}>
          {closeError}
        </InfoBar>
      )}

      <Card>
        <FigureRow<ReadinessRow>
          figure={figure}
          label={t(READINESS_LABEL_KEY)}
          value={t('figure.percent', { value: number(figure.value) })}
          rowsLabel={t('figure.rows')}
          renderRow={(row) => (
            <>
              <span className="font-semibold text-fg">{row.title}</span>
              {row.stageName !== null && (
                <>
                  <span aria-hidden="true"> — </span>
                  <span>{row.stageName}</span>
                </>
              )}
              <span aria-hidden="true"> — </span>
              <span>{t(ROW_KEYS[row.ruleId])}</span>
            </>
          )}
        />
        <p data-testid="readiness-sentence" className="mt-3 text-body-lg text-fg">
          {sentence}
        </p>
        <p className="mt-1 text-caption text-fg-tertiary">{t('readiness.description')}</p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <FinishCard snapshot={snapshot} />
        <CalendarCard snapshot={snapshot} />
      </div>
    </div>
  );
}

function FinishCard({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t, tp, day } = useI18n();
  const placement = placeActivities(snapshot);
  const finish = finishDate(placement);
  const reasons = new Set(placement.flatMap((row) => ('unplaced' in row ? [row.unplaced] : [])));
  const leftOut = placement.filter(
    (row) => 'unplaced' in row && row.unplaced === 'no-duration',
  ).length;

  const shown =
    finish !== null
      ? day(finish)
      : reasons.has('invalid-calendar')
        ? t('dashboard.finish.invalidCalendar')
        : reasons.has('invalid-start')
          ? t('dashboard.finish.invalidStart')
          : t('dashboard.finish.unknown');

  return (
    <Card title={t('dashboard.finish.title')}>
      <p
        data-testid="finish-date"
        className={finish !== null ? 'text-subtitle font-semibold text-fg' : 'text-body text-fg'}
      >
        {shown}
      </p>
      {/* A date that leaves activities out says which it left out, in number (§2: a view says
          what it left out). */}
      {finish !== null && leftOut > 0 && (
        <p className="mt-1 text-body text-fg-secondary">
          {tp('dashboard.finish.leftOut', leftOut)}
        </p>
      )}
      <p className="mt-2 text-caption text-fg-tertiary">{t('dashboard.finish.sequential')}</p>
    </Card>
  );
}

function CalendarCard({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t, day, number, workingDays, currency } = useI18n();
  const calendar = workingCalendarOf(snapshot);

  return (
    <Card title={t('dashboard.calendar.title')}>
      {calendar === null ? (
        <p className="text-body text-fg-secondary">{t('dashboard.calendar.unreadable')}</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-body">
          <dt className="text-fg-tertiary">{t('dashboard.calendar.start')}</dt>
          <dd className="text-fg">{day(snapshot.work.startDate)}</dd>
          <dt className="text-fg-tertiary">{t('dashboard.calendar.days')}</dt>
          <dd className="text-fg">{workingDays(calendar.workingDays)}</dd>
          <dt className="text-fg-tertiary">{t('dashboard.calendar.hours')}</dt>
          <dd className="text-fg">{number(calendar.hoursPerDay)}</dd>
          <dt className="text-fg-tertiary">{t('dashboard.calendar.holidays')}</dt>
          <dd className="text-fg">
            {calendar.holidays.size === 0
              ? t('dashboard.calendar.noHolidays')
              : number(calendar.holidays.size)}
          </dd>
          <dt className="text-fg-tertiary">{t('dashboard.currency')}</dt>
          <dd className="text-fg">{currency(snapshot.work.currency)}</dd>
        </dl>
      )}
    </Card>
  );
}
