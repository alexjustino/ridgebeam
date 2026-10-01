/**
 * Payment plans: what a commitment has earned by the facts of the work, what was paid on it, what is
 * due now and what was paid ahead of the work (slice D2, ADR-037).
 *
 * A commitment may carry a **payment plan**: milestones, each a share of its amount in basis points
 * (`shareBp`, 3 000 is 30 %), summing to at most 10 000. **A milestone is earned by a fact, never a
 * date or a tick**, on the day of that fact:
 *
 * - `advance` — the day the commitment was agreed (`agreedOn`): a "sinal", paid before any work;
 * - `stage_started` — the day the commitment's stage was started, its start gate passed (F5
 *   `startedAt`; a stage closed without a start said, which the host never stores, counts from its
 *   close);
 * - `activity_finished` — the first day an effective diary entry finished the activity (F4
 *   `progress`, corrections applied: a correction that un-finishes it un-earns the milestone);
 * - `stage_closed` — the day the stage was closed (F5 `closedAt`); a reopened stage has no `closedAt`,
 *   so it un-earns it.
 *
 * A fact dated after today is not a fact yet. **Today is an input**, as everywhere in the domain.
 *
 * **Basis points on cents**: each milestone is `amount × shareBp / 10 000` rounded half up, in whole
 * cents and exact integer arithmetic (`milestoneCents`); when the plan is 100 % (the shares sum to
 * exactly 10 000), the **last milestone takes the remainder**, so the plan sums to the amount to the
 * cent. A plan below 100 % is rounded milestone by milestone; the rest is "not in the plan yet".
 *
 * Per commitment: **earned** (rows: the milestones reached, each with its day), **paid** (rows: the
 * ledger's payments on it, reversals applied — `money.ts`), **due now** = max(0, earned − paid) and
 * **paid ahead** = max(0, paid − earned). Per stage and for the work: the sums, with a row per
 * commitment — due and ahead are never netted across commitments: one paid ahead does not pay what
 * another has earned. **A commitment with no milestones has no payment plan**: it is not evaluated,
 * never assumed earned or not, and is counted and listed (`noPlanFigure`). Payments on no commitment
 * are outside all this; a figure says how many there are (`outside`).
 *
 * **Paying ahead is warned, not refused** (money is a fact, F6): `paymentPreview` says what a draft
 * payment would leave earned, paid, due and ahead, before it is saved; a reversal is never warned
 * about. **A plan is locked once money has moved** on its commitment (`milestonesLocked`): a plan
 * rewritten after paying would hide being ahead. The host refuses; the domain says so first.
 *
 * Nothing here changes readiness: a payment plan is an agreement about money, not something the plan
 * lacks.
 *
 * What this module is not: storage or text. It returns rows, codes, message keys and figures.
 */

import { isIsoDay } from './calendar';
import { counted, moneyFigure, type AmountRow, type Figure } from './figure';
import { progress, type DiaryEntry } from './diary';
import { paidRowsByCommitment, type MoneyRow, type PaymentDraft } from './money';
import {
  compareText,
  stagesInOrder,
  type Activity,
  type Commitment,
  type Milestone,
  type MilestoneTrigger,
  type Stage,
  type WorkSnapshot,
} from './plan';

export type { Milestone, MilestoneTrigger } from './plan';

// ── Constants and message keys ───────────────────────────────────────────────

export const MILESTONE_TRIGGERS = [
  'advance',
  'stage_started',
  'activity_finished',
  'stage_closed',
] as const satisfies readonly MilestoneTrigger[];

/** A whole plan: 100 %, in basis points. */
export const FULL_PLAN_BP = 10_000;

/** The longest a milestone's label may be, in characters. */
export const MILESTONE_LABEL_LIMIT = 120;

/** What each trigger is called on screen ("Stage started"). */
export const MILESTONE_TRIGGER_KEYS = {
  advance: 'money.milestone.trigger.advance',
  stage_started: 'money.milestone.trigger.stageStarted',
  activity_finished: 'money.milestone.trigger.activityFinished',
  stage_closed: 'money.milestone.trigger.stageClosed',
} as const satisfies Record<MilestoneTrigger, string>;

/**
 * What a milestone not earned yet waits for, said of its target: `{name}` — "{name} is not agreed
 * yet" (an advance dated after today), "{name} is not started yet", "{name} is not finished yet",
 * "{name} is not closed yet".
 */
export const MILESTONE_PENDING_KEYS = {
  advance: 'money.milestone.pending.advance',
  stage_started: 'money.milestone.pending.stageStarted',
  activity_finished: 'money.milestone.pending.activityFinished',
  stage_closed: 'money.milestone.pending.stageClosed',
} as const satisfies Record<MilestoneTrigger, string>;

