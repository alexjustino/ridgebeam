/**
 * Change orders (slice E1, pt "aditivo"): nothing changes without a price and a date.
 *
 * A change order is somebody asking, on the record, for the approved work to change: who asked,
 * what changes, what it costs, and **what it does to the finish, computed by the schedule** before
 * anybody decides. This module answers the schedule's part and keeps the tally; the record is the
 * host's (insert-only, one decision per change), and the words are the interface's.
 *
 * **The impact is the schedule's, never typed.** `withEffects` builds the plan with the change
 * applied, in memory only, the way the what-if (`schedule/whatIf.ts`) does: an `add` is a new
 * activity in the change's stage, finish-to-start after `after` when it names one; a `duration` is
 * an override; a `remove` drops the activity and every dependency that names it. `changeImpact`
 * schedules both plans and says how far the finish moved, in signed working days, with the rows
 * that moved (`whatIfDelta`), plus the rows the change itself adds and removes.
 *
 * It refuses what the host would refuse, as data with message keys, never exceptions: a stage or an
 * activity the plan does not have, a closed stage (an add into it, or a duration or removal of one
 * of its activities: its work is a fact now), a duration outside 1–3 650 whole working days, a name
 * blank or over 200 characters, more than 50 effects, two effects on the same activity, and an
 * `after` the same change removes. An `after` in another stage is allowed: dependencies already
 * cross stages.
 *
 * **An approved change is already in the plan.** The impact of a decided change is the one frozen
 * in its decision (`finishBefore`, `finishAfter`, `daysDelta`): `changeImpact` is the question asked
 * of a change still to decide, and asking it of an approved one would apply it twice.
 *
 * **The tally counts decisions, not wishes.** `changeTally` sums the money and the days of the
 * approved changes only, from their decisions — the fact of the moment they were decided — and says
 * how long each change still waiting has waited, in calendar days, against a `today` the caller
 * passes. What this module is not: storage, text, or the record's own checks. No I/O.
 */

import { calendarDaysBetween, isIsoDay } from './calendar';
import {
  counted,
  daysFigure,
  moneyFigure,
  type AmountRow,
  type DaysRow,
  type Figure,
  type ReportRow,
} from './figure';
import {
  compareText,
  type Activity,
  type ChangeAskedBy,
  type ChangeEffect,
  type ChangeOrder,
  type ChangeOrderOutcome,
  type Dependency,
  type WorkSnapshot,
} from './plan';
import { schedule } from './schedule';
import { WHAT_IF_LIMIT_DAYS, whatIfDelta } from './schedule/whatIf';

export type {
  ChangeAskedBy,
  ChangeEffect,
  ChangeOrder,
  ChangeOrderDecision,
  ChangeOrderOutcome,
} from './plan';

// ── Limits and words ─────────────────────────────────────────────────────────

/** What the host accepts in a change's effects: the domain refuses the same, before it is asked. */
export const CHANGE_LIMITS = {
  /** Effects in one change. Zero is allowed: a money-only change. */
  effects: 50,
  /** Characters in an added activity's name (code points, as the host counts them). */
  name: 120,
  /** Whole working days a duration may be, from 1. */
  durationDays: WHAT_IF_LIMIT_DAYS,
} as const;

/**
 * Calendar days a change may wait for its decision before readiness says the plan does not know
 * something: waiting 7 days is still in time; 8 is not.
 */
export const CHANGE_WAITING_LIMIT_DAYS = 7;

/** How the interface says each refusal. */
export const CHANGE_PROBLEM_KEYS = {
  'unknown-stage': 'changes.problem.unknownStage',
  'closed-stage': 'changes.problem.closedStage',
  'unknown-activity': 'changes.problem.unknownActivity',
  'invalid-duration': 'changes.problem.invalidDuration',
  'invalid-name': 'changes.problem.invalidName',
  'too-many': 'changes.problem.tooMany',
  duplicate: 'changes.problem.duplicate',
  'after-removed': 'changes.problem.afterRemoved',
} as const;

/** A refusal's message key. */
export type ChangeMessageKey = (typeof CHANGE_PROBLEM_KEYS)[keyof typeof CHANGE_PROBLEM_KEYS];

