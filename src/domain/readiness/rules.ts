/**
 * The readiness rules, as data: what the plan must know, one rule per kind of thing.
 *
 * A rule names the rows it applies to, a test each row must pass, and the message key the
 * interface uses to say, in the person's language, how many rows fail it. Readiness is computed
 * from this table and nothing else (docs/DATA_MODEL.md, "Readiness is computed, not stored"), so
 * a template, a lens or a screen that disagrees with it is wrong, not the table.
 *
 * Slice F0 has two rules: an activity must have a duration, and must have a responsible. Later
 * slices add rules (a stage's decisions, checks and money; declared dependencies) as new rows
 * here, without changing the shape.
 *
 * What this module is not: text. It holds message keys, never English or Portuguese; the i18n
 * tables turn a key and a count into "1 activity has no responsible." or "1 atividade não tem
 * responsável.".
 */

import { hasDuration, type Activity, type WorkSnapshot } from '../plan';

/** The rules that exist today. */
export type RuleId = 'activity.duration' | 'activity.responsible';

/** What a missing row can be missing: a rule that failed, or the plan having nothing to test. */
export type MissingId = RuleId | 'plan.activity';

/**
 * The message keys readiness hands the interface. Each is a sentence with a `{count}`,
 * pluralised by the i18n tables.
 */
export const READINESS_MESSAGE_KEYS = {
  'activity.duration': 'readiness.missing.activity.duration',
  'activity.responsible': 'readiness.missing.activity.responsible',
  'plan.activity': 'readiness.missing.plan.activity',
} as const satisfies Record<MissingId, string>;

export type ReadinessMessageKey = (typeof READINESS_MESSAGE_KEYS)[MissingId];

/** The readiness figure's own name, as a message key. */
export const READINESS_LABEL_KEY = 'readiness.label';

/** One thing the plan must know about every row of a kind. */
export interface Rule {
  readonly id: RuleId;
  readonly appliesTo: 'activity';
  /** Does this row know what the rule asks? The whole plan is at hand for references. */
  readonly holds: (row: Activity, plan: WorkSnapshot) => boolean;
  readonly messageKey: ReadinessMessageKey;
}

/** The rules, in the order their sentences are said. */
export const RULES: readonly Rule[] = [
  {
    id: 'activity.duration',
    appliesTo: 'activity',
    // A whole number of working days above zero; zero, negative and fractional are not known.
    holds: (activity) => hasDuration(activity),
    messageKey: READINESS_MESSAGE_KEYS['activity.duration'],
  },
  {
    id: 'activity.responsible',
    appliesTo: 'activity',
    // A responsible that names nobody in the plan is not a responsible.
    holds: (activity, plan) =>
      activity.responsibleId !== null &&
      plan.people.some((person) => person.id === activity.responsibleId),
    messageKey: READINESS_MESSAGE_KEYS['activity.responsible'],
  },
];
