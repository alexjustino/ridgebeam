import {
  gatesHeldFigure,
  STAGE_STATES,
  stagesFigure,
  STAGES_LABEL_KEYS,
  type GateHeldRow,
  type StageRow,
} from '@/domain/checks';
import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';

/**
 * The stages on the front door (slice F5): how many are planned, started and closed — one counted
 * figure per state, each opening onto its stages — and the gates held: the stages whose next gate
 * has an unanswered or "no" item while nothing before them is still open, opening onto each stage
 * and the items that hold it (the spec's "blocked"). Every figure is the domain's.
 */
export function StagesCard({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t, day, number } = useI18n();
  const term = useTerms();
  if (snapshot.stages.length === 0) return null;
  const held = gatesHeldFigure(snapshot);

  return (
    <Card>
      <div className="grid gap-4 md:grid-cols-4">
        {STAGE_STATES.map((state) => {
          const figure = stagesFigure(snapshot, state);
          return (
            <FigureRow<StageRow>
              key={state}
              testId={`stages-${state}`}
              size="title"
              figure={figure}
              label={t(STAGES_LABEL_KEYS[state])}
              value={number(figure.value)}
              rowsLabel={t('dashboard.stages.rows')}
              renderRow={(row) => (
                <>
                  <span className="font-semibold text-fg">{row.title}</span>
                  {row.day !== null && (
                    <>
                      <span aria-hidden="true"> — </span>
                      <span>{day(row.day)}</span>
                    </>
                  )}
                </>
              )}
            />
          );
        })}
        <FigureRow<GateHeldRow>
          testId="gates-held"
          size="title"
          figure={held}
          label={t('checks.figure.gatesHeld')}
          value={number(held.value)}
          rowsLabel={t('dashboard.gatesHeld.rows')}
          renderRow={(row) => (
            <>
              <span className="font-semibold text-fg">{row.title}</span>
              <span aria-hidden="true"> — </span>
              <span>{term(row.gate === 'start' ? 'startGate' : 'closeGate')}</span>
              <span aria-hidden="true"> — </span>
              <span>{row.holding.map((item) => item.check.name).join('; ')}</span>
            </>
          )}
        />
      </div>
    </Card>
  );
}