/**
 * A milestone's state: `{day}` — "earned on {day}"; "not yet". And the sum line: `{planned}`,
 * `{rest}` (percent) — "{planned} in the plan; {rest} not yet"; and `{planned}` — "{planned} in the
 * plan" when it is whole.
 */
export const MILESTONE_STATE_KEYS = {
  earned: 'money.milestone.state.earned',
  notYet: 'money.milestone.state.notYet',
  sum: 'money.paymentPlan.sum',
  sumWhole: 'money.paymentPlan.sumWhole',
} as const;

/** The figures' labels. */
export const MILESTONE_LABEL_KEYS = {
  earned: 'money.paymentPlan.figure.earned',
  paid: 'money.paymentPlan.figure.paid',
  due: 'money.paymentPlan.figure.due',
  ahead: 'money.paymentPlan.figure.ahead',
  /** A count: "2 commitments paid ahead of the work". */
  paidAhead: 'money.paymentPlan.figure.paidAhead',
  /** A sum: "R$ 300,00 earned and not paid". */
  dueNow: 'money.paymentPlan.figure.dueNow',
  noPlan: 'money.paymentPlan.figure.noPlan',
  /** A count: "3 payments on no commitment are outside the payment plans". */
  outside: 'money.paymentPlan.figure.outside',
} as const;

/**
 * The warning before a payment (decision 4): `{amount}`, `{commitment}`, `{earned}`, `{next}`,
 * `{share}` (percent), `{pending}` (the next milestone's pending sentence) — "This payment puts you
 * {amount} ahead of the work on {commitment}: earned so far {earned} — {next} ({share}) …";
 * `aheadNoNext` when every milestone is earned and the rest of the amount is not in the plan.
 */
export const PAYMENT_PREVIEW_KEYS = {
  ahead: 'money.paymentPreview.ahead',
  aheadNoNext: 'money.paymentPreview.aheadNoNext',
} as const;

/** Why a milestone is refused before the host is asked. */
export const MILESTONE_PROBLEM_KEYS = {
  'unknown-commitment': 'money.milestone.problem.unknownCommitment',
  'unknown-milestone': 'money.milestone.problem.unknownMilestone',
  locked: 'money.milestone.problem.locked',
  'label-empty': 'money.milestone.problem.labelEmpty',
  'label-too-long': 'money.milestone.problem.labelTooLong',
  'invalid-share': 'money.milestone.problem.invalidShare',
  'over-plan': 'money.milestone.problem.overPlan',
  'invalid-trigger': 'money.milestone.problem.invalidTrigger',
  'activity-required': 'money.milestone.problem.activityRequired',
  'activity-not-allowed': 'money.milestone.problem.activityNotAllowed',
  'unknown-activity': 'money.milestone.problem.unknownActivity',
  'activity-of-another-stage': 'money.milestone.problem.activityOfAnotherStage',
} as const;

/**
 * The usual plan (decision 6), as data: 30 % when the stage starts, 40 % when its last activity is
 * finished, 30 % when it closes. A common split, said as such, never advice. The labels are the
 * person's language (`USUAL_PLAN_LABEL_KEYS`); the host picks the stage's last activity by position.
 */
export const USUAL_PLAN = [
  { part: 'started', shareBp: 3_000, trigger: 'stage_started' },
  { part: 'finished', shareBp: 4_000, trigger: 'activity_finished' },
  { part: 'closed', shareBp: 3_000, trigger: 'stage_closed' },
] as const satisfies ReadonlyArray<{
  part: string;
  shareBp: number;
  trigger: MilestoneTrigger;
}>;

export type UsualPart = (typeof USUAL_PLAN)[number]['part'];

/**
 * The usual plan's labels (`milestones_usual`'s `labels`), and the line under its button: "A common
 * split, not advice: change it to what you agreed."
 */
export const USUAL_PLAN_LABEL_KEYS = {
  started: 'money.paymentPlan.usual.started',
  finished: 'money.paymentPlan.usual.finished',
  closed: 'money.paymentPlan.usual.closed',
  note: 'money.paymentPlan.usual.note',
} as const satisfies Record<UsualPart | 'note', string>;

/** Every message key this module adds, for the dictionaries' completeness test. */
export const MILESTONE_MESSAGE_KEYS: readonly string[] = [
  ...Object.values(MILESTONE_TRIGGER_KEYS),
  ...Object.values(MILESTONE_PENDING_KEYS),
  ...Object.values(MILESTONE_STATE_KEYS),
  ...Object.values(MILESTONE_LABEL_KEYS),
  ...Object.values(PAYMENT_PREVIEW_KEYS),
  ...Object.values(MILESTONE_PROBLEM_KEYS),
  ...Object.values(USUAL_PLAN_LABEL_KEYS),
];

