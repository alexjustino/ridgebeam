import {
  Add20Regular,
  ArrowDown20Regular,
  DocumentText20Regular,
  ArrowUp20Regular,
  Delete20Regular,
  Rename20Regular,
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useToday } from '@/app/today';

import {
  useAddActivity,
  useAddStage,
  useRemoveActivity,
  useRemoveDecision,
  useRemoveStage,
  useRenameStage,
} from '@/data/queries';
import { breakdown } from '@/domain/arrangements';
import { stageState } from '@/domain/checks';
import { decisionRows } from '@/domain/decisions';
import {
  activitiesInOrder,
  decisionsOf,
  isLocked,
  latestBaseline,
  roomsInOrder,
  stagesInOrder,
  type Activity,
  type Decision,
  type Stage,
  type WorkSnapshot,
} from '@/domain/plan';
import { schedule } from '@/domain/schedule';
import { MakeDecisionDialog } from '@/features/decisions/MakeDecisionDialog';
import { DocumentsCount } from '@/features/documents/DocumentsCount';
import { ReplanButton } from '@/features/schedule/ReplanDialog';
import { useReplanningFocus } from '@/features/schedule/replanningFocus';
import { StartFromTemplateDialog } from '@/features/templates/StartFromTemplateDialog';
import { TemplateNotes } from '@/features/templates/TemplateNotes';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EmptyState } from '@/ui/EmptyState';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';

import { ACTIVITY_COLUMNS, ActivityRow } from './ActivityRow';
import { AddForm } from './AddForm';
import { CalendarCard } from './CalendarCard';
import { ChecksBlock } from './ChecksBlock';
import { CostLines } from './CostLines';
import { DecisionsBlock } from './DecisionsBlock';
import { useEndpointName } from './endpoints';
import { LinkChip, LinksLine } from './LinksLine';
import { chordDirection, useMover } from './moves';
import { NameField } from './NameField';
import type { Outcome } from './outcome';
import { PeopleCard } from './PeopleCard';
import { RangesBar } from './RangesBar';
import { useRewritten } from './rewritten';
import { RoomsCard } from './RoomsCard';

type Removal =
  | { kind: 'stage'; id: string; name: string; activities: number }
  | { kind: 'activity'; id: string; name: string }
  | { kind: 'decision'; id: string; name: string };

/**
 * The work breakdown: where the plan is edited.
 *
 * The working calendar (collapsed until asked for), the people, the rooms, and then the stages in
 * order, each numbered, each with its activities numbered under it — the same rows the other two
 * arrangements show, never a copy of them (DESIGN_SYSTEM §8). Every row can be moved one place by
 * its buttons or by Alt+ArrowUp/Down from any control in it, and where it went is announced.
 *
 * An approved plan is locked until somebody says why it changes (ADR-027): the breakdown says so at
 * the top and offers **Replan…**, but disables nothing — the refusal is the host's, and it is said
 * on the row that tried the edit (`stage-problem`, `activity-problem`, `link-problem`,
 * `cost-line-problem`), never only at the top of the page. One refusal at a time: the next edit
 * that is kept, or a refusal anywhere else, takes it away.
 *
 * A work with no stage can start from a template (F9, `template-start`); activities a template gave
 * a range and no duration are counted above the stages, with the two ways to take every range at
 * once (`RangesBar`). Either act rewrites the plan and removes the control that did it, so the focus
 * then goes to the breakdown's heading (`useRewritten`).
 */
