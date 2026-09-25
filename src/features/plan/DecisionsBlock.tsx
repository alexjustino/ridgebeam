import {
  Add20Regular,
  ArrowDown20Regular,
  ArrowUp20Regular,
  Delete20Regular,
} from '@fluentui/react-icons';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { LIMITS } from '@/data/commands';
import { useAddDecision, useReopenDecision, useUpdateDecision } from '@/data/queries';
import { overdueOnCreation, type DecisionRow } from '@/domain/decisions';
import type { Direction } from '@/domain/ordering';
import type { Decision, Stage, WorkSnapshot } from '@/domain/plan';
import type { Schedule } from '@/domain/schedule';
import { StatusChip } from '@/features/decisions/StatusChip';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';

import { chordDirection } from './moves';
import { NameField } from './NameField';
import type { Outcome } from './outcome';

/** The columns of a decision row, shared with the block's column heads. */
const DECISION_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_7rem_minmax(0,11rem)_auto_auto] items-start gap-2';

/**
 * A stage's decisions, above its activities (slice F3): what somebody has to choose before the
 * stage can go ahead, each with its lead time — how long between deciding and having.
 *
 * The deadline and the status beside each one are computed, read-only: the stage's earliest
 * scheduled start less the lead time, on the working calendar, against today. They move when the
 * schedule moves, and nobody maintains them (ADR-017). A decision that is already late the moment
 * it is written down is not refused — the plan must be able to say the truth — but the row says
 * so, with the numbers that make it late.
 */
export function DecisionsBlock({
  stage,
  decisions,
  rows,
  snapshot,
  scheduled,
  today,
  outcome,
  focusRow,
  onFocused,
  onMove,
  onMake,
  onRemove,
}: {
  stage: Stage;
  decisions: readonly Decision[];
  rows: ReadonlyMap<string, DecisionRow>;
  snapshot: WorkSnapshot;
  scheduled: Schedule;
  today: string;
  outcome: Outcome;
  focusRow: string | null;
  onFocused: () => void;
  onMove: (decision: Decision, direction: Direction) => void;
  onMake: (decision: Decision) => void;
  onRemove: (decision: Decision) => void;
}) {
  const { t } = useI18n();
  const term = useTerms();

  return (
    <section
      data-testid="decisions"
      aria-label={t('plan.fieldOf', { field: t('decisions.title'), name: stage.name })}
      className="mb-3 rounded-lg border border-stroke-subtle bg-layer p-3"
    >
      <h4 className="mb-2 text-caption font-semibold text-fg-secondary">{t('decisions.title')}</h4>
      {decisions.length === 0 ? (
        <p className="mb-2 text-caption text-fg-tertiary">{t('decisions.none')}</p>
      ) : (
        <>
          <div
            aria-hidden="true"
            className={`${DECISION_COLUMNS} pb-1 text-caption font-semibold text-fg-tertiary`}
          >
            <span>{term('decision', { capital: true })}</span>
            <span>{t('decisions.column.lead', { lead: term('leadTime', { capital: true }) })}</span>
            <span>{term('deadline', { capital: true })}</span>
            <span>{t('decisions.column.status')}</span>
            <span />
          </div>
          <ul className="flex flex-col">
            {decisions.map((decision) => (
              <DecisionLine
                key={decision.id}
                decision={decision}
                row={rows.get(decision.id) ?? null}
                warning={
                  decision.madeAt === null
                    ? overdueOnCreation(snapshot, scheduled, today, stage.id, decision.leadTimeDays)
                    : null
                }
                stageName={stage.name}
                outcome={outcome}
                focus={focusRow === decision.id}
                onFocused={onFocused}
                onMove={(direction) => onMove(decision, direction)}
                onMake={() => onMake(decision)}
                onRemove={() => onRemove(decision)}
              />
            ))}
          </ul>
        </>
      )}
      <AddDecision stage={stage} outcome={outcome} />
    </section>
  );
}

