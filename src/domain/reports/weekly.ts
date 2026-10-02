/**
 * The weekly report: what the owner is told about one week of the work (slice F10, decision 4).
 *
 * A pure selection of figures the product already makes — each carrying its rows, so the report can
 * list under every number what it counted — for the calendar week (Monday to Sunday) of `weekStart`
 * (any day of it) or, when none is given, of today:
 *
 * - **the days**: all seven, each written, missing, still to come, not a working day or before the
 *   start; the working days that are over with nothing written are a figure of their own, listed
 *   (SPEC R2). A week with no effective entry at all is `empty`, and the report says so first;
 *   everything else is still given.
 * - **what was done**: the activities an effective entry of the week says were worked on, and those
 *   it says were finished (an activity finished in the week is in `finished` only);
 * - **who was on site**, and the **weather days lost** in the week (`dashboard/`, the same figures
 *   the front door shows);
 * - **readiness** and the first three things it lacks;
 * - **the finish** against the latest baseline, with the slip;
 * - **decisions** overdue, or due within the next 14 calendar days from today;
 * - **money** planned, committed and paid, and paid this week (payments dated in the week,
 *   reversals included, so a reversed payment nets out); and, from the payment plans (slice D2), the
 *   commitments **paid ahead of the work** and what is **earned and not paid**, as of today;
 * - **stages** planned, ready, running, held at a gate ("blocked") and closed.
 *
 * The decisions, the money and the stages are the work **as it is today**: a report on a past week
 * says where the work stands now, and which week the diary part is about. A week that has not
 * started yet has nothing to report and is refused; so is a day that is not a day.
 *
 * What this module is not: text. The interface turns this into a document, in the owner's words.
 */

import { breakdown } from '../arrangements';
import { isIsoDay } from '../calendar';
import { STAGE_STATES, gatesHeldFigure, stagesFigure, stagesReadyFigure } from '../checks';
import type { GateHeldRow, StageRow } from '../checks';
import {
  onSiteFigure,
  weatherLostFigure,
  weekDays,
  weekDaysWithoutEntryFigure,
  weekEntriesFigure,
  weekOf,
  type EntryRow,
  type PersonRow,
  type WeatherLostRow,
  type Week,
  type WeekDay,
} from '../dashboard';
import { decisionRows, decisionsDueWithin, type DecisionDueRow } from '../decisions';
import { effectiveEntries, type DiaryEntry } from '../diary';
import { counted, moneyFigure, type Figure, type ReportRow } from '../figure';
import { aheadFigure, dueFigure, type PlanRow } from '../milestones';
import { moneyOfWork, type MoneyRow } from '../money';
import { latestBaseline, type WorkSnapshot } from '../plan';
import { readiness, readinessFigure, type ReadinessRow } from '../readiness';
import type { Schedule } from '../schedule';
import { slip, type SlipRow } from '../schedule/slip';

/**
 * How far ahead of today the report looks for decisions due, in calendar days, that day included.
 * The owner's snapshot (`lookahead`) asks the same, through `decisionsDueWithin`.
 */
export const WEEKLY_DECISION_WINDOW_DAYS = 14;

/** How many of the things readiness lacks the report names. */
export const WEEKLY_LACKS = 3;

export const WEEKLY_LABEL_KEYS = {
  worked: 'reports.weekly.figure.worked',
  finished: 'reports.weekly.figure.finished',
  decisions: 'reports.weekly.figure.decisions',
  paidThisWeek: 'reports.weekly.figure.paidThisWeek',
} as const;

export const WEEKLY_PROBLEM_KEYS = {
  'invalid-week': 'reports.weekly.problem.invalidWeek',
  'invalid-today': 'reports.weekly.problem.invalidToday',
  'future-week': 'reports.weekly.problem.futureWeek',
} as const;

/** Why a weekly report was not made. The interface turns each into its sentence. */
export type WeeklyProblem =
  | {
      readonly code: 'invalid-week';
      readonly messageKey: (typeof WEEKLY_PROBLEM_KEYS)['invalid-week'];
    }
  | {
      readonly code: 'invalid-today';
      readonly messageKey: (typeof WEEKLY_PROBLEM_KEYS)['invalid-today'];
    }
  | {
      readonly code: 'future-week';
      readonly messageKey: (typeof WEEKLY_PROBLEM_KEYS)['future-week'];
      /** The Monday of the week asked for. */
      readonly from: string;
    };

