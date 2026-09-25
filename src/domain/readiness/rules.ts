/**
 * The readiness rules, as data: what the plan must know, one rule per kind of thing.
 *
 * A rule names the rows it applies to, whether it asks anything of a given row at all, the test
 * each row it asks must pass, and three message keys: the sentence that counts the rows failing it,
 * its short label ("Durations"), and the one-sentence explanation of why the plan must know it.
 * Readiness is computed from this table and nothing else (docs/DATA_MODEL.md, "Readiness is
 * computed, not stored"), so a template, a lens or a screen that disagrees with it is wrong, not
 * the table.
 *
 * Slice F0 has two rules: an activity must have a duration, and must have a responsible. Slice F2
 * adds the third: in a plan with two or more activities, an activity must be linked to another (the
 * spec's "every dependency that matters is declared", made measurable). Slice F3 adds two over
 * decisions: a decision must have a deadline (its stage has something scheduled), and, once it has
 * one, must not be overdue. A made decision is always ready. Later slices add rules (a stage's
 * checks and money) as new rows here, without changing the shape.
 *
 * What this module is not: text. It holds message keys, never English or Portuguese; the i18n
 * tables turn a key and a count into "1 activity has no responsible." or "1 atividade não tem
 * responsável.".
 */

import type { DecisionRow } from '../decisions';
import { hasDuration, type Activity, type WorkSnapshot } from '../plan';
import { expandDependencies } from '../schedule/expand';

/** The rules over activities. */
export type ActivityRuleId = 'activity.duration' | 'activity.responsible' | 'activity.linked';

/** The rules over decisions. */
export type DecisionRuleId = 'decision.deadline' | 'decision.timely';

/** The rules that exist today. */
export type RuleId = ActivityRuleId | DecisionRuleId;

/** What a missing row can be missing: a rule that failed, or the plan having nothing to test. */
export type MissingId = RuleId | 'plan.activity';

/**
 * The message keys readiness hands the interface. Each is a sentence with a `{count}`,
 * pluralised by the i18n tables.
 */
export const READINESS_MESSAGE_KEYS = {
  'activity.duration': 'readiness.missing.activity.duration',
  'activity.responsible': 'readiness.missing.activity.responsible',
  'activity.linked': 'readiness.missing.activity.linked',
  'decision.deadline': 'readiness.missing.decision.deadline',
  'decision.timely': 'readiness.missing.decision.timely',
  'plan.activity': 'readiness.missing.plan.activity',
} as const satisfies Record<MissingId, string>;

export type ReadinessMessageKey = (typeof READINESS_MESSAGE_KEYS)[MissingId];

/** Each rule's short name, for the rule-by-rule list: "Durations · 4 of 4". */
export const RULE_LABEL_KEYS = {
  'activity.duration': 'readiness.rule.activity.duration',
  'activity.responsible': 'readiness.rule.activity.responsible',
  'activity.linked': 'readiness.rule.activity.linked',
  'decision.deadline': 'readiness.rule.decision.deadline',
  'decision.timely': 'readiness.rule.decision.timely',
} as const satisfies Record<RuleId, string>;

/**
 * Why the plan must know what each rule asks, in one sentence a person who has never planned a
 * work can read: "Without a duration nothing can be scheduled."
 */
export const RULE_EXPLANATION_KEYS = {
  'activity.duration': 'readiness.explanation.activity.duration',
  'activity.responsible': 'readiness.explanation.activity.responsible',
  'activity.linked': 'readiness.explanation.activity.linked',
  'decision.deadline': 'readiness.explanation.decision.deadline',
  'decision.timely': 'readiness.explanation.decision.timely',
} as const satisfies Record<RuleId, string>;

/** The readiness figure's own name, as a message key. */
export const READINESS_LABEL_KEY = 'readiness.label';

