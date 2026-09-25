import { Edit20Regular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { useToday } from '@/app/today';
import { useReopenDecision } from '@/data/queries';
import { byUrgency, decisionRows, type DecisionRow } from '@/domain/decisions';
import type { WorkSnapshot } from '@/domain/plan';
import { schedule } from '@/domain/schedule';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';

import { MakeDecisionDialog } from './MakeDecisionDialog';
import { StatusChip } from './StatusChip';

/**
 * What to decide (slice F3): every decision of the work, overdue first, then due, then the ones
 * whose deadline is not yet known, made last — each with its stage, its lead time, its computed
 * deadline and where today stands against it (ADR-017: a deadline is never typed).
 *
 * The owner's page: a decision is made or reopened here in one press; its name and lead time are
 * edited where the plan is edited, and each row leads there.
 */
export function DecisionsPage({
  snapshot,
  onEdit,
}: {
  snapshot: WorkSnapshot;
  onEdit: (decisionId: string) => void;
}) {
  const { t, describeError } = useI18n();
  const today = useToday();
  const scheduled = useMemo(() => schedule(snapshot), [snapshot]);
  const rows = byUrgency(decisionRows(snapshot, scheduled, today));
  const [making, setMaking] = useState<{ id: string; name: string } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">{t('nav.decisions')}</h1>
        <p className="mt-1 text-body-lg text-fg">{snapshot.work.name}</p>
        <p className="mt-1 max-w-3xl text-body text-fg-secondary">{t('decisions.lead')}</p>
      </header>

      {refusal !== null && (
        <InfoBar severity="danger" title={t('decisions.refused')}>
          {refusal}
        </InfoBar>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title={t('decisions.empty.title')}
            description={t('decisions.empty.description')}
          />
        </Card>
      ) : (
        <Card>
          <ol aria-label={t('decisions.list')} className="flex flex-col">
            {rows.map((row) => (
              <DecisionItem
                key={row.decisionId}
                row={row}
                onMake={() => setMaking({ id: row.decisionId, name: row.name })}
                onEdit={() => onEdit(row.decisionId)}
                onRefused={(error) => setRefusal(describeError(error))}
                onKept={() => setRefusal(null)}
              />
            ))}
          </ol>
        </Card>
      )}

      <MakeDecisionDialog
        decision={making}
        onClose={() => setMaking(null)}
        onMade={() => {
          setRefusal(null);
          setMaking(null);
        }}
      />
    </div>
  );
}

function DecisionItem({
  row,
  onMake,
  onEdit,
  onRefused,
  onKept,
}: {
  row: DecisionRow;
  onMake: () => void;
  onEdit: () => void;
  onRefused: (error: unknown) => void;
  onKept: () => void;
}) {
  const { t, tp, day } = useI18n();
  const term = useTerms();
  const reopen = useReopenDecision();

  return (
    <li
      data-decision-id={row.decisionId}
      className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-stroke-subtle py-3 first:border-t-0"
    >
      <div className="min-w-0 flex-1">
        <p className="text-body-lg font-semibold text-fg">{row.name}</p>
        <p className="text-caption text-fg-secondary">
          {[
            row.stageName ?? '',
            t('decisions.leadTime', {
              lead: tp('plan.checklist.days', row.leadTimeDays),
            }),
            [
              term('deadline', { capital: true }),
              row.deadline === null ? t('decisions.deadline.unknown') : day(row.deadline),
            ].join(': '),
          ]
            .filter((part) => part !== '')
            .join(' — ')}
        </p>
        {row.answer !== null && (
          <p className="mt-1 text-caption text-fg-secondary">
            {t('decisions.answered', { answer: row.answer })}
          </p>
        )}
      </div>
      <StatusChip row={row} />
      <div className="flex items-center gap-1">
        {row.status === 'made' ? (
          <Button
            data-testid="decision-reopen"
            disabled={reopen.isPending}
            onClick={() => reopen.mutate(row.decisionId, { onSuccess: onKept, onError: onRefused })}
          >
            {t('decisions.reopen')}
          </Button>
        ) : (
          <Button appearance="accent" data-testid="decision-make" onClick={onMake}>
            {t('decisions.make')}
          </Button>
        )}
        <Button appearance="subtle" icon={<Edit20Regular />} onClick={onEdit}>
          {t('plan.editInBreakdown')}
        </Button>
      </div>
    </li>
  );
}