/** The figures' names, as message keys. */
export const CHANGE_LABEL_KEYS = {
  /** The finish moved by one change: the impact shown before a decision. */
  moved: 'changes.figure.moved',
  /** Changes approved: the money they added (or saved). */
  cost: 'changes.figure.cost',
  /** Days added by changes: the working days their decisions moved the finish. */
  days: 'changes.figure.days',
  /** Waiting for a decision. */
  waiting: 'changes.figure.waiting',
} as const;

/** What was refused, and about which effect (its index in the list). */
export type ChangeProblemDetail =
  | { readonly code: 'unknown-stage'; readonly stageId: string }
  | {
      readonly code: 'closed-stage';
      readonly effectIndex: number;
      readonly stageId: string;
      /** The activity whose stage is closed; `null` for an add into the change's closed stage. */
      readonly activityId: string | null;
    }
  | { readonly code: 'unknown-activity'; readonly effectIndex: number; readonly activityId: string }
  | {
      readonly code: 'invalid-duration';
      readonly effectIndex: number;
      readonly durationDays: number;
    }
  | { readonly code: 'invalid-name'; readonly effectIndex: number }
  | { readonly code: 'too-many'; readonly count: number; readonly limit: number }
  | { readonly code: 'duplicate'; readonly effectIndex: number; readonly activityId: string }
  | { readonly code: 'after-removed'; readonly effectIndex: number; readonly activityId: string };

/** Why a change's effects were refused, with the key the interface says it with. */
export type ChangeProblem = ChangeProblemDetail & { readonly messageKey: ChangeMessageKey };

export type WithEffectsResult =
  | { readonly ok: true; readonly snapshot: WorkSnapshot }
  | { readonly ok: false; readonly problems: readonly ChangeProblem[] };

function problem(detail: ChangeProblemDetail): ChangeProblem {
  return { ...detail, messageKey: CHANGE_PROBLEM_KEYS[detail.code] };
}

// ── The plan with the change ─────────────────────────────────────────────────

/**
 * The id `withEffects` gives the activity an `add` effect makes, by the effect's index. It exists
 * only in memory: the host gives the real one when the change is approved.
 */
export function effectActivityId(effectIndex: number): string {
  return `change-effect:${effectIndex}`;
}

/** The id of the dependency an `add` effect with an `after` makes, by the effect's index. */
export function effectDependencyId(effectIndex: number): string {
  return `change-effect-link:${effectIndex}`;
}

const wholeDays = (value: number): boolean =>
  Number.isInteger(value) && value >= 1 && value <= CHANGE_LIMITS.durationDays;

const validName = (name: string): boolean =>
  name.trim() !== '' && [...name].length <= CHANGE_LIMITS.name;

/**
 * Check a change's effects against the plan, before it is raised or its impact is shown. Every
 * problem is reported, in effect order; none at all is `[]`. Never throws.
 */
export function validateEffects(
  snapshot: WorkSnapshot,
  stageId: string,
  effects: readonly ChangeEffect[],
): ChangeProblem[] {
  const problems: ChangeProblem[] = [];
  const stages = new Map(snapshot.stages.map((stage) => [stage.id, stage]));
  const activities = new Map(snapshot.activities.map((activity) => [activity.id, activity]));
  const closed = (id: string) => (stages.get(id)?.closedAt ?? null) !== null;

  const home = stages.get(stageId);
  if (home === undefined) problems.push(problem({ code: 'unknown-stage', stageId }));
  if (effects.length > CHANGE_LIMITS.effects) {
    problems.push(
      problem({ code: 'too-many', count: effects.length, limit: CHANGE_LIMITS.effects }),
    );
  }

  const removed = new Set(
    effects.flatMap((effect) => (effect.kind === 'remove' ? [effect.activityId] : [])),
  );
  const named = new Set<string>();
  effects.forEach((effect, effectIndex) => {
    if (effect.kind === 'add') {
      if (!validName(effect.name)) problems.push(problem({ code: 'invalid-name', effectIndex }));
      if (!wholeDays(effect.durationDays)) {
        problems.push(
          problem({ code: 'invalid-duration', effectIndex, durationDays: effect.durationDays }),
        );
      }
      if (home !== undefined && closed(home.id)) {
        problems.push(
          problem({ code: 'closed-stage', effectIndex, stageId: home.id, activityId: null }),
        );
      }
      const after = effect.after;
      if (after !== null) {
        if (!activities.has(after)) {
          problems.push(problem({ code: 'unknown-activity', effectIndex, activityId: after }));
        } else if (removed.has(after)) {
          problems.push(problem({ code: 'after-removed', effectIndex, activityId: after }));
        }
      }
      return;
    }

    const { activityId } = effect;
    // One effect per existing activity: two would depend on the order the host applies them in.
    if (named.has(activityId))
      problems.push(problem({ code: 'duplicate', effectIndex, activityId }));
    named.add(activityId);
    const target = activities.get(activityId);
    if (target === undefined) {
      problems.push(problem({ code: 'unknown-activity', effectIndex, activityId }));
    } else if (closed(target.stageId)) {
      problems.push(
        problem({ code: 'closed-stage', effectIndex, stageId: target.stageId, activityId }),
      );
    }
    if (effect.kind === 'duration' && !wholeDays(effect.durationDays)) {
      problems.push(
        problem({ code: 'invalid-duration', effectIndex, durationDays: effect.durationDays }),
      );
    }
  });
  return problems;
}

