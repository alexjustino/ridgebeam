import {
  Add20Regular,
  ArrowCounterclockwise20Regular,
  Dismiss16Regular,
  LockClosed20Regular,
  Play20Regular,
} from '@fluentui/react-icons';
import { useId, useState } from 'react';

import { LIMITS, type Answer } from '@/data/commands';
import { useAnswerCheck, useCloseStage, useReopenStage, useStartStage } from '@/data/queries';
import {
  gateStatus,
  GATES,
  stageActionProblem,
  stageState,
  validateAnswer,
  type GateItem,
} from '@/domain/checks';
import { stagesInOrder, type Check, type Stage, type WorkSnapshot } from '@/domain/plan';
import { PhotoThumb } from '@/features/diary/PhotoThumb';
import type { MessageKey } from '@/i18n/en';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { TextArea } from '@/ui/TextArea';

const ANSWER_KEYS: Record<Answer, MessageKey> = {
  yes: 'gates.yes',
  no: 'gates.no',
  na: 'gates.na',
};

/**
 * The stage's gates (slice F5, ADR-022): one card per stage, in order, with where it stands, its
 * two checklists and the act each gate allows.
 *
 * Every answer is a fact kept for good — answering again appends, and the latest counts. Not
 * applicable always carries its reason, asked in a small dialog. An answer may bring a photo (the
 * inspection is a check with a photo), chosen as a path and sent with the next answer pressed on
 * that item; the host copies it in exactly as it copies the diary's. A gate that holds says which
 * items hold it beside the button it disables — never just "no" (DESIGN_SYSTEM §8). Starting cannot
 * be undone, and the question says so; a closed stage can be reopened.
 */
