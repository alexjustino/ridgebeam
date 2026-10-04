/**
 * Baselines compared: any two of them, what changed between them, and the reasons given for it.
 *
 * A baseline is a photograph of the plan taken when it was approved (baseline 1) and each time it
 * was replanned with a reason (2, 3 …). Comparing two says what the person needs to explain the
 * plan's history: **how far the finish moved, which dates moved, which activities and stages came
 * and went, how the money planned changed, and why** — the reasons of every baseline after the
 * earlier one, up to the later one.
 *
 * The pair is **ordered by number whatever order it was chosen in** (`swapped` says it was turned
 * round, so the interface can say so), and a baseline **compared with itself is refused**
 * (`same-baseline`), never answered with an empty comparison that would read as "nothing changed".
 * A refusal is a result, not an exception: choosing the same baseline twice is a person's mistake.
 *
 * Things are matched **by id**, never by name: an activity renamed between the two is the same
 * activity (its date moved, it was not removed and added), and a stage renamed is the same stage.
 * Days are counted on the calendar given (the work's as it is now), signed: positive later.
 *
 * **Money not recorded is said, never counted as 0**: a baseline taken before money was recorded
 * has `plannedCents` `null`, and a comparison with it reads `'not recorded'`.
 *
 * **The change orders approved between the two are listed too** (slice E1, `changes`): every change
 * whose approval was recorded after the earlier baseline was taken, up to the moment the later one
 * was (its decision's `createdAt`, a moment, against the baselines' `takenAt`; never the decision's
 * day, which cannot be ordered against a moment). An approval writes into the plan inside a
 * replanning, and the baseline that closes it is the first one taken after it, so this is exactly
 * the set that baseline photographs. Declined and withdrawn changes changed nothing in the plan, so
 * they are not listed. Their money and days (`explainedByChanges`) are what of the move the changes
 * explain.
 *
 * Every list is a counted figure carrying its rows (`figure.ts`): "3 dates moved · 1 activity added
 * · 1 stage removed". What this module is not: storage, the slip against the plan now (`slip.ts`),
 * or text. It performs no I/O.
 */

import { isIsoDay, workingDaysUntil, type WorkingCalendar } from './calendar';
import { counted, type Figure, type ReportRow } from './figure';
import {
  compareText,
  type Baseline,
  type BaselineRow,
  type BaselineStage,
  type ChangeAskedBy,
  type ChangeOrder,
} from './plan';

// ── The pair ─────────────────────────────────────────────────────────────────

/** Two things with a number, earlier first; `swapped` when they were given the other way round. */
export interface OrderedPair<T> {
  readonly earlier: T;
  readonly later: T;
  readonly swapped: boolean;
}

/** Put a pair in the order of its numbers. An equal pair is left as given. */
export function orderPair<T extends { readonly number: number }>(a: T, b: T): OrderedPair<T> {
  return a.number > b.number
    ? { earlier: b, later: a, swapped: true }
    : { earlier: a, later: b, swapped: false };
}

// ── Refusals ─────────────────────────────────────────────────────────────────

/** How the interface says each refusal. */
export const COMPARISON_PROBLEM_KEYS = {
  'same-baseline': 'baselines.problem.same',
  'unknown-baseline': 'baselines.problem.unknown',
} as const;

/** Why two baselines were not compared. The interface turns each into its sentence. */
export type ComparisonProblem =
  | {
      readonly code: 'same-baseline';
      readonly messageKey: (typeof COMPARISON_PROBLEM_KEYS)['same-baseline'];
      readonly number: number;
    }
  | {
      readonly code: 'unknown-baseline';
      readonly messageKey: (typeof COMPARISON_PROBLEM_KEYS)['unknown-baseline'];
      readonly number: number;
    };

