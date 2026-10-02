import { useId, useMemo, useState } from 'react';

import { useToday } from '@/app/today';
import { LIMITS } from '@/data/commands';
import { useDecideChange } from '@/data/queries';
import { changeImpact, type ChangeOrder, type ChangeOrderOutcome } from '@/domain/changes';
import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { Modal } from '@/ui/Modal';
import { TextArea } from '@/ui/TextArea';

import { changeName } from './changeWords';
import { ImpactPanel } from './ImpactPanel';

/** What is being decided: the change, and how. */
export interface ChangeToDecide {
  readonly change: ChangeOrder;
  readonly outcome: ChangeOrderOutcome;
}

const TITLE_KEYS = {
  approved: 'changes.decide.approve.title',
  declined: 'changes.decide.decline.title',
  withdrawn: 'changes.decide.withdraw.title',
} as const;

const BODY_KEYS = {
  approved: 'changes.decide.approve.body',
  declined: 'changes.decide.decline.body',
  withdrawn: 'changes.decide.withdraw.body',
} as const;

const CONFIRM_KEYS = {
  approved: 'changes.decide.approve.confirm',
  declined: 'changes.decide.decline.confirm',
  withdrawn: 'changes.decide.withdraw.confirm',
} as const;

/**
 * Deciding a change order, once (slice E1): **Approve**, **Decline** or **Withdraw**, each asked in
 * this dialog, which names the change, says what the decision does — and that it cannot be undone —
 * and **shows the impact again**, worked out by the schedule from the plan as it stands at this
 * moment (DESIGN_SYSTEM §8: an impact is shown before a decision, always). The note is optional.
 *
 * What is sent with the decision is that impact — the finish before and after, and the signed working
 * days — the fact of the moment of deciding, frozen by the host with the record. An approval applies
 * the change to the plan inside a replanning, in one transaction; a change the plan can no longer
 * take (an activity it names removed since) is said in the panel, and the approval is not offered
 * until it would hold — a decline or a withdrawal still is, with nothing to freeze.
 *
 * Its confirm button repeats the verb; a decline or a withdrawal is not drawn as danger, because
 * neither touches the plan — the wording carries what each does.
 */
export function DecideChangeDialog({
  snapshot,
  deciding,
  onClose,
  onDecided,
}: {
  snapshot: WorkSnapshot;
  deciding: ChangeToDecide | null;
  onClose: () => void;
  onDecided: (decided: ChangeToDecide) => void;
}) {
  const i18n = useI18n();
  const { t, number, describeError } = i18n;
  const term = useTerms();
  const today = useToday();
  const decide = useDecideChange();
  const field = useId();
  const [note, setNote] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  const impact = useMemo(
    () => (deciding === null ? null : changeImpact(snapshot, deciding.change)),
    [snapshot, deciding],
  );

  const close = () => {
    decide.reset();
    setNote('');
    setRefusal(null);
    onClose();
  };

  const name = deciding === null ? '' : changeName(i18n, term, deciding.change);
  const title = deciding === null ? '' : t(TITLE_KEYS[deciding.outcome], { name });
  const blocked = deciding?.outcome === 'approved' && impact !== null && !impact.ok;

  return (
    <Modal open={deciding !== null} label={title} onClose={close} width="lg">
      {deciding !== null && impact !== null && (
        <form
          data-testid="change-decide"
          data-outcome={deciding.outcome}
          className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (blocked) return;
            const frozen = impact.ok ? impact.impact : null;
            const trimmed = note.trim();
            decide.mutate(
              {
                id: deciding.change.id,
                outcome: deciding.outcome,
                decidedOn: today,
                note: trimmed === '' ? null : trimmed,
                finishBefore: frozen?.finishBefore ?? null,
                finishAfter: frozen?.finishAfter ?? null,
                daysDelta: frozen?.days ?? null,
              },
              {
                onSuccess: () => {
                  const decided = deciding;
                  setNote('');
                  setRefusal(null);
                  onDecided(decided);
                },
                onError: (error) => setRefusal(describeError(error)),
              },
            );
          }}
        >
          <h2 className="text-body-lg font-semibold text-fg">{title}</h2>
          <p className="text-body text-fg-secondary">
            {t(BODY_KEYS[deciding.outcome], { stage: term('stage') })}
          </p>
          {deciding.outcome === 'approved' &&
            deciding.change.costCents !== null &&
            deciding.change.costCents < 0 && (
              <p className="text-body text-fg-secondary">{t('changes.field.cost.negative')}</p>
            )}
          <ImpactPanel
            result={impact}
            currency={snapshot.work.currency}
            testId="change-impact"
            label={t('changes.decide.impact')}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor={field} className="text-caption font-semibold text-fg-secondary">
              {t('changes.decide.note')}
            </label>
            <TextArea
              id={field}
              data-testid="change-note"
              maxLength={LIMITS.changeNote}
              aria-describedby={`${field}-hint`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <span id={`${field}-hint`} className="text-caption text-fg-tertiary">
              {t('changes.decide.note.hint', { max: number(LIMITS.changeNote) })}
            </span>
          </div>
          {refusal !== null && (
            <div data-testid="change-decide-refused">
              <InfoBar severity="danger" title={t('changes.decide.refused')}>
                {refusal}
              </InfoBar>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={close} disabled={decide.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              appearance="accent"
              data-testid="change-confirm"
              disabled={decide.isPending || blocked}
            >
              {decide.isPending ? t('common.working') : t(CONFIRM_KEYS[deciding.outcome])}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