function DecisionLine({
  decision,
  row,
  warning,
  stageName,
  outcome,
  focus,
  onFocused,
  onMove,
  onMake,
  onRemove,
}: {
  decision: Decision;
  row: DecisionRow | null;
  warning: { deadline: string; left: number } | null;
  stageName: string;
  outcome: Outcome;
  focus: boolean;
  onFocused: () => void;
  onMove: (direction: Direction) => void;
  onMake: () => void;
  onRemove: () => void;
}) {
  const { t, tp, day, number } = useI18n();
  const term = useTerms();
  const update = useUpdateDecision();
  const reopen = useReopenDecision();
  const hint = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [lead, setLead] = useState(String(decision.leadTimeDays));
  const [leadInvalid, setLeadInvalid] = useState(false);

  useEffect(() => {
    if (!focus) return;
    nameRef.current?.focus();
    nameRef.current?.scrollIntoView({ block: 'center' });
    onFocused();
  }, [focus, onFocused]);

  const editLead = (next: string) => {
    setLead(next);
    const days = Number(next);
    if (next.trim() === '' || !Number.isInteger(days) || days < 0 || days > LIMITS.durationDays) {
      setLeadInvalid(true);
      return;
    }
    setLeadInvalid(false);
    if (days !== decision.leadTimeDays) {
      update.mutate(
        { id: decision.id, patch: { leadTimeDays: days } },
        { onSuccess: outcome.kept, onError: outcome.refused },
      );
    }
  };

  const made = decision.madeAt !== null;

  return (
    <li
      data-decision-id={decision.id}
      className="flex flex-col gap-1.5 border-t border-stroke-subtle py-2 first:border-t-0"
      onKeyDown={(event) => {
        const direction = chordDirection(event);
        if (direction === null) return;
        event.preventDefault();
        event.stopPropagation();
        onMove(direction);
      }}
    >
      <div className={DECISION_COLUMNS}>
        <NameField
          ref={nameRef}
          testId="decision-name"
          value={decision.name}
          label={t('plan.fieldOf', {
            field: term('decision', { capital: true }),
            name: decision.name,
          })}
          onCommit={(name) =>
            update.mutate(
              { id: decision.id, patch: { name } },
              { onSuccess: outcome.kept, onError: outcome.refused },
            )
          }
        />
        <span className="flex flex-col">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={LIMITS.durationDays}
            step={1}
            data-testid="decision-lead"
            aria-label={t('plan.fieldOf', {
              field: term('leadTime', { capital: true }),
              name: decision.name,
            })}
            aria-invalid={leadInvalid}
            aria-describedby={leadInvalid ? `${hint}-lead` : undefined}
            value={lead}
            onChange={(event) => editLead(event.target.value)}
          />
          {leadInvalid && (
            <span id={`${hint}-lead`} className="mt-1 text-caption text-fg-secondary">
              {t('decisions.invalid.lead', { max: number(LIMITS.durationDays) })}
            </span>
          )}
        </span>
        <span data-testid="decision-deadline" className="pt-1.5 text-body text-fg">
          {row !== null && row.deadline !== null
            ? day(row.deadline)
            : t('decisions.deadline.unknown')}
        </span>
        <span className="pt-1">{row !== null && <StatusChip row={row} />}</span>
        <span className="flex items-center gap-0.5">
          {made ? (
            <Button
              appearance="subtle"
              data-testid="decision-reopen"
              disabled={reopen.isPending}
              onClick={() =>
                reopen.mutate(decision.id, { onSuccess: outcome.kept, onError: outcome.refused })
              }
            >
              {t('decisions.reopen')}
            </Button>
          ) : (
            <Button appearance="subtle" data-testid="decision-make" onClick={onMake}>
              {t('decisions.make')}
            </Button>
          )}
          <IconButton
            data-testid="decision-up"
            icon={<ArrowUp20Regular />}
            label={t('plan.move.up', { name: decision.name })}
            onClick={() => onMove('up')}
          />
          <IconButton
            data-testid="decision-down"
            icon={<ArrowDown20Regular />}
            label={t('plan.move.down', { name: decision.name })}
            onClick={() => onMove('down')}
          />
          <IconButton
            data-testid="decision-remove"
            icon={<Delete20Regular />}
            label={t('plan.removeNamed', { name: decision.name })}
            onClick={onRemove}
          />
        </span>
      </div>
      {made && decision.answer !== null && (
        <p className="text-caption text-fg-secondary">
          {t('decisions.answered', { answer: decision.answer })}
        </p>
      )}
      {warning !== null && (
        <div data-testid="decision-warning">
          <InfoBar severity="caution" title={t('decisions.warning.title')}>
            {warning.left > 0
              ? t('decisions.warning.body', {
                  lead: tp('plan.checklist.days', decision.leadTimeDays),
                  stage: stageName,
                  left: tp('plan.checklist.days', warning.left),
                })
              : t('decisions.warning.started', {
                  lead: tp('plan.checklist.days', decision.leadTimeDays),
                  stage: stageName,
                })}
          </InfoBar>
        </div>
      )}
    </li>
  );
}

function AddDecision({ stage, outcome }: { stage: Stage; outcome: Outcome }) {
  const { t, number } = useI18n();
  const term = useTerms();
  const add = useAddDecision();
  const hint = useId();
  const [name, setName] = useState('');
  const [lead, setLead] = useState('0');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const days = Number(lead === '' ? '0' : lead);
    if (name.trim() === '') {
      setProblem(t('plan.invalid.name'));
      return;
    }
    if (!Number.isInteger(days) || days < 0 || days > LIMITS.durationDays) {
      setProblem(t('decisions.invalid.lead', { max: number(LIMITS.durationDays) }));
      return;
    }
    setProblem(null);
    add.mutate(
      { stageId: stage.id, name: name.trim(), leadTimeDays: days },
      {
        onSuccess: () => {
          outcome.kept();
          setName('');
          setLead('0');
        },
        onError: outcome.refused,
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="mt-2 flex flex-col gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-2">
        <Input
          data-testid="decision-add-name"
          aria-label={t('plan.toAddIn', {
            what: term('decision', { capital: true }),
            where: stage.name,
          })}
          placeholder={t('plan.toAddIn', {
            what: term('decision', { capital: true }),
            where: stage.name,
          })}
          aria-describedby={problem !== null ? hint : undefined}
          maxLength={LIMITS.name}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={LIMITS.durationDays}
          step={1}
          data-testid="decision-add-lead"
          aria-label={t('decisions.newLead', { lead: term('leadTime', { capital: true }) })}
          value={lead}
          onChange={(event) => setLead(event.target.value)}
        />
        <Button
          type="submit"
          icon={<Add20Regular />}
          data-testid="decision-add"
          disabled={add.isPending}
        >
          {t('plan.add', { what: term('decision') })}
        </Button>
      </div>
      {problem !== null && (
        <span id={hint} className="text-caption text-fg-secondary">
          {problem}
        </span>
      )}
    </form>
  );
}
