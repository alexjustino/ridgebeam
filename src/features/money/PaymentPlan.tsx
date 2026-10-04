import {
  Add20Regular,
  ArrowDown20Regular,
  ArrowUp20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
  Delete20Regular,
  LockClosed20Regular,
  TaskListLtr20Regular,
} from '@fluentui/react-icons';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import {
  useAddMilestone,
  useMoveMilestone,
  useRemoveMilestone,
  useUpdateMilestone,
  useUsualMilestones,
} from '@/data/queries';
import {
  MILESTONE_LABEL_LIMIT,
  MILESTONE_PROBLEM_KEYS,
  MILESTONE_STATE_KEYS,
  MILESTONE_TRIGGER_KEYS,
  MILESTONE_TRIGGERS,
  RETENTION_KEYS,
  USUAL_PLAN_LABEL_KEYS,
  milestonesInOrder,
  percentToBp,
  retentionOffer,
  usualPlan,
  validateMilestone,
  type CommitmentPlan,
  type MilestoneProblem,
  type MilestoneStatus,
  type MilestoneTrigger,
} from '@/domain/milestones';
import { moved, type Direction } from '@/domain/ordering';
import type { Commitment, Milestone, Stage, WorkSnapshot } from '@/domain/plan';
import { chordDirection } from '@/features/plan/moves';
import type { MessageKey } from '@/i18n/en';
import { useI18n, type I18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

import { percentText, whenText } from './paymentPlanWords';

/** A share as the field shows it back: 3000 → "30", 1250 → "12.5" — the dot the field reads. */
function shareField(bp: number): string {
  return String(bp / 100);
}

/** The domain's problems, said: one sentence each, the over-plan one with what is left. */
function problemText(i18n: I18n, problems: readonly MilestoneProblem[]): string {
  return [
    ...new Set(
      problems.map((problem) =>
        problem.code === 'over-plan'
          ? i18n.t(MILESTONE_PROBLEM_KEYS['over-plan'], {
              available: percentText(i18n, problem.availableBp),
            })
          : i18n.t(MILESTONE_PROBLEM_KEYS[problem.code] as MessageKey),
      ),
    ),
  ].join(' ');
}

/**
 * Where a milestone stands, from the domain: "earned on 3 Oct", "not yet" — and, for a retention
 * (E4), "held until its snags are fixed (2 open)" while a snag holds it, or "held until Tiling
 * closes" while its stage is open. Held money is never said as due.
 */
function stateText(
  i18n: Pick<I18n, 't' | 'tp' | 'day'>,
  status: MilestoneStatus,
  target: { readonly name: string | null },
): string {
  if (status.earned && status.earnedOn !== null) {
    return i18n.t(MILESTONE_STATE_KEYS.earned, { day: i18n.day(status.earnedOn) });
  }
  if (status.held) return i18n.tp('money.milestone.state.held', status.openSnagIds.length);
  if (status.milestone.trigger === 'retention') {
    return i18n.t('money.milestone.state.heldStage', {
      name: target.name ?? i18n.t('snags.row.goneStage'),
    });
  }
  return i18n.t(MILESTONE_STATE_KEYS.notYet);
}

/**
 * A commitment's payment plan (slice D2, decision 5): a disclosure under the commitment on Money →
 * By stage, open by default while the commitment has none. Inside, the milestones in order — each
 * with its name, its share and amount, the fact that earns it, and whether the work has earned it
 * ("earned on 3 Oct" or "not yet", from the domain) — and the line that adds one; on a commitment
 * with none, **Add the usual plan**, said to be a common split and not advice.
 *
 * **Locked once money has moved** (decision 2): when a payment names the commitment, the plan is
 * shown with the sentence that says why and nothing that would change it. A closed stage does not
 * lock it, and the plan says so. A refusal — the domain's before the host is asked, or the host's —
 * is one sentence under the plan (`milestone-problem`), and the field keeps what was typed.
 *
 * Focus: removing a milestone puts the focus on the next milestone's Remove (or the one before, or
 * the add line's name when none is left); adding one puts it back on the add line's name; the usual
 * plan puts it on the first milestone's name. A move keeps it where it was, and says where the
 * milestone went.
 */
export function PaymentPlan({
  commitment,
  plan,
  stage,
  snapshot,
  locked,
  initiallyOpen,
  focusToggle = false,
  onFocusTaken,
}: {
  commitment: Commitment;
  /** What the work has made of it — `null` while the diary is read. */
  plan: CommitmentPlan | null;
  stage: Stage;
  snapshot: WorkSnapshot;
  locked: boolean;
  initiallyOpen: boolean;
  /** Put the focus on the toggle once mounted (the Next question opened Money on this plan). */
  focusToggle?: boolean;
  onFocusTaken?: () => void;
}) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const panel = useId();
  const [open, setOpen] = useState(initiallyOpen);
  const [problem, setProblem] = useState<string | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const addLabel = useRef<HTMLInputElement>(null);
  const usual = useUsualMilestones();
  const milestones = milestonesInOrder(commitment);
  const statuses = new Map(
    (plan?.milestones ?? []).map((status) => [status.milestone.id, status] as const),
  );
  const plannedBp = milestones.reduce((sum, each) => sum + each.shareBp, 0);
  const usualOffer = usualPlan(snapshot, commitment.id);
  // Where the focus goes once the list has changed under a control that removed itself: the
  // milestone now at the removed one's place (its Remove), or the first milestone's name after the
  // usual plan, or the last milestone's share after the retention (E4: the share is the one thing a
  // person may want to change at once). Taken when the plan's milestones change, never before — the
  // control is still there until then, and the new list is not.
  const pendingFocus = useRef<
    { kind: 'at'; index: number } | { kind: 'first' } | { kind: 'last-share' } | null
  >(null);
  const idsKey = milestones.map((each) => each.id).join(' ');

  useEffect(() => {
    const pending = pendingFocus.current;
    if (pending === null) return;
    pendingFocus.current = null;
    const rows = list.current?.querySelectorAll<HTMLElement>('[data-milestone-id]') ?? [];
    const target =
      pending.kind === 'first'
        ? (rows[0]?.querySelector<HTMLElement>('[data-testid="milestone-label"]') ?? null)
        : pending.kind === 'last-share'
          ? (rows[rows.length - 1]?.querySelector<HTMLElement>('[data-testid="milestone-share"]') ??
            null)
          : rows.length === 0
            ? null
            : (rows[Math.min(pending.index, rows.length - 1)]!.querySelector<HTMLElement>(
                '[data-testid="milestone-remove"]',
              ) ?? null);
    (target ?? addLabel.current)?.focus();
  }, [idsKey]);

  useEffect(() => {
    if (!focusToggle) return;
    toggle.current?.scrollIntoView({ block: 'center' });
    toggle.current?.focus();
    onFocusTaken?.();
  }, [focusToggle, onFocusTaken]);

  const refused = (error: unknown) => setProblem(i18n.describeError(error));

  const addUsual = () => {
    setProblem(null);
    usual.mutate(
      {
        commitmentId: commitment.id,
        labels: {
          started: t(USUAL_PLAN_LABEL_KEYS.started),
          finished: t(USUAL_PLAN_LABEL_KEYS.finished),
          closed: t(USUAL_PLAN_LABEL_KEYS.closed),
        },
      },
      {
        onSuccess: () => {
          announce(t('money.paymentPlan.usual.done'));
          // The button that was pressed goes with the plan it added: the first milestone's name.
          pendingFocus.current = { kind: 'first' };
        },
        onError: refused,
      },
    );
  };

  const summary =
    milestones.length === 0
      ? t('money.paymentPlan.summary.none')
      : tp('money.paymentPlan.summary', milestones.length, {
          share: percentText(i18n, plannedBp),
        });

  return (
    <div className="mt-1 flex flex-col gap-2">
      <div>
        <Button
          ref={toggle}
          appearance="subtle"
          data-testid="payment-plan-toggle"
          aria-expanded={open}
          aria-controls={panel}
          icon={open ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
          onClick={() => setOpen((value) => !value)}
          className="-ml-3"
        >
          {t('money.paymentPlan.toggle')}
          <span className="font-normal text-fg-secondary">· {summary}</span>
        </Button>
      </div>

      <div
        id={panel}
        hidden={!open}
        role="group"
        aria-label={t('money.paymentPlan.milestones', { name: commitment.label })}
        className="flex flex-col gap-2 border-l border-stroke-subtle pl-3"
      >
        <p className="text-caption text-fg-tertiary">{t('money.paymentPlan.lead')}</p>
        {locked ? (
          <p data-testid="payment-plan-locked" className="text-caption text-fg-secondary">
            {t('money.paymentPlan.locked')}
          </p>
        ) : (
          stage.closedAt !== null && (
            <p className="text-caption text-fg-secondary">
              {t('money.paymentPlan.closedStage', { stage: stage.name })}
            </p>
          )
        )}

        {milestones.length === 0 ? (
          <p className="text-body text-fg-secondary">{t('money.paymentPlan.none')}</p>
        ) : (
          <>
            <ol ref={list} className="flex flex-col">
              {milestones.map((milestone, index) => (
                <MilestoneLine
                  key={milestone.id}
                  milestone={milestone}
                  status={statuses.get(milestone.id) ?? null}
                  siblings={milestones.map((each) => each.id)}
                  commitment={commitment}
                  snapshot={snapshot}
                  locked={locked}
                  onProblem={setProblem}
                  onRemoved={() => {
                    pendingFocus.current = { kind: 'at', index };
                  }}
                />
              ))}
            </ol>
            <p data-testid="payment-plan-sum" className="text-body text-fg">
              {plannedBp >= 10_000
                ? t(MILESTONE_STATE_KEYS.sumWhole, { planned: percentText(i18n, plannedBp) })
                : t(MILESTONE_STATE_KEYS.sum, {
                    planned: percentText(i18n, plannedBp),
                    rest: percentText(i18n, 10_000 - plannedBp),
                  })}
            </p>
          </>
        )}

        {!locked && milestones.length === 0 && (
          <div className="flex flex-col gap-1">
            {usualOffer.ok ? (
              <div>
                <Button
                  icon={<TaskListLtr20Regular />}
                  data-testid="payment-plan-usual"
                  disabled={usual.isPending}
                  onClick={addUsual}
                >
                  {usual.isPending ? t('common.working') : t('money.paymentPlan.usual')}
                </Button>
              </div>
            ) : null}
            <p className="text-caption text-fg-tertiary">
              {usualOffer.ok || usualOffer.code !== 'no-activity'
                ? t(USUAL_PLAN_LABEL_KEYS.note)
                : t('money.paymentPlan.usual.noActivity', { stage: stage.name })}
            </p>
          </div>
        )}

        {!locked && (
          <RetentionOffer
            commitment={commitment}
            snapshot={snapshot}
            onProblem={setProblem}
            onAdded={() => {
              pendingFocus.current = { kind: 'last-share' };
            }}
          />
        )}

        {!locked && (
          <AddMilestone
            commitment={commitment}
            stage={stage}
            snapshot={snapshot}
            labelRef={addLabel}
            onProblem={setProblem}
          />
        )}

        {problem !== null && (
          <p data-testid="milestone-problem" className="text-caption text-fg">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}

/** A milestone as the plan lists it: its name and share (editable while unlocked), what earns it,
 *  whether the work has, and Move up, Move down and Remove. */
function MilestoneLine({
  milestone,
  status,
  siblings,
  commitment,
  snapshot,
  locked,
  onProblem,
  onRemoved,
}: {
  milestone: Milestone;
  status: MilestoneStatus | null;
  siblings: readonly string[];
  commitment: Commitment;
  snapshot: WorkSnapshot;
  locked: boolean;
  onProblem: (problem: string | null) => void;
  onRemoved: () => void;
}) {
  const i18n = useI18n();
  const { t, money } = i18n;
  const update = useUpdateMilestone();
  const move = useMoveMilestone();
  const remove = useRemoveMilestone();
  const [label, setLabel] = useState(milestone.label);
  const [share, setShare] = useState(shareField(milestone.shareBp));
  // What the plan holds, as last seen: when it changes, the fields follow it; a refusal changes
  // nothing, so the field keeps what was typed (DESIGN_SYSTEM §10).
  const [held, setHeld] = useState({ label: milestone.label, shareBp: milestone.shareBp });
  if (held.label !== milestone.label || held.shareBp !== milestone.shareBp) {
    setHeld({ label: milestone.label, shareBp: milestone.shareBp });
    setLabel(milestone.label);
    setShare(shareField(milestone.shareBp));
  }
  const target = status?.target ?? {
    kind: milestone.trigger === 'activity_finished' ? ('activity' as const) : ('stage' as const),
    id: milestone.activityId ?? commitment.stageId,
    name:
      milestone.trigger === 'activity_finished'
        ? (snapshot.activities.find((each) => each.id === milestone.activityId)?.name ?? null)
        : (snapshot.stages.find((each) => each.id === commitment.stageId)?.name ?? null),
  };

  const keep = (patch: { label?: string; shareBp?: number }) => {
    const draft = {
      label: patch.label ?? milestone.label,
      shareBp: patch.shareBp ?? milestone.shareBp,
      trigger: milestone.trigger,
      activityId: milestone.activityId,
    };
    const problems = validateMilestone(snapshot, commitment.id, draft, milestone.id);
    if (problems.length > 0) {
      onProblem(problemText(i18n, problems));
      return;
    }
    onProblem(null);
    update.mutate(
      { id: milestone.id, patch },
      { onError: (error) => onProblem(i18n.describeError(error)) },
    );
  };

  const keepLabel = () => {
    const trimmed = label.trim();
    if (trimmed === milestone.label) return;
    keep({ label: trimmed });
  };

  const keepShare = () => {
    const bp = percentToBp(share);
    if (bp === milestone.shareBp) return;
    if (bp === null) {
      onProblem(t(MILESTONE_PROBLEM_KEYS['invalid-share']));
      return;
    }
    keep({ shareBp: bp });
  };

  const go = (direction: Direction) => {
    const after = moved(siblings, milestone.id, direction);
    if (after.every((each, index) => each === siblings[index])) {
      announce(
        t(direction === 'up' ? 'plan.move.alreadyFirst' : 'plan.move.alreadyLast', {
          name: milestone.label,
        }),
      );
      return;
    }
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    move.mutate(
      { id: milestone.id, direction },
      {
        onSuccess: () => {
          onProblem(null);
          announce(
            t('plan.move.done', {
              name: milestone.label,
              number: after.indexOf(milestone.id) + 1,
            }),
          );
          window.requestAnimationFrame(() => {
            if (focused !== null && focused.isConnected && document.activeElement !== focused) {
              focused.focus();
            }
          });
        },
        onError: (error) => onProblem(i18n.describeError(error)),
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (locked) return;
    const direction = chordDirection(event);
    if (direction === null) return;
    event.preventDefault();
    event.stopPropagation();
    go(direction);
  };

  return (
    <li
      data-milestone-id={milestone.id}
      onKeyDown={onKeyDown}
      className="grid items-center gap-x-3 gap-y-1 border-t border-stroke-subtle py-1.5 first:border-t-0 md:grid-cols-[minmax(0,1fr)_7rem_9rem_auto]"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {locked ? (
          <span className="text-body font-semibold text-fg">{milestone.label}</span>
        ) : (
          <Input
            data-testid="milestone-label"
            aria-label={t('money.milestone.labelOf', { name: milestone.label })}
            maxLength={MILESTONE_LABEL_LIMIT}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onBlur={keepLabel}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                keepLabel();
              }
            }}
          />
        )}
        <span className="text-caption text-fg-secondary">
          {whenText(i18n, milestone.trigger, target)}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {locked ? (
          <span className="text-body text-fg tabular-nums">
            {percentText(i18n, milestone.shareBp)}
          </span>
        ) : (
          <Input
            data-testid="milestone-share"
            inputMode="decimal"
            aria-label={t('money.milestone.shareOf', { name: milestone.label })}
            value={share}
            onChange={(event) => setShare(event.target.value)}
            onBlur={keepShare}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                keepShare();
              }
            }}
          />
        )}
        {status !== null && (
          <span className="text-caption text-fg-tertiary tabular-nums">
            {money(status.cents, snapshot.work.currency)}
          </span>
        )}
      </div>
      <span
        data-testid="milestone-state"
        data-earned={status?.earned === true ? 'true' : 'false'}
        data-held={status?.held === true ? 'true' : undefined}
        className={
          status?.earned === true
            ? 'text-body font-semibold text-fg'
            : status?.held === true
              ? 'inline-flex items-start gap-1 text-body text-fg'
              : 'text-body text-fg-tertiary'
        }
      >
        {status !== null && status.held && (
          <LockClosed20Regular aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        )}
        {status === null ? '' : stateText(i18n, status, target)}
      </span>
      {locked ? (
        <span aria-hidden="true" />
      ) : (
        <span className="flex items-center gap-0.5">
          <IconButton
            data-testid="milestone-up"
            icon={<ArrowUp20Regular />}
            label={t('plan.move.up', { name: milestone.label })}
            disabled={move.isPending}
            onClick={() => go('up')}
          />
          <IconButton
            data-testid="milestone-down"
            icon={<ArrowDown20Regular />}
            label={t('plan.move.down', { name: milestone.label })}
            disabled={move.isPending}
            onClick={() => go('down')}
          />
          <IconButton
            data-testid="milestone-remove"
            icon={<Delete20Regular />}
            label={t('money.milestone.remove', { name: milestone.label })}
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(milestone.id, {
                onSuccess: () => {
                  onProblem(null);
                  announce(t('money.milestone.removed', { name: milestone.label }));
                  onRemoved();
                },
                onError: (error) => onProblem(i18n.describeError(error)),
              })
            }
          />
        </span>
      )}
    </li>
  );
}

