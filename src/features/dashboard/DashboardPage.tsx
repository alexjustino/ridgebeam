import {
  ChevronDown16Regular,
  ChevronRight16Regular,
  Dismiss20Regular,
} from '@fluentui/react-icons';
import { useId, useMemo, useState } from 'react';

import { useToday } from '@/app/today';
import { decisionRows, decisionsDue, type DecisionDueRow } from '@/domain/decisions';

import { latestBaseline, workingCalendarOf, type WorkSnapshot } from '@/domain/plan';
import {
  readiness,
  readinessByRule,
  readinessFigure,
  RULE_EXPLANATION_KEYS,
  RULE_LABEL_KEYS,
  RULES,
  sentenceParts,
  type MissingId,
  type ReadinessRow,
  type RuleSummary,
} from '@/domain/readiness';
import { schedule, type Schedule } from '@/domain/schedule';
import { useStatusText } from '@/features/decisions/statusText';
import { slip } from '@/domain/schedule/slip';
import { SlipFigure } from '@/features/schedule/SlipFigure';
import type { MessageKey } from '@/i18n/en';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';
import { InfoBar } from '@/ui/InfoBar';

import { SiteCard } from './SiteCard';

/** What each kind of missing row lacks, said on the row itself. */
const ROW_KEYS: Record<MissingId, MessageKey> = {
  'activity.duration': 'readiness.row.activity.duration',
  'activity.responsible': 'readiness.row.activity.responsible',
  'activity.linked': 'readiness.row.activity.linked',
  'decision.deadline': 'readiness.row.decision.deadline',
  'decision.timely': 'readiness.row.decision.timely',
  'plan.activity': 'readiness.row.plan.activity',
};

/** The heading each missing row is listed under: its rule, in rule order; the plan's own row last. */
function ruleGroup(ruleId: MissingId, t: (key: MessageKey) => string) {
  if (ruleId === 'plan.activity') {
    return { id: ruleId, label: t('readiness.rule.plan.activity'), order: RULES.length };
  }
  return {
    id: ruleId,
    label: t(RULE_LABEL_KEYS[ruleId]),
    order: RULES.findIndex((rule) => rule.id === ruleId),
  };
}

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
  const term = useTerms();
  const today = useToday();
  const scheduled = useMemo(() => schedule(snapshot), [snapshot]);
  const measure = readiness(snapshot, { schedule: scheduled, today });
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
          label={term('readiness', { capital: true })}
          value={t('figure.percent', { value: number(figure.value) })}
          rowsLabel={t('figure.rows')}
          groupBy={(row) => ruleGroup(row.ruleId, t)}
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
        <RuleList summaries={readinessByRule(measure)} />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <FinishCard snapshot={snapshot} scheduled={scheduled} />
        <DecisionsDueCard snapshot={snapshot} scheduled={scheduled} today={today} />
        <CalendarCard snapshot={snapshot} />
      </div>

      <SiteCard snapshot={snapshot} today={today} />
    </div>
  );
}

/**
 * The finish date, computed from the durations and the links on the working calendar — and, once
 * the plan is approved, read against the baseline: the baseline's finish, the slip with the same
 * rows the Schedule page shows, and how many activities are on the critical path.
 */
function FinishCard({ snapshot, scheduled }: { snapshot: WorkSnapshot; scheduled: Schedule }) {
  const { t, tp, day } = useI18n();
  const term = useTerms();
  const finish = scheduled.finishDate;
  const reasons = new Set(scheduled.unplaced.map((row) => row.reason));
  const leftOut = scheduled.unplaced.filter((row) => row.reason === 'no-duration').length;
  const baseline = latestBaseline(snapshot);

  const shown =
    finish !== null
      ? day(finish)
      : scheduled.cyclic
        ? t('dashboard.finish.cyclic')
        : reasons.has('invalid-calendar')
          ? t('dashboard.finish.invalidCalendar')
          : reasons.has('invalid-start')
            ? t('dashboard.finish.invalidStart')
            : t('dashboard.finish.unknown');

  return (
    <Card title={term('finishDate', { capital: true })}>
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
      {baseline !== null && (
        <div className="mt-3 flex flex-col gap-2">
          <p data-testid="baseline-finish" className="text-body text-fg-secondary">
            {t('dashboard.baselineFinish', {
              baseline: term('baseline', { capital: true }),
              number: baseline.number,
              day: baseline.finishDate === null ? '—' : day(baseline.finishDate),
            })}
          </p>
          <SlipFigure figure={slip(scheduled, baseline)} size="title" />
        </div>
      )}
      <p data-testid="critical-count" className="mt-3 text-body text-fg">
        {tp('dashboard.critical', scheduled.critical.size, {
          label: term('criticalPath', { capital: true }),
        })}
      </p>
      <p className="mt-2 text-caption text-fg-tertiary">{t('dashboard.finish.scheduled')}</p>
    </Card>
  );
}

