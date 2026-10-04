import { useId, useState, type FormEvent } from 'react';

import { useApplyPlan } from '@/data/queries';
import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';

import { keepNotes } from './notes';
import { countsText } from './plan';
import { TemplatePicker } from './TemplatePicker';
import { useTemplateChoice } from './useTemplateChoice';

/**
 * Start an empty work's plan from a template (F9): the New work form's picker, in a dialog, offered
 * by the breakdown while the work has no stage (`template-start`). The template is written as the
 * work's own plan in one host step (`plan_apply`) — once: nothing links back to it afterwards.
 *
 * Success removes the button that opened the dialog (the work now has stages), so the dialog cannot
 * hand the focus back to it: `onApplied` tells the breakdown, which puts the focus on its heading
 * once the new plan is drawn — the F8 lesson of the replan dialog.
 */
export function StartFromTemplateDialog({
  snapshot,
  open,
  onClose,
  onApplied,
}: {
  snapshot: WorkSnapshot;
  open: boolean;
  onClose: () => void;
  /** Called with the plan as it was before, once the host has written the template's. */
  onApplied: (before: WorkSnapshot) => void;
}) {
  const { t, tp, describeError } = useI18n();
  const term = useTerms();
  const apply = useApplyPlan();
  const template = useTemplateChoice({ allowEmpty: false });
  const heading = useId();
  const [resolving, setResolving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const close = () => {
    apply.reset();
    setRefusal(null);
    onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRefusal(null);
    setResolving(true);
    const chosen = await template.resolve();
    setResolving(false);
    if (chosen.kind !== 'plan') return;
    const { plan } = chosen;
    const before = snapshot;
    apply.mutate(plan.plan, {
      onSuccess: () => {
        keepNotes({ workId: snapshot.work.workId, title: plan.title, notes: plan.notes });
        announce(
          t('templates.applied', { title: plan.title, counts: countsText(plan.counts, tp) }),
        );
        onApplied(before);
        close();
      },
      onError: (error) => setRefusal(describeError(error)),
    });
  };

  const pending = resolving || apply.isPending;
  const title = t('templates.start.title', { template: term('template') });

  return (
    <Modal open={open} label={title} onClose={close} width="lg">
      <form
        aria-labelledby={heading}
        className="flex min-h-0 flex-col"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
          <div>
            <h2 id={heading} className="text-subtitle font-semibold text-fg">
              {title}
            </h2>
            <p className="mt-1 text-body text-fg-secondary">{t('templates.start.lead')}</p>
          </div>
          <TemplatePicker state={template} hostProblem={refusal} />
        </div>
        <div className="flex justify-end gap-2 border-t border-stroke-subtle p-4">
          <Button onClick={close} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" appearance="accent" data-testid="template-apply" disabled={pending}>
            {pending ? t('common.working') : t('templates.apply')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
