/**
 * The plan's questions: what a plan started from a template still has to be told, asked one at a
 * time, in plain words (slice F11, SPEC R3, ADR-034).
 *
 * A template brings a plan whose shape is right and whose particulars are not known yet: durations
 * given as a range, nobody responsible, cost lines that are labels until somebody prices them,
 * decisions with no answer. Readiness counts all of that; this module turns it into **the next
 * question** the dashboard asks, in a fixed order:
 *
 * 1. an activity with a **range and no duration** ("How many working days will *Remove the tiles*
 *    take? Most take 1 to 2.");
 * 2. an activity with **no responsible** (nobody, or somebody no longer in the plan);
 * 3. a **cost line not priced yet**;
 * 4. a **decision not made whose deadline is within 14 calendar days** of today, or already past.
 *
 * Inside each kind, plan order (stage by stage, by position); decisions most urgent first. Each
 * question carries a **stable key** (`duration:<activityId>` …) that the interface keeps in the set
 * of questions skipped this session, the **message key and params** of its sentence, and **what the
 * answer writes**: the existing command, the row it targets and the one field it sets, so the
 * interface never works it out again. The answer goes through that command like any other edit.
 *
 * **No question while the plan is locked** (approved, no replanning open): the host would refuse
 * the answer, so the card is not shown. Nor is anything asked of an activity or a cost line of a
 * **closed stage**, which the host refuses to change either.
 *
 * The count ("3 of 22 answered") is over the questions of the plan as it is: an activity with a
 * range, every activity (its responsible), every cost line, of the stages still open; and every
 * decision made, plus every open one being asked now. A decision whose deadline is further away is
 * not asked yet, so it is neither answered nor open. A question skipped is still open.
 *
 * What this module is not: text, storage or a clock. `today` is passed in; nothing is written.
 */

import { addCalendarDays, isIsoDay } from './calendar';
import { byUrgency, decisionRows } from './decisions';
import {
  activitiesInOrder,
  durationRangeOf,
  hasDuration,
  hasResponsible,
  isLocked,
  isPriced,
  stagesInOrder,
  type CostLine,
  type WorkSnapshot,
} from './plan';
import type { Schedule } from './schedule';

