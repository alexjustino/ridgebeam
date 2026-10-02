/**
 * Readiness: how much of what the plan must know, it does know, as a measure from the rows.
 *
 * Every activity, decision, stage, change order and the work itself is tested against every rule in
 * `rules.ts` that applies to it (the linking rule asks nothing of a plan with one activity; the
 * timing rule asks nothing of a decision with no deadline; the funding rule nothing of a work with
 * no money planned). Each test is one thing the plan must know (`mustKnow`); each that
 * passes is one it knows (`known`); each that fails is a missing row that names the activity or
 * decision, its stage and the rule. The figure is the share known, and it opens onto exactly those
 * rows, so the number and the list can never disagree. `readinessByRule` splits the same count
 * rule by rule, and the rules add up to the figure.
 *
 * Decisions are judged against the schedule and a `today` the caller passes, and change orders
 * waiting for a decision against the same `today`: the domain never reads the clock.
 *
 * A plan with no activity has nothing to measure. It is not ready: its share is 0, and one missing
 * row says why (the plan has no activity) rather than a 100 % that means nothing. Its decisions
 * are not counted then: with nothing scheduled none can have a deadline, and the reason is the one
 * row already given.
 *
 * What this module is not: text, and not storage. It returns counts and message keys, which the
 * interface renders in the person's language; nothing here is ever written to the database.
 */

import { changeOrderRows } from '../changes';
import { decisionRows } from '../decisions';
import { percent, type Figure, type ReportRow } from '../figure';
import { activitiesInOrder, durationRangeOf, stagesInOrder, type WorkSnapshot } from '../plan';
import type { Schedule } from '../schedule';
import {
  ACTIVITY_RULES,
  CHANGE_RULES,
  DECISION_RULES,
  STAGE_RULES,
  WORK_RULES,
  READINESS_LABEL_KEY,
  READINESS_MESSAGE_KEYS,
  RULE_EXPLANATION_KEYS,
  RULE_LABEL_KEYS,
  RULES,
  type MissingId,
  type ReadinessMessageKey,
  type RuleId,
} from './rules';

export * from './rules';

/** What readiness needs besides the plan: the schedule it has already computed, and today. */
export interface ReadinessContext {
  readonly schedule: Schedule;
  /** `YYYY-MM-DD`, the person's local day, passed in. */
  readonly today: string;
}

/** What a missing row is about (`change`: a change order, slice E1; `work`: the work, slice E2). */
export type ReadinessEntity = 'activity' | 'decision' | 'stage' | 'change' | 'work' | 'plan';

/** One thing the plan does not know. */
export interface MissingRow {
  readonly ruleId: MissingId;
  readonly entity: ReadinessEntity;
  /**
   * The activity's, decision's, stage's or change order's id, or the work's for a row about the
   * whole plan.
   */
  readonly id: string;
  /** The activity's, decision's or stage's name, the change order's title, or the work's. */
  readonly name: string;
  /** The stage it belongs to, or `null` for the plan or a row whose stage is not in the plan. */
  readonly stageName: string | null;
  /**
   * For an activity with no duration yet, the range of working days its template gave it ("a range
   * of 3–5 working days, no duration yet"); `null` for every other row.
   */
  readonly durationRange: { readonly min: number; readonly max: number } | null;
}

/** How one rule counted. */
export interface RuleCount {
  readonly ruleId: RuleId;
  readonly known: number;
  readonly mustKnow: number;
}

export interface Readiness {
  /** Things the plan knows. */
  readonly known: number;
  /** Things the plan must know: every rule that applies, for every activity, decision and stage. */
  readonly mustKnow: number;
  /** `known / mustKnow`, from 0 to 1; 0 when there is nothing to know. */
  readonly ratio: number;
  /**
   * What the plan does not know: activity by activity in plan order, rule by rule, then decision
   * by decision, then stage by stage; or, for a plan with no activity, the one row that says so.
   */
  readonly missing: readonly MissingRow[];
  /** The same count, rule by rule, in rule order. Every rule is listed, asked or not. */
  readonly rules: readonly RuleCount[];
}

