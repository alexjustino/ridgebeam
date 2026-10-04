import { useState } from 'react';

import { useTakeRanges } from '@/data/queries';
import { stageState } from '@/domain/checks';
import { durationRangeOf, type WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';

/**
 * The activities a template gave a range and no duration (F9): a range is shown as a range until a
 * person picks (DESIGN_SYSTEM §8). Each can be picked in its row; these two buttons pick one end of
 * every range at once — **Use the upper end of each range** (`ranges-take-high`) and **Use the lower
 * end** (`ranges-take-low`) — an explicit act, never done for the person, and refused by the host
 * after approval like any duration edit, in its own sentence (`ranges-problem`).
 *
 * Counted as the host takes them: an activity of a closed stage is read-only until the stage is
 * reopened, so it is neither counted nor taken. Shown only while some activity outside a closed stage
 * has a range and no duration. Taking them removes these buttons,
 * so `onTaken` tells the breakdown, which puts the focus on its heading once the durations are drawn.
 */
export function RangesBar({
  snapshot,
  onTaken,
}: {
  snapshot: WorkSnapshot;
  /** Called with the plan as it was before, once the host has written the durations. */
  onTaken: (before: WorkSnapshot) => void;
}) {
  const { t, tp, describeError } = useI18n();
  const take = useTakeRanges();
  const [refusal, setRefusal] = useState<string | null>(null);

  const closed = new Set(
    snapshot.stages.filter((stage) => stageState(stage) === 'closed').map((stage) => stage.id),
  );
  const open = snapshot.activities.filter(
    (activity) =>
      !closed.has(activity.stageId) &&
      activity.durationDays === null &&
      durationRangeOf(activity) !== null,
  ).length;
  if (open === 0) return null;

  const go = (which: 'low' | 'high') => {
    const before = snapshot;
    take.mutate(which, {
      onSuccess: () => {
        setRefusal(null);
        announce(tp(which === 'high' ? 'ranges.taken.high' : 'ranges.taken.low', open));
        onTaken(before);
      },
      onError: (error) => setRefusal(describeError(error)),
    });
  };

  return (
    <div data-testid="ranges" className="flex flex-col gap-2">
      <InfoBar severity="info" title={t('ranges.title')}>
        <p>{tp('ranges.body', open)}</p>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:flex">
          <Button
            data-testid="ranges-take-high"
            disabled={take.isPending}
            onClick={() => go('high')}
          >
            {t('ranges.takeHigh')}
          </Button>
          <Button data-testid="ranges-take-low" disabled={take.isPending} onClick={() => go('low')}>
            {t('ranges.takeLow')}
          </Button>
        </div>
      </InfoBar>
      {refusal !== null && (
        <div data-testid="ranges-problem">
          <InfoBar severity="caution" title={t('plan.refused')}>
            {refusal}
          </InfoBar>
        </div>
      )}
    </div>
  );
}