/** The kinds of question, in the order they are asked. */
export const QUESTION_KINDS = ['duration', 'responsible', 'price', 'decision'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** How far ahead of today a decision's deadline must fall to be asked, in calendar days. */
export const QUESTION_DECISION_WINDOW_DAYS = 14;

/**
 * The sentences a question and its card are said in, as message keys. Every one is new in slice
 * F11, and the interface registers each in both languages:
 *
 * - `duration`: `{name}`, `{min}`, `{max}` — "How many working days will {name} take? Most take
 *   {min} to {max}."
 * - `durationExact`: `{name}`, `{days}` — the same when the template's range is one number.
 * - `responsible`: `{name}` — "Who answers for {name}?"
 * - `price`: `{label}` — "How much is {label}?"
 * - `decision`: `{name}`, `{deadline}` (an ISO day, to be formatted) — "What was decided about
 *   {name}? It must be decided by {deadline}."
 * - `decisionOverdue`: `{name}`, `{deadline}` — the same, for a deadline already past.
 * - `count`: `{answered}`, `{total}` — "{answered} of {total} answered".
 */
export const QUESTION_MESSAGE_KEYS = {
  duration: 'nextQuestion.ask.duration',
  durationExact: 'nextQuestion.ask.durationExact',
  responsible: 'nextQuestion.ask.responsible',
  price: 'nextQuestion.ask.price',
  decision: 'nextQuestion.ask.decision',
  decisionOverdue: 'nextQuestion.ask.decisionOverdue',
  count: 'nextQuestion.count',
} as const;

type Keys = typeof QUESTION_MESSAGE_KEYS;

/**
 * What an answer writes: the command the interface already has, the id it is called with, and the
 * one field of its patch the answer sets. Duration: a whole number of working days from 1;
 * responsible: a person's id; price: an amount in cents; decision: what was decided, or `null`.
 */
export type QuestionAnswer =
  | {
      readonly command: 'activity_update';
      readonly targetId: string;
      readonly field: 'durationDays';
    }
  | {
      readonly command: 'activity_update';
      readonly targetId: string;
      readonly field: 'responsibleId';
    }
  | {
      readonly command: 'cost_line_update';
      readonly targetId: string;
      readonly field: 'amountCents';
    }
  | { readonly command: 'decision_make'; readonly targetId: string; readonly field: 'answer' };

interface QuestionBase {
  /** Stable while the question is open: `<kind>:<id>`. The key the skipped set holds. */
  readonly key: string;
  /** The stage it is about (for a cost line, the stage it counts for). */
  readonly stageId: string;
  /** `null` when the stage is not in the plan. */
  readonly stageName: string | null;
}

export type Question =
  | (QuestionBase & {
      readonly kind: 'duration';
      readonly messageKey: Keys['duration'] | Keys['durationExact'];
      readonly params: {
        readonly name: string;
        readonly min: number;
        readonly max: number;
        readonly days: number;
      };
      readonly activityId: string;
      /** The template's range of working days: what "most take" says. */
      readonly range: { readonly min: number; readonly max: number };
      readonly answer: Extract<QuestionAnswer, { field: 'durationDays' }>;
    })
  | (QuestionBase & {
      readonly kind: 'responsible';
      readonly messageKey: Keys['responsible'];
      readonly params: { readonly name: string };
      readonly activityId: string;
      readonly answer: Extract<QuestionAnswer, { field: 'responsibleId' }>;
    })
  | (QuestionBase & {
      readonly kind: 'price';
      readonly messageKey: Keys['price'];
      readonly params: { readonly label: string };
      readonly costLineId: string;
      /** The activity the line is on, or `null` for a line on the stage itself. */
      readonly activityId: string | null;
      /** That activity's name, when it is in the plan. */
      readonly activityName: string | null;
      readonly answer: Extract<QuestionAnswer, { field: 'amountCents' }>;
    })
  | (QuestionBase & {
      readonly kind: 'decision';
      readonly messageKey: Keys['decision'] | Keys['decisionOverdue'];
      readonly params: { readonly name: string; readonly deadline: string };
      readonly decisionId: string;
      readonly status: 'overdue' | 'due';
      readonly deadline: string;
      /** Working days from today to the deadline; negative once overdue (`decisions.ts`). */
      readonly daysLeft: number;
      readonly answer: Extract<QuestionAnswer, { field: 'answer' }>;
    });

/** Every open question of the plan, and the count the card says. */
export interface OpenQuestions {
  /** The plan is locked: nothing is asked, and every number below is 0. */
  readonly locked: boolean;
  /** Every open question, in the order they are asked, skipped ones included. */
  readonly questions: readonly Question[];
  /** Questions of this plan already answered. */
  readonly answered: number;
  /** `answered` + the open questions: the M of "N of M answered". */
  readonly total: number;
  /** Of the open questions, how many were skipped this session. */
  readonly skipped: number;
  /** Of the open questions, how many are still to be asked this session: open, not skipped. */
  readonly remaining: number;
}

const NONE: ReadonlySet<string> = new Set();

/** Cost lines in plan order: by the stage they count for, the stage's own first, then by activity. */
function costLinesInOrder(
  snapshot: WorkSnapshot,
  stageRank: ReadonlyMap<string, number>,
  activityRank: ReadonlyMap<string, number>,
  activityStage: ReadonlyMap<string, string>,
): Array<{ line: CostLine; stageId: string }> {
  const unknownStage = stageRank.size;
  const unknownActivity = activityRank.size;
  return snapshot.costLines
    .map((line, index) => ({
      line,
      index,
      // The stage a line counts for: its activity's, when the activity is in the plan (`stageOfLine`).
      stageId:
        (line.activityId === null ? undefined : activityStage.get(line.activityId)) ?? line.stageId,
    }))
    .map((each) => ({
      ...each,
      stageAt: stageRank.get(each.stageId) ?? unknownStage,
      activityAt:
        each.line.activityId === null
          ? -1
          : (activityRank.get(each.line.activityId) ?? unknownActivity),
    }))
    .sort((a, b) => a.stageAt - b.stageAt || a.activityAt - b.activityAt || a.index - b.index)
    .map(({ line, stageId }) => ({ line, stageId }));
}

/**
 * Every open question of the plan as of `today`, in the order they are asked, and how many of the
 * plan's questions are answered. `skipped` holds the keys the person skipped this session: they
 * stay in the list (and in the count), and `nextQuestion` passes over them.
 */
export function openQuestions(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  today: string,
  skipped: ReadonlySet<string> = NONE,
): OpenQuestions {
  if (isLocked(snapshot)) {
    return { locked: true, questions: [], answered: 0, total: 0, skipped: 0, remaining: 0 };
  }

  const stages = stagesInOrder(snapshot);
  const stageNames = new Map(stages.map((stage) => [stage.id, stage.name]));
  const closed = new Set(stages.filter((stage) => stage.closedAt !== null).map((s) => s.id));
  const activities = activitiesInOrder(snapshot);
  const open = activities.filter((activity) => !closed.has(activity.stageId));
  const questions: Question[] = [];
  let answered = 0;

  // 1. A range and no duration: the template said "most take 1 to 2"; the person says how many.
  for (const activity of open) {
    const range = durationRangeOf(activity);
    if (range === null) continue;
    if (hasDuration(activity)) {
      answered += 1;
      continue;
    }
    questions.push({
      kind: 'duration',
      key: `duration:${activity.id}`,
      messageKey:
        range.min === range.max
          ? QUESTION_MESSAGE_KEYS.durationExact
          : QUESTION_MESSAGE_KEYS.duration,
      params: { name: activity.name, min: range.min, max: range.max, days: range.max },
      stageId: activity.stageId,
      stageName: stageNames.get(activity.stageId) ?? null,
      activityId: activity.id,
      range,
      answer: { command: 'activity_update', targetId: activity.id, field: 'durationDays' },
    });
  }

  // 2. Nobody responsible, or somebody no longer in the plan: the same test readiness makes.
  for (const activity of open) {
    if (hasResponsible(activity, snapshot)) {
      answered += 1;
      continue;
    }
    questions.push({
      kind: 'responsible',
      key: `responsible:${activity.id}`,
      messageKey: QUESTION_MESSAGE_KEYS.responsible,
      params: { name: activity.name },
      stageId: activity.stageId,
      stageName: stageNames.get(activity.stageId) ?? null,
      activityId: activity.id,
      answer: { command: 'activity_update', targetId: activity.id, field: 'responsibleId' },
    });
  }

  // 3. A cost line not priced yet: a template's label, until somebody writes its amount.
  const activityNames = new Map(activities.map((activity) => [activity.id, activity.name]));
  const lines = costLinesInOrder(
    snapshot,
    new Map(stages.map((stage, index) => [stage.id, index])),
    new Map(activities.map((activity, index) => [activity.id, index])),
    new Map(activities.map((activity) => [activity.id, activity.stageId])),
  );
  for (const { line, stageId } of lines) {
    if (closed.has(stageId) || closed.has(line.stageId)) continue;
    if (isPriced(line)) {
      answered += 1;
      continue;
    }
    questions.push({
      kind: 'price',
      key: `price:${line.id}`,
      messageKey: QUESTION_MESSAGE_KEYS.price,
      params: { label: line.label },
      stageId,
      stageName: stageNames.get(stageId) ?? null,
      costLineId: line.id,
      activityId: line.activityId,
      activityName: line.activityId === null ? null : (activityNames.get(line.activityId) ?? null),
      answer: { command: 'cost_line_update', targetId: line.id, field: 'amountCents' },
    });
  }

  // 4. A decision not made, overdue or due within the window; most urgent first. Every decision
  // made is a question answered.
  answered += snapshot.decisions.filter((decision) => decision.madeAt !== null).length;
  if (isIsoDay(today)) {
    const last = addCalendarDays(today, QUESTION_DECISION_WINDOW_DAYS);
    for (const row of byUrgency(decisionRows(snapshot, scheduled, today))) {
      // `decisionRows` gives a deadline and days left exactly when the status is overdue or due.
      if (row.status !== 'overdue' && row.status !== 'due') continue;
      if (row.status === 'due' && row.deadline! > last) continue;
      questions.push({
        kind: 'decision',
        key: `decision:${row.decisionId}`,
        messageKey:
          row.status === 'overdue'
            ? QUESTION_MESSAGE_KEYS.decisionOverdue
            : QUESTION_MESSAGE_KEYS.decision,
        params: { name: row.name, deadline: row.deadline! },
        stageId: row.stageId,
        stageName: row.stageName,
        decisionId: row.decisionId,
        status: row.status,
        deadline: row.deadline!,
        daysLeft: row.daysLeft!,
        answer: { command: 'decision_make', targetId: row.decisionId, field: 'answer' },
      });
    }
  }

  const skippedOpen = questions.filter((question) => skipped.has(question.key)).length;
  return {
    locked: false,
    questions,
    answered,
    total: answered + questions.length,
    skipped: skippedOpen,
    remaining: questions.length - skippedOpen,
  };
}

/**
 * The one question the dashboard asks now: the first open question not skipped this session, or
 * `null` when there is none (nothing open, everything open skipped, or the plan locked).
 */
export function nextQuestion(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  today: string,
  skipped: ReadonlySet<string> = NONE,
): Question | null {
  return (
    openQuestions(snapshot, scheduled, today, skipped).questions.find(
      (question) => !skipped.has(question.key),
    ) ?? null
  );
}
