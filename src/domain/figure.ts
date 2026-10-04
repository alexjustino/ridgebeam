/**
 * Figures: every number the product shows, carrying the rows it came from.
 *
 * The rule this module exists for: **a figure is never just a number**. Each one is built from
 * a list of rows and states the list, so the interface can open any figure and show what it
 * counted, and a test can check that the rows *are* the figure. A readiness of 50 % that cannot
 * say which activity has no responsible is a number nobody can act on.
 *
 * Copied from Tessera (`src/domain/report.ts`, the figure part: `ReportRow`, `Figure`,
 * `summed`, `counted`, `traceable`), with the names kept so the two stay recognisably one
 * pattern. Three changes: a figure's `label` is a message key the interface renders through the
 * i18n tables, never display text; a unit `percent`, for a share of things known, whose rows are
 * the things not yet known; and a unit `days`, for how far a date has moved, whose rows are what
 * moved.
 *
 * **A percent figure never reads 100 while the list behind it is not empty.** A rounded share
 * would: 199 of 200 is 99.5, which rounds to 100 with one thing still missing. So the value is
 * capped at 99 whenever anything is missing, and 100 means, exactly, that nothing is.
 *
 * **A days figure is the move of one date, and its rows are everything that moved.** The value is
 * how many working days the finish moved against a reference (a baseline); each row says how far
 * its own finish now lies from that same reference. The finish is the latest finish, so when it
 * moved later the value is exactly the furthest row, and when it did not, no row lies beyond it.
 * With nothing moved, the value is 0.
 *
 * **A chance figure is a share of simulated runs, and its rows are what it depends on, not parts of
 * it** (slice D1). A probability is not a sum: the value is `hits / runs`, exactly, and each row is
 * an activity with its role — one that moves the finish most (`driver`, with its rank correlation),
 * one counted as certain (`certain`), or one with how often it was critical (`critical`, with that
 * share). The rows say what the number is made of in the only way a probability can be: which
 * inputs it came from.
 *
 * What this module is not: a report. It builds no figure of its own; readiness, and later the
 * schedule, the diary and the money, build theirs with it.
 */

/**
 * One row a figure was built from. Enough to show it and to open what it points at.
 */
export interface ReportRow {
  /** Unique within a figure, e.g. `activity.responsible:<activityId>`. */
  key: string;
  /** The row the figure opens onto, where there is one. */
  itemId: string | null;
  /** The row's own name, as the person wrote it. */
  title: string;
  /** The day the row is filed under, where it has one. */
  day: string | null;
  /** What the row contributes. Zero for rows that are counted rather than summed. */
  minutes: number;
}

interface FigureBase<Row extends ReportRow> {
  id: string;
  /** A message key, rendered by the interface in the person's language. */
  label: string;
  value: number;
  rows: readonly Row[];
}

/**
 * A number with its rows.
 *
 * - `minutes` adds up what the rows contribute; `count` counts the rows.
 * - `percent` is `round(100 × known / mustKnow)`, capped at 99 while anything is missing, and
 *   its rows are what is not known: exactly `mustKnow − known` of them. A share of nothing
 *   (`mustKnow = 0`) is 0, and carries at least one row saying why there is nothing to measure.
 * - `days` is a signed number of working days a date moved; its rows are `DaysRow`s.
 * - `money` is a sum of money in the currency's minor unit (cents), whole numbers only: the sum of
 *   its rows' signed `amountCents` (`AmountRow`).
 * - `chance` is `hits / runs`, a share of simulated runs from 0 to 1, the day it is the chance of
 *   finishing by in `date`; its rows are `ChanceRow`s, what the chance depends on.
 */
export type Figure<Row extends ReportRow = ReportRow> =
  | (FigureBase<Row> & { unit: 'minutes' | 'count' | 'days' | 'money' })
  | (FigureBase<Row> & { unit: 'percent'; known: number; mustKnow: number })
  | (FigureBase<Row> & { unit: 'chance'; hits: number; runs: number; date: string | null });

