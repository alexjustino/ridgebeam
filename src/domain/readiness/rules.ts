/**
 * The readiness rules, as data: what the plan must know, one rule per kind of thing.
 *
 * A rule names the rows it applies to, a test each row must pass, and the message key the
 * interface uses to say, in the person's language, how many rows fail it. Readiness is computed
 * from this table and nothing else (docs/DATA_MODEL.md, "Readiness is computed, not stored"), so
 * a template, a lens or a screen that disagrees with it is wrong, not the table.
 *
 * Slice F0 has two rules: an activity must have a duration, and must have a responsible. Slice F2
 * adds the third: in a plan with two or more activities, an activity must be linked to another
 * (the spec's "every dependency that matters is declared", made measurable). Later slices add
 * rules (a stage's decisions, checks and money) as new rows here, without changing the shape.
 *
 * What this module is not: text. It holds message keys, never English or Portuguese; the i18n
 * tables turn a key and a count into "1 activity has no responsible." or "1 atividade não tem
 * responsável.".
 */

import { hasDuration, type Activity, type WorkSnapshot } from '../plan';
import { expandDependencies } from '../schedule/expand';

/** The rules that exist today. */
export type RuleId = 'activity.duration' | 'activity.responsible' | 'activity.linked';

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
  'plan.activity': 'readiness.missing.plan.activity',
} as const satisfies Record<MissingId, string>;

export type ReadinessMessageKey = (typeof READINESS_MESSAGE_KEYS)[MissingId];

/** The readiness figure's own name, as a message key. */
export const READINESS_LABEL_KEY = 'readiness.label';

/** One thing the plan must know about every row of a kind. */
export interface Rule {
  readonly id: RuleId;
  readonly appliesTo: 'activity';
  /**
   * Does the rule ask anything of this row at all? A rule that does not apply is neither known
   * nor missing: it is not counted, so it cannot move the figure.
   */
  readonly applies: (row: Activity, plan: WorkSnapshot) => boolean;
  /** Does this row know what the rule asks? The whole plan is at hand for references. */
  readonly holds: (row: Activity, plan: WorkSnapshot) => boolean;
  readonly messageKey: ReadinessMessageKey;
}

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

/** The rules, in the order their sentences are said. */
export const RULES: readonly Rule[] = [
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
