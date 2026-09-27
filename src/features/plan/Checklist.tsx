import { Checkmark12Filled, Edit20Regular } from '@fluentui/react-icons';

import { useDiary } from '@/data/queries';
import { checklist, type ChecklistMissing } from '@/domain/arrangements';
import { progress, type ProgressState } from '@/domain/diary';
import type { WorkSnapshot } from '@/domain/plan';
import { schedule } from '@/domain/schedule';
import type { MessageKey } from '@/i18n/en';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';

const MISSING: Record<ChecklistMissing, MessageKey> = {
  duration: 'readiness.row.activity.duration',
  responsible: 'readiness.row.activity.responsible',
  linked: 'readiness.row.activity.linked',
};

/**
 * The owner's checklist: the same rows as the breakdown, one line each, in the order the schedule
 * places them (start, then breakdown order) (DESIGN_SYSTEM §8: the same rows, never a copy).
 *
 * The box at the start of a line is drawn, not a control. Nothing on the plan says what is done —
 * that is the diary's to say, from the day it arrives (SPEC §2.6) — so there is nothing here to
 * press, and the note above the list says why. A line whose plan lacks something says what, in
 * the words readiness uses, so the two can never disagree.
 */
export function Checklist({
  snapshot,
  onEdit,
}: {
  snapshot: WorkSnapshot;
  onEdit: (activityId: string) => void;
}) {
  const { t, tp, day, number } = useI18n();
  const term = useTerms();
  const lines = checklist(snapshot, schedule(snapshot));
  const diary = useDiary(true);
  const states = progress(snapshot, diary.data ?? []);
  const activities = new Map(snapshot.activities.map((activity) => [activity.id, activity]));
  const stageNames = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  const people = new Map(snapshot.people.map((person) => [person.id, person.name]));

  if (lines.length === 0) {
    return (
      <Card>
        <EmptyState
          title={t('plan.checklist.emptyTitle')}
          description={t('plan.checklist.emptyDescription')}
        />
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-caption text-fg-tertiary">
        {[
          term('activity', { capital: true }),
          term('stage', { capital: true }),
          term('responsible', { capital: true }),
          term('duration', { capital: true }),
          term('quantity', { capital: true }),
        ].join(' — ')}
      </p>
      <p className="mt-1 mb-3 text-body text-fg-secondary">{t('plan.checklist.note')}</p>
      <ol className="flex flex-col">
        {lines.map((line) => {
          const activity = activities.get(line.activityId);
          if (activity === undefined) return null;
          const responsible =
            activity.responsibleId === null ? null : (people.get(activity.responsibleId) ?? null);
          const known = states.get(line.activityId);
          const state: ProgressState = known?.state ?? 'not-started';
          const stateText =
            state === 'finished'
              ? t('state.finished', { day: day(known?.finishedOn ?? '') })
              : state === 'started'
                ? t('state.started', { day: day(known?.startedOn ?? '') })
                : t('state.notStarted');
          const parts = [
            stageNames.get(line.stageId) ?? '',
            responsible ?? '',
            activity.durationDays === null ? '' : tp('plan.checklist.days', activity.durationDays),
            activity.quantity === null
              ? ''
              : [number(activity.quantity), activity.unit ?? ''].join(' ').trim(),
            line.start === null ? '' : t('plan.checklist.from', { day: day(line.start) }),
          ].filter((part) => part !== '');
          return (
            <li
              key={line.activityId}
              data-checklist-line={line.activityId}
              data-done={state}
              className="flex items-start gap-3 border-t border-stroke-subtle py-2 first:border-t-0"
            >
              {/* A drawn box, ticked by the diary (ADR-020). Not a control, so not in the tab
                  order and not announced as one; the state is said in words beside it. */}
              <DrawnBox state={state} />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-fg">{activity.name}</span>
                <span className="block text-caption text-fg-secondary">{stateText}</span>
                <span className="block text-caption text-fg-secondary">{parts.join(' — ')}</span>
                {line.missing.length > 0 && (
                  <span className="block text-caption text-fg-secondary">
                    {line.missing.map((missing) => t(MISSING[missing])).join(' · ')}
                  </span>
                )}
              </span>
              <Button
                appearance="subtle"
                icon={<Edit20Regular />}
                onClick={() => onEdit(line.activityId)}
              >
                {t('plan.editInBreakdown')}
              </Button>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** The line's box: empty, marked from one side once started, filled and ticked once finished. */
function DrawnBox({ state }: { state: ProgressState }) {
  if (state === 'finished') {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm border border-accent bg-accent text-fg-on-accent"
      >
        <Checkmark12Filled />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="relative mt-0.5 size-4 shrink-0 overflow-hidden rounded-sm border border-stroke-strong"
    >
      {state === 'started' && <span className="absolute inset-y-0 left-0 w-1/2 bg-accent" />}
    </span>
  );
}