/** A row of a `days` figure: something whose date moved. */
export interface DaysRow extends ReportRow {
  /** Working days this row's own date moved, signed: positive later, negative earlier. */
  days: number;
  /**
   * Working days from the figure's reference date to this row's date now, signed; `null` when
   * the row has no date now (it was removed, or can no longer be placed).
   */
  againstFinish: number | null;
}

/**
 * A figure that adds its rows up, and one that counts them.
 *
 * Exported because a figure is a rule about numbers in this product, not about one module:
 * there is one way to make a figure and one thing to check.
 */
export function summed<Row extends ReportRow>(
  id: string,
  label: string,
  rows: readonly Row[],
): Figure<Row> {
  return {
    id,
    label,
    unit: 'minutes',
    value: rows.reduce((sum, row) => sum + row.minutes, 0),
    rows,
  };
}

export function counted<Row extends ReportRow>(
  id: string,
  label: string,
  rows: readonly Row[],
): Figure<Row> {
  return { id, label, unit: 'count', value: rows.length, rows };
}

/**
 * The whole percentage `known` is of `mustKnow`: 0 when there is nothing to know, and never 100
 * while something is not known (at most 99 then), so the number cannot claim a list is empty
 * when it is not.
 */
export function percentOf(known: number, mustKnow: number): number {
  if (mustKnow === 0) return 0;
  const rounded = Math.round((100 * known) / mustKnow);
  return known < mustKnow ? Math.min(99, rounded) : rounded;
}

/**
 * A share of what must be known that is known, with the rows that are missing.
 *
 * `rows` must be the things not known, one row each; `traceable` checks that they are.
 */
export function percent<Row extends ReportRow>(
  id: string,
  label: string,
  known: number,
  mustKnow: number,
  rows: readonly Row[],
): Figure<Row> {
  return { id, label, unit: 'percent', value: percentOf(known, mustKnow), known, mustKnow, rows };
}

/** A row of a `money` figure: an amount, signed as the figure counts it, in minor units. */
export interface AmountRow extends ReportRow {
  /** Whole cents. Positive adds to the figure, negative takes away (a payment in "remaining"). */
  amountCents: number;
}

/** What a row is to a chance: never a part of it, always something it depends on. */
export const CHANCE_ROLES = ['driver', 'certain', 'critical'] as const;
export type ChanceRole = (typeof CHANCE_ROLES)[number];

/** A row of a `chance` figure (or of a count of activities with their criticality). */
export interface ChanceRow extends ReportRow {
  readonly role: ChanceRole;
  /**
   * The row's own number: a driver's rank correlation with the finish (−1 to 1), a critical row's
   * share of runs it was critical in (0 to 1); `null` for an activity counted as certain.
   */
  readonly share: number | null;
}

/** A figure of unit `chance`, with its counts and its date. */
export type ChanceFigure<Row extends ReportRow = ReportRow> = Extract<
  Figure<Row>,
  { unit: 'chance' }
>;

/**
 * A chance figure: `hits` of `runs` simulated runs, the value their share. `date` is the day it is
 * the chance of finishing by, when it is one.
 */
export function chanceFigure<Row extends ChanceRow>(
  id: string,
  label: string,
  hits: number,
  runs: number,
  date: string | null,
  rows: readonly Row[],
): ChanceFigure<Row> {
  return { id, label, unit: 'chance', value: hits / runs, hits, runs, date, rows };
}

/** Is this row's share what its role allows? */
function chanceRowHolds(row: ReportRow): boolean {
  const { role, share } = row as Partial<ChanceRow>;
  if (role === 'certain') return share === null;
  if (typeof share !== 'number' || !Number.isFinite(share)) return false;
  if (role === 'driver') return share >= -1 && share <= 1;
  return role === 'critical' && share >= 0 && share <= 1;
}

