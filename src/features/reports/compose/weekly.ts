/**
 * The weekly report, as a document: the domain's selection of the week (`reports/weekly.ts`) turned
 * into blocks, in the language on screen and **always in the owner's words** — whatever lens the
 * person is reading in, the report is for the owner, so its nouns come from the owner's vocabulary
 * table (`termsFor(language, 'owner')`) and never from the lens on screen (decision 4).
 *
 * The stages are the dashboard's five figures, in its order: planned, ready, started, closed, held.
 *
 * **When will it really finish?** (D1) is printed after the finish and the slip, from the same
 * seeded simulation the Schedule shows (`probability`, computed by the caller with the diary): the
 * headline in natural frequencies, with the drivers and how many activities were counted as certain
 * as its rows — what the screen's figure opens onto — and then the plan's and the baseline's chances
 * and how it was computed. Never percentages: it is the owner's report.
 *
 * Every number is printed as a figure with the rows it was counted from listed under it: a report
 * carries its rows too. A week with no entry says so on its **first line**, in strong type, and
 * everything else is still printed (SPEC R2).
 *
 * Pure: the selection, the plan and an `I18n` in; a `ReportDocument` out. No clock, no host.
 */

import type { ReportBlock, ReportDocument } from '@/data/commands';
import { GATES_HELD_LABEL_KEY, STAGES_LABEL_KEYS, STAGES_READY_LABEL_KEY } from '@/domain/checks';
import { DASHBOARD_LABEL_KEYS, WEEK_DAY_STATUS_KEYS, type WeekDay } from '@/domain/dashboard';
import type { Figure, ReportRow } from '@/domain/figure';
import type { MoneyRow } from '@/domain/money';
import { NOT_PRICED_KEY } from '@/domain/money';
import type { WorkSnapshot } from '@/domain/plan';
import type { Schedule } from '@/domain/schedule';
import {
  PROBABILITY_MESSAGE_KEYS,
  type FinishProbabilityResult,
} from '@/domain/schedule/probability';
import {
  WEEKLY_DECISION_WINDOW_DAYS,
  WEEKLY_LABEL_KEYS,
  type WeekActivityRow,
  type Weekly,
} from '@/domain/reports/weekly';
import type { MessageKey } from '@/i18n/en';
import { termsFor } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

import { finished, shortened } from './document';
import {
  baselineChanceText,
  criticalText,
  daysText,
  decisionStatusText,
  driverRangeText,
  finishText,
  headlineText,
  planChanceText,
  readinessRowText,
  slipRowText,
  WEATHER_KEYS,
} from './words';

/** How much of a note a row of the week's entries shows: the diary export has it whole. */
const NOTE_IN_ROW = 160;

/** The words of one row of a figure: parts joined the way the screen joins them. */
function row(...parts: ReadonlyArray<string | null | undefined | false>): string {
  return (
    parts
      .filter((part): part is string => typeof part === 'string' && part !== '')
      // A stage's own row names the stage twice (its name, then the stage it belongs to).
      .filter((part, index, all) => index === 0 || part !== all[index - 1])
      .join(' — ')
  );
}

function figure(label: string, value: string, rows: readonly string[]): ReportBlock {
  return { type: 'figure', label, value, rows: [...rows] };
}

/** The week of a day as the report and the card both say it. */
export function weekText(i18n: Pick<I18n, 't' | 'day'>, from: string, to: string): string {
  return i18n.t('reports.weekly.week', { from: i18n.day(from), to: i18n.day(to) });
}

/** What the diary says of one day of the week, in words. */
function dayText(i18n: I18n, day: WeekDay): string {
  const parts: string[] = [i18n.t(WEEK_DAY_STATUS_KEYS[day.status] as MessageKey)];
  if (day.seqs.length > 0) parts.push(i18n.tp('reports.entries', day.seqs.length));
  if (day.weather.length > 0) {
    parts.push(day.weather.map((weather) => i18n.t(WEATHER_KEYS[weather])).join(', '));
  }
  if (day.lostDay) parts.push(i18n.t('diary.entry.lostDay'));
  if (day.holiday) parts.push(i18n.t('reports.weekly.holiday'));
  return parts.join(' · ');
}

function activityRow(i18n: I18n, activity: WeekActivityRow): string {
  const name = [activity.number, activity.title].filter((part) => part !== null).join(' ');
  const quantity =
    activity.quantity === null
      ? null
      : [i18n.number(activity.quantity), activity.unit ?? ''].join(' ').trim();
  return row(
    name,
    activity.stageName,
    activity.days.map((day) => i18n.day(day)).join(', '),
    quantity,
  );
}

function moneyRows(i18n: I18n, figureOf: Figure<MoneyRow>, currency: string): string[] {
  return figureOf.rows.map((each) =>
    row(
      each.label,
      each.day === null ? null : i18n.day(each.day),
      each.priced ? i18n.money(each.amountCents, currency) : i18n.t(NOT_PRICED_KEY as MessageKey),
    ),
  );
}