/** Measure a plan's readiness from its rows, the rule table, the schedule and today. */
export function readiness(snapshot: WorkSnapshot, context: ReadinessContext): Readiness {
  const counts = new Map<RuleId, { known: number; mustKnow: number }>(
    RULES.map((rule) => [rule.id, { known: 0, mustKnow: 0 }]),
  );
  const rules = () => RULES.map((rule) => ({ ruleId: rule.id, ...counts.get(rule.id)! }));

  const activities = activitiesInOrder(snapshot);
  if (activities.length === 0) {
    return {
      known: 0,
      mustKnow: 0,
      ratio: 0,
      missing: [
        {
          ruleId: 'plan.activity',
          entity: 'plan',
          id: snapshot.work.workId,
          name: snapshot.work.name,
          stageName: null,
          durationRange: null,
        },
      ],
      rules: rules(),
    };
  }

  const stageNames = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  const missing: MissingRow[] = [];

  /** Test every row of one kind against that kind's rules, counting and listing as it goes. */
  function tally<Row>(
    rows: readonly Row[],
    rules: ReadonlyArray<{
      readonly id: RuleId;
      readonly applies: (row: Row, plan: WorkSnapshot) => boolean;
      readonly holds: (row: Row, plan: WorkSnapshot) => boolean;
    }>,
    describe: (row: Row, ruleId: RuleId) => Omit<MissingRow, 'ruleId'>,
  ): void {
    for (const row of rows) {
      for (const rule of rules) {
        if (!rule.applies(row, snapshot)) continue;
        const count = counts.get(rule.id)!;
        count.mustKnow += 1;
        if (rule.holds(row, snapshot)) count.known += 1;
        else missing.push({ ruleId: rule.id, ...describe(row, rule.id) });
      }
    }
  }

  tally(activities, ACTIVITY_RULES, (activity, ruleId) => ({
    entity: 'activity',
    id: activity.id,
    name: activity.name,
    stageName: stageNames.get(activity.stageId) ?? null,
    // The duration row says what the template offered: a range, until a person picks.
    durationRange: ruleId === 'activity.duration' ? durationRangeOf(activity) : null,
  }));
  tally(decisionRows(snapshot, context.schedule, context.today), DECISION_RULES, (decision) => ({
    entity: 'decision',
    id: decision.decisionId,
    name: decision.name,
    stageName: decision.stageName,
    durationRange: null,
  }));
  tally(stagesInOrder(snapshot), STAGE_RULES, (stage) => ({
    entity: 'stage',
    id: stage.id,
    name: stage.name,
    stageName: stage.name,
    durationRange: null,
  }));
  tally(changeOrderRows(snapshot, context.today), CHANGE_RULES, (change) => ({
    entity: 'change',
    id: change.changeOrderId,
    name: change.title,
    stageName: change.stageName,
    durationRange: null,
  }));
  tally([snapshot.work], WORK_RULES, (work) => ({
    entity: 'work',
    id: work.workId,
    name: work.name,
    stageName: null,
    durationRange: null,
  }));

  let known = 0;
  let mustKnow = 0;
  for (const count of counts.values()) {
    known += count.known;
    mustKnow += count.mustKnow;
  }
  return { known, mustKnow, ratio: known / mustKnow, missing, rules: rules() };
}

/** A row of a readiness figure: the missing row, in the shape every figure's rows share. */
export interface ReadinessRow extends ReportRow {
  readonly ruleId: MissingId;
  readonly entity: ReadinessEntity;
  readonly stageName: string | null;
  /** The template's range for an activity with no duration yet; `null` otherwise. */
  readonly durationRange: { readonly min: number; readonly max: number } | null;
}

function readinessRows(missing: readonly MissingRow[]): ReadinessRow[] {
  return missing.map((row) => ({
    key: `${row.ruleId}:${row.id}`,
    itemId: row.id,
    title: row.name,
    day: null,
    minutes: 0,
    ruleId: row.ruleId,
    entity: row.entity,
    stageName: row.stageName,
    durationRange: row.durationRange,
  }));
}