// ── Basis points on cents ────────────────────────────────────────────────────

/**
 * `amount × bp / 10 000`, rounded half up, in exact integer arithmetic: the amount is split into
 * whole ten-thousands and a rest, so no product leaves the range a float holds exactly.
 */
export function shareOfCents(amountCents: number, bp: number): number {
  const whole = Math.floor(amountCents / FULL_PLAN_BP);
  const rest = amountCents - whole * FULL_PLAN_BP;
  return whole * bp + Math.floor((rest * bp + FULL_PLAN_BP / 2) / FULL_PLAN_BP);
}

/**
 * Each milestone's cents, in the order given (position order): half up milestone by milestone, and,
 * when the shares sum to exactly 10 000, the last takes the remainder so the plan sums to the amount
 * exactly. The last may then differ from its own share by up to half a cent per other milestone.
 */
export function milestoneCents(amountCents: number, milestones: readonly Milestone[]): number[] {
  const cents = milestones.map((milestone) => shareOfCents(amountCents, milestone.shareBp));
  const total = milestones.reduce((sum, milestone) => sum + milestone.shareBp, 0);
  if (total === FULL_PLAN_BP && cents.length > 0) {
    const others = cents.slice(0, -1).reduce((sum, each) => sum + each, 0);
    cents[cents.length - 1] = amountCents - others;
  }
  return cents;
}

/**
 * A percent as the person types it — whole, or with one decimal after `.` or `,` ("30", "12,5") —
 * in basis points; `null` when it is not one. The range is `validateMilestone`'s business.
 */
export function percentToBp(text: string): number | null {
  const match = /^\s*(\d{1,5})(?:[.,](\d))?\s*$/.exec(text);
  if (match === null) return null;
  return Number(match[1]) * 100 + Number(match[2] ?? '0') * 10;
}

// ── Reading a commitment's plan ──────────────────────────────────────────────

/** A commitment's milestones in position order (then id), whatever order they were given in. */
export function milestonesInOrder(commitment: Commitment): Milestone[] {
  return [...commitment.milestones].sort(
    (a, b) => a.position - b.position || compareText(a.id, b.id),
  );
}

/**
 * The commitments money has moved on: some payment names it, a reversal counting for the one its
 * original names. Their plans are locked.
 */
export function commitmentsWithMoney(snapshot: WorkSnapshot): Set<string> {
  const bySeq = new Map(snapshot.payments.map((payment) => [payment.seq, payment]));
  const moved = new Set<string>();
  for (const payment of snapshot.payments) {
    if (payment.commitmentId !== null) moved.add(payment.commitmentId);
    const original = payment.reversesSeq === null ? undefined : bySeq.get(payment.reversesSeq);
    if (original !== undefined && original.commitmentId !== null) moved.add(original.commitmentId);
  }
  return moved;
}

/**
 * Has money moved on this commitment: does a payment (or a reversal of one) name it? Then its plan
 * cannot be added to, changed, moved or removed (decision 2). A closed stage does not lock it.
 */
export function milestonesLocked(snapshot: WorkSnapshot, commitmentId: string): boolean {
  return commitmentsWithMoney(snapshot).has(commitmentId);
}

/** What a milestone is earned by: the commitment (an advance), its stage, or an activity. */
export interface MilestoneTarget {
  readonly kind: 'commitment' | 'stage' | 'activity';
  readonly id: string;
  /** Its name (the commitment's label for an advance); `null` when it is not in the plan. */
  readonly name: string | null;
}

/** One milestone of a plan, with its cents and whether the work has earned it. */
export interface MilestoneStatus {
  readonly milestone: Milestone;
  readonly commitmentId: string;
  /** Its share of the commitment's amount, rounded (`milestoneCents`). */
  readonly cents: number;
  readonly target: MilestoneTarget;
  readonly earned: boolean;
  /** The day of the fact that earned it; `null` while not earned. */
  readonly earnedOn: string | null;
}

/** A row of an earned figure: one milestone reached, on the day of its fact. */
export interface MilestoneRow extends AmountRow {
  readonly source: 'milestone';
  readonly milestoneId: string;
  readonly commitmentId: string;
  readonly stageId: string;
  readonly trigger: MilestoneTrigger;
  readonly shareBp: number;
  readonly target: MilestoneTarget;
}