/** An activity the week's entries mention, with what they say of it. */
export interface WeekActivityRow extends ReportRow {
  readonly activityId: string;
  readonly stageId: string;
  /** `null` when its stage is not in the plan. */
  readonly stageName: string | null;
  /** Its breakdown number (`1.2`), `null` when its stage is not in the plan. */
  readonly number: string | null;
  /** The days of the week it was mentioned on, oldest first. */
  readonly days: readonly string[];
  /** The quantities said in the week, added up; `null` when no line gave one. */
  readonly quantity: number | null;
  readonly unit: string | null;
}

/** A decision the report lists: overdue, or due inside the window. */
export interface WeeklyDecisionRow extends DecisionDueRow {
  /** `null` when its stage is not in the plan. */
  readonly stageName: string | null;
}

/** The finish date, and where it stands against the latest baseline. */
export interface WeeklyFinish {
  /** The schedule's finish now; `null` when it cannot be computed. */
  readonly finishDate: string | null;
  /** The latest baseline's number and finish; `null` before the plan is approved. */
  readonly baseline: { readonly number: number; readonly finishDate: string | null } | null;
  /** The slip against it, with the activities that moved; `null` with no baseline. */
  readonly slip: Figure<SlipRow> | null;
}

export interface Weekly {
  readonly week: Week;
  readonly today: string;
  /** No effective entry is about any day of the week. The report says so on its first line. */
  readonly empty: boolean;
  /** The calendar can be counted on; when not, no day is called missing or not working. */
  readonly calendarKnown: boolean;
  /** Monday to Sunday. */
  readonly days: readonly WeekDay[];
  readonly entries: Figure<EntryRow>;
  /** The working days that are over and have nothing written, listed. */
  readonly daysWithoutEntry: Figure;
  readonly worked: Figure<WeekActivityRow>;
  readonly finished: Figure<WeekActivityRow>;
  readonly onSite: Figure<PersonRow>;
  readonly weatherLost: Figure<WeatherLostRow>;
  readonly readiness: Figure<ReadinessRow>;
  /** The first `WEEKLY_LACKS` rows of the readiness figure, in its order. */
  readonly lacks: readonly ReadinessRow[];
  readonly finish: WeeklyFinish;
  readonly decisions: Figure<WeeklyDecisionRow>;
  readonly money: {
    readonly planned: Figure<MoneyRow>;
    readonly committed: Figure<MoneyRow>;
    readonly paid: Figure<MoneyRow>;
    readonly paidThisWeek: Figure<MoneyRow>;
    /** The commitments paid ahead of the work, counted, each with its excess (slice D2). */
    readonly paidAhead: Figure<PlanRow>;
    /** What is earned and not paid, summed, a row per commitment (slice D2). */
    readonly dueNow: Figure<PlanRow>;
  };
  readonly stages: {
    readonly planned: Figure<StageRow>;
    readonly ready: Figure<StageRow>;
    readonly started: Figure<StageRow>;
    readonly held: Figure<GateHeldRow>;
    readonly closed: Figure<StageRow>;
  };
}

export type WeeklyResult =
  | { readonly ok: true; readonly weekly: Weekly }
  | { readonly ok: false; readonly problem: WeeklyProblem };

/** The activities the week's effective entries mention, split into finished and only worked on. */
function doneInWeek(
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
  week: Week,
): { worked: Figure<WeekActivityRow>; finished: Figure<WeekActivityRow> } {
  const lines = new Map<string, { days: Set<string>; finished: boolean; quantities: number[] }>();
  for (const entry of effectiveEntries(entries)) {
    if (entry.day < week.from || entry.day > week.to) continue;
    for (const line of entry.done) {
      let said = lines.get(line.activityId);
      if (said === undefined) {
        said = { days: new Set(), finished: false, quantities: [] };
        lines.set(line.activityId, said);
      }
      said.days.add(entry.day);
      if (line.state === 'finished') said.finished = true;
      if (line.quantity !== null && Number.isFinite(line.quantity)) {
        said.quantities.push(line.quantity);
      }
    }
  }
  const stageNames = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  const units = new Map(snapshot.activities.map((activity) => [activity.id, activity.unit]));
  const worked: WeekActivityRow[] = [];
  const finished: WeekActivityRow[] = [];
  for (const row of breakdown(snapshot)) {
    if (row.kind !== 'activity') continue;
    const said = lines.get(row.id);
    if (said === undefined) continue;
    const days = [...said.days].sort();
    const out: WeekActivityRow = {
      key: `activity:${row.id}`,
      itemId: row.id,
      title: row.name,
      day: days.at(-1)!,
      minutes: 0,
      activityId: row.id,
      stageId: row.stageId,
      stageName: stageNames.get(row.stageId) ?? null,
      number: row.number,
      days,
      quantity:
        said.quantities.length === 0 ? null : said.quantities.reduce((sum, n) => sum + n, 0),
      unit: units.get(row.id) ?? null,
    };
    (said.finished ? finished : worked).push(out);
  }
  return {
    worked: counted('week-worked', WEEKLY_LABEL_KEYS.worked, worked),
    finished: counted('week-finished', WEEKLY_LABEL_KEYS.finished, finished),
  };
}