export function GatesTab({ snapshot }: { snapshot: WorkSnapshot }) {
  const { t } = useI18n();
  const stages = stagesInOrder(snapshot);

  if (stages.length === 0) {
    return (
      <Card>
        <EmptyState
          title={t('plan.stages.emptyTitle')}
          description={t('plan.stages.emptyDescription')}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-3xl text-body text-fg-secondary">{t('gates.lead')}</p>
      <ol className="flex flex-col gap-3">
        {stages.map((stage) => (
          <StageGates key={stage.id} stage={stage} snapshot={snapshot} />
        ))}
      </ol>
    </div>
  );
}

function StageGates({ stage, snapshot }: { stage: Stage; snapshot: WorkSnapshot }) {
  const { t, tp, day, describeError } = useI18n();
  const start = useStartStage();
  const close = useCloseStage();
  const reopen = useReopenStage();
  const [asking, setAsking] = useState<'start' | 'close' | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const state = stageState(stage);

  const action = state === 'planned' ? 'start' : state === 'started' ? 'close' : 'reopen';
  const problem = stageActionProblem(snapshot, stage.id, action);
  const holding = problem?.code === 'gate-open' ? problem.items : [];

  const stateText =
    state === 'closed' && stage.closedAt !== null
      ? t('stage.state.closed', { day: day(stage.closedAt.slice(0, 10)) })
      : state === 'started' && stage.startedAt !== null
        ? t('stage.state.started', { day: day(stage.startedAt.slice(0, 10)) })
        : t('stage.state.planned');

  const done = () => setRefusal(null);
  const refused = (error: unknown) => setRefusal(describeError(error));

  return (
    <li data-stage-id={stage.id}>
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="min-w-0 flex-1 truncate text-body-lg font-semibold text-fg">
            {stage.name}
          </h3>
          <span
            data-testid="stage-state"
            data-state={state}
            className={[
              'rounded-md px-2 py-0.5 text-caption',
              state === 'closed'
                ? 'bg-success-subtle text-fg'
                : state === 'started'
                  ? 'bg-info-subtle text-fg'
                  : 'bg-card-hover text-fg-secondary',
            ].join(' ')}
          >
            {stateText}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {GATES.map((gate) => (
            <GateList
              key={gate}
              snapshot={snapshot}
              gate={gate}
              items={gateStatus(stage, snapshot.checks, snapshot.checkAnswers, gate).items}
              readOnly={state === 'closed'}
              onKept={done}
              onRefused={refused}
            />
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t border-stroke-subtle pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {state === 'planned' && (
              <Button
                appearance="accent"
                icon={<Play20Regular />}
                data-testid="stage-start"
                disabled={problem !== null || start.isPending}
                onClick={() => setAsking('start')}
              >
                {t('gates.start')}
              </Button>
            )}
            {state === 'started' && (
              <Button
                appearance="accent"
                icon={<LockClosed20Regular />}
                data-testid="stage-close"
                disabled={problem !== null || close.isPending}
                onClick={() => setAsking('close')}
              >
                {t('gates.close')}
              </Button>
            )}
            {state === 'closed' && (
              <Button
                icon={<ArrowCounterclockwise20Regular />}
                data-testid="stage-reopen"
                disabled={reopen.isPending}
                onClick={() => reopen.mutate(stage.id, { onSuccess: done, onError: refused })}
              >
                {t('gates.reopen')}
              </Button>
            )}
          </div>
          {holding.length > 0 && (
            <div data-testid="gate-holding" className="text-caption text-fg-secondary">
              <p>{tp('gates.holding', holding.length)}</p>
              <ul className="ml-4 list-disc">
                {holding.map((item) => (
                  <li key={item.check.id}>{item.check.name}</li>
                ))}
              </ul>
            </div>
          )}
          {problem?.code === 'not-started' && (
            <p className="text-caption text-fg-secondary">{t('gates.notStarted')}</p>
          )}
          {refusal !== null && (
            <InfoBar severity="danger" title={t('gates.refused')}>
              {refusal}
            </InfoBar>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={asking !== null}
        title={
          asking === 'start'
            ? t('gates.confirm.startTitle', { name: stage.name })
            : t('gates.confirm.closeTitle', { name: stage.name })
        }
        confirmLabel={asking === 'start' ? t('gates.start') : t('gates.close')}
        pending={start.isPending || close.isPending}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const mutation = asking === 'start' ? start : close;
          mutation.mutate(stage.id, {
            onSuccess: () => {
              done();
              setAsking(null);
            },
            onError: (error) => {
              refused(error);
              setAsking(null);
            },
          });
        }}
      >
        {asking === 'start' ? t('gates.confirm.startBody') : t('gates.confirm.closeBody')}
      </ConfirmDialog>
    </li>
  );
}

function GateList({
  snapshot,
  gate,
  items,
  readOnly,
  onKept,
  onRefused,
}: {
  snapshot: WorkSnapshot;
  gate: 'start' | 'close';
  items: readonly GateItem[];
  readOnly: boolean;
  onKept: () => void;
  onRefused: (error: unknown) => void;
}) {
  const { t } = useI18n();
  const term = useTerms();
  const heading = useId();

  return (
    <section data-gate={gate} aria-labelledby={heading} className="flex flex-col gap-1">
      <h4 id={heading} className="text-caption font-semibold text-fg-secondary">
        {term(gate === 'start' ? 'startGate' : 'closeGate', { capital: true })}
      </h4>
      {items.length === 0 ? (
        <p className="text-caption text-fg-tertiary">{t('gates.noChecks')}</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <GateItemLine
              key={item.check.id}
              item={item}
              snapshot={snapshot}
              readOnly={readOnly}
              onKept={onKept}
              onRefused={onRefused}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function GateItemLine({
  item,
  snapshot,
  readOnly,
  onKept,
  onRefused,
}: {
  item: GateItem;
  snapshot: WorkSnapshot;
  readOnly: boolean;
  onKept: () => void;
  onRefused: (error: unknown) => void;
}) {
  const { t, day } = useI18n();
  const answer = useAnswerCheck();
  const [pathField, setPathField] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [naOpen, setNaOpen] = useState(false);
  const check: Check = item.check;
  const latest = item.latest;

  const send = (value: Answer, reason: string | null, after?: () => void) =>
    answer.mutate(
      {
        checkId: check.id,
        answer: value,
        reason,
        photoPath: pending,
        photoHash: null,
      },
      {
        onSuccess: () => {
          setPending(null);
          onKept();
          after?.();
        },
        onError: onRefused,
      },
    );

  const latestText =
    latest === null
      ? t('gates.unanswered')
      : latest.answer === 'na'
        ? t('gates.latest.na', {
            reason: latest.reason ?? '',
            author: latest.authorName,
            day: day(latest.answeredAt.slice(0, 10)),
          })
        : t(latest.answer === 'yes' ? 'gates.latest.yes' : 'gates.latest.no', {
            author: latest.authorName,
            day: day(latest.answeredAt.slice(0, 10)),
          });

  return (
    <li
      data-check-id={check.id}
      data-holds={item.holds ? 'true' : 'false'}
      className="flex flex-col gap-1.5 border-t border-stroke-subtle py-2 first:border-t-0"
    >
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-body text-fg">{check.name}</span>
          <span
            data-testid="check-latest"
            className={
              item.holds && latest !== null
                ? 'block text-caption font-semibold text-fg-secondary'
                : 'block text-caption text-fg-secondary'
            }
          >
            {latestText}
          </span>
        </span>
        {latest !== null && latest.photoHash !== null && (
          <PhotoThumb
            size="sm"
            day={latest.answeredAt.slice(0, 10)}
            photo={{
              fileHash: latest.photoHash,
              fileName: check.name,
              bytes: 0,
              width: 0,
              height: 0,
              thumbnail: true,
            }}
          />
        )}
      </div>
      {!readOnly && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {(['yes', 'no', 'na'] as const).map((value) => (
              <Button
                key={value}
                appearance={latest?.answer === value ? 'accent' : 'standard'}
                data-testid={`check-answer-${value}`}
                aria-label={t('gates.answerOf', {
                  answer: t(ANSWER_KEYS[value]),
                  name: check.name,
                })}
                disabled={answer.isPending}
                onClick={() => (value === 'na' ? setNaOpen(true) : send(value, null))}
              >
                {t(ANSWER_KEYS[value])}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1">
            <Input
              data-testid="check-answer-photo-path"
              aria-label={t('gates.photo.path', { name: check.name })}
              placeholder={t('diary.photos.path')}
              className="font-mono"
              spellCheck={false}
              value={pathField}
              onChange={(event) => setPathField(event.target.value)}
            />
            <Button
              icon={<Add20Regular />}
              data-testid="check-answer-photo-add"
              onClick={() => {
                if (pathField.trim() !== '') setPending(pathField.trim());
                setPathField('');
              }}
            >
              {t('diary.photos.add')}
            </Button>
          </div>
          {pending !== null && (
            <div
              data-pending-photo={pending}
              className="flex items-center gap-2 text-caption text-fg-secondary"
            >
              <span className="min-w-0 flex-1 truncate">
                {t('gates.photo.pending', { name: pending.split(/[\\/]/).pop() ?? pending })}
              </span>
              <button
                type="button"
                aria-label={t('diary.photos.remove', {
                  name: pending.split(/[\\/]/).pop() ?? pending,
                })}
                title={t('diary.photos.remove', { name: pending.split(/[\\/]/).pop() ?? pending })}
                onClick={() => setPending(null)}
                className="grid size-6 place-items-center rounded-sm hover:bg-card-hover"
              >
                <Dismiss16Regular aria-hidden="true" />
              </button>
            </div>
          )}
        </>
      )}
      <NotApplicableDialog
        open={naOpen}
        check={check}
        snapshot={snapshot}
        pending={answer.isPending}
        onCancel={() => setNaOpen(false)}
        onConfirm={(reason) => send('na', reason, () => setNaOpen(false))}
      />
    </li>
  );
}

function NotApplicableDialog({
  open,
  check,
  snapshot,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  check: Check;
  snapshot: WorkSnapshot;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t, number } = useI18n();
  const field = useId();
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const close = () => {
    setReason('');
    setProblem(null);
    onCancel();
  };

  return (
    <Modal open={open} label={t('gates.na.title', { name: check.name })} onClose={close}>
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          const problems = validateAnswer(snapshot, check.id, 'na', reason);
          if (problems.some((each) => each.code === 'na-without-reason')) {
            setProblem(t('gates.problem.naReason'));
            return;
          }
          if (problems.some((each) => each.code === 'reason-too-long')) {
            setProblem(t('gates.problem.reasonLong', { max: number(LIMITS.answerReason) }));
            return;
          }
          setProblem(null);
          onConfirm(reason.trim());
          setReason('');
        }}
      >
        <h2 className="text-body-lg font-semibold text-fg">
          {t('gates.na.title', { name: check.name })}
        </h2>
        <label htmlFor={field} className="text-caption font-semibold text-fg-secondary">
          {t('gates.na.reason')}
        </label>
        <TextArea
          id={field}
          data-testid="na-reason"
          aria-required="true"
          maxLength={LIMITS.answerReason}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {problem !== null && (
          <div data-testid="na-problem">
            <InfoBar severity="caution" title={t('gates.refused')}>
              {problem}
            </InfoBar>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={close} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" appearance="accent" data-testid="na-confirm" disabled={pending}>
            {pending ? t('common.working') : t('gates.na.confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