interface RuleShape<Id extends RuleId, Kind extends string, Row> {
  readonly id: Id;
  readonly appliesTo: Kind;
  /**
   * Does the rule ask anything of this row at all? A rule that does not apply is neither known
   * nor missing: it is not counted, so it cannot move the figure.
   */
  readonly applies: (row: Row, plan: WorkSnapshot) => boolean;
  /** Does this row know what the rule asks? The whole plan is at hand for references. */
  readonly holds: (row: Row, plan: WorkSnapshot) => boolean;
  readonly messageKey: ReadinessMessageKey;
}

/** One thing the plan must know about every activity. */
export type ActivityRule = RuleShape<ActivityRuleId, 'activity', Activity>;

/**
 * One thing the plan must know about every decision. The row is the decision with its deadline
 * and status already computed against the schedule and today (`decisionRows`), so the rule itself
 * needs neither.
 */
export type DecisionRule = RuleShape<DecisionRuleId, 'decision', DecisionRow>;

export type Rule = ActivityRule | DecisionRule;

const linkedCache = new WeakMap<WorkSnapshot, ReadonlySet<string>>();

/**
 * The activities joined to another by a dependency, after stage endpoints are expanded. A
 * self-edge (an activity made to wait on its own stage) links it to nothing else, and an inert
 * dependency links nothing. Computed once per snapshot, however many activities ask.
 */
export function linkedActivities(plan: WorkSnapshot): ReadonlySet<string> {
  const cached = linkedCache.get(plan);
  if (cached !== undefined) return cached;
  const linked = new Set<string>();
  for (const edge of expandDependencies(plan).edges) {
    if (edge.blockerId === edge.blockedId) continue;
    linked.add(edge.blockerId);
    linked.add(edge.blockedId);
  }
  linkedCache.set(plan, linked);
  return linked;
}

/** The rules over activities, in the order their sentences are said. */
export const ACTIVITY_RULES: readonly ActivityRule[] = [
  {
    id: 'activity.duration',
    appliesTo: 'activity',
    applies: () => true,
    // A whole number of working days above zero; zero, negative and fractional are not known.
    holds: (activity) => hasDuration(activity),
    messageKey: READINESS_MESSAGE_KEYS['activity.duration'],
  },
  {
    id: 'activity.responsible',
    appliesTo: 'activity',
    applies: () => true,
    // A responsible that names nobody in the plan is not a responsible.
    holds: (activity, plan) =>
      activity.responsibleId !== null &&
      plan.people.some((person) => person.id === activity.responsibleId),
    messageKey: READINESS_MESSAGE_KEYS['activity.responsible'],
  },
  {
    id: 'activity.linked',
    appliesTo: 'activity',
    // A single activity has nothing to be linked to, so the rule does not ask; from two on, each
    // must be joined to another.
    applies: (_activity, plan) => plan.activities.length >= 2,
    holds: (activity, plan) => linkedActivities(plan).has(activity.id),
    messageKey: READINESS_MESSAGE_KEYS['activity.linked'],
  },
];

/** The rules over decisions, in the order their sentences are said. */
export const DECISION_RULES: readonly DecisionRule[] = [
  {
    id: 'decision.deadline',
    appliesTo: 'decision',
    applies: () => true,
    // Its stage has something scheduled, so the last day to decide is known. A made decision
    // needs no deadline any more: it is always ready.
    holds: (decision) => decision.status === 'made' || decision.deadline !== null,
    messageKey: READINESS_MESSAGE_KEYS['decision.deadline'],
  },
  {
    id: 'decision.timely',
    appliesTo: 'decision',
    // Only a decision with a deadline can be late; one with none is the rule above's business.
    applies: (decision) => decision.deadline !== null,
    holds: (decision) => decision.status !== 'overdue',
    messageKey: READINESS_MESSAGE_KEYS['decision.timely'],
  },
];

/** Every rule, in the order their sentences are said and their lines are listed. */
export const RULES: readonly Rule[] = [...ACTIVITY_RULES, ...DECISION_RULES];