/** Open decisions overdue, or due on or before today + the window, most urgent first. */
function decisionsInWindow(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  today: string,
): Figure<WeeklyDecisionRow> {
  const rows = decisionRows(snapshot, scheduled, today);
  const stageNames = new Map(rows.map((row) => [row.decisionId, row.stageName]));
  const listed: WeeklyDecisionRow[] =
    scheduled.calendar === null
      ? []
      : decisionsDueWithin(rows, scheduled.calendar, today, WEEKLY_DECISION_WINDOW_DAYS).map(
          (row) => ({ ...row, stageName: stageNames.get(row.decisionId)! }),
        );
  return counted('week-decisions', WEEKLY_LABEL_KEYS.decisions, listed);
}

/**
 * The weekly report of the week `weekStart` falls in (`null`: the week of `today`), as of `today`.
 * Never throws: a day that is not a day, or a week that has not begun, is a problem in the result.
 */
export function weekly(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  entries: readonly DiaryEntry[],
  weekStart: string | null,
  today: string,
): WeeklyResult {
  if (!isIsoDay(today)) {
    return {
      ok: false,
      problem: { code: 'invalid-today', messageKey: WEEKLY_PROBLEM_KEYS['invalid-today'] },
    };
  }
  const week = weekOf(weekStart ?? today);
  if (week === null) {
    return {
      ok: false,
      problem: { code: 'invalid-week', messageKey: WEEKLY_PROBLEM_KEYS['invalid-week'] },
    };
  }
  if (week.from > today) {
    return {
      ok: false,
      problem: {
        code: 'future-week',
        messageKey: WEEKLY_PROBLEM_KEYS['future-week'],
        from: week.from,
      },
    };
  }

  const days = weekDays(scheduled.calendar, week, today, snapshot.work.startDate, entries);
  const entriesFigure = weekEntriesFigure(entries, week);
  const measure = readinessFigure(readiness(snapshot, { schedule: scheduled, today }));
  const baseline = latestBaseline(snapshot);
  const money = moneyOfWork(snapshot);
  const [planned, started, closed] = STAGE_STATES.map((state) => stagesFigure(snapshot, state));

  return {
    ok: true,
    weekly: {
      week,
      today,
      empty: entriesFigure.rows.length === 0,
      calendarKnown: scheduled.calendar !== null,
      days,
      entries: entriesFigure,
      daysWithoutEntry: weekDaysWithoutEntryFigure(days),
      ...doneInWeek(snapshot, entries, week),
      onSite: onSiteFigure(snapshot, entries, week),
      weatherLost: weatherLostFigure(entries, week),
      readiness: measure,
      lacks: measure.rows.slice(0, WEEKLY_LACKS),
      finish: {
        finishDate: scheduled.finishDate,
        baseline:
          baseline === null ? null : { number: baseline.number, finishDate: baseline.finishDate },
        slip: baseline === null ? null : slip(scheduled, baseline),
      },
      decisions: decisionsInWindow(snapshot, scheduled, today),
      money: {
        planned: money.planned,
        committed: money.committed,
        paid: money.paid,
        paidThisWeek: moneyFigure(
          'paid:week',
          WEEKLY_LABEL_KEYS.paidThisWeek,
          money.paid.rows.filter(
            (row) => row.day !== null && row.day >= week.from && row.day <= week.to,
          ),
        ),
        paidAhead: aheadFigure(snapshot, entries, today),
        dueNow: dueFigure(snapshot, entries, today),
      },
      stages: {
        planned: planned!,
        ready: stagesReadyFigure(snapshot),
        started: started!,
        held: gatesHeldFigure(snapshot),
        closed: closed!,
      },
    },
  };
}
