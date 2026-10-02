import type { ChangeImpactResult, ChangeImpactRow } from '@/domain/changes';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { FigureRow } from '@/ui/FigureRow';
import { InfoBar } from '@/ui/InfoBar';

import { changeDaysText, impactRowText, impactSentence, problemsText } from './changeWords';

/**
 * What a change does, as the schedule works it out (slice E1): one sentence — "Finishes 3 working
 * days later — on 14 November 2026 instead of 11 November 2026; costs $1,200.00 more." — and the
 * finish's move as a figure that opens onto every activity it moves, adds or takes away
 * (DESIGN_SYSTEM §2, _a number can be opened_). Shown before a change is raised, and again in the
 * dialog that decides it, always from the domain's `changeImpact` of the plan as it is now.
 *
 * A change the domain refuses is said with its sentences, and no impact is drawn: a number computed
 * from effects the plan cannot take would be a guess.
 */
export function ImpactPanel({
  result,
  currency,
  testId,
  label,
}: {
  result: ChangeImpactResult;
  currency: string;
  testId: string;
  label: string;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const term = useTerms();

  if (!result.ok) {
    return (
      <div data-testid={testId} data-impact="refused">
        <InfoBar severity="caution" title={t('changes.impact.refused')}>
          <ul className="flex flex-col gap-0.5">
            {problemsText(i18n, term, result.problems).map((each) => (
              <li key={each}>{each}</li>
            ))}
          </ul>
        </InfoBar>
      </div>
    );
  }

  const { impact } = result;
  return (
    <section
      data-testid={testId}
      data-impact="ok"
      data-days={impact.days ?? ''}
      aria-label={label}
      className="flex flex-col gap-2 rounded-md border border-stroke-subtle bg-layer px-3 py-2"
    >
      <p className="text-caption font-semibold text-fg-secondary">{label}</p>
      <p data-testid={`${testId}-sentence`} className="text-body-lg text-fg">
        {impactSentence(i18n, impact, currency)}
      </p>
      <FigureRow<ChangeImpactRow>
        testId={`${testId}-moved`}
        size="inline"
        figure={impact.moved}
        label={t('changes.figure.moved')}
        value={changeDaysText(i18n, impact.days)}
        rowsLabel={t('changes.figure.moved.rows')}
        renderRow={(row) => (
          <>
            <span className="font-semibold text-fg">{row.name}</span>
            <span aria-hidden="true"> — </span>
            <span>{impactRowText(i18n, row)}</span>
          </>
        )}
      />
      <p className="text-caption text-fg-tertiary">{t('changes.impact.note')}</p>
    </section>
  );
}