/**
 * The readiness figure: a percent that opens onto what is missing.
 *
 * Its value is `round(100 × known / mustKnow)`, capped at 99 while anything is missing, and its
 * rows are the missing rows, one each, so `traceable` holds for it by construction. It never
 * reads 100 while the list behind it is not empty.
 */
export function readinessFigure(measure: Readiness): Figure<ReadinessRow> {
  return percent(
    'readiness',
    READINESS_LABEL_KEY,
    measure.known,
    measure.mustKnow,
    readinessRows(measure.missing),
  );
}

/** One rule's share of readiness: its count, its missing rows, its figure and its words. */
export interface RuleSummary {
  readonly ruleId: RuleId;
  readonly known: number;
  readonly mustKnow: number;
  /** This rule's missing rows, in the order readiness lists them. */
  readonly missing: readonly MissingRow[];
  /**
   * The rule as a percent figure of its own, opening onto its rows; `null` when the rule asked
   * nothing of this plan (a single activity has nothing to link), which is not a share of anything.
   */
  readonly figure: Figure<ReadinessRow> | null;
  readonly labelKey: string;
  readonly explanationKey: string;
  /**
   * Did the rule count anything in this plan? `false` when it asked nothing (`mustKnow` is 0): the
   * line reads "nothing to count yet" (`RULE_UNCOUNTED_KEY`), in a muted tone, never "0 of 0",
   * which reads like a failure. It moves no number: a rule that counts nothing adds 0 to both.
   */
  readonly counted: boolean;
}

/**
 * Readiness rule by rule: every rule, with how much of what it asks the plan knows, and the rows it
 * finds missing. The rules that counted something come first, in rule order; the rules that counted
 * nothing (`counted: false`) come last, in rule order too (slice F11). The rules add up to the
 * whole: their `known` and `mustKnow` sum to the figure's, and their rows are all its rows but the
 * plan-level one. Only the order of the lines moves; no count does.
 */
export function readinessByRule(measure: Readiness): RuleSummary[] {
  const summaries = measure.rules.map(({ ruleId, known, mustKnow }): RuleSummary => {
    const missing = measure.missing.filter((row) => row.ruleId === ruleId);
    return {
      ruleId,
      known,
      mustKnow,
      missing,
      figure:
        mustKnow === 0
          ? null
          : percent(
              `readiness:${ruleId}`,
              RULE_LABEL_KEYS[ruleId],
              known,
              mustKnow,
              readinessRows(missing),
            ),
      labelKey: RULE_LABEL_KEYS[ruleId],
      explanationKey: RULE_EXPLANATION_KEYS[ruleId],
      counted: mustKnow > 0,
    };
  });
  return [
    ...summaries.filter((summary) => summary.counted),
    ...summaries.filter((summary) => !summary.counted),
  ];
}

/** One sentence of the readiness explanation: a message key, and how many rows it speaks for. */
export interface SentencePart {
  readonly key: ReadinessMessageKey;
  readonly count: number;
  /** The sentence's `{variables}`. */
  readonly params: Readonly<Record<string, string | number>>;
}

/**
 * The explanation, as data: one part per kind of thing missing, in the rule table's order, the
 * plan-level explanation last. Nothing missing, no parts.
 *
 * `{ key: 'readiness.missing.activity.responsible', count: 1 }` is rendered by the interface as
 * "1 activity has no responsible." or "1 atividade não tem responsável.".
 */
export function sentenceParts(missing: readonly MissingRow[]): SentencePart[] {
  const order: readonly MissingId[] = [...RULES.map((rule) => rule.id), 'plan.activity'];
  const parts: SentencePart[] = [];
  for (const id of order) {
    const count = missing.filter((row) => row.ruleId === id).length;
    if (count === 0) continue;
    parts.push({ key: READINESS_MESSAGE_KEYS[id], count, params: { count } });
  }
  return parts;
}