const TRIGGER_DEFAULT: MilestoneTrigger = 'stage_started';

/**
 * The line that adds a milestone: its name, its share in percent (one decimal at most, turned into
 * basis points once), what earns it, and — only for "when an activity is finished" — which activity
 * of the stage. The cell the activity sits in is always there, so choosing a trigger never moves the
 * line; for an advance it says, in words, that an advance is paid before any work.
 */
function AddMilestone({
  commitment,
  stage,
  snapshot,
  labelRef,
  onProblem,
}: {
  commitment: Commitment;
  stage: Stage;
  snapshot: WorkSnapshot;
  labelRef: RefObject<HTMLInputElement | null>;
  onProblem: (problem: string | null) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const add = useAddMilestone();
  const [label, setLabel] = useState('');
  const [share, setShare] = useState('');
  const [trigger, setTrigger] = useState<MilestoneTrigger>(TRIGGER_DEFAULT);
  const [activityId, setActivityId] = useState('');
  const activities = snapshot.activities
    .filter((activity) => activity.stageId === stage.id)
    .sort((a, b) => a.position - b.position);
  // Whose snags hold a retention: the commitment's person, by name (E4).
  const person =
    commitment.personId === null
      ? null
      : (snapshot.people.find((each) => each.id === commitment.personId)?.name ??
        t('snags.row.personGone'));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const bp = percentToBp(share);
    const draft = {
      label: label.trim(),
      shareBp: bp ?? Number.NaN,
      trigger,
      activityId: trigger === 'activity_finished' && activityId !== '' ? activityId : null,
    };
    const problems = validateMilestone(snapshot, commitment.id, draft);
    if (problems.length > 0) {
      onProblem(problemText(i18n, problems));
      return;
    }
    onProblem(null);
    add.mutate(
      { commitmentId: commitment.id, ...draft },
      {
        onSuccess: () => {
          announce(t('money.milestone.added', { name: draft.label }));
          setLabel('');
          setShare('');
          labelRef.current?.focus();
        },
        onError: (error) => onProblem(i18n.describeError(error)),
      },
    );
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid items-start gap-2 md:grid-cols-[minmax(0,1fr)_6rem_minmax(0,13rem)_minmax(0,13rem)_auto]"
    >
      <Input
        ref={labelRef}
        data-testid="milestone-add-label"
        aria-label={t('money.milestone.add.label')}
        placeholder={t('money.milestone.add.label')}
        maxLength={MILESTONE_LABEL_LIMIT}
        value={label}
        onChange={(event) => setLabel(event.target.value)}
      />
      <Input
        data-testid="milestone-add-share"
        inputMode="decimal"
        aria-label={t('money.milestone.add.share')}
        placeholder={t('money.milestone.add.share')}
        value={share}
        onChange={(event) => setShare(event.target.value)}
      />
      <Select
        data-testid="milestone-add-trigger"
        aria-label={t('money.milestone.add.trigger')}
        value={trigger}
        onChange={(event) => setTrigger(event.target.value as MilestoneTrigger)}
      >
        {MILESTONE_TRIGGERS.map((each) => (
          <option key={each} value={each}>
            {t(MILESTONE_TRIGGER_KEYS[each])}
          </option>
        ))}
      </Select>
      <div className="min-w-0">
        {trigger === 'activity_finished' ? (
          activities.length === 0 ? (
            <p className="text-caption text-fg-secondary">
              {t('money.milestone.noActivities', { stage: stage.name })}
            </p>
          ) : (
            <Select
              data-testid="milestone-add-activity"
              aria-label={t('money.milestone.add.activity')}
              value={activityId}
              onChange={(event) => setActivityId(event.target.value)}
            >
              <option value="">{t('money.milestone.add.chooseActivity')}</option>
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.name}
                </option>
              ))}
            </Select>
          )
        ) : trigger === 'advance' ? (
          <p className="text-caption text-fg-secondary">{t('money.milestone.advanceNote')}</p>
        ) : trigger === 'retention' ? (
          <p className="text-caption text-fg-secondary">
            {person === null
              ? t(RETENTION_KEYS.noPerson)
              : t('money.milestone.retentionNote', { name: person })}
          </p>
        ) : null}
      </div>
      <Button
        type="submit"
        icon={<Add20Regular />}
        data-testid="milestone-add"
        disabled={add.isPending}
      >
        {t('money.milestone.add')}
      </Button>
    </form>
  );
}