/** Is this the same baseline twice? Then there is nothing to compare, and Compare is refused. */
export function sameBaseline(a: number, b: number): boolean {
  return a === b;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** How an activity's finish differs between the two baselines. */
export type DateChange =
  /** Placed in both, finishing on a different day. */
  | 'moved'
  /** Placed in the later one only (it had no duration then). */
  | 'placed'
  /** Placed in the earlier one only (its duration was cleared). */
  | 'unplaced';

/** An activity in both baselines whose finish is not the same. */
export interface DateMovedRow extends ReportRow {
  readonly activityId: string;
  /** Its name in the later baseline. */
  readonly name: string;
  /** Its name in the earlier one: different when it was renamed in between. */
  readonly nameThen: string;
  readonly stageName: string;
  readonly change: DateChange;
  /** The finish in the earlier baseline, and in the later one. */
  readonly from: string | null;
  readonly to: string | null;
  /** Working days the finish moved, signed; `null` when it cannot be counted (one side unplaced). */
  readonly days: number | null;
}

/** An activity in both baselines whose duration is not the same. */
export interface DurationChangedRow extends ReportRow {
  readonly activityId: string;
  readonly name: string;
  readonly nameThen: string;
  readonly stageName: string;
  readonly from: number | null;
  readonly to: number | null;
  /** `to − from`; `null` when either side had no duration. */
  readonly delta: number | null;
}

/** An activity in one baseline and not the other. */
export interface ActivityChangeRow extends ReportRow {
  readonly activityId: string;
  readonly name: string;
  readonly stageName: string;
  readonly finish: string | null;
  readonly plannedCents: number | null;
}

/** A stage in one baseline and not the other. */
export interface StageChangeRow extends ReportRow {
  readonly stageId: string;
  readonly name: string;
  readonly position: number;
  readonly plannedCents: number | null;
}

/** A change order approved between the two baselines, with what its decision froze. */
export interface ChangeApprovedRow extends ReportRow {
  readonly changeOrderId: string;
  readonly number: number;
  readonly askedBy: ChangeAskedBy;
  /** `YYYY-MM-DD`, the day it was approved. */
  readonly decidedOn: string;
  /** Signed working days, as decided; `null` when it could not be counted. */
  readonly daysDelta: number | null;
  /** Signed cents, as decided; `null` when not priced. */
  readonly costCents: number | null;
}

/** How far the finish date moved. */
export interface FinishMove {
  readonly from: string | null;
  readonly to: string | null;
  /** Working days, signed; `null` when either side has no finish or the calendar cannot count. */
  readonly days: number | null;
}

/** The money planned, then and later, in cents; or that one of the two did not record it. */
export type MoneyChange =
  { readonly from: number; readonly to: number; readonly delta: number } | 'not recorded';

/** The figures' names, as message keys. */
export const COMPARISON_LABEL_KEYS = {
  datesMoved: 'baselines.figure.datesMoved',
  durationsChanged: 'baselines.figure.durationsChanged',
  activitiesAdded: 'baselines.figure.activitiesAdded',
  activitiesRemoved: 'baselines.figure.activitiesRemoved',
  stagesAdded: 'baselines.figure.stagesAdded',
  stagesRemoved: 'baselines.figure.stagesRemoved',
  changes: 'baselines.figure.changes',
} as const;

/** What changed between two baselines, the earlier first. */
export interface Comparison {
  readonly earlier: Baseline;
  readonly later: Baseline;
  /** The pair was chosen later-first and turned round: the interface says so. */
  readonly swapped: boolean;
  /** `null` when the finish is the same day in both. */
  readonly finishMoved: FinishMove | null;
  readonly datesMoved: Figure<DateMovedRow>;
  readonly durationsChanged: Figure<DurationChangedRow>;
  readonly activitiesAdded: Figure<ActivityChangeRow>;
  readonly activitiesRemoved: Figure<ActivityChangeRow>;
  readonly stagesAdded: Figure<StageChangeRow>;
  readonly stagesRemoved: Figure<StageChangeRow>;
  /** The change orders approved between the two, by number (slice E1). */
  readonly changes: Figure<ChangeApprovedRow>;
  readonly money: MoneyChange;
  /** The reasons of the baselines after the earlier one, up to the later one, in number order. */
  readonly reasons: readonly string[];
  /**
   * The numbers in that range with no reason to give: a baseline that recorded none, or one missing
   * from the list. Listed, so a reason is never silently left out.
   */
  readonly unexplained: readonly number[];
}

export type ComparisonResult =
  | { readonly ok: true; readonly comparison: Comparison }
  | { readonly ok: false; readonly problem: ComparisonProblem };

// ── Comparing ────────────────────────────────────────────────────────────────

/** Each id once, first occurrence kept, in the baseline's order. */
function byId<Row>(rows: readonly Row[], idOf: (row: Row) => string): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const row of rows) if (!map.has(idOf(row))) map.set(idOf(row), row);
  return map;
}

/**
 * Compare baselines `a` and `b`, by number, out of the work's `baselines`. The pair is put in order;
 * the same number twice, or a number the list does not hold, is refused. `changeOrders` are the
 * work's (none given, none listed). Never throws.
 */