/** A money figure: the sum of its rows' amounts, in minor units. */
export function moneyFigure<Row extends AmountRow>(
  id: string,
  label: string,
  rows: readonly Row[],
): Figure<Row> {
  return {
    id,
    label,
    unit: 'money',
    value: rows.reduce((sum, row) => sum + row.amountCents, 0),
    rows,
  };
}

/** A figure of how many working days a date moved, with the rows that moved. */
export function daysFigure<Row extends DaysRow>(
  id: string,
  label: string,
  value: number,
  rows: readonly Row[],
): Figure<Row> {
  return { id, label, unit: 'days', value, rows };
}

/** A row's distance from the reference date, when it is a days row that has one. */
function againstFinishOf(row: ReportRow): number | null {
  const value = (row as Partial<DaysRow>).againstFinish;
  return typeof value === 'number' ? value : null;
}

/**
 * Does a figure say what its rows say? The invariant this module promises, as a function so the
 * interface can assert it too.
 *
 * Always: every row key is unique. Then, by unit: `minutes` is the sum of the rows'
 * contributions; `count` is their number; `percent` has whole counts with
 * `0 ≤ known ≤ mustKnow`, exactly `mustKnow − known` rows, and the value `percentOf` gives —
 * or, when there is nothing to know, the value 0 and at least one row that says so. A percent
 * that reads 100 with rows behind it, or below 100 with none, is broken whatever its counts.
 * `days` is a whole number; 0 with no rows; when positive, exactly the furthest `againstFinish`
 * among the rows; otherwise at least as far as every row's. `money` is a whole number of cents, the
 * sum of its rows' whole `amountCents`; a row without one breaks it. `chance` has whole
 * `0 ≤ hits ≤ runs` with at least one run, the value exactly `hits / runs`, and every row a
 * `ChanceRow` whose share its role allows (a certain row has none; a driver's is from −1 to 1; a
 * critical row's from 0 to 1).
 */
export function traceable<Row extends ReportRow>(figure: Figure<Row>): boolean {
  const keys = new Set(figure.rows.map((row) => row.key));
  if (keys.size !== figure.rows.length) return false;

  if (figure.unit === 'percent') {
    const { known, mustKnow } = figure;
    // The number and the list must agree first: 100 exactly when nothing is listed.
    if (figure.rows.length > 0 && figure.value === 100) return false;
    if (figure.rows.length === 0 && figure.value < 100) return false;
    if (!Number.isInteger(known) || !Number.isInteger(mustKnow)) return false;
    if (known < 0 || known > mustKnow) return false;
    if (mustKnow === 0) return figure.value === 0 && figure.rows.length > 0;
    return figure.rows.length === mustKnow - known && figure.value === percentOf(known, mustKnow);
  }

  if (figure.unit === 'chance') {
    const { hits, runs } = figure;
    if (!Number.isInteger(hits) || !Number.isInteger(runs)) return false;
    if (runs < 1 || hits < 0 || hits > runs) return false;
    return figure.value === hits / runs && figure.rows.every(chanceRowHolds);
  }

  if (figure.unit === 'money') {
    let sum = 0;
    for (const row of figure.rows) {
      const amount = (row as Partial<AmountRow>).amountCents;
      if (typeof amount !== 'number' || !Number.isInteger(amount)) return false;
      sum += amount;
    }
    return Number.isInteger(figure.value) && figure.value === sum;
  }

  if (figure.unit === 'days') {
    if (!Number.isInteger(figure.value)) return false;
    if (figure.rows.length === 0) return figure.value === 0;
    let furthest = Number.NEGATIVE_INFINITY;
    for (const row of figure.rows) {
      const against = againstFinishOf(row);
      if (against !== null) furthest = Math.max(furthest, against);
    }
    return figure.value > 0 ? furthest === figure.value : furthest <= figure.value;
  }

  const expected =
    figure.unit === 'minutes'
      ? figure.rows.reduce((sum, row) => sum + row.minutes, 0)
      : figure.rows.length;
  return figure.value === expected;
}