/** Does this dependency name the activity at either end? */
function names(dependency: Dependency, activityId: string): boolean {
  return (
    (dependency.blocker.kind === 'activity' && dependency.blocker.id === activityId) ||
    (dependency.blocked.kind === 'activity' && dependency.blocked.id === activityId)
  );
}

/**
 * The plan with a change's effects applied, landing in `stageId`, as a new snapshot; the one given
 * is never touched. Refused, with every problem, when any effect is (`validateEffects`). No effects
 * (a money-only change) give back an equal, new snapshot.
 *
 * An added activity goes last in the change's stage, with no responsible and no room, and its
 * finish-to-start link after `after` has no lag. A removed activity takes with it every dependency
 * that names it; a dependency on its stage stays (the stage stands for the activities it still
 * has). Cost lines are left as they are: the impact is the schedule's.
 */
export function withEffects(
  snapshot: WorkSnapshot,
  stageId: string,
  effects: readonly ChangeEffect[],
): WithEffectsResult {
  const problems = validateEffects(snapshot, stageId, effects);
  if (problems.length > 0) return { ok: false, problems };

  const durations = new Map<string, number>();
  const removed = new Set<string>();
  const added: Activity[] = [];
  const links: Dependency[] = [];
  let position = Math.max(
    0,
    ...snapshot.activities
      .filter((activity) => activity.stageId === stageId)
      .map((activity) => activity.position),
  );
  effects.forEach((effect, effectIndex) => {
    if (effect.kind === 'duration') durations.set(effect.activityId, effect.durationDays);
    else if (effect.kind === 'remove') removed.add(effect.activityId);
    else {
      position += 1;
      const id = effectActivityId(effectIndex);
      added.push({
        id,
        stageId,
        position,
        name: effect.name.trim(),
        durationDays: effect.durationDays,
        durationMinDays: null,
        durationMaxDays: null,
        responsibleId: null,
        roomIds: [],
        quantity: null,
        unit: null,
      });
      if (effect.after !== null) {
        links.push({
          id: effectDependencyId(effectIndex),
          blocker: { kind: 'activity', id: effect.after },
          blocked: { kind: 'activity', id },
          lagDays: 0,
        });
      }
    }
  });

  return {
    ok: true,
    snapshot: {
      ...snapshot,
      activities: [
        ...snapshot.activities
          .filter((activity) => !removed.has(activity.id))
          .map((activity) =>
            durations.has(activity.id)
              ? { ...activity, durationDays: durations.get(activity.id)! }
              : activity,
          ),
        ...added,
      ],
      dependencies: [
        ...snapshot.dependencies.filter((dependency) =>
          [...removed].every((id) => !names(dependency, id)),
        ),
        ...links,
      ],
    },
  };
}

// ── The impact ───────────────────────────────────────────────────────────────

/**
 * How a row of the impact differs: an existing activity's finish `moved`, was `placed` or
 * `unplaced` (as in the what-if), or the change `added` or `removed` the activity.
 */
export type ChangeImpactChange = 'moved' | 'placed' | 'unplaced' | 'added' | 'removed';