/** The next milestone of a plan: the first by position not earned yet. */
export interface NextMilestone {
  readonly milestoneId: string;
  readonly label: string;
  readonly shareBp: number;
  readonly cents: number;
  readonly trigger: MilestoneTrigger;
  readonly target: MilestoneTarget;
  /** The sentence of what it waits for (`MILESTONE_PENDING_KEYS`), `{name}` the target's. */
  readonly pendingKey: (typeof MILESTONE_PENDING_KEYS)[MilestoneTrigger];
}

/** One commitment's payment plan and what the work has made of it. */
export interface CommitmentPlan {
  readonly commitmentId: string;
  readonly stageId: string;
  readonly personId: string | null;
  readonly label: string;
  readonly amountCents: number;
  /**
   * It has at least one milestone. Without one, nothing is earned, due or ahead: those figures are
   * empty, not evaluated; paid is still what the ledger says.
   */
  readonly hasPlan: boolean;
  /** A payment names it: its plan can no longer change. */
  readonly locked: boolean;
  /** The shares' sum, in basis points, and what is not in the plan yet (10 000 less it, from 0). */
  readonly plannedBp: number;
  readonly restBp: number;
  /** The milestones in position order. */
  readonly milestones: readonly MilestoneStatus[];
  readonly next: NextMilestone | null;
  readonly earned: Figure<MilestoneRow>;
  readonly paid: Figure<MoneyRow>;
  /** Earned less paid when that is above zero (rows: the milestones, and the payments negated). */
  readonly due: Figure<MilestoneRow | MoneyRow>;
  /** Paid less earned when that is above zero (rows: the payments, and the milestones negated). */
  readonly ahead: Figure<MilestoneRow | MoneyRow>;
}

/** A row of a stage's or the work's figures: one commitment with a payment plan, and its amount. */
export interface PlanRow extends AmountRow {
  readonly commitmentId: string;
  readonly stageId: string;
  readonly personId: string | null;
  readonly commitmentCents: number;
  readonly earnedCents: number;
  readonly paidCents: number;
  readonly next: NextMilestone | null;
}

/** The sums over some commitments with a plan, a row per commitment. */
export interface PlanSums {
  /** A row per commitment with a plan. */
  readonly earned: Figure<PlanRow>;
  readonly paid: Figure<PlanRow>;
  /** A row per commitment with something due. */
  readonly due: Figure<PlanRow>;
  /** A row per commitment paid ahead, the excess its amount. */
  readonly ahead: Figure<PlanRow>;
}

export interface StagePlans extends PlanSums {
  readonly stageId: string;
}

/** A row of the no-plan figure, and of the outside figure. */
export interface NoPlanRow extends AmountRow {
  readonly commitmentId: string;
  readonly stageId: string;
}

export interface PaymentPlans {
  /** Every commitment: those of the plan's stages in stage order, then the rest, each in given order. */
  readonly commitments: readonly CommitmentPlan[];
  /** Every stage in plan order. */
  readonly stages: readonly StagePlans[];
  readonly work: PlanSums;
  /** The commitments with no payment plan, counted and listed (their amount on the row). */
  readonly noPlan: Figure<NoPlanRow>;
  /** The payments on no commitment, counted: outside the payment plans. */
  readonly outside: Figure<MoneyRow>;
}

// ── Earned ───────────────────────────────────────────────────────────────────

/** A timestamp's day, or the day itself. */
const dayOf = (at: string): string => at.slice(0, 10);

interface Facts {
  readonly upTo: string | null;
  readonly stages: ReadonlyMap<string, Stage>;
  readonly activities: ReadonlyMap<string, Activity>;
  readonly finishedOn: ReadonlyMap<string, string>;
}

function factsOf(snapshot: WorkSnapshot, entries: readonly DiaryEntry[], today: string): Facts {
  const needsDiary = snapshot.commitments.some((commitment) =>
    commitment.milestones.some((milestone) => milestone.trigger === 'activity_finished'),
  );
  const finishedOn = new Map<string, string>();
  if (needsDiary) {
    for (const [id, each] of progress(snapshot, entries)) {
      if (each.finishedOn !== null) finishedOn.set(id, each.finishedOn);
    }
  }
  return {
    upTo: isIsoDay(today) ? today : null,
    stages: new Map(snapshot.stages.map((stage) => [stage.id, stage])),
    activities: new Map(snapshot.activities.map((activity) => [activity.id, activity])),
    finishedOn,
  };
}

