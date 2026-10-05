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
import { MILESTONE_LABEL_KEYS, type PlanRow } from '@/domain/milestones';
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
import { CHANGE_LABEL_KEYS, changeTally, type ChangeTally } from '@/domain/changes';
import { RUNWAY_LABEL_KEYS, type Runway, type RunwayChance } from '@/domain/runway';
import { DELAY_LABEL_KEYS, type DelayLedger } from '@/domain/delay';
import { SNAG_LABEL_KEYS, snagFigures, snagRows, type SnagRow } from '@/domain/snags';
import { PURCHASE_LABEL_KEYS, type PurchaseFigures, type PurchaseRow } from '@/domain/purchases';
import {
  delayCauseText,
  delayLeftText,
  delayPartyRowText,
  delayResidualText,
  delayStatusText,
  delayTraceText,
} from '@/features/dashboard/delayWords';
import {
  forecastAssumesText,
  forecastPlanText,
  forecastSentence,
} from '@/features/schedule/forecastWords';
import { pendingText, percentText } from '@/features/money/paymentPlanWords';
import {
  runwayChanceText,
  runwayMethodText,
  runwayNotes,
  runwayRowLine,
  runwaySentenceText,
  runwayValue,
} from '@/features/money/runwayWords';
import {
  askedByText,
  changeCostText,
  signedDays,
  changeRowTitle,
  changeStateText,
  decidedImpactSentence,
  finishMoveText,
  tallySentence,
  waitedText,
} from '@/features/plan/changeWords';
import {
  snagClosureText,
  snagDueText,
  snagGroupLabel,
  snagRowTitle,
  snagSentence,
  snagWhereText,
  snagWhoText,
} from '@/features/plan/snagWords';
import { purchaseRowLine, purchaseSentence } from '@/features/plan/purchaseWords';
import type { MessageKey } from '@/i18n/en';
import { termsFor } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

import { finished, REPORT_LIMITS, shortened } from './document';
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

