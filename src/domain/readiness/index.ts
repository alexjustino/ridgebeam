/**
 * Readiness: how much of what the plan must know, it does know, as a measure from the rows.
 *
 * Every activity and every decision is tested against every rule in `rules.ts` that applies to it
 * (the linking rule asks nothing of a plan with one activity; the timing rule asks nothing of a
 * decision with no deadline). Each test is one thing the plan must know (`mustKnow`); each that
 * passes is one it knows (`known`); each that fails is a missing row that names the activity or
 * decision, its stage and the rule. The figure is the share known, and it opens onto exactly those
 * rows, so the number and the list can never disagree. `readinessByRule` splits the same count
 * rule by rule, and the rules add up to the figure.
 *
 * Decisions are judged against the schedule and a `today` the caller passes: the domain never
 * reads the clock.
 *
 * A plan with no activity has nothing to measure. It is not ready: its share is 0, and one missing
 * row says why (the plan has no activity) rather than a 100 % that means nothing. Its decisions
 * are not counted then: with nothing scheduled none can have a deadline, and the reason is the one
 * row already given.
 *
 * What this module is not: text, and not storage. It returns counts and message keys, which the
 * interface renders in the person's language; nothing here is ever written to the database.
 */

import { decisionRows } from '../decisions';
import { percent, type Figure, type ReportRow } from '../figure';
import { activitiesInOrder, type WorkSnapshot } from '../plan';
import type { Schedule } from '../schedule';
import {
  ACTIVITY_RULES,
  DECISION_RULES,
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

/** One thing the plan does not know. */
export interface MissingRow {
  readonly ruleId: MissingId;
  readonly entity: 'activity' | 'decision' | 'plan';
  /** The activity's or decision's id, or the work's for a row about the whole plan. */
  readonly id: string;
  /** The activity's or decision's name, or the work's. */
  readonly name: string;
  /** The stage it belongs to, or `null` for the plan or a row whose stage is not in the plan. */
  readonly stageName: string | null;
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
  /** Things the plan must know: every rule that applies, for every activity and decision. */
  readonly mustKnow: number;
  /** `known / mustKnow`, from 0 to 1; 0 when there is nothing to know. */
  readonly ratio: number;
  /**
   * What the plan does not know: activity by activity in plan order, rule by rule, then decision
   * by decision; or, for a plan with no activity, the one row that says so.
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
        },
      ],
      rules: rules(),
    };
  }

  const stageNames = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  const missing: MissingRow[] = [];

  for (const activity of activities) {
    for (const rule of ACTIVITY_RULES) {
      if (!rule.applies(activity, snapshot)) continue;
      const count = counts.get(rule.id)!;
      count.mustKnow += 1;
      if (rule.holds(activity, snapshot)) {
        count.known += 1;
        continue;
      }
      missing.push({
        ruleId: rule.id,
        entity: 'activity',
        id: activity.id,
        name: activity.name,
        stageName: stageNames.get(activity.stageId) ?? null,
      });
    }
  }

  for (const decision of decisionRows(snapshot, context.schedule, context.today)) {
    for (const rule of DECISION_RULES) {
      if (!rule.applies(decision, snapshot)) continue;
      const count = counts.get(rule.id)!;
      count.mustKnow += 1;
      if (rule.holds(decision, snapshot)) {
        count.known += 1;
        continue;
      }
      missing.push({
        ruleId: rule.id,
        entity: 'decision',
        id: decision.decisionId,
        name: decision.name,
        stageName: decision.stageName,
      });
    }
  }

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
  readonly entity: 'activity' | 'decision' | 'plan';
  readonly stageName: string | null;
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
}

/**
 * Readiness rule by rule, in rule order: every rule, with how much of what it asks the plan knows,
 * and the rows it finds missing. The rules add up to the whole: their `known` and `mustKnow` sum to
 * the figure's, and their rows are all its rows but the plan-level one.
 */
export function readinessByRule(measure: Readiness): RuleSummary[] {
  return measure.rules.map(({ ruleId, known, mustKnow }) => {
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
    };
  });
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