/** The target a milestone is earned by, and the day of its fact when there is one. */
function factOf(
  commitment: Commitment,
  milestone: Milestone,
  facts: Facts,
): { target: MilestoneTarget; day: string | null } {
  const stage = facts.stages.get(commitment.stageId);
  const onStage: MilestoneTarget = {
    kind: 'stage',
    id: commitment.stageId,
    name: stage?.name ?? null,
  };
  switch (milestone.trigger) {
    case 'advance':
      return {
        target: { kind: 'commitment', id: commitment.id, name: commitment.label },
        day: commitment.agreedOn,
      };
    case 'stage_started': {
      const at = stage?.startedAt ?? stage?.closedAt ?? null;
      return { target: onStage, day: at === null ? null : dayOf(at) };
    }
    case 'stage_closed': {
      const at = stage?.closedAt ?? null;
      return { target: onStage, day: at === null ? null : dayOf(at) };
    }
    case 'activity_finished': {
      const id = milestone.activityId ?? '';
      return {
        target: { kind: 'activity', id, name: facts.activities.get(id)?.name ?? null },
        day: facts.finishedOn.get(id) ?? null,
      };
    }
  }
}

function negated<Row extends AmountRow>(row: Row): Row {
  // `0`, never `-0`.
  return { ...row, amountCents: row.amountCents === 0 ? 0 : -row.amountCents };
}

function commitmentPlan(
  commitment: Commitment,
  paidRows: readonly MoneyRow[],
  locked: boolean,
  facts: Facts,
): CommitmentPlan {
  const ordered = milestonesInOrder(commitment);
  const cents = milestoneCents(commitment.amountCents, ordered);
  const milestones: MilestoneStatus[] = ordered.map((milestone, index) => {
    const { target, day } = factOf(commitment, milestone, facts);
    const earned = day !== null && (facts.upTo === null || day <= facts.upTo);
    return {
      milestone,
      commitmentId: commitment.id,
      cents: cents[index]!,
      target,
      earned,
      earnedOn: earned ? day : null,
    };
  });

  const earnedRows: MilestoneRow[] = milestones
    .filter((status) => status.earned)
    .map((status) => ({
      key: `milestone:${status.milestone.id}`,
      itemId: status.milestone.id,
      title: status.milestone.label,
      day: status.earnedOn,
      minutes: 0,
      amountCents: status.cents,
      source: 'milestone',
      milestoneId: status.milestone.id,
      commitmentId: commitment.id,
      stageId: commitment.stageId,
      trigger: status.milestone.trigger,
      shareBp: status.milestone.shareBp,
      target: status.target,
    }));
  const hasPlan = ordered.length > 0;
  const earned = moneyFigure(
    `earned:commitment:${commitment.id}`,
    MILESTONE_LABEL_KEYS.earned,
    hasPlan ? earnedRows : [],
  );
  // Paid is what the ledger says, plan or not; due and ahead are evaluated only against a plan.
  const paid = moneyFigure(`paid:commitment:${commitment.id}`, MILESTONE_LABEL_KEYS.paid, paidRows);
  const dueRows =
    hasPlan && earned.value > paid.value ? [...earned.rows, ...paid.rows.map(negated)] : [];
  const aheadRows =
    hasPlan && paid.value > earned.value ? [...paid.rows, ...earned.rows.map(negated)] : [];

  const pending = milestones.find((status) => !status.earned);
  const plannedBp = ordered.reduce((sum, milestone) => sum + milestone.shareBp, 0);
  return {
    commitmentId: commitment.id,
    stageId: commitment.stageId,
    personId: commitment.personId,
    label: commitment.label,
    amountCents: commitment.amountCents,
    hasPlan,
    locked,
    plannedBp,
    restBp: Math.max(0, FULL_PLAN_BP - plannedBp),
    milestones,
    next:
      pending === undefined
        ? null
        : {
            milestoneId: pending.milestone.id,
            label: pending.milestone.label,
            shareBp: pending.milestone.shareBp,
            cents: pending.cents,
            trigger: pending.milestone.trigger,
            target: pending.target,
            pendingKey: MILESTONE_PENDING_KEYS[pending.milestone.trigger],
          },
    earned,
    paid,
    due: moneyFigure(`due:commitment:${commitment.id}`, MILESTONE_LABEL_KEYS.due, dueRows),
    ahead: moneyFigure(`ahead:commitment:${commitment.id}`, MILESTONE_LABEL_KEYS.ahead, aheadRows),
  };
}

function planRow(plan: CommitmentPlan, amountCents: number): PlanRow {
  return {
    key: `commitment:${plan.commitmentId}`,
    itemId: plan.commitmentId,
    title: plan.label,
    day: null,
    minutes: 0,
    amountCents,
    commitmentId: plan.commitmentId,
    stageId: plan.stageId,
    personId: plan.personId,
    commitmentCents: plan.amountCents,
    earnedCents: plan.earned.value,
    paidCents: plan.paid.value,
    next: plan.next,
  };
}