/** A row that may carry names typed by a person, kept inside the host's string limit. */
function line(...parts: ReadonlyArray<string | null | undefined | false>): string {
  return shortened(row(...parts), REPORT_LIMITS.text);
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

/**
 * A payment-plan figure's rows (D2): each commitment, its stage, the mark in words with its amount,
 * and the milestone it waits for — what the dashboard's figure opens onto.
 */
function planRows(
  i18n: I18n,
  figureOf: Figure<PlanRow>,
  snapshot: WorkSnapshot,
  mark: 'money.paymentPlan.paidAhead.mark' | 'money.paymentPlan.dueNow.mark',
): string[] {
  const stages = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  const currency = snapshot.work.currency;
  return figureOf.rows.map((each) =>
    row(
      each.title,
      stages.get(each.stageId),
      i18n.t(mark, { amount: i18n.money(each.amountCents, currency) }),
      each.next === null
        ? null
        : `${each.next.label} (${percentText(i18n, each.next.shareBp)}): ${pendingText(i18n, each.next)}`,
    ),
  );
}

function stageRows(i18n: I18n, figureOf: Figure<ReportRow>): string[] {
  return figureOf.rows.map((each) =>
    row(each.title, each.day === null ? null : i18n.day(each.day.slice(0, 10))),
  );
}

/**
 * The week's change orders (E1), in the owner's words: the ones decided this week, each with how it
 * was decided and the impact its decision froze; the ones still waiting, each with how long it has
 * waited; then the standing tally — the approved changes' money and working days, each a figure with
 * its changes as rows — and the tally in words, with who asked. The owner's snapshot prints the same
 * waiting figure and tally (`changeTallyBlocks`).
 */
function weeklyChangeBlocks(weekly: Weekly, snapshot: WorkSnapshot, i18n: I18n): ReportBlock[] {
  const { t, number } = i18n;
  const currency = snapshot.work.currency;
  const tally = changeTally(snapshot, weekly.today);
  const decided = snapshot.changeOrders
    .filter(
      (change) =>
        change.decision !== null &&
        change.decision.decidedOn >= weekly.week.from &&
        change.decision.decidedOn <= weekly.week.to,
    )
    .sort((a, b) => a.number - b.number);
  return [
    { type: 'heading', level: 2, text: t('reports.weekly.changes') },
    figure(
      t('reports.weekly.changes.decided'),
      number(decided.length),
      decided.map((change) =>
        line(
          changeRowTitle(i18n, change),
          askedByText(i18n, snapshot, change, true),
          changeStateText(i18n, change),
          decidedImpactSentence(i18n, change, currency),
        ),
      ),
    ),
    ...changeTallyBlocks(i18n, snapshot, tally, t(CHANGE_LABEL_KEYS.waiting)),
  ];
}

/**
 * The waiting change orders and the standing tally, as both owner's documents print them: "Waiting
 * for a decision" (or the snapshot's "Waiting for your decision") with each change, who asked and how
 * long it has waited; the approved changes' money and working days, each change a row; and the tally
 * in one sentence, with who asked.
 */
export function changeTallyBlocks(
  i18n: I18n,
  snapshot: WorkSnapshot,
  tally: ChangeTally,
  waitingLabel: string,
): ReportBlock[] {
  const { t, number, money, day } = i18n;
  const currency = snapshot.work.currency;
  const byId = new Map(snapshot.changeOrders.map((change) => [change.id, change]));
  const { cost, days, waiting } = tally.figures;
  return [
    figure(
      waitingLabel,
      number(waiting.value),
      waiting.rows.map((each) => {
        const change = byId.get(each.changeOrderId);
        return line(
          changeRowTitle(i18n, each),
          change === undefined ? null : askedByText(i18n, snapshot, change, true),
          waitedText(i18n, each.waitedDays, each.tooLong),
          change === undefined ? null : changeCostText(i18n, change.costCents, currency),
        );
      }),
    ),
    figure(
      t(CHANGE_LABEL_KEYS.cost),
      money(cost.value, currency),
      cost.rows.map((each) =>
        line(
          changeRowTitle(i18n, each),
          each.day === null ? null : day(each.day),
          each.priced ? money(each.amountCents, currency) : t('changes.row.unpriced'),
        ),
      ),
    ),
    figure(
      t(CHANGE_LABEL_KEYS.days),
      signedDays(i18n, days.value),
      days.rows.map((each) =>
        line(changeRowTitle(i18n, each), finishMoveText(i18n, { ...each, days: each.daysDelta })),
      ),
    ),
    {
      type: 'paragraph',
      text: shortened(tallySentence(i18n, tally, currency, true), REPORT_LIMITS.text),
    },
  ];
}

/**
 * **Still to fix** (E4), as both owner's documents print it, in the owner's words: what is still
 * open and on whom in one sentence, then the open snags and those past their day — each a figure with
 * its snags as rows, who must fix each and its day — and the open ones by who must fix them. Printed
 * once a snag has been raised; a work that never found one has nothing to say here, as the
 * dashboard's card has not. `closedThisWeek` adds, for the weekly report, the snags closed in its week.
 */
export function snagBlocks(
  i18n: I18n,
  snapshot: WorkSnapshot,
  today: string,
  level: 1 | 2,
  closedThisWeek: { readonly from: string; readonly to: string } | null = null,
): ReportBlock[] {
  const { t, number } = i18n;
  const figures = snagFigures(snapshot, today);
  if (figures.raised === 0) return [];
  const term = termsFor(i18n.language, 'owner');
  const openRow = (each: SnagRow) =>
    line(
      snagRowTitle(i18n, each),
      snagWhereText(i18n, term, each),
      snagWhoText(i18n, each),
      snagDueText(i18n, each),
    );
  const blocks: ReportBlock[] = [
    { type: 'heading', level, text: t('dashboard.snags.title') },
    {
      type: 'paragraph',
      tone: 'strong',
      text: shortened(snagSentence(i18n, figures), REPORT_LIMITS.text),
    },
    figure(t(SNAG_LABEL_KEYS.open), number(figures.open.value), figures.open.rows.map(openRow)),
    figure(
      t(SNAG_LABEL_KEYS.overdue),
      number(figures.overdue.value),
      figures.overdue.rows.map(openRow),
    ),
    ...figures.byPerson.map((group) =>
      figure(
        snagGroupLabel(i18n, group),
        number(group.open.value),
        group.open.rows.map((each) => line(snagRowTitle(i18n, each), snagDueText(i18n, each))),
      ),
    ),
  ];
  if (closedThisWeek !== null) {
    const closed = snagRows(snapshot, today).filter(
      (each) =>
        each.closedOn !== null &&
        each.closedOn >= closedThisWeek.from &&
        each.closedOn <= closedThisWeek.to,
    );
    const byId = new Map(snapshot.snags.map((snag) => [snag.id, snag]));
    blocks.push(
      figure(
        t('reports.weekly.snags.closed'),
        number(closed.length),
        closed.map((each) =>
          line(
            snagRowTitle(i18n, each),
            snagWhoText(i18n, each),
            snagClosureText(i18n, each, byId.get(each.snagId)),
            each.state === 'withdrawn' ? each.note : null,
          ),
        ),
      ),
    );
  }
  return blocks;
}

/**
 * **To order this week** (G2), as both owner's documents print it, in the owner's words: what to
 * order and what is late in one sentence, then four figures with their purchases as rows — to order
 * this week, late to order, ordered and late to arrive, arriving after it is needed — each row with
 * what needs it and the day to order by or the day expected. Printed once the work has a purchase; a
 * work that buys nothing with a lead time has nothing to say here, as the dashboard's card has not.
 */
export function purchaseBlocks(i18n: I18n, figures: PurchaseFigures, level: 1 | 2): ReportBlock[] {
  if (figures.total === 0) return [];
  const { t, number } = i18n;
  const term = termsFor(i18n.language, 'owner');
  const rows = (each: { readonly rows: readonly PurchaseRow[] }) =>
    each.rows.map((purchase) => line(purchaseRowLine(i18n, term, purchase)));
  return [
    { type: 'heading', level, text: t('dashboard.purchases.title') },
    {
      type: 'paragraph',
      tone: 'strong',
      text: shortened(purchaseSentence(i18n, figures), REPORT_LIMITS.text),
    },
    figure(
      t(PURCHASE_LABEL_KEYS.toOrderThisWeek),
      number(figures.toOrderThisWeek.value),
      rows(figures.toOrderThisWeek),
    ),
    figure(
      t(PURCHASE_LABEL_KEYS.lateToOrder),
      number(figures.lateToOrder.value),
      rows(figures.lateToOrder),
    ),
    figure(
      t(PURCHASE_LABEL_KEYS.lateToArrive),
      number(figures.lateToArrive.value),
      rows(figures.lateToArrive),
    ),
    figure(
      t(PURCHASE_LABEL_KEYS.arrivesAfterNeeded),
      number(figures.arrivesAfterNeeded.value),
      rows(figures.arrivesAfterNeeded),
    ),
  ];
}

/** The runway and its chance, as the Money page computes them from the same three inputs. */
export interface Cash {
  readonly runway: Runway;
  readonly chance: RunwayChance;
}

/**
 * **Will the money last?** (E2), as both owner's documents print it: the heading, the sentence and
 * the chance in natural frequencies (never a percentage: they are the owner's), then one figure — the
 * week the money runs short, opening onto what comes in and goes out that week, or the money left at
 * the end — and, when any, the money expected and late, which is not counted; then what the sentence
 * leaves out and how the chance was computed.
 */
export function runwayBlocks(
  i18n: I18n,
  snapshot: WorkSnapshot,
  cash: Cash,
  level: 1 | 2,
): ReportBlock[] {
  const { t, number } = i18n;
  const { runway, chance } = cash;
  const currency = snapshot.work.currency;
  const blocks: ReportBlock[] = [
    { type: 'heading', level, text: t('money.runway.title') },
    {
      type: 'paragraph',
      tone: 'strong',
      text: shortened(runwaySentenceText(i18n, runway.sentence, currency), REPORT_LIMITS.text),
    },
    {
      type: 'paragraph',
      text: shortened(runwayChanceText(i18n, chance), REPORT_LIMITS.text),
    },
  ];
  if (runway.state !== 'nothing') {
    const shortWeek = runway.shortWeek;
    blocks.push(
      figure(
        t(shortWeek === null ? RUNWAY_LABEL_KEYS.end : RUNWAY_LABEL_KEYS.short),
        runwayValue(i18n, runway, currency),
        shortWeek === null
          ? []
          : [
              line(
                t('money.runway.weekRange', {
                  from: i18n.day(shortWeek.from),
                  to: i18n.day(shortWeek.to),
                }),
                t('money.runway.shortBy', { amount: i18n.money(runway.shortBy ?? 0, currency) }),
              ),
              ...shortWeek.rows.map((each) =>
                shortened(runwayRowLine(i18n, each, snapshot, currency), REPORT_LIMITS.text),
              ),
            ],
      ),
    );
  }
  const late = runway.figures.late;
  if (late.value > 0) {
    blocks.push(
      figure(
        t(RUNWAY_LABEL_KEYS.late),
        number(late.value),
        late.rows.map((each) =>
          shortened(runwayRowLine(i18n, each, snapshot, currency), REPORT_LIMITS.text),
        ),
      ),
    );
  }
  // E4: retention held while snags are open — the money the owner is holding, never in a week.
  const held = runway.figures.held;
  if (held.rows.length > 0) {
    blocks.push(
      figure(
        t(RUNWAY_LABEL_KEYS.held),
        i18n.money(held.value, currency),
        held.rows.map((each) =>
          shortened(runwayRowLine(i18n, each, snapshot, currency), REPORT_LIMITS.text),
        ),
      ),
    );
  }
  const facts = [...runwayNotes(i18n, runway, currency), runwayMethodText(i18n, chance)].filter(
    (each): each is string => each !== null,
  );
  if (facts.length > 0) {
    blocks.push({
      type: 'paragraph',
      tone: 'muted',
      text: shortened(facts.join(' '), REPORT_LIMITS.text),
    });
  }
  return blocks;
}

/**
 * **As things stand** and **Why is it late?** (E3), as both owner's documents print them: the
 * forecast in one sentence against the baseline, and against the plan's own date — two answers,
 * labelled — then where the work stands, and, when it is late, the days late as a figure opening
 * onto what finishes later, and the ledger by cause (and, with `byParty`, by whose account), each
 * line with its working days and every day or change it was made from; what the record does not
 * explain in a strong sentence of its own; and what the forecast assumes and the ledger is not.
 */
export function delayBlocks(
  i18n: I18n,
  snapshot: WorkSnapshot,
  ledger: DelayLedger,
  level: 1 | 2,
  byParty: boolean,
): ReportBlock[] {
  const { t, tp, number } = i18n;
  const term = termsFor(i18n.language, 'owner');
  const days = (value: number) => tp('plan.checklist.days', Math.abs(value));
  const blocks: ReportBlock[] = [
    { type: 'heading', level, text: t(DELAY_LABEL_KEYS.title) },
    {
      type: 'paragraph',
      tone: 'strong',
      text: shortened(forecastSentence(i18n, term, ledger.forecast), REPORT_LIMITS.text),
    },
  ];
  const plan =
    ledger.forecast.problem === null ? forecastPlanText(i18n, term, ledger.forecast) : null;
  if (plan !== null) blocks.push({ type: 'paragraph', text: shortened(plan, REPORT_LIMITS.text) });
  blocks.push({
    type: 'paragraph',
    text: shortened(delayStatusText(i18n, term, ledger), REPORT_LIMITS.text),
  });
  const figures = ledger.status === 'late' ? ledger.figures : null;
  if (figures !== null) {
    blocks.push(
      figure(
        t(DELAY_LABEL_KEYS.total),
        number(figures.total.value),
        figures.total.rows.map((each) => line(each.name, slipRowText(i18n, each))),
      ),
    );
    blocks.push(
      figure(
        t(DELAY_LABEL_KEYS.byCause),
        number(figures.byCause.value),
        figures.byCause.rows.map((each) =>
          line(
            delayCauseText(i18n, each),
            days(each.days),
            each.cause === 'unexplained' || each.cause === 'made-up'
              ? delayResidualText(i18n, each.cause)
              : each.trace.map((trace) => delayTraceText(i18n, snapshot, trace)).join('; '),
          ),
        ),
      ),
    );
    if (byParty) {
      blocks.push(
        figure(
          t(DELAY_LABEL_KEYS.byParty),
          number(figures.byParty.value),
          figures.byParty.rows.map((each) =>
            line(
              delayPartyRowText(i18n, each),
              days(each.days),
              each.residual !== null
                ? delayResidualText(i18n, each.residual)
                : each.trace.map((trace) => delayTraceText(i18n, snapshot, trace)).join('; '),
            ),
          ),
        ),
      );
    }
  }
  const left = delayLeftText(i18n, ledger);
  if (left !== null) blocks.push({ type: 'paragraph', tone: 'strong', text: left });
  const facts = [
    ledger.forecast.problem === null
      ? forecastAssumesText(i18n, term, ledger.forecast, snapshot.activities.length)
      : null,
    figures !== null ? t('delay.caveat') : null,
  ].filter((each): each is string => each !== null);
  if (facts.length > 0) {
    blocks.push({
      type: 'paragraph',
      tone: 'muted',
      text: shortened(facts.join(' '), REPORT_LIMITS.text),
    });
  }
  return blocks;
}

/**
 * The finish as a probability, as the page prints it: one figure, then what it rests on. The owner's
 * snapshot (D4) prints the same blocks.
 */
export function probabilityBlocks(i18n: I18n, probability: FinishProbabilityResult): ReportBlock[] {
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
 * `probability` is `finishProbability` over the same plan, schedule and diary (D1); `cash` is the
 * runway and its chance over the same three (E2), printed after the money when given; `delay` is
 * `delayLedger` over the same three (E3), printed after the plan when given — the forecast and why
 * it is late.
 */
export function composeWeekly(
  weekly: Weekly,
  snapshot: WorkSnapshot,
  scheduled: Pick<Schedule, 'finishDate' | 'cyclic' | 'unplaced'>,
  i18n: I18n,
  probability: FinishProbabilityResult,
  cash: Cash | null = null,
  delay: DelayLedger | null = null,
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

  // ── As things stand, and why it is late (E3) ──
  if (delay !== null) blocks.push(...delayBlocks(i18n, snapshot, delay, 2, true));

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
  // D2: the payment plans, as of today — the same two figures the dashboard shows.
  blocks.push(
    figure(
      t(MILESTONE_LABEL_KEYS.paidAhead),
      number(weekly.money.paidAhead.value),
      planRows(i18n, weekly.money.paidAhead, snapshot, 'money.paymentPlan.paidAhead.mark'),
    ),
  );
  blocks.push(
    figure(
      t(MILESTONE_LABEL_KEYS.dueNow),
      money(weekly.money.dueNow.value, currency),
      planRows(i18n, weekly.money.dueNow, snapshot, 'money.paymentPlan.dueNow.mark'),
    ),
  );

  // E2: will the money last, in the same words as the Money page.
  if (cash !== null) blocks.push(...runwayBlocks(i18n, snapshot, cash, 2));

  // ── Changes (E1) — once the plan is approved; before that there are none to report ──
  if (snapshot.work.approvedAt !== null) {
    blocks.push(...weeklyChangeBlocks(weekly, snapshot, i18n));
  }

  // ── Still to fix (E4) — once a snag has been raised ──
  blocks.push(...snagBlocks(i18n, snapshot, weekly.today, 2, weekly.week));

  // ── To order this week (G2) — once the work has a purchase ──
  blocks.push(...purchaseBlocks(i18n, weekly.purchases, 2));

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