export function compareBaselines(
  baselines: readonly Baseline[],
  a: number,
  b: number,
  calendar: WorkingCalendar | null,
  changeOrders: readonly ChangeOrder[] = [],
): ComparisonResult {
  if (sameBaseline(a, b)) {
    return {
      ok: false,
      problem: {
        code: 'same-baseline',
        messageKey: COMPARISON_PROBLEM_KEYS['same-baseline'],
        number: a,
      },
    };
  }
  const find = (number: number) => baselines.find((baseline) => baseline.number === number);
  const first = find(a);
  const second = find(b);
  for (const [number, found] of [
    [a, first],
    [b, second],
  ] as const) {
    if (found === undefined) {
      return {
        ok: false,
        problem: {
          code: 'unknown-baseline',
          messageKey: COMPARISON_PROBLEM_KEYS['unknown-baseline'],
          number,
        },
      };
    }
  }
  const { earlier, later, swapped } = orderPair(first!, second!);

  const diff = (from: string | null, to: string | null): number | null =>
    calendar === null || from === null || to === null || !isIsoDay(from) || !isIsoDay(to)
      ? null
      : workingDaysUntil(calendar, from, to);

  const then = byId(earlier.rows, (row) => row.activityId);
  const now = byId(later.rows, (row) => row.activityId);

  const datesMoved: DateMovedRow[] = [];
  const durationsChanged: DurationChangedRow[] = [];
  const activitiesAdded: ActivityChangeRow[] = [];
  for (const [id, row] of now) {
    const old = then.get(id);
    if (old === undefined) {
      activitiesAdded.push(activityRow(row));
      continue;
    }
    if (old.finish !== row.finish) {
      const change: DateChange =
        old.finish !== null && row.finish !== null
          ? 'moved'
          : row.finish === null
            ? 'unplaced'
            : 'placed';
      datesMoved.push({
        ...common(row, old),
        day: row.finish ?? old.finish,
        change,
        from: old.finish,
        to: row.finish,
        days: diff(old.finish, row.finish),
      });
    }
    if (old.durationDays !== row.durationDays) {
      durationsChanged.push({
        ...common(row, old),
        day: null,
        from: old.durationDays,
        to: row.durationDays,
        delta:
          old.durationDays === null || row.durationDays === null
            ? null
            : row.durationDays - old.durationDays,
      });
    }
  }
  const activitiesRemoved = [...then.values()]
    .filter((row) => !now.has(row.activityId))
    .map(activityRow);

  const stagesThen = byId(earlier.stages, (stage) => stage.stageId);
  const stagesNow = byId(later.stages, (stage) => stage.stageId);
  const inOrder = (stages: Map<string, BaselineStage>) =>
    [...stages.values()].sort(
      (x, y) => x.position - y.position || compareText(x.stageId, y.stageId),
    );
  const stagesAdded = inOrder(stagesNow)
    .filter((stage) => !stagesThen.has(stage.stageId))
    .map(stageRow);
  const stagesRemoved = inOrder(stagesThen)
    .filter((stage) => !stagesNow.has(stage.stageId))
    .map(stageRow);

  const reasons: string[] = [];
  const unexplained: number[] = [];
  for (let number = earlier.number + 1; number <= later.number; number += 1) {
    const reason = find(number)?.reason ?? null;
    if (reason === null || reason.trim() === '') unexplained.push(number);
    else reasons.push(reason);
  }

  return {
    ok: true,
    comparison: {
      earlier,
      later,
      swapped,
      finishMoved:
        earlier.finishDate === later.finishDate
          ? null
          : {
              from: earlier.finishDate,
              to: later.finishDate,
              days: diff(earlier.finishDate, later.finishDate),
            },
      datesMoved: counted('baselines:datesMoved', COMPARISON_LABEL_KEYS.datesMoved, datesMoved),
      durationsChanged: counted(
        'baselines:durationsChanged',
        COMPARISON_LABEL_KEYS.durationsChanged,
        durationsChanged,
      ),
      activitiesAdded: counted(
        'baselines:activitiesAdded',
        COMPARISON_LABEL_KEYS.activitiesAdded,
        activitiesAdded,
      ),
      activitiesRemoved: counted(
        'baselines:activitiesRemoved',
        COMPARISON_LABEL_KEYS.activitiesRemoved,
        activitiesRemoved,
      ),
      stagesAdded: counted('baselines:stagesAdded', COMPARISON_LABEL_KEYS.stagesAdded, stagesAdded),
      stagesRemoved: counted(
        'baselines:stagesRemoved',
        COMPARISON_LABEL_KEYS.stagesRemoved,
        stagesRemoved,
      ),
      changes: counted(
        'baselines:changes',
        COMPARISON_LABEL_KEYS.changes,
        changesBetween(changeOrders, earlier, later),
      ),
      money:
        earlier.plannedCents === null || later.plannedCents === null
          ? 'not recorded'
          : {
              from: earlier.plannedCents,
              to: later.plannedCents,
              delta: later.plannedCents - earlier.plannedCents,
            },
      reasons,
      unexplained,
    },
  };
}

