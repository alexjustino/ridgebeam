import { ArrowSync20Regular } from '@fluentui/react-icons';
import { useId, useState } from 'react';

import { LIMITS } from '@/data/commands';
import { useReplanOpen } from '@/data/queries';
import { focusReplanningNext } from '@/features/schedule/replanningFocus';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { Modal } from '@/ui/Modal';
import { TextArea } from '@/ui/TextArea';

/**
 * Replanning an approved plan: one question, and it is required — why does the plan change
 * (ADR-027)? The same dialog wherever the way out is offered: the Schedule page's baseline card and
 * the breakdown's locked-plan banner. A blank reason is said here and never sent; whatever the host
 * refuses is said in its own words in the same place. Nothing about the plan changes by opening a
 * replanning: it only lets the edits through, and the next baseline keeps the reason.
 */
export function ReplanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, number, describeError } = useI18n();
  const term = useTerms();
  const replan = useReplanOpen();
  const field = useId();
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const close = () => {
    replan.reset();
    setReason('');
    setProblem(null);
    onClose();
  };

  const title = t('replan.title');

  return (
    <Modal open={open} label={title} onClose={close}>
      <form
        className="flex flex-col gap-4 p-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = reason.trim();
          if (trimmed === '') {
            setProblem(t('replan.blank', { reason: term('reason') }));
            return;
          }
          setProblem(null);
          replan.mutate(trimmed, {
            onSuccess: () => {
              announce(t('replan.opened', { reason: trimmed }));
              focusReplanningNext();
              close();
            },
            onError: (error) => setProblem(describeError(error)),
          });
        }}
      >
        <h2 className="text-body-lg font-semibold text-fg">{title}</h2>
        <p className="text-body text-fg-secondary">{t('replan.body')}</p>
        <div className="flex flex-col gap-1">
          <label htmlFor={field} className="text-caption font-semibold text-fg-secondary">
            {term('reason', { capital: true })}
          </label>
          <TextArea
            id={field}
            data-testid="replan-reason"
            maxLength={LIMITS.replanReason}
            aria-required="true"
            aria-invalid={problem !== null}
            aria-describedby={`${field}-hint`}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (problem !== null) setProblem(null);
            }}
          />
          <span id={`${field}-hint`} className="text-caption text-fg-tertiary">
            {t('replan.hint', { max: number(LIMITS.replanReason) })}
          </span>
        </div>
        {problem !== null && (
          <div data-testid="replan-problem">
            <InfoBar severity="caution" title={t('replan.refused')}>
              {problem}
            </InfoBar>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={close} disabled={replan.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            appearance="accent"
            data-testid="replan-confirm"
            disabled={replan.isPending}
          >
            {replan.isPending ? t('common.working') : t('replan.confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** "Replan…": the button that opens the dialog — the way out of a locked plan, wherever it is offered. */
export function ReplanButton({ appearance = 'standard' }: { appearance?: 'accent' | 'standard' }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        appearance={appearance}
        icon={<ArrowSync20Regular />}
        data-testid="replan-open"
        onClick={() => setOpen(true)}
      >
        {t('replan.open')}
      </Button>
      <ReplanDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
