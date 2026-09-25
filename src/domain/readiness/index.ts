/**
 * Readiness: how much of what the plan must know, it does know, as a measure from the rows.
 *
 * Every activity is tested against every rule in `rules.ts` that applies to it (the linking rule
 * asks nothing of a plan with one activity). Each test is one thing the plan must know
 * (`mustKnow`); each that passes is one it knows (`known`); each that fails is a
 * missing row that names the activity, its stage and the rule. The figure is the share known,
 * and it opens onto exactly those rows, so the number and the list can never disagree.
 *
 * A plan with no activity has nothing to measure. It is not ready: its share is 0, and one
 * missing row says why (the plan has no activity) rather than a 100 % that means nothing.
 *
 * What this module is not: text, and not storage. It returns counts and message keys, which the
 * interface renders in the person's language; nothing here is ever written to the database.
 */

import { percent, type Figure, type ReportRow } from '../figure';
import { activitiesInOrder, type WorkSnapshot } from '../plan';
import {
  READINESS_LABEL_KEY,
  READINESS_MESSAGE_KEYS,
  RULES,
  type MissingId,
  type ReadinessMessageKey,
} from './rules';

export * from './rules';

/** One thing the plan does not know. */
export interface MissingRow {
  readonly ruleId: MissingId;
  readonly entity: 'activity' | 'plan';
  /** The activity's id, or the work's for a row about the whole plan. */
  readonly id: string;
  /** The activity's name, or the work's. */
  readonly name: string;
  /** The stage the activity belongs to, or `null` for the plan or an activity with no stage. */
  readonly stageName: string | null;
}

export interface Readiness {
  /** Things the plan knows. */
  readonly known: number;
  /** Things the plan must know: every rule that applies, for every activity. */
  readonly mustKnow: number;
  /** `known / mustKnow`, from 0 to 1; 0 when there is nothing to know. */
  readonly ratio: number;
  /** What the plan does not know, activity by activity in plan order, rule by rule. */
  readonly missing: readonly MissingRow[];
}

/** Measure a plan's readiness from its rows and the rule table. */
export function readiness(snapshot: WorkSnapshot): Readiness {
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
    };
  }

  const stageNames = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  let known = 0;
  let mustKnow = 0;
  const missing: MissingRow[] = [];

  for (const activity of activities) {
    for (const rule of RULES) {
      if (!rule.applies(activity, snapshot)) continue;
      mustKnow += 1;
      if (rule.holds(activity, snapshot)) {
        known += 1;
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

  return { known, mustKnow, ratio: known / mustKnow, missing };
}

/** A row of the readiness figure: the missing row, in the shape every figure's rows share. */
export interface ReadinessRow extends ReportRow {
  readonly ruleId: MissingId;
  readonly entity: 'activity' | 'plan';
  readonly stageName: string | null;
}

/**
 * The readiness figure: a percent that opens onto what is missing.
 *
 * Its value is `round(100 × known / mustKnow)`, capped at 99 while anything is missing, and its
 * rows are the missing rows, one each, so `traceable` holds for it by construction. It never
 * reads 100 while the list behind it is not empty.
 */
export function readinessFigure(measure: Readiness): Figure<ReadinessRow> {
  const rows: ReadinessRow[] = measure.missing.map((row) => ({
    key: `${row.ruleId}:${row.id}`,
    itemId: row.id,
    title: row.name,
    day: null,
    minutes: 0,
    ruleId: row.ruleId,
    entity: row.entity,
    stageName: row.stageName,
  }));
  return percent('readiness', READINESS_LABEL_KEY, measure.known, measure.mustKnow, rows);
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