function sums(scope: string, plans: readonly CommitmentPlan[]): PlanSums {
  const withPlan = plans.filter((plan) => plan.hasPlan);
  return {
    earned: moneyFigure(
      `earned:${scope}`,
      MILESTONE_LABEL_KEYS.earned,
      withPlan.map((plan) => planRow(plan, plan.earned.value)),
    ),
    paid: moneyFigure(
      `paid:${scope}`,
      MILESTONE_LABEL_KEYS.paid,
      withPlan.map((plan) => planRow(plan, plan.paid.value)),
    ),
    due: moneyFigure(
      `due:${scope}`,
      MILESTONE_LABEL_KEYS.due,
      withPlan.filter((plan) => plan.due.value > 0).map((plan) => planRow(plan, plan.due.value)),
    ),
    ahead: moneyFigure(
      `ahead:${scope}`,
      MILESTONE_LABEL_KEYS.ahead,
      withPlan
        .filter((plan) => plan.ahead.value > 0)
        .map((plan) => planRow(plan, plan.ahead.value)),
    ),
  };
}

/** The commitments in the order the plan shows them: by their stage's order, then as given. */
function commitmentsInOrder(snapshot: WorkSnapshot): Commitment[] {
  const rank = new Map(stagesInOrder(snapshot).map((stage, index) => [stage.id, index]));
  const unknown = rank.size;
  return snapshot.commitments
    .map((commitment, index) => ({ commitment, index }))
    .sort(
      (a, b) =>
        (rank.get(a.commitment.stageId) ?? unknown) - (rank.get(b.commitment.stageId) ?? unknown) ||
        a.index - b.index,
    )
    .map(({ commitment }) => commitment);
}

const cache = new WeakMap<
  WorkSnapshot,
  { entries: readonly DiaryEntry[]; today: string; plans: PaymentPlans }
>();

/**
 * Every commitment's payment plan and what the work has made of it, as of `today`, with the sums per
 * stage and for the work. Linear in the plan, the ledger and the diary; remembered for the last
 * `entries` (the same list, or two empty ones) and `today` asked of a snapshot, so the figures below
 * cost nothing more.
 */
export function paymentPlans(
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
  today: string,
): PaymentPlans {
  const cached = cache.get(snapshot);
  const sameDiary =
    cached !== undefined &&
    (cached.entries === entries || (cached.entries.length === 0 && entries.length === 0));
  if (cached !== undefined && sameDiary && cached.today === today) {
    return cached.plans;
  }

  const facts = factsOf(snapshot, entries, today);
  const paidRows = paidRowsByCommitment(snapshot);
  const moved = commitmentsWithMoney(snapshot);
  const commitments = commitmentsInOrder(snapshot).map((commitment) =>
    commitmentPlan(commitment, paidRows.get(commitment.id) ?? [], moved.has(commitment.id), facts),
  );

  const byStage = new Map<string, CommitmentPlan[]>();
  for (const plan of commitments) {
    const list = byStage.get(plan.stageId);
    if (list === undefined) byStage.set(plan.stageId, [plan]);
    else list.push(plan);
  }

  const plans: PaymentPlans = {
    commitments,
    stages: stagesInOrder(snapshot).map((stage) => ({
      stageId: stage.id,
      ...sums(`stage:${stage.id}`, byStage.get(stage.id) ?? []),
    })),
    work: sums('work', commitments),
    noPlan: noPlanFigure(snapshot),
    outside: counted('payments-outside', MILESTONE_LABEL_KEYS.outside, paidRows.get(null) ?? []),
  };
  cache.set(snapshot, { entries, today, plans });
  return plans;
}

/** One commitment's plan, or `null` when the commitment is not in the plan. */
export function commitmentPlanOf(
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
  today: string,
  commitmentId: string,
): CommitmentPlan | null {
  return (
    paymentPlans(snapshot, entries, today).commitments.find(
      (plan) => plan.commitmentId === commitmentId,
    ) ?? null
  );
}

/**
 * The commitments paid ahead of the work, counted: "1 commitment paid ahead of the work". Each row's
 * amount is its excess, paid less earned.
 */
export function aheadFigure(
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
  today: string,
): Figure<PlanRow> {
  return counted(
    'paid-ahead',
    MILESTONE_LABEL_KEYS.paidAhead,
    paymentPlans(snapshot, entries, today).work.ahead.rows,
  );
}

/** What is earned and not paid, summed over the commitments: a row per commitment with some due. */
export function dueFigure(
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
  today: string,
): Figure<PlanRow> {
  return moneyFigure(
    'due-now',
    MILESTONE_LABEL_KEYS.dueNow,
    paymentPlans(snapshot, entries, today).work.due.rows,
  );
}

/**
 * The commitments with no payment plan, counted and listed in plan order, each with its amount:
 * never assumed earned or not. Needs neither the diary nor today.
 */
