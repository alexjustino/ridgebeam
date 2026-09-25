import { useId, useState } from 'react';

import { LIMITS } from '@/data/commands';
import { useMakeDecision } from '@/data/queries';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { Modal } from '@/ui/Modal';
import { TextArea } from '@/ui/TextArea';

/**
 * Marking a decision made: one question and an optional answer — "Porcelain, grey" — kept with
 * the decision. The moment is the host's (`made_at` is set when the host keeps it), so nothing
 * here asks for a date.
 */
export function MakeDecisionDialog({
  decision,
  onClose,
  onMade,
}: {
  decision: { id: string; name: string } | null;
  onClose: () => void;
  onMade: () => void;
}) {
  const { t, number, describeError } = useI18n();
  const make = useMakeDecision();
  const field = useId();
  const [answer, setAnswer] = useState('');

  const close = () => {
    make.reset();
    setAnswer('');
    onClose();
  };

  return (
    <Modal
      open={decision !== null}
      label={decision === null ? '' : t('decisions.make.title', { name: decision.name })}
      onClose={close}
    >
      {decision !== null && (
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = answer.trim();
            make.mutate(
              { id: decision.id, answer: trimmed === '' ? null : trimmed },
              {
                onSuccess: () => {
                  setAnswer('');
                  onMade();
                },
              },
            );
          }}
        >
          <h2 className="text-body-lg font-semibold text-fg">
            {t('decisions.make.title', { name: decision.name })}
          </h2>
          <div className="flex flex-col gap-1">
            <label htmlFor={field} className="text-caption font-semibold text-fg-secondary">
              {t('decisions.answer')}
            </label>
            <TextArea
              id={field}
              data-testid="decision-answer"
              maxLength={LIMITS.answer}
              aria-describedby={`${field}-hint`}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
            <span id={`${field}-hint`} className="text-caption text-fg-tertiary">
              {t('decisions.answer.hint', { max: number(LIMITS.answer) })}
            </span>
          </div>
          {make.isError && (
            <InfoBar severity="danger" title={t('decisions.refused')}>
              {describeError(make.error)}
            </InfoBar>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={close} disabled={make.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              appearance="accent"
              data-testid="decision-make-confirm"
              disabled={make.isPending}
            >
              {make.isPending ? t('common.working') : t('decisions.make')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
