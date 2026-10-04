import type { Figure } from '@/domain/figure';
import { NOT_PRICED_KEY, type MoneyRow } from '@/domain/money';
import { useI18n } from '@/i18n/useI18n';
import { FigureRow } from '@/ui/FigureRow';

/**
 * One money figure in a row of them: the amount as a button that opens onto the cost lines,
 * commitments or payments it adds up (DESIGN_SYSTEM §2, a number can be opened). Each row says what
 * it is, what it is for and its own amount, signed as the figure counts it. A cost line not priced
 * yet (F9) is still one of its rows, and says "not priced yet" where its amount would be: the figure
 * counted it as nothing, and says so rather than leaving it out.
 */
export function MoneyCell({
  figure,
  name,
  label,
  currency,
}: {
  figure: Figure<MoneyRow>;
  /** `planned`, `committed`, … — the test id is `<name>-value`, the rows `money-row`. */
  name: string;
  /** What the figure is, and of what: "Planned of Tiling". */
  label: string;
  currency: string;
}) {
  const { t, money, day } = useI18n();
  return (
    <FigureRow<MoneyRow>
      testId={name}
      rowTestId="money-row"
      size="cell"
      figure={figure}
      label={label}
      value={money(figure.value, currency)}
      rowsLabel={t('money.rows')}
      renderRow={(row) => (
        <>
          <span className="font-semibold text-fg">{row.label}</span>
          <span aria-hidden="true"> — </span>
          <span>
            {row.source === 'cost-line'
              ? t('money.row.costLine')
              : row.source === 'commitment'
                ? t('money.row.commitment')
                : t('money.row.payment', { seq: row.sourceId })}
          </span>
          {row.day !== null && (
            <>
              <span aria-hidden="true"> — </span>
              <span>{day(row.day)}</span>
            </>
          )}
          <span aria-hidden="true"> — </span>
          {row.priced ? (
            <span className="tabular-nums">{money(row.amountCents, currency)}</span>
          ) : (
            <span data-unpriced className="font-semibold text-fg">
              {t(NOT_PRICED_KEY)}
            </span>
          )}
        </>
      )}
    />
  );
}
