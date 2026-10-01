import { useId, useState, type ReactNode } from 'react';

import { traceable, type Figure, type ReportRow } from '@/domain/figure';
import { useI18n } from '@/i18n/useI18n';

/**
 * A number that can be opened (DESIGN_SYSTEM §2).
 *
 * Tessera's pattern, kept: the value is a button, pressing it lists the rows it was made from,
 * and a figure whose rows do not agree with it (`traceable` fails) shows a dash and says why
 * instead of a number. The button's name is its own text — the number — and what the number is
 * and what pressing it does are its description, so a screen reader hears "50 %, Readiness,
 * press it to list what it counts" and a keyboard reaches it like any other button.
 *
 * One primitive for every figure (moved here in F2, when the schedule became its second screen):
 * `testId` names the figure for the end-to-end suite (`<testId>`, `<testId>-value`,
 * `<testId>-row`), and `size` is `display` for the one number a screen is about and `title` for
 * a figure that sits beside others, and `cell` for a figure in a table-like row — its name read by
 * a screen reader but not shown, because the column already says it. `inline` is a small figure
 * inside a row that has no column to name it (D2: a commitment's earned and due): its name is shown
 * beside it in caption type, the value in body type, and the hint is read, not shown. `rowTestId`
 * names the rows when a suite reads them across figures (`money-row`).
 *
 * It stays pressable when there is nothing to list: opening it then says so, which is a fact the
 * reader checked, rather than a disabled control that says nothing.
 */
export function FigureRow<Row extends ReportRow>({
  figure,
  label,
  value,
  renderRow,
  rowsLabel,
  testId = 'figure',
  size = 'display',
  rowTestId,
  groupBy,
}: {
  figure: Figure<Row>;
  /** What the figure is, in words. */
  label: string;
  /** The value, formatted for the reader. */
  value: string;
  /** One row, as the reader sees it. */
  renderRow: (row: Row) => ReactNode;
  /** The accessible name of the list the figure opens onto. */
  rowsLabel: string;
  testId?: string;
  size?: 'display' | 'title' | 'cell' | 'inline';
  rowTestId?: string;
  /**
   * When given, the rows are shown under headings — the group each belongs to, groups in their
   * `order` — and each row keeps its own place inside its group.
   */
  groupBy?: (row: Row) => { id: string; label: string; order: number };
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId();
  const broken = !traceable(figure);

  return (
    <div data-testid={testId} data-figure={figure.id} className="flex flex-col gap-2">
      <div
        className={`flex flex-wrap items-baseline gap-y-1 ${size === 'inline' ? 'gap-x-1' : 'gap-x-4'}`}
      >
        <span
          id={`${id}-label`}
          className={
            size === 'cell'
              ? 'sr-only'
              : size === 'inline'
                ? 'text-caption font-semibold text-fg-secondary'
                : 'text-body-lg font-semibold text-fg'
          }
        >
          {label}
        </span>
        <button
          type="button"
          data-testid={`${testId}-value`}
          aria-expanded={open}
          aria-controls={`${id}-rows`}
          aria-describedby={`${id}-label ${id}-hint`}
          onClick={() => setOpen((value) => !value)}
          className={[
            'rounded-md px-2 font-semibold text-fg tabular-nums',
            size === 'display'
              ? 'font-display text-display'
              : size === 'title'
                ? 'text-title'
                : 'text-body',
            'transition-colors duration-100 ease-easy hover:bg-card-hover active:bg-card-active',
          ].join(' ')}
        >
          {broken ? '—' : value}
        </button>
        <span
          id={`${id}-hint`}
          className={
            size === 'cell' || size === 'inline' ? 'sr-only' : 'text-caption text-fg-tertiary'
          }
        >
          {open ? t('figure.closes') : t('figure.opens')}
        </span>
      </div>

      {broken && <p className="text-body text-fg-secondary">{t('figure.broken')}</p>}

      <div id={`${id}-rows`} hidden={!open}>
        {figure.rows.length === 0 ? (
          <p className="border-l border-stroke-subtle pl-3 text-body text-fg-tertiary">
            {t('figure.nothing')}
          </p>
        ) : (
          <ul
            aria-label={rowsLabel}
            className="flex flex-col gap-1 border-l border-stroke-subtle pl-3"
          >
            {groupBy === undefined
              ? figure.rows.map((row) => (
                  <li
                    key={row.key}
                    data-testid={rowTestId ?? `${testId}-row`}
                    className="text-body text-fg-secondary"
                  >
                    {renderRow(row)}
                  </li>
                ))
              : grouped(figure.rows, groupBy).map((group) => (
                  <li key={group.id} className="flex flex-col gap-1">
                    <span className="text-caption font-semibold text-fg-tertiary">
                      {group.label}
                    </span>
                    <ul className="flex flex-col gap-1">
                      {group.rows.map((row) => (
                        <li
                          key={row.key}
                          data-testid={rowTestId ?? `${testId}-row`}
                          className="text-body text-fg-secondary"
                        >
                          {renderRow(row)}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The rows under their headings: groups in their order, rows in theirs. */
function grouped<Row>(
  rows: readonly Row[],
  groupBy: (row: Row) => { id: string; label: string; order: number },
): Array<{ id: string; label: string; order: number; rows: Row[] }> {
  const groups = new Map<string, { id: string; label: string; order: number; rows: Row[] }>();
  for (const row of rows) {
    const group = groupBy(row);
    const found = groups.get(group.id);
    if (found === undefined) groups.set(group.id, { ...group, rows: [row] });
    else found.rows.push(row);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}