function stageRows(i18n: I18n, figureOf: Figure<ReportRow>): string[] {
  return figureOf.rows.map((each) =>
    row(each.title, each.day === null ? null : i18n.day(each.day.slice(0, 10))),
  );
}

/** The finish as a probability, as the page prints it: one figure, then what it rests on. */
function probabilityBlocks(i18n: I18n, probability: FinishProbabilityResult): ReportBlock[] {
  const { t, number, day } = i18n;
  const label = t(PROBABILITY_MESSAGE_KEYS.title);
  if (!probability.ok) {
    return [figure(label, t(probability.messageKey as MessageKey), [])];
  }
  if (probability.allCertain) {
    return [figure(label, day(probability.p80), [t(PROBABILITY_MESSAGE_KEYS.allCertain)])];
  }
  const { counts } = probability;
  const often = new Map(probability.criticality.map((each) => [each.activityId, each.frequency]));
  const rows = [
    ...probability.drivers.map((driver) => {
      const frequency = often.get(driver.activityId);
      return row(
        driver.name,
        driverRangeText(i18n, driver),
        frequency === undefined ? null : criticalText(i18n, frequency),
      );
    }),
    ...(counts.certain > 0
      ? [
          t(PROBABILITY_MESSAGE_KEYS.certainCount, {
            certain: number(counts.certain),
            total: number(counts.total),
          }),
        ]
      : []),
    ...(counts.unplaced > 0
      ? [t(PROBABILITY_MESSAGE_KEYS.unplacedCount, { unplaced: number(counts.unplaced) })]
      : []),
  ];
  const facts = [
    probability.plan === null ? null : planChanceText(i18n, probability.plan),
    probability.baseline === null ? null : baselineChanceText(i18n, probability.baseline),
    t(PROBABILITY_MESSAGE_KEYS.method, { runs: number(probability.runs) }),
    t(PROBABILITY_MESSAGE_KEYS.leftOut),
  ].filter((each): each is string => each !== null);
  return [
    figure(label, headlineText(i18n, probability.headline), rows),
    { type: 'paragraph', tone: 'muted', text: facts.join(' ') },
  ];
}

/**
 * The weekly report for the selection `weekly`, in `i18n`'s language and the owner's words.
 * `scheduled` is the schedule the selection was made from, for why a finish is not known;
 * `probability` is `finishProbability` over the same plan, schedule and diary (D1).
 */