/** Something whose finish the change moves, adds or takes away. */
export interface ChangeImpactRow extends DaysRow {
  /** The existing activity; `null` for one the change adds (it has no id until approved). */
  readonly activityId: string | null;
  /** The `add` effect the row comes from; `null` for an existing activity. */
  readonly effectIndex: number | null;
  readonly name: string;
  readonly change: ChangeImpactChange;
  readonly beforeFinish: string | null;
  readonly afterFinish: string | null;
}

/** What a change does, computed by the schedule. */
export interface ChangeImpact {
  /** The finish today, and with the change. */
  readonly finishBefore: string | null;
  readonly finishAfter: string | null;
  /** Working days the finish moves, signed (positive later); `null` when it cannot be counted. */
  readonly days: number | null;
  /** The move as a days figure (0 when it cannot be counted), with every row the change moves. */
  readonly moved: Figure<ChangeImpactRow>;
  /** The change's own money, signed; `null` when not priced. */
  readonly costCents: number | null;
}

export type ChangeImpactResult =
  | { readonly ok: true; readonly impact: ChangeImpact }
  | { readonly ok: false; readonly problems: readonly ChangeProblem[] };

/** What `changeImpact` needs of a change: a change order, or a draft not yet raised. */
export type ChangeDraft = Pick<ChangeOrder, 'stageId' | 'effects' | 'costCents'>;

/**
 * What a change still to decide would do: the plan scheduled as it is and with the change, the
 * finish compared in working days on the work's calendar, and every activity whose finish moves,
 * appears or goes. Refused, with the problems, when its effects are. Never throws.
 */
export function changeImpact(snapshot: WorkSnapshot, change: ChangeDraft): ChangeImpactResult {
  const applied = withEffects(snapshot, change.stageId, change.effects);
  if (!applied.ok) return { ok: false, problems: applied.problems };

  const before = schedule(snapshot);
  const after = schedule(applied.snapshot);
  const delta = whatIfDelta(before, after, before.calendar);

  const addedBy = new Map(
    change.effects.flatMap((effect, index) =>
      effect.kind === 'add' ? [[effectActivityId(index), index] as const] : [],
    ),
  );
  const rows: ChangeImpactRow[] = delta.moved.rows.map((row) => {
    const effectIndex = addedBy.get(row.activityId);
    if (effectIndex === undefined) return { ...row, effectIndex: null };
    return {
      ...row,
      key: `effect:${effectIndex}`,
      itemId: null,
      activityId: null,
      effectIndex,
      change: 'added',
    };
  });
  // The what-if lists what the plan with the change still has; what it takes away is listed too,
  // so a removal that brings the finish forward is never a move with nothing behind it.
  const kept = new Set(after.activities.map((activity) => activity.id));
  for (const activity of before.activities) {
    if (kept.has(activity.id)) continue;
    const finish = before.dates.get(activity.id)?.finish ?? null;
    if (finish === null) continue;
    rows.push({
      key: `activity:${activity.id}`,
      itemId: activity.id,
      title: activity.name,
      day: finish,
      minutes: 0,
      days: 0,
      againstFinish: null,
      activityId: activity.id,
      effectIndex: null,
      name: activity.name,
      change: 'removed',
      beforeFinish: finish,
      afterFinish: null,
    });
  }

  return {
    ok: true,
    impact: {
      finishBefore: delta.from,
      finishAfter: delta.to,
      days: delta.days,
      moved: daysFigure('change', CHANGE_LABEL_KEYS.moved, delta.days ?? 0, rows),
      costCents: change.costCents,
    },
  };
}

// ── The record, read ─────────────────────────────────────────────────────────

/** Where a change order stands: waiting, or how it was decided. */
export type ChangeState = 'pending' | ChangeOrderOutcome;

export function changeState(change: ChangeOrder): ChangeState {
  return change.decision?.outcome ?? 'pending';
}

/** One change order as the screens and readiness read it. */
export interface ChangeOrderRow {
  readonly changeOrderId: string;
  readonly number: number;
  readonly title: string;
  readonly stageId: string;
  /** `null` when its stage is no longer in the plan. */
  readonly stageName: string | null;
  readonly askedBy: ChangeAskedBy;
  readonly state: ChangeState;
  readonly raisedOn: string;
  /**
   * Calendar days it has waited for its decision, from the day it was raised to today (0 on that
   * day); `null` once decided, or when either day is not a day.
   */
  readonly waitedDays: number | null;
}