export function Breakdown({
  snapshot,
  outcome,
  calendarOpen,
  onCalendarOpen,
  focusRow,
  onFocused,
}: {
  snapshot: WorkSnapshot;
  outcome: Outcome;
  calendarOpen: boolean;
  onCalendarOpen: (open: boolean) => void;
  focusRow: string | null;
  onFocused: () => void;
}) {
  const { t, tp, day, describeError } = useI18n();
  const replanningFocus = useReplanningFocus();
  const term = useTerms();
  const removeStage = useRemoveStage();
  const removeActivity = useRemoveActivity();
  const removeDecision = useRemoveDecision();
  const today = useToday();
  const [making, setMaking] = useState<Decision | null>(null);
  const mover = useMover(outcome);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [problem, setProblem] = useState<{ scope: string; text: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const { generation, heading, rewritten } = useRewritten(snapshot);

  // The page's channel, for the cards whose refusals are not a row's: a refusal there takes a
  // row's away, so two never argue on screen.
  const page: Outcome = useMemo(
    () => ({
      refused: (error: unknown) => {
        setProblem(null);
        outcome.refused(error);
      },
      kept: () => {
        setProblem(null);
        outcome.kept();
      },
    }),
    [outcome],
  );
  /** A row's own channel: its refusal is said on that row, and the page's is taken away. */
  const at = useCallback(
    (scope: string): Outcome => ({
      refused: (error: unknown) => {
        outcome.kept();
        setProblem({ scope, text: describeError(error) });
      },
      kept: () => {
        setProblem(null);
        outcome.kept();
      },
    }),
    [outcome, describeError],
  );
  const problemAt = (scope: string): string | null =>
    problem !== null && problem.scope === scope ? problem.text : null;

  const numbers = new Map(breakdown(snapshot).map((row) => [row.id, row.number]));
  const endpointName = useEndpointName(snapshot, numbers);
  const stages = stagesInOrder(snapshot);
  const stageIds = stages.map((stage) => stage.id);
  const ordered = activitiesInOrder(snapshot);
  const rooms = roomsInOrder(snapshot);
  const scheduled = useMemo(() => schedule(snapshot), [snapshot]);
  const decisionRowsById = useMemo(
    () => new Map(decisionRows(snapshot, scheduled, today).map((row) => [row.decisionId, row])),
    [snapshot, scheduled, today],
  );
  const activitiesOf = (stage: Stage): Activity[] =>
    ordered.filter((activity) => activity.stageId === stage.id);

  const confirmRemoval = () => {
    if (removal === null) return;
    const report = removal.kind === 'decision' ? page : at(`${removal.kind}:${removal.id}`);
    const options = {
      onSuccess: () => {
        report.kept();
        setRemoval(null);
      },
      onError: (error: unknown) => {
        report.refused(error);
        setRemoval(null);
      },
    };
    if (removal.kind === 'stage') removeStage.mutate(removal.id, options);
    else if (removal.kind === 'activity') removeActivity.mutate(removal.id, options);
    else removeDecision.mutate(removal.id, options);
  };

  const replanning = snapshot.replanning;
  const baseline = latestBaseline(snapshot);

  return (
    <>
      {isLocked(snapshot) && (
        <div data-testid="plan-locked">
          <InfoBar severity="info" title={t('replan.locked.title')}>
            <p>{t('replan.locked.body')}</p>
            <div className="mt-2">
              <ReplanButton />
            </div>
          </InfoBar>
        </div>
      )}
      {replanning !== null && (
        <div ref={replanningFocus} tabIndex={-1} data-testid="replanning-open">
          <InfoBar
            severity="info"
            title={t('replan.since', {
              replanning: term('replanning', { capital: true }),
              day: day(replanning.openedAt.slice(0, 10)),
            })}
          >
            <p>{replanning.reason}</p>
            <p className="mt-1">
              {t('replan.closeOnSchedule', {
                baseline: term('baseline'),
                number: (baseline?.number ?? 0) + 1,
              })}
            </p>
          </InfoBar>
        </div>
      )}
      <CalendarCard
        snapshot={snapshot}
        outcome={page}
        open={calendarOpen}
        onOpen={onCalendarOpen}
      />
      <PeopleCard snapshot={snapshot} outcome={page} />
      <RoomsCard snapshot={snapshot} outcome={page} mover={mover.go} />

      <section aria-labelledby="plan-breakdown" className="flex flex-col gap-3">
        <div>
          <h2
            ref={heading}
            id="plan-breakdown"
            tabIndex={-1}
            className="text-subtitle font-semibold text-fg"
          >
            {term('plan', { capital: true })}
          </h2>
          <p className="mt-0.5 text-caption text-fg-tertiary">{t('plan.move.hint')}</p>
        </div>
        <TemplateNotes workId={snapshot.work.workId} onDismissed={() => heading.current?.focus()} />
        <RangesBar snapshot={snapshot} onTaken={rewritten} />
        <AddStage outcome={at('stage-add')} problem={problemAt('stage-add')} />

        {stages.length === 0 ? (
          <Card>
            <EmptyState
              title={t('plan.stages.emptyTitle')}
              description={t('plan.stages.emptyTemplate', { template: term('template') })}
              action={
                <Button
                  icon={<DocumentText20Regular />}
                  data-testid="template-start"
                  onClick={() => setStarting(true)}
                >
                  {t('templates.start', { template: term('template') })}
                </Button>
              }
            />
          </Card>
        ) : (
          <ol className="flex flex-col gap-3">
            {stages.map((stage) => {
              const activities = activitiesOf(stage);
              const siblings = activities.map((activity) => activity.id);
              // A closed stage is read-only until it is reopened (ADR-022): every control in it is
              // disabled by one fieldset, and one sentence says where to reopen it.
              const closed = stageState(stage) === 'closed';
              return (
                <li
                  key={stage.id}
                  data-stage-id={stage.id}
                  onKeyDown={(event) => {
                    const direction = chordDirection(event);
                    if (direction === null || closed) return;
                    event.preventDefault();
                    mover.go(
                      'stage',
                      stage.id,
                      direction,
                      stageIds,
                      stage.name,
                      at(`stage:${stage.id}`),
                    );
                  }}
                >
                  <Card>
                    {closed && stage.closedAt !== null && (
                      <p
                        data-testid="stage-closed-note"
                        className="mb-2 rounded-md bg-card-hover px-2 py-1 text-caption text-fg-secondary"
                      >
                        {t('stage.closedNote', { day: day(stage.closedAt.slice(0, 10)) })}
                      </p>
                    )}
                    <div className="-mt-1 mb-1 flex justify-end">
                      <DocumentsCount
                        snapshot={snapshot}
                        target={{ targetKind: 'stage', targetId: stage.id }}
                        name={stage.name}
                        testId="stage-documents-count"
                      />
                    </div>
                    <fieldset disabled={closed} className="m-0 min-w-0 border-0 p-0">
                      <StageHeader
                        stage={stage}
                        number={numbers.get(stage.id) ?? ''}
                        outcome={at(`stage:${stage.id}`)}
                        onMove={(direction) =>
                          mover.go(
                            'stage',
                            stage.id,
                            direction,
                            stageIds,
                            stage.name,
                            at(`stage:${stage.id}`),
                          )
                        }
                        onRemove={() =>
                          setRemoval({
                            kind: 'stage',
                            id: stage.id,
                            name: stage.name,
                            activities: activities.length,
                          })
                        }
                      />
                      <RowProblem testId="stage-problem" text={problemAt(`stage:${stage.id}`)} />
                      {snapshot.dependencies.some(
                        (dependency) =>
                          dependency.blocked.kind === 'stage' && dependency.blocked.id === stage.id,
                      ) && (
                        <div className="mb-3 flex flex-col gap-1">
                          <span className="text-caption font-semibold text-fg-tertiary">
                            {t('plan.stageLinks')}
                          </span>
                          <ul className="flex flex-wrap gap-1.5">
                            {snapshot.dependencies
                              .filter(
                                (dependency) =>
                                  dependency.blocked.kind === 'stage' &&
                                  dependency.blocked.id === stage.id,
                              )
                              .map((dependency) => (
                                <LinkChip
                                  key={dependency.id}
                                  dependency={dependency}
                                  name={endpointName}
                                  outcome={at(`stage:${stage.id}`)}
                                />
                              ))}
                          </ul>
                        </div>
                      )}
                      <DecisionsBlock
                        stage={stage}
                        decisions={decisionsOf(snapshot, stage.id)}
                        rows={decisionRowsById}
                        snapshot={snapshot}
                        scheduled={scheduled}
                        today={today}
                        outcome={page}
                        focusRow={focusRow}
                        onFocused={onFocused}
                        onMove={(decision, direction) =>
                          mover.go(
                            'decision',
                            decision.id,
                            direction,
                            decisionsOf(snapshot, stage.id).map((each) => each.id),
                            decision.name,
                          )
                        }
                        onMake={setMaking}
                        onRemove={(decision) =>
                          setRemoval({ kind: 'decision', id: decision.id, name: decision.name })
                        }
                      />
                      <ChecksBlock
                        stage={stage}
                        snapshot={snapshot}
                        outcome={page}
                        readOnly={closed}
                        onMove={(check, direction, checkSiblings) =>
                          mover.go('check', check.id, direction, checkSiblings, check.name)
                        }
                      />
                      <div className="mb-3 rounded-lg border border-stroke-subtle bg-layer p-3">
                        <CostLines
                          snapshot={snapshot}
                          stageId={stage.id}
                          activityId={null}
                          outcome={page}
                          readOnly={closed}
                        />
                      </div>
                      {activities.length === 0 ? (
                        <p className="text-body text-fg-tertiary">{t('plan.activities.empty')}</p>
                      ) : (
                        <>
                          {/* The column heads are for the eye; every field names itself. */}
                          <div
                            aria-hidden="true"
                            className={`${ACTIVITY_COLUMNS} pb-1 text-caption font-semibold text-fg-tertiary`}
                          >
                            <span>#</span>
                            <span>{term('activity', { capital: true })}</span>
                            <span>
                              {t('plan.column.duration', {
                                duration: term('duration', { capital: true }),
                              })}
                            </span>
                            <span>{term('responsible', { capital: true })}</span>
                            <span />
                          </div>
                          <ul className="flex flex-col">
                            {activities.map((activity) => (
                              <ActivityRow
                                key={`${activity.id}:${generation}`}
                                activity={activity}
                                number={numbers.get(activity.id) ?? null}
                                people={snapshot.people}
                                snapshot={snapshot}
                                rooms={rooms}
                                outcome={at(`activity:${activity.id}`)}
                                problem={problemAt(`activity:${activity.id}`)}
                                focus={focusRow === activity.id}
                                onFocused={onFocused}
                                onMove={(direction) =>
                                  mover.go(
                                    'activity',
                                    activity.id,
                                    direction,
                                    siblings,
                                    activity.name,
                                    at(`activity:${activity.id}`),
                                  )
                                }
                                onRemove={() =>
                                  setRemoval({
                                    kind: 'activity',
                                    id: activity.id,
                                    name: activity.name,
                                  })
                                }
                              >
                                <LinksLine
                                  activityId={activity.id}
                                  activityName={activity.name}
                                  snapshot={snapshot}
                                  numbers={numbers}
                                  outcome={at(`activity:${activity.id}`)}
                                  readOnly={closed}
                                />
                                <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2">
                                  <span aria-hidden="true" />
                                  <CostLines
                                    snapshot={snapshot}
                                    stageId={stage.id}
                                    activityId={activity.id}
                                    outcome={page}
                                    readOnly={closed}
                                  />
                                </div>
                              </ActivityRow>
                            ))}
                          </ul>
                        </>
                      )}
                      {!closed && (
                        <AddActivity
                          stage={stage}
                          outcome={at(`activity-add:${stage.id}`)}
                          problem={problemAt(`activity-add:${stage.id}`)}
                        />
                      )}
                    </fieldset>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <ConfirmDialog
        open={removal !== null}
        title={removal === null ? '' : t('plan.confirm.removeTitle', { name: removal.name })}
        confirmLabel={t('plan.remove')}
        danger
        pending={removeStage.isPending || removeActivity.isPending || removeDecision.isPending}
        onConfirm={confirmRemoval}
        onCancel={() => setRemoval(null)}
      >
        {removal === null
          ? null
          : removal.kind === 'decision'
            ? t('decisions.confirm.body')
            : removal.kind === 'activity'
              ? t('plan.confirm.activityBody')
              : removal.activities === 0
                ? t('plan.confirm.stageEmpty')
                : tp('plan.confirm.stageBody', removal.activities)}
      </ConfirmDialog>
      {starting && (
        <StartFromTemplateDialog
          snapshot={snapshot}
          open
          onClose={() => setStarting(false)}
          onApplied={rewritten}
        />
      )}
      <MakeDecisionDialog
        decision={making}
        onClose={() => setMaking(null)}
        onMade={() => {
          outcome.kept();
          setMaking(null);
        }}
      />
    </>
  );
}

/**
 * A stage's own row: its number and its name as a heading, and beside them the stage's actions.
 * Renaming swaps the heading for a field and back — the name is always one thing on screen.
 */
function StageHeader({
  stage,
  number,
  outcome,
  onMove,
  onRemove,
}: {
  stage: Stage;
  number: string;
  outcome: Outcome;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const term = useTerms();
  const rename = useRenameStage();
  const [renaming, setRenaming] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (renaming) field.current?.focus();
  }, [renaming]);

  const finish = () => {
    setRenaming(false);
    window.requestAnimationFrame(() => button.current?.focus());
  };

  return (
    <div className="mb-3 flex items-center gap-2">
      <span
        data-testid="row-number"
        className="text-body-lg font-semibold text-fg-secondary tabular-nums"
      >
        {number}
      </span>
      {renaming ? (
        <NameField
          ref={field}
          value={stage.name}
          label={t('plan.fieldOf', { field: term('stage', { capital: true }), name: stage.name })}
          onCancel={finish}
          onCommit={(name) =>
            rename.mutate(
              { id: stage.id, name },
              {
                onSuccess: () => {
                  outcome.kept();
                  finish();
                },
                onError: outcome.refused,
              },
            )
          }
        />
      ) : (
        <h3
          data-testid="stage-name"
          className="min-w-0 flex-1 truncate text-body-lg font-semibold text-fg"
        >
          {stage.name}
        </h3>
      )}
      <span className="flex shrink-0 items-center gap-0.5">
        <IconButton
          ref={button}
          icon={<Rename20Regular />}
          label={t('plan.rename', { name: stage.name })}
          aria-expanded={renaming}
          onClick={() => setRenaming((now) => !now)}
        />
        <IconButton
          data-testid="stage-up"
          icon={<ArrowUp20Regular />}
          label={t('plan.move.up', { name: stage.name })}
          onClick={() => onMove('up')}
        />
        <IconButton
          data-testid="stage-down"
          icon={<ArrowDown20Regular />}
          label={t('plan.move.down', { name: stage.name })}
          onClick={() => onMove('down')}
        />
        <IconButton
          data-testid="stage-remove"
          icon={<Delete20Regular />}
          label={t('plan.removeNamed', { name: stage.name })}
          onClick={onRemove}
        />
      </span>
    </div>
  );
}

/** The host's refusal of an edit, said on the row that tried it. Nothing when there is none. */
function RowProblem({ testId, text }: { testId: string; text: string | null }) {
  const { t } = useI18n();
  if (text === null) return null;
  return (
    <div data-testid={testId} className="mb-3">
      <InfoBar severity="caution" title={t('plan.refused')}>
        {text}
      </InfoBar>
    </div>
  );
}

function AddStage({ outcome, problem }: { outcome: Outcome; problem: string | null }) {
  const { t } = useI18n();
  const term = useTerms();
  const add = useAddStage();
  return (
    <>
      <AddForm
        label={t('plan.toAdd', { what: term('stage', { capital: true }) })}
        inputTestId="stage-add-name"
        buttonTestId="stage-add"
        buttonLabel={t('plan.add', { what: term('stage') })}
        icon={<Add20Regular />}
        pending={add.isPending}
        onAdd={(name, done) =>
          add.mutate(name, {
            onSuccess: () => {
              outcome.kept();
              done();
            },
            onError: outcome.refused,
          })
        }
      />
      <RowProblem testId="stage-problem" text={problem} />
    </>
  );
}

function AddActivity({
  stage,
  outcome,
  problem,
}: {
  stage: Stage;
  outcome: Outcome;
  problem: string | null;
}) {
  const { t } = useI18n();
  const term = useTerms();
  const add = useAddActivity();
  return (
    <div className="mt-3">
      <AddForm
        label={t('plan.toAddIn', { what: term('activity', { capital: true }), where: stage.name })}
        inputTestId="activity-add-name"
        buttonTestId="activity-add"
        buttonLabel={t('plan.add', { what: term('activity') })}
        icon={<Add20Regular />}
        pending={add.isPending}
        onAdd={(name, done) =>
          add.mutate(
            { stageId: stage.id, name },
            {
              onSuccess: () => {
                outcome.kept();
                done();
              },
              onError: outcome.refused,
            },
          )
        }
      />
      <div className="mt-2">
        <RowProblem testId="stage-problem" text={problem} />
      </div>
    </div>
  );
}