export function composeWeekly(
  weekly: Weekly,
  snapshot: WorkSnapshot,
  scheduled: Pick<Schedule, 'finishDate' | 'cyclic' | 'unplaced'>,
  i18n: I18n,
  probability: FinishProbabilityResult,
): ReportDocument {
  const { t, tp, day, number, money } = i18n;
  const term = termsFor(i18n.language, 'owner');
  const currency = snapshot.work.currency;
  const title = term('report', { capital: true });
  const blocks: ReportBlock[] = [];

  // R2: an empty week says so first, before anything else on the page.
  if (weekly.empty) {
    const missing = weekly.daysWithoutEntry.value;
    blocks.push({
      type: 'paragraph',
      tone: 'strong',
      text: missing === 0 ? t('reports.weekly.emptyYet') : tp('reports.weekly.empty', missing),
    });
  }

  // The host prints the title and the subtitle (the work and the week) at the top of the page;
  // the document does not say them again.
  if (snapshot.work.place !== '') {
    blocks.push({ type: 'paragraph', tone: 'strong', text: snapshot.work.place });
  }
  blocks.push({
    type: 'paragraph',
    tone: 'muted',
    text: t('reports.weekly.asOf', { today: day(weekly.today) }),
  });

  // ── The site ──
  blocks.push({ type: 'heading', level: 2, text: t('reports.weekly.site') });
  blocks.push({
    type: 'table',
    columns: [
      { text: t('reports.weekly.days.day'), align: 'left', width: 0.4 },
      { text: t('reports.weekly.days.diary'), align: 'left', width: 0.6 },
    ],
    rows: weekly.days.map((each) => [day(each.day), dayText(i18n, each)]),
  });
  blocks.push(
    figure(
      t(DASHBOARD_LABEL_KEYS.weekEntries),
      tp('reports.entries', weekly.entries.value),
      weekly.entries.rows.map((entry) =>
        row(
          t('reports.entryRow', { seq: entry.seq, day: day(entry.day ?? '') }),
          entry.title === '' ? null : shortened(entry.title, NOTE_IN_ROW),
        ),
      ),
    ),
  );
  blocks.push(
    figure(
      t(DASHBOARD_LABEL_KEYS.weekDaysWithoutEntry),
      number(weekly.daysWithoutEntry.value),
      weekly.daysWithoutEntry.rows.map((each) => day(each.day ?? '')),
    ),
  );
  if (!weekly.calendarKnown) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.weekly.calendarUnknown') });
  }
  blocks.push(
    figure(
      t(WEEKLY_LABEL_KEYS.worked),
      number(weekly.worked.value),
      weekly.worked.rows.map((each) => activityRow(i18n, each)),
    ),
  );
  blocks.push(
    figure(
      t(WEEKLY_LABEL_KEYS.finished),
      number(weekly.finished.value),
      weekly.finished.rows.map((each) => activityRow(i18n, each)),
    ),
  );
  blocks.push(
    figure(
      t(DASHBOARD_LABEL_KEYS.onSite),
      number(weekly.onSite.value),
      weekly.onSite.rows.map((person) =>
        row(
          person.known ? person.title : t('reports.diary.unknownPerson'),
          person.trade,
          person.days.map((each) => day(each)).join(', '),
        ),
      ),
    ),
  );
  blocks.push(
    figure(
      t(DASHBOARD_LABEL_KEYS.weatherLost),
      number(weekly.weatherLost.value),
      weekly.weatherLost.rows.map((each) => row(day(each.day), t(WEATHER_KEYS[each.weather]))),
    ),
  );

  // ── The plan, in the owner's words ──
  blocks.push({ type: 'heading', level: 2, text: term('plan', { capital: true }) });
  const rest = weekly.readiness.rows.length - weekly.lacks.length;
  blocks.push(
    figure(
      term('readiness', { capital: true }),
      t('figure.percent', { value: number(weekly.readiness.value) }),
      [
        ...weekly.lacks.map((lack) =>
          row(lack.title, lack.stageName, readinessRowText(i18n, lack)),
        ),
        ...(rest > 0 ? [tp('reports.weekly.lacksMore', rest)] : []),
      ],
    ),
  );
  const finish = weekly.finish;
  blocks.push(
    figure(term('finishDate', { capital: true }), finishText(i18n, scheduled), [
      finish.baseline === null
        ? t('reports.weekly.noBaseline', { baseline: term('baseline') })
        : t('dashboard.baselineFinish', {
            baseline: term('baseline', { capital: true }),
            number: finish.baseline.number,
            day: finish.baseline.finishDate === null ? '—' : day(finish.baseline.finishDate),
          }),
    ]),
  );
  if (finish.slip !== null) {
    blocks.push(
      figure(
        term('slip', { capital: true }),
        daysText(i18n, finish.slip.value),
        finish.slip.rows.map((each) => row(each.name, slipRowText(i18n, each))),
      ),
    );
  }
  blocks.push(...probabilityBlocks(i18n, probability));
  blocks.push(
    figure(
      t(WEEKLY_LABEL_KEYS.decisions, { days: number(WEEKLY_DECISION_WINDOW_DAYS) }),
      number(weekly.decisions.value),
      weekly.decisions.rows.map((decision) =>
        row(
          decision.title,
          decision.stageName,
          day(decision.deadline),
          decisionStatusText(i18n, { ...decision, madeAt: null }),
        ),
      ),
    ),
  );

  // ── Money ──
  blocks.push({ type: 'heading', level: 2, text: t('nav.money') });
  for (const name of ['planned', 'committed', 'paid'] as const) {
    const each = weekly.money[name];
    blocks.push(
      figure(
        term(name, { capital: true }),
        money(each.value, currency),
        moneyRows(i18n, each, currency),
      ),
    );
  }
  blocks.push(
    figure(
      t(WEEKLY_LABEL_KEYS.paidThisWeek),
      money(weekly.money.paidThisWeek.value, currency),
      moneyRows(i18n, weekly.money.paidThisWeek, currency),
    ),
  );

  // ── Stages ──
  blocks.push({ type: 'heading', level: 2, text: t('reports.weekly.stages') });
  const stages = weekly.stages;
  blocks.push(
    figure(
      t(STAGES_LABEL_KEYS.planned),
      number(stages.planned.value),
      stageRows(i18n, stages.planned),
    ),
  );
  blocks.push(
    figure(
      t(STAGES_READY_LABEL_KEY as MessageKey),
      number(stages.ready.value),
      stageRows(i18n, stages.ready),
    ),
  );
  blocks.push(
    figure(
      t(STAGES_LABEL_KEYS.started),
      number(stages.started.value),
      stageRows(i18n, stages.started),
    ),
  );
  blocks.push(
    figure(
      t(STAGES_LABEL_KEYS.closed),
      number(stages.closed.value),
      stageRows(i18n, stages.closed),
    ),
  );

  blocks.push(
    figure(
      t(GATES_HELD_LABEL_KEY),
      number(stages.held.value),
      stages.held.rows.map((held) =>
        row(
          held.title,
          term(held.gate === 'start' ? 'startGate' : 'closeGate'),
          held.holding.map((item) => item.check.name).join('; '),
        ),
      ),
    ),
  );
  blocks.push({ type: 'rule' });
  blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.weekly.note') });

  return finished({
    kind: 'weekly',
    title,
    subtitle: t('reports.weekly.subtitle', {
      work: snapshot.work.name,
      from: day(weekly.week.from),
      to: day(weekly.week.to),
    }),
    pageSize: 'a4',
    language: i18n.language,
    blocks,
  });
}