/** Every change order, by number (the order they were raised in), as of `today`. */
export function changeOrderRows(snapshot: WorkSnapshot, today: string): ChangeOrderRow[] {
  const stageNames = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  const todayKnown = isIsoDay(today);
  return byNumber(snapshot.changeOrders).map((change) => {
    const state = changeState(change);
    return {
      changeOrderId: change.id,
      number: change.number,
      title: change.title,
      stageId: change.stageId,
      stageName: stageNames.get(change.stageId) ?? null,
      askedBy: change.askedBy,
      state,
      raisedOn: change.raisedOn,
      waitedDays:
        state === 'pending' && todayKnown && isIsoDay(change.raisedOn)
          ? Math.max(0, calendarDaysBetween(change.raisedOn, today))
          : null,
    };
  });
}

/** Has this change waited longer for its decision than readiness allows? */
export function waitsTooLong(row: ChangeOrderRow): boolean {
  return row.waitedDays !== null && row.waitedDays > CHANGE_WAITING_LIMIT_DAYS;
}

function byNumber(changes: readonly ChangeOrder[]): ChangeOrder[] {
  return [...changes].sort((a, b) => a.number - b.number || compareText(a.id, b.id));
}

// ── The tally ────────────────────────────────────────────────────────────────

/** The fields every row of a tally figure shares: the change it is. */
interface ChangeRowBase extends ReportRow {
  readonly changeOrderId: string;
  readonly number: number;
  readonly askedBy: ChangeAskedBy;
}

/** An approved change in "Changes approved": its money, from its decision. */
export interface ChangeCostRow extends AmountRow, ChangeRowBase {
  /** `false` for a change approved without a price: shown as "not priced", contributing 0. */
  readonly priced: boolean;
}

/** An approved change in "Days added by changes": the working days its decision froze. */
export interface ChangeDaysRow extends DaysRow, ChangeRowBase {
  /** As decided; `null` when it could not be counted then (contributes 0, `days` reads 0). */
  readonly daysDelta: number | null;
  readonly finishBefore: string | null;
  readonly finishAfter: string | null;
}

/** A change waiting for its decision, and for how long. */
export interface ChangeWaitingRow extends ChangeRowBase {
  readonly raisedOn: string;
  /** Calendar days waited; `null` when it cannot be counted. */
  readonly waitedDays: number | null;
  /** Waited more than `CHANGE_WAITING_LIMIT_DAYS`: readiness lists it. */
  readonly tooLong: boolean;
}

/** One party who asked for changes, and what came of it. */
export interface ChangePartyRow {
  /** `owner`, `person:<id>` or `other:<name>`. */
  readonly key: string;
  readonly askedBy: ChangeAskedBy;
  /** The person, for `person`; `null` otherwise. */
  readonly personId: string | null;
  /**
   * The person's name in the plan, or the name on the record for `other`; `null` for the owner, and
   * for a person no longer in the plan.
   */
  readonly name: string | null;
  readonly approved: number;
  readonly declined: number;
  readonly withdrawn: number;
  readonly pending: number;
  /** The approved changes' money and days, as decided. */
  readonly costCents: number;
  readonly days: number;
}

export interface ChangeTally {
  readonly approved: number;
  readonly declined: number;
  readonly withdrawn: number;
  readonly pending: number;
  /** The approved changes' money, signed, in cents: the cost figure's value. */
  readonly costCents: number;
  /** The working days the approved changes moved the finish, as decided: the days figure's value. */
  readonly days: number;
  /** Who asked: the owner first, then each party by the first change they asked for. */
  readonly byParty: readonly ChangePartyRow[];
  readonly figures: {
    readonly cost: Figure<ChangeCostRow>;
    readonly days: Figure<ChangeDaysRow>;
    readonly waiting: Figure<ChangeWaitingRow>;
  };
}

function partyOf(change: ChangeOrder): string {
  if (change.askedBy === 'owner') return 'owner';
  if (change.askedBy === 'person') return `person:${change.askedByPersonId ?? ''}`;
  return `other:${(change.askedByName ?? '').trim()}`;
}

