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
 * pattern. Two changes: a figure's `label` is a message key the interface renders through the
 * i18n tables, never display text; and a third unit, `percent`, for a share of things known,
 * whose rows are the things not yet known.
 *
 * **A percent figure never reads 100 while the list behind it is not empty.** A rounded share
 * would: 199 of 200 is 99.5, which rounds to 100 with one thing still missing. So the value is
 * capped at 99 whenever anything is missing, and 100 means, exactly, that nothing is.
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
 *   its rows are what is not known: exactly `mustKnow − known` of them. A share of nothing (`mustKnow = 0`) is 0, and carries at least
 *   one row saying why there is nothing to measure.
 */
export type Figure<Row extends ReportRow = ReportRow> =
  | (FigureBase<Row> & { unit: 'minutes' | 'count' })
  | (FigureBase<Row> & { unit: 'percent'; known: number; mustKnow: number });

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

/**
 * Does a figure say what its rows say? The invariant this module promises, as a function so the
 * interface can assert it too.
 *
 * Always: every row key is unique. Then, by unit: `minutes` is the sum of the rows'
 * contributions; `count` is their number; `percent` has whole counts with
 * `0 ≤ known ≤ mustKnow`, exactly `mustKnow − known` rows, and the value `percentOf` gives —
 * or, when there is nothing to know, the value 0 and at least one row that says so. A percent
 * that reads 100 with rows behind it, or below 100 with none, is broken whatever its counts.
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

  const expected =
    figure.unit === 'minutes'
      ? figure.rows.reduce((sum, row) => sum + row.minutes, 0)
      : figure.rows.length;
  return figure.value === expected;
}