/**
 * The change orders approved after `earlier` was taken and up to when `later` was, by number: the
 * approvals the later baseline photographs.
 */
export function changesBetween(
  changeOrders: readonly ChangeOrder[],
  earlier: Baseline,
  later: Baseline,
): ChangeApprovedRow[] {
  return changeOrders
    .filter((change) => {
      const decision = change.decision;
      return (
        decision !== null &&
        decision.outcome === 'approved' &&
        decision.createdAt > earlier.takenAt &&
        decision.createdAt <= later.takenAt
      );
    })
    .sort((x, y) => x.number - y.number || compareText(x.id, y.id))
    .map((change) => ({
      key: `change:${change.id}`,
      itemId: change.id,
      title: change.title,
      day: change.decision!.decidedOn,
      minutes: 0,
      changeOrderId: change.id,
      number: change.number,
      askedBy: change.askedBy,
      decidedOn: change.decision!.decidedOn,
      daysDelta: change.decision!.daysDelta,
      costCents: change.decision!.costCents,
    }));
}

/**
 * What of a comparison the change orders approved in it explain: their money and their working
 * days, summed as decided (an unpriced change, or one whose days could not be counted, adds 0 and is
 * counted in `unpriced` or `uncounted`). The rest of the move is the replanning's reasons'.
 */
export function explainedByChanges(comparison: Comparison): {
  costCents: number;
  days: number;
  unpriced: number;
  uncounted: number;
} {
  let costCents = 0;
  let days = 0;
  let unpriced = 0;
  let uncounted = 0;
  for (const row of comparison.changes.rows) {
    if (row.costCents === null) unpriced += 1;
    else costCents += row.costCents;
    if (row.daysDelta === null) uncounted += 1;
    else days += row.daysDelta;
  }
  return { costCents, days, unpriced, uncounted };
}

/** The fields every row of an activity found in both baselines shares. */
function common(row: BaselineRow, old: BaselineRow) {
  return {
    key: `activity:${row.activityId}`,
    itemId: row.activityId,
    title: row.name,
    minutes: 0,
    activityId: row.activityId,
    name: row.name,
    nameThen: old.name,
    stageName: row.stageName,
  };
}

function activityRow(row: BaselineRow): ActivityChangeRow {
  return {
    key: `activity:${row.activityId}`,
    itemId: row.activityId,
    title: row.name,
    day: row.finish,
    minutes: 0,
    activityId: row.activityId,
    name: row.name,
    stageName: row.stageName,
    finish: row.finish,
    plannedCents: row.plannedCents,
  };
}

function stageRow(stage: BaselineStage): StageChangeRow {
  return {
    key: `stage:${stage.stageId}`,
    itemId: stage.stageId,
    title: stage.name,
    day: null,
    minutes: 0,
    stageId: stage.stageId,
    name: stage.name,
    position: stage.position,
    plannedCents: stage.plannedCents,
  };
}

/**
 * The comparison's counted figures that have something in them, in the order the summary line says
 * them: "3 dates moved · 1 activity added · 1 stage removed". Money and the finish are not figures
 * of rows; the interface adds them.
 */
export function comparisonFigures(comparison: Comparison): Array<Figure<ReportRow>> {
  return [
    comparison.datesMoved,
    comparison.durationsChanged,
    comparison.activitiesAdded,
    comparison.activitiesRemoved,
    comparison.stagesAdded,
    comparison.stagesRemoved,
    comparison.changes,
  ].filter((figure) => figure.rows.length > 0);
}

/**
 * The pair the Baselines card compares by default: the last two by number, earlier first; `null`
 * while there are fewer than two.
 */
export function defaultPair(baselines: readonly Baseline[]): { a: number; b: number } | null {
  const numbers = [...new Set(baselines.map((baseline) => baseline.number))].sort((x, y) => x - y);
  if (numbers.length < 2) return null;
  return { a: numbers[numbers.length - 2]!, b: numbers[numbers.length - 1]! };
}