export function noPlanFigure(snapshot: WorkSnapshot): Figure<NoPlanRow> {
  const rows: NoPlanRow[] = commitmentsInOrder(snapshot)
    .filter((commitment) => commitment.milestones.length === 0)
    .map((commitment) => ({
      key: `commitment:${commitment.id}`,
      itemId: commitment.id,
      title: commitment.label,
      day: null,
      minutes: 0,
      amountCents: commitment.amountCents,
      commitmentId: commitment.id,
      stageId: commitment.stageId,
    }));
  return counted('no-payment-plan', MILESTONE_LABEL_KEYS.noPlan, rows);
}

// ── The warning before a payment ─────────────────────────────────────────────

/**
 * What a draft payment would do to its commitment's plan (decision 4). `none`: it names no
 * commitment, or one not in the plan. `no-plan`: the commitment has no payment plan, so nothing is
 * evaluated. `plan`: earned so far, paid so far and after, due and ahead now and after; `warn` when
 * the draft is a payment (not a reversal) of more than zero that leaves the commitment ahead of the
 * work, with the sentence's key (`PAYMENT_PREVIEW_KEYS`) and the next milestone to name. Saving is
 * never refused: the warning is the whole of it.
 */
export type PaymentPreview =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'no-plan';
      readonly commitmentId: string;
      readonly paidCents: number;
      readonly paidAfterCents: number;
    }
  | {
      readonly kind: 'plan';
      readonly commitmentId: string;
      readonly label: string;
      readonly earnedCents: number;
      readonly paidCents: number;
      readonly paidAfterCents: number;
      readonly dueCents: number;
      readonly dueAfterCents: number;
      readonly aheadCents: number;
      readonly aheadAfterCents: number;
      readonly reversal: boolean;
      readonly warn: boolean;
      readonly messageKey: (typeof PAYMENT_PREVIEW_KEYS)[keyof typeof PAYMENT_PREVIEW_KEYS] | null;
      readonly next: NextMilestone | null;
    };

/**
 * The preview the Ledger form shows live while a payment is typed. The draft's amount counts only
 * when it is whole cents; a reversal names the commitment of the payment it reverses.
 */
export function paymentPreview(
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
  today: string,
  draft: PaymentDraft,
): PaymentPreview {
  const reversal = draft.reversesSeq !== null;
  const original = reversal
    ? snapshot.payments.find((payment) => payment.seq === draft.reversesSeq)
    : undefined;
  const commitmentId = original?.commitmentId ?? draft.commitmentId;
  if (commitmentId === null) return { kind: 'none' };
  const plan = commitmentPlanOf(snapshot, entries, today, commitmentId);
  if (plan === null) return { kind: 'none' };

  const amount = Number.isInteger(draft.amountCents) ? draft.amountCents : 0;
  const paidCents = plan.paid.value;
  const paidAfterCents = paidCents + amount;
  if (!plan.hasPlan) return { kind: 'no-plan', commitmentId, paidCents, paidAfterCents };

  const earnedCents = plan.earned.value;
  const aheadAfterCents = Math.max(0, paidAfterCents - earnedCents);
  const warn = !reversal && amount > 0 && aheadAfterCents > 0;
  return {
    kind: 'plan',
    commitmentId,
    label: plan.label,
    earnedCents,
    paidCents,
    paidAfterCents,
    dueCents: plan.due.value,
    dueAfterCents: Math.max(0, earnedCents - paidAfterCents),
    aheadCents: plan.ahead.value,
    aheadAfterCents,
    reversal,
    warn,
    messageKey: warn
      ? plan.next === null
        ? PAYMENT_PREVIEW_KEYS.aheadNoNext
        : PAYMENT_PREVIEW_KEYS.ahead
      : null,
    next: plan.next,
  };
}

// ── Checking a milestone before the host is asked ────────────────────────────

/** A milestone as the interface asks the host to add it, or the whole of what an edit sets. */
export interface MilestoneDraft {
  readonly label: string;
  readonly shareBp: number;
  readonly trigger: MilestoneTrigger;
  readonly activityId: string | null;
}

export type MilestoneProblemCode = keyof typeof MILESTONE_PROBLEM_KEYS;

export type MilestoneProblem =
  | { readonly code: Exclude<MilestoneProblemCode, 'over-plan'> }
  | {
      readonly code: 'over-plan';
      /** What is left in the plan for this milestone, in basis points. */
      readonly availableBp: number;
    };

