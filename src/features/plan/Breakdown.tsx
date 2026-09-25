import {
  Add20Regular,
  ArrowDown20Regular,
  ArrowUp20Regular,
  Delete20Regular,
  Rename20Regular,
} from '@fluentui/react-icons';
import { useEffect, useMemo, useRef, useState } from 'react';

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
import { decisionRows } from '@/domain/decisions';
import {
  activitiesInOrder,
  decisionsOf,
  roomsInOrder,
  stagesInOrder,
  type Activity,
  type Decision,
  type Stage,
  type WorkSnapshot,
} from '@/domain/plan';
import { schedule } from '@/domain/schedule';
import { MakeDecisionDialog } from '@/features/decisions/MakeDecisionDialog';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Card } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EmptyState } from '@/ui/EmptyState';
import { IconButton } from '@/ui/IconButton';

import { ACTIVITY_COLUMNS, ActivityRow } from './ActivityRow';
import { AddForm } from './AddForm';
import { CalendarCard } from './CalendarCard';
import { DecisionsBlock } from './DecisionsBlock';
import { useEndpointName } from './endpoints';
import { LinkChip, LinksLine } from './LinksLine';
import { chordDirection, useMover } from './moves';
import { NameField } from './NameField';
import type { Outcome } from './outcome';
import { PeopleCard } from './PeopleCard';
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
  const { t, tp } = useI18n();
  const term = useTerms();
  const removeStage = useRemoveStage();
  const removeActivity = useRemoveActivity();
  const removeDecision = useRemoveDecision();
  const today = useToday();
  const [making, setMaking] = useState<Decision | null>(null);
  const mover = useMover(outcome);
  const [removal, setRemoval] = useState<Removal | null>(null);

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
    const options = {
      onSuccess: () => {
        outcome.kept();
        setRemoval(null);
      },
      onError: (error: unknown) => {
        outcome.refused(error);
        setRemoval(null);
      },
    };
    if (removal.kind === 'stage') removeStage.mutate(removal.id, options);
    else if (removal.kind === 'activity') removeActivity.mutate(removal.id, options);
    else removeDecision.mutate(removal.id, options);
  };

  return (
    <>
      <CalendarCard
        snapshot={snapshot}
        outcome={outcome}
        open={calendarOpen}
        onOpen={onCalendarOpen}
      />
      <PeopleCard snapshot={snapshot} outcome={outcome} />
      <RoomsCard snapshot={snapshot} outcome={outcome} mover={mover.go} />

      <section aria-labelledby="plan-breakdown" className="flex flex-col gap-3">
        <div>
          <h2 id="plan-breakdown" className="text-subtitle font-semibold text-fg">
            {term('plan', { capital: true })}
          </h2>
          <p className="mt-0.5 text-caption text-fg-tertiary">{t('plan.move.hint')}</p>
        </div>
        <AddStage outcome={outcome} />

        {stages.length === 0 ? (
          <Card>
            <EmptyState
              title={t('plan.stages.emptyTitle')}
              description={t('plan.stages.emptyDescription')}
            />
          </Card>
        ) : (
          <ol className="flex flex-col gap-3">
            {stages.map((stage) => {
              const activities = activitiesOf(stage);
              const siblings = activities.map((activity) => activity.id);
              return (
                <li
                  key={stage.id}
                  data-stage-id={stage.id}
                  onKeyDown={(event) => {
                    const direction = chordDirection(event);
                    if (direction === null) return;
                    event.preventDefault();
                    mover.go('stage', stage.id, direction, stageIds, stage.name);
                  }}
                >
                  <Card>
                    <StageHeader
                      stage={stage}
                      number={numbers.get(stage.id) ?? ''}
                      outcome={outcome}
                      onMove={(direction) =>
                        mover.go('stage', stage.id, direction, stageIds, stage.name)
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
                                outcome={outcome}
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
                      outcome={outcome}
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
                              key={activity.id}
                              activity={activity}
                              number={numbers.get(activity.id) ?? null}
                              people={snapshot.people}
                              rooms={rooms}
                              outcome={outcome}
                              focus={focusRow === activity.id}
                              onFocused={onFocused}
                              onMove={(direction) =>
                                mover.go(
                                  'activity',
                                  activity.id,
                                  direction,
                                  siblings,
                                  activity.name,
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
                                outcome={outcome}
                              />
                            </ActivityRow>
                          ))}
                        </ul>
                      </>
                    )}
                    <AddActivity stage={stage} outcome={outcome} />
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

function AddStage({ outcome }: { outcome: Outcome }) {
  const { t } = useI18n();
  const term = useTerms();
  const add = useAddStage();
  return (
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
  );
}

function AddActivity({ stage, outcome }: { stage: Stage; outcome: Outcome }) {
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
    </div>
  );
}
