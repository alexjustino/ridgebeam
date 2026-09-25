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
 * It stays pressable when there is nothing to list: opening it then says so, which is a fact the
 * reader checked, rather than a disabled control that says nothing.
 */
export function FigureRow<Row extends ReportRow>({
  figure,
  label,
  value,
  renderRow,
  rowsLabel,
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
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId();
  const broken = !traceable(figure);

  return (
    <div data-testid="figure" data-figure={figure.id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span id={`${id}-label`} className="text-body-lg font-semibold text-fg">
          {label}
        </span>
        <button
          type="button"
          data-testid="figure-value"
          aria-expanded={open}
          aria-controls={`${id}-rows`}
          aria-describedby={`${id}-label ${id}-hint`}
          onClick={() => setOpen((value) => !value)}
          className={[
            'rounded-md px-2 font-display text-display font-semibold text-fg tabular-nums',
            'transition-colors duration-100 ease-easy hover:bg-card-hover active:bg-card-active',
          ].join(' ')}
        >
          {broken ? '—' : value}
        </button>
        <span id={`${id}-hint`} className="text-caption text-fg-tertiary">
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
            {figure.rows.map((row) => (
              <li key={row.key} data-testid="figure-row" className="text-body text-fg-secondary">
                {renderRow(row)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
