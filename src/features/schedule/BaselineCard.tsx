import { CheckmarkCircle20Regular, Camera20Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import { useTakeBaseline } from '@/data/queries';
import { latestBaseline, type WorkSnapshot } from '@/domain/plan';
import { baselineDraft, type Schedule } from '@/domain/schedule';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';

import { ReplanButton } from './ReplanDialog';
import { useReplanningFocus } from './replanningFocus';

/**
 * The baseline card: approving the plan, and then replanning it (F2, F8 — ADR-027).
 *
 * Before approval: **Approve the plan**, which keeps today's schedule as baseline 1. After it, the
 * card says when and which baseline the plan is measured against, and offers the one way to change
 * an approved plan — **Replan…**, which asks why. While a replanning is open, its reason is on the
 * card and **Take baseline N+1** closes it: the same draft as the approval, the schedule as it is
 * now, and the host keeps the reason with it. There is no discard: an edit already in the file is
 * not silent, so a replanning ends in a baseline.
 */
export function BaselineCard({
  snapshot,
  scheduled,
}: {
  snapshot: WorkSnapshot;
  scheduled: Schedule;
}) {
  const { t, day, describeError } = useI18n();
  const replanningFocus = useReplanningFocus();
  const term = useTerms();
  const take = useTakeBaseline();
  const [refusal, setRefusal] = useState<string | null>(null);
  const baseline = latestBaseline(snapshot);
  const replanning = snapshot.replanning;

  const takeBaseline = () => {
    const draft = baselineDraft(snapshot, scheduled);
    take.mutate(
      {
        rows: draft.rows.map((row) => ({
          activityId: row.activityId,
          start: row.start,
          finish: row.finish,
        })),
        finishDate: draft.finishDate,
      },
      {
        onSuccess: (next) => {
          setRefusal(null);
          const taken = latestBaseline(next);
          if (taken !== null) {
            announce(
              t('schedule.approvedOn', { day: day(taken.takenAt.slice(0, 10)) }) +
                ` · ${term('baseline', { capital: true })} ${taken.number}`,
            );
          }
        },
        onError: (error) => setRefusal(describeError(error)),
      },
    );
  };

  return (
    <Card title={term('baseline', { capital: true })}>
      {snapshot.work.approvedAt === null || baseline === null ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-body text-fg-secondary">
            {scheduled.cyclic ? t('schedule.approve.cannot') : t('schedule.approve.note')}
          </p>
          <Button
            appearance="accent"
            icon={<CheckmarkCircle20Regular />}
            data-testid="plan-approve"
            disabled={take.isPending || scheduled.cyclic}
            onClick={takeBaseline}
          >
            {take.isPending ? t('common.working') : t('schedule.approve')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="text-body-lg font-semibold text-fg">
            {t('schedule.approvedOn', { day: day(snapshot.work.approvedAt.slice(0, 10)) })}
            <span aria-hidden="true"> · </span>
            {term('baseline', { capital: true })}{' '}
            <span data-testid="baseline-number">{baseline.number}</span>
          </p>
          {replanning === null ? (
            <>
              <p className="text-caption text-fg-tertiary">{t('schedule.approved.note')}</p>
              <ReplanButton />
            </>
          ) : (
            <>
              <div
                ref={replanningFocus}
                tabIndex={-1}
                data-testid="replanning-open"
                className="w-full"
              >
                <InfoBar
                  severity="info"
                  title={t('replan.since', {
                    replanning: term('replanning', { capital: true }),
                    day: day(replanning.openedAt.slice(0, 10)),
                  })}
                >
                  <p>{replanning.reason}</p>
                </InfoBar>
              </div>
              <p className="text-caption text-fg-tertiary">{t('replan.take.note')}</p>
              <Button
                appearance="accent"
                icon={<Camera20Regular />}
                data-testid="baseline-take"
                disabled={take.isPending || scheduled.cyclic}
                onClick={takeBaseline}
              >
                {take.isPending
                  ? t('common.working')
                  : t('replan.take', {
                      baseline: term('baseline'),
                      number: baseline.number + 1,
                    })}
              </Button>
              {scheduled.cyclic && (
                <p className="text-caption text-fg-secondary">{t('schedule.approve.cannot')}</p>
              )}
            </>
          )}
        </div>
      )}
      {refusal !== null && (
        <div className="mt-3">
          <InfoBar severity="danger" title={t('schedule.approveRefused')}>
            {refusal}
          </InfoBar>
        </div>
      )}
    </Card>
  );
}