function CalendarCard({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t, day, number, workingDays, currency } = useI18n();
  const term = useTerms();
  const calendar = workingCalendarOf(snapshot);

  return (
    <Card title={term('calendar', { capital: true })}>
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

/**
 * Readiness rule by rule (slice F3, ADR-018): each rule a line — "Durations · 4 of 4" — that opens
 * onto the rows it finds missing and the one sentence that says why the plan must know it. The
 * rules add up to the figure above them; a test in the domain holds that.
 */
function RuleList({ summaries }: { summaries: readonly RuleSummary[] }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="readiness-rules" className="mt-4 border-t border-stroke-subtle pt-3">
      <h2 id="readiness-rules" className="mb-2 text-body font-semibold text-fg">
        {t('readiness.rules')}
      </h2>
      <ul data-testid="readiness-rules" className="flex flex-col gap-1">
        {summaries.map((summary) => (
          <RuleLine key={summary.ruleId} summary={summary} />
        ))}
      </ul>
    </section>
  );
}

function RuleLine({ summary }: { summary: RuleSummary }) {
  const { t, number } = useI18n();
  const [open, setOpen] = useState(false);
  const rows = useId();
  const complete = summary.known === summary.mustKnow;

  return (
    <li data-rule-id={summary.ruleId} className="flex flex-col">
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
        <span className={complete ? 'text-fg' : 'font-semibold text-fg'}>
          {t('readiness.rule.line', {
            label: t(RULE_LABEL_KEYS[summary.ruleId]),
            known: number(summary.known),
            mustKnow: number(summary.mustKnow),
          })}
        </span>
      </button>
      <div id={rows} hidden={!open} className="ml-7 border-l border-stroke-subtle pl-3">
        <p className="text-caption text-fg-secondary">{t(RULE_EXPLANATION_KEYS[summary.ruleId])}</p>
        {summary.missing.length === 0 ? (
          <p className="text-caption text-fg-tertiary">{t('readiness.rule.nothing')}</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-0.5">
            {summary.missing.map((row) => (
              <li
                key={`${row.ruleId}:${row.id}`}
                data-rule-row={row.id}
                className="text-body text-fg-secondary"
              >
                <span className="font-semibold text-fg">{row.name}</span>
                {row.stageName !== null && (
                  <>
                    <span aria-hidden="true"> — </span>
                    <span>{row.stageName}</span>
                  </>
                )}
                <span aria-hidden="true"> — </span>
                <span>{t(ROW_KEYS[row.ruleId])}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * Decisions due (slice F3): every open decision that is overdue or due within the next five working
 * days, counted, opening onto those decisions with their deadline and where today stands against
 * it. The deadlines are computed from the schedule; the count is the domain's.
 */
function DecisionsDueCard({
  snapshot,
  scheduled,
  today,
}: {
  snapshot: WorkSnapshot;
  scheduled: Schedule;
  today: string;
}) {
  const { t, tp, day } = useI18n();
  const statusText = useStatusText();
  if (scheduled.calendar === null || snapshot.decisions.length === 0) return null;
  const rows = decisionRows(snapshot, scheduled, today);
  const figure = decisionsDue(rows, scheduled.calendar, today);
  const stageNames = new Map(rows.map((row) => [row.decisionId, row.stageName ?? '']));

  return (
    <Card>
      <FigureRow<DecisionDueRow>
        testId="decisions-due"
        size="title"
        figure={figure}
        label={t('decisions.due.label')}
        value={
          figure.value === 0 ? t('decisions.due.none') : tp('decisions.due.value', figure.value)
        }
        rowsLabel={t('decisions.due.rows')}
        renderRow={(row) => (
          <>
            <span className="font-semibold text-fg">{row.title}</span>
            <span aria-hidden="true"> — </span>
            <span>{stageNames.get(row.decisionId) ?? ''}</span>
            <span aria-hidden="true"> — </span>
            <span>{day(row.deadline)}</span>
            <span aria-hidden="true"> — </span>
            <span>{statusText({ status: row.status, daysLeft: row.daysLeft, madeAt: null })}</span>
          </>
        )}
      />
      <p className="mt-2 text-caption text-fg-tertiary">
        {t('decisions.due.hint', { days: tp('plan.checklist.days', 5) })}
      </p>
    </Card>
  );
}