/**
 * Check a milestone before the host is asked: added to `commitmentId`, or, with `editingId`, as that
 * milestone would become. Never throws; every problem is reported. Refused: a commitment or milestone
 * not in the plan; a commitment money has moved on (`locked`); an empty label, or one over 120
 * characters; a share that is not whole basis points from 1 to 10 000, or that takes the plan over
 * 100 %; a trigger that is not one of the four; an activity missing for `activity_finished` or given
 * for another trigger, not in the plan, or of another stage than the commitment's.
 */
export function validateMilestone(
  snapshot: WorkSnapshot,
  commitmentId: string,
  draft: MilestoneDraft,
  editingId: string | null = null,
): MilestoneProblem[] {
  const commitment = snapshot.commitments.find((each) => each.id === commitmentId);
  if (commitment === undefined) return [{ code: 'unknown-commitment' }];
  const problems: MilestoneProblem[] = [];
  if (editingId !== null && !commitment.milestones.some((each) => each.id === editingId)) {
    problems.push({ code: 'unknown-milestone' });
  }
  if (milestonesLocked(snapshot, commitmentId)) problems.push({ code: 'locked' });

  if (draft.label.trim() === '') problems.push({ code: 'label-empty' });
  else if (draft.label.length > MILESTONE_LABEL_LIMIT) problems.push({ code: 'label-too-long' });

  if (!Number.isInteger(draft.shareBp) || draft.shareBp < 1 || draft.shareBp > FULL_PLAN_BP) {
    problems.push({ code: 'invalid-share' });
  } else {
    const others = commitment.milestones
      .filter((each) => each.id !== editingId)
      .reduce((sum, each) => sum + each.shareBp, 0);
    if (others + draft.shareBp > FULL_PLAN_BP) {
      problems.push({ code: 'over-plan', availableBp: Math.max(0, FULL_PLAN_BP - others) });
    }
  }

  if (!(MILESTONE_TRIGGERS as readonly string[]).includes(draft.trigger)) {
    problems.push({ code: 'invalid-trigger' });
  } else if (draft.trigger === 'activity_finished') {
    const activity =
      draft.activityId === null
        ? undefined
        : snapshot.activities.find((each) => each.id === draft.activityId);
    if (draft.activityId === null) problems.push({ code: 'activity-required' });
    else if (activity === undefined) problems.push({ code: 'unknown-activity' });
    else if (activity.stageId !== commitment.stageId) {
      problems.push({ code: 'activity-of-another-stage' });
    }
  } else if (draft.activityId !== null) {
    problems.push({ code: 'activity-not-allowed' });
  }
  return problems;
}

// ── The usual plan ───────────────────────────────────────────────────────────

/** A stage's last activity by position (then id), as the host picks it; `null` when it has none. */
export function lastActivityOf(snapshot: WorkSnapshot, stageId: string): Activity | null {
  let last: Activity | null = null;
  for (const activity of snapshot.activities) {
    if (activity.stageId !== stageId) continue;
    if (
      last === null ||
      activity.position > last.position ||
      (activity.position === last.position && compareText(activity.id, last.id) > 0)
    ) {
      last = activity;
    }
  }
  return last;
}

/** The usual plan as it would be added to a commitment, or why it is not offered. */
export type UsualPlan =
  | {
      readonly ok: true;
      readonly milestones: ReadonlyArray<{
        readonly part: UsualPart;
        readonly labelKey: (typeof USUAL_PLAN_LABEL_KEYS)[UsualPart];
        readonly shareBp: number;
        readonly trigger: MilestoneTrigger;
        readonly activityId: string | null;
      }>;
    }
  | {
      readonly ok: false;
      readonly code: 'unknown-commitment' | 'has-plan' | 'locked' | 'no-activity';
    };

/**
 * The usual plan for a commitment (decision 6): offered only on one with no milestones and no money
 * moved, whose stage has an activity for the 40 % to wait on (its last, by position).
 */
export function usualPlan(snapshot: WorkSnapshot, commitmentId: string): UsualPlan {
  const commitment = snapshot.commitments.find((each) => each.id === commitmentId);
  if (commitment === undefined) return { ok: false, code: 'unknown-commitment' };
  if (commitment.milestones.length > 0) return { ok: false, code: 'has-plan' };
  if (milestonesLocked(snapshot, commitmentId)) return { ok: false, code: 'locked' };
  const last = lastActivityOf(snapshot, commitment.stageId);
  if (last === null) return { ok: false, code: 'no-activity' };
  return {
    ok: true,
    milestones: USUAL_PLAN.map((each) => ({
      part: each.part,
      labelKey: USUAL_PLAN_LABEL_KEYS[each.part],
      shareBp: each.shareBp,
      trigger: each.trigger,
      activityId: each.trigger === 'activity_finished' ? last.id : null,
    })),
  };
}