/**
 * **Hold back as retention** (E4, decision 3, `milestone-retention`): adds the commitment's last
 * part, earned only when its stage is closed and every snag of it on the commitment's person is
 * fixed — the money a layperson never knows to hold. The share is the domain's suggestion (5 %, or
 * what the plan has left when that is less), and the sentence beside the button says it is a usual
 * practice, not advice; the share is changed afterwards like any other. A commitment on nobody is
 * told that no snag can hold it. A plan already at 100 % keeps the button, disabled, with the
 * sentence that says why beside it; a plan that holds a retention already is not offered another.
 */
function RetentionOffer({
  commitment,
  snapshot,
  onProblem,
  onAdded,
}: {
  commitment: Commitment;
  snapshot: WorkSnapshot;
  onProblem: (problem: string | null) => void;
  onAdded: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const add = useAddMilestone();
  const note = useId();
  const offer = retentionOffer(snapshot, commitment.id);
  if (!offer.ok && offer.code !== 'full') return null;

  const hold = () => {
    if (!offer.ok) return;
    const draft = {
      label: t(offer.labelKey),
      shareBp: offer.shareBp,
      trigger: offer.trigger,
      activityId: offer.activityId,
    };
    const problems = validateMilestone(snapshot, commitment.id, draft);
    if (problems.length > 0) {
      onProblem(problemText(i18n, problems));
      return;
    }
    onProblem(null);
    add.mutate(
      { commitmentId: commitment.id, ...draft },
      {
        onSuccess: () => {
          announce(
            t('money.paymentPlan.retention.done', { share: percentText(i18n, offer.shareBp) }),
          );
          onAdded();
        },
        onError: (error) => onProblem(i18n.describeError(error)),
      },
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          icon={<LockClosed20Regular />}
          data-testid="milestone-retention"
          aria-describedby={note}
          disabled={!offer.ok || add.isPending}
          onClick={hold}
        >
          {add.isPending ? t('common.working') : t(RETENTION_KEYS.offer)}
        </Button>
      </div>
      <p id={note} data-testid="milestone-retention-note" className="text-caption text-fg-tertiary">
        {offer.ok
          ? [
              t(offer.noteKey, { share: percentText(i18n, offer.shareBp) }),
              offer.holdsOnPerson ? null : t(RETENTION_KEYS.noPerson),
            ]
              .filter((each) => each !== null)
              .join(' ')
          : t(RETENTION_KEYS.full)}
      </p>
    </div>
  );
}