/**
 * The standing tally of a work's change orders, as of `today`: how many were approved, declined,
 * withdrawn and are waiting; the money and the working days of the approved ones, from their
 * decisions; who asked; and the three figures with their rows.
 *
 * "Days added by changes" is a days figure whose value is the sum of the approved decisions'
 * `daysDelta`, each a move of the finish frozen the day it was decided. Every row with a counted
 * delta lies where the sum does (`againstFinish` is the sum: each approved change is part of where
 * the finish now lies against a plan without changes); a row decided with no count lies nowhere
 * (`null`) and adds 0. So the figure says, as every days figure does, the move and what moved it.
 */
export function changeTally(snapshot: WorkSnapshot, today: string): ChangeTally {
  const changes = byNumber(snapshot.changeOrders);
  const rows = new Map(
    changeOrderRows(snapshot, today).map((row) => [row.changeOrderId, row] as const),
  );
  const people = new Map(snapshot.people.map((person) => [person.id, person.name]));

  const counts = { approved: 0, declined: 0, withdrawn: 0, pending: 0 };
  const parties = new Map<string, ChangePartyRow>();
  const costRows: ChangeCostRow[] = [];
  const approvedDecided: Array<{ change: ChangeOrder; daysDelta: number | null }> = [];
  const waiting: ChangeWaitingRow[] = [];

  for (const change of changes) {
    const state = changeState(change);
    counts[state] += 1;
    const base = {
      key: `change:${change.id}`,
      itemId: change.id,
      title: change.title,
      minutes: 0,
      changeOrderId: change.id,
      number: change.number,
      askedBy: change.askedBy,
    };

    const key = partyOf(change);
    const party = parties.get(key) ?? {
      key,
      askedBy: change.askedBy,
      personId: change.askedBy === 'person' ? change.askedByPersonId : null,
      name:
        change.askedBy === 'person'
          ? (people.get(change.askedByPersonId ?? '') ?? null)
          : change.askedBy === 'other'
            ? (change.askedByName?.trim() ?? null)
            : null,
      approved: 0,
      declined: 0,
      withdrawn: 0,
      pending: 0,
      costCents: 0,
      days: 0,
    };
    const decision = change.decision;
    let { costCents, days } = party;
    if (decision !== null && decision.outcome === 'approved') {
      costCents += decision.costCents ?? 0;
      days += decision.daysDelta ?? 0;
      costRows.push({
        ...base,
        day: decision.decidedOn,
        amountCents: decision.costCents ?? 0,
        priced: decision.costCents !== null,
      });
      approvedDecided.push({ change, daysDelta: decision.daysDelta });
    }
    if (state === 'pending') {
      const row = rows.get(change.id)!;
      waiting.push({
        ...base,
        day: change.raisedOn,
        raisedOn: change.raisedOn,
        waitedDays: row.waitedDays,
        tooLong: waitsTooLong(row),
      });
    }
    parties.set(key, { ...party, [state]: party[state] + 1, costCents, days });
  }

  const totalDays = approvedDecided.reduce((sum, each) => sum + (each.daysDelta ?? 0), 0);
  const daysRows: ChangeDaysRow[] = approvedDecided.map(({ change, daysDelta }) => ({
    key: `change:${change.id}`,
    itemId: change.id,
    title: change.title,
    day: change.decision!.decidedOn,
    minutes: 0,
    changeOrderId: change.id,
    number: change.number,
    askedBy: change.askedBy,
    days: daysDelta ?? 0,
    againstFinish: daysDelta === null ? null : totalDays,
    daysDelta,
    finishBefore: change.decision!.finishBefore,
    finishAfter: change.decision!.finishAfter,
  }));
  // The longest wait first; then by number.
  waiting.sort((a, b) => (b.waitedDays ?? -1) - (a.waitedDays ?? -1) || a.number - b.number);

  const cost = moneyFigure('changes:cost', CHANGE_LABEL_KEYS.cost, costRows);
  return {
    ...counts,
    costCents: cost.value,
    days: totalDays,
    byParty: [...parties.values()].sort(
      (a, b) => Number(b.askedBy === 'owner') - Number(a.askedBy === 'owner'),
    ),
    figures: {
      cost,
      days: daysFigure('changes:days', CHANGE_LABEL_KEYS.days, totalDays, daysRows),
      waiting: counted('changes:waiting', CHANGE_LABEL_KEYS.waiting, waiting),
    },
  };
}
