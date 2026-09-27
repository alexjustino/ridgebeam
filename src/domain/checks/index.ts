/**
 * Checks: the questions a stage must answer before it starts and before it closes.
 *
 * Each stage has two gates. A **gate is passed** when every check at it has a latest answer of
 * `yes` or `na` (not applicable, which always carries its reason); an unanswered check or a `no`
 * **holds** it, and the interface says which items hold it, never just "no". Answers are facts:
 * appended, never changed, and the latest one counts, so a `no` after a `yes` holds the gate again.
 *
 * A stage's lifecycle is the person's decision: **planned**, then **started** (the start gate
 * passed), then **closed** (the close gate passed). Reopening a closed stage is allowed; starting
 * cannot be undone. The lifecycle is intent, not progress: progress still comes from the diary.
 * **A closed stage is closed**: nothing may be made to wait on its activities until it is
 * reopened (`closedStageIfAdded`).
 *
 * A gate with no checks at all asks nothing, so it is passed; that a stage has no checks is
 * readiness's business (the `stage.checks` rule), not the gate's.
 *
 * What this module is not: storage or text. It returns codes, rows and figures.
 */

import { endpointActivities } from '../schedule/expand';
import { counted, type Figure, type ReportRow } from '../figure';
import {
  compareText,
  stagesInOrder,
  type Answer,
  type Check,
  type CheckAnswer,
  type Endpoint,
  type Gate,
  type Stage,
  type WorkSnapshot,
} from '../plan';

export type { Answer, Check, CheckAnswer, Gate } from '../plan';
export { DEFAULT_CHECK_KEYS, type DefaultCheckKey } from './defaults';

export const GATES = ['start', 'close'] as const satisfies readonly Gate[];
export const ANSWERS = ['yes', 'no', 'na'] as const satisfies readonly Answer[];

export type StageState = 'planned' | 'started' | 'closed';
export const STAGE_STATES = [
  'planned',
  'started',
  'closed',
] as const satisfies readonly StageState[];

/** Where a stage is in its lifecycle. A closed stage is closed whatever else it says. */
export function stageState(stage: Stage): StageState {
  if (stage.closedAt !== null) return 'closed';
  if (stage.startedAt !== null) return 'started';
  return 'planned';
}

/** The latest answer to every check that has one: the highest seq wins. */
export function latestAnswers(answers: readonly CheckAnswer[]): Map<string, CheckAnswer> {
  const latest = new Map<string, CheckAnswer>();
  for (const answer of answers) {
    const known = latest.get(answer.checkId);
    if (known === undefined || answer.seq > known.seq) latest.set(answer.checkId, answer);
  }
  return latest;
}

/** A stage's checks at one gate, by position. */
export function checksAt(checks: readonly Check[], stageId: string, gate: Gate): Check[] {
  return checks
    .filter((check) => check.stageId === stageId && check.gate === gate)
    .sort((a, b) => a.position - b.position || compareText(a.id, b.id));
}

/** One check at a gate, with its latest answer and whether it holds the gate. */
export interface GateItem {
  readonly check: Check;
  readonly latest: CheckAnswer | null;
  /** Unanswered, or answered `no`: the gate cannot pass while this is so. */
  readonly holds: boolean;
}

export interface GateStatus {
  readonly stageId: string;
  readonly gate: Gate;
  /** Every check at the gate, by position. */
  readonly items: readonly GateItem[];
  /** No item holds it. A gate with no checks asks nothing, and is passed. */
  readonly passed: boolean;
}

/** The status of one gate of a stage, from the work's checks and answers. */
export function gateStatus(
  stage: Stage,
  checks: readonly Check[],
  answers: readonly CheckAnswer[],
  gate: Gate,
): GateStatus {
  const latest = latestAnswers(answers);
  const items = checksAt(checks, stage.id, gate).map((check) => {
    const answer = latest.get(check.id) ?? null;
    return { check, latest: answer, holds: answer === null || answer.answer === 'no' };
  });
  return { stageId: stage.id, gate, items, passed: items.every((item) => !item.holds) };
}

/** The items that hold a gate, in position order: what the interface names beside the button. */
export function holdingItems(status: GateStatus): GateItem[] {
  return status.items.filter((item) => item.holds);
}

// ── Starting, closing, reopening ─────────────────────────────────────────────

export type StageAction = 'start' | 'close' | 'reopen';

/** Why a stage cannot be started, closed or reopened now. */
export type StageActionProblem =
  | { readonly code: 'unknown-stage' }
  | { readonly code: 'already-started' }
  | { readonly code: 'not-started' }
  | { readonly code: 'already-closed' }
  | { readonly code: 'not-closed' }
  | { readonly code: 'gate-open'; readonly gate: Gate; readonly items: readonly GateItem[] };

/**
 * What stands in the way of starting, closing or reopening a stage, or `null` when nothing does.
 * The interface asks this before the host, and names the items when a gate holds.
 *
 * Start: a planned stage whose start gate passes. Close: a started, open stage whose close gate
 * passes (a planned stage cannot be closed). Reopen: a closed stage.
 */
export function stageActionProblem(
  snapshot: WorkSnapshot,
  stageId: string,
  action: StageAction,
): StageActionProblem | null {
  const stage = snapshot.stages.find((candidate) => candidate.id === stageId);
  if (stage === undefined) return { code: 'unknown-stage' };
  const state = stageState(stage);

  if (action === 'reopen') return state === 'closed' ? null : { code: 'not-closed' };
  if (state === 'closed') return { code: 'already-closed' };
  if (action === 'start' && state === 'started') return { code: 'already-started' };
  if (action === 'close' && state === 'planned') return { code: 'not-started' };

  const gate: Gate = action;
  const status = gateStatus(stage, snapshot.checks, snapshot.checkAnswers, gate);
  return status.passed ? null : { code: 'gate-open', gate, items: holdingItems(status) };
}

// ── Answers ──────────────────────────────────────────────────────────────────

/** Why an answer is refused before the host is asked. */
export type AnswerProblem =
  | { readonly code: 'unknown-check' }
  | { readonly code: 'invalid-answer' }
  | { readonly code: 'na-without-reason' }
  | { readonly code: 'reason-too-long' };

const REASON_LIMIT = 500;

/**
 * Check an answer before the host is asked: the check must exist, the answer be one of the three,
 * `na` must say why, and a reason fit in 500 characters. Never throws; every problem is listed.
 */
export function validateAnswer(
  snapshot: WorkSnapshot,
  checkId: string,
  answer: Answer,
  reason: string | null,
): AnswerProblem[] {
  const problems: AnswerProblem[] = [];
  if (!snapshot.checks.some((check) => check.id === checkId))
    problems.push({ code: 'unknown-check' });
  if (!(ANSWERS as readonly string[]).includes(answer)) problems.push({ code: 'invalid-answer' });
  if (answer === 'na' && (reason ?? '').trim() === '') problems.push({ code: 'na-without-reason' });
  if ((reason ?? '').length > REASON_LIMIT) problems.push({ code: 'reason-too-long' });
  return problems;
}

// ── A closed stage is closed ─────────────────────────────────────────────────

/**
 * The closed stage a new dependency would make wait, or `null`. A dependency whose blocked end is
 * an activity of a closed stage, or a closed stage itself, is refused until the stage is reopened:
 * a closed stage's work cannot be made to wait on anything new. Being the blocker is fine.
 */
export function closedStageIfAdded(snapshot: WorkSnapshot, blocked: Endpoint): string | null {
  const closed = new Set(
    snapshot.stages.filter((stage) => stageState(stage) === 'closed').map((stage) => stage.id),
  );
  if (blocked.kind === 'stage') return closed.has(blocked.id) ? blocked.id : null;
  if (endpointActivities(snapshot, blocked) === null) return null;
  const stageId = snapshot.activities.find((activity) => activity.id === blocked.id)!.stageId;
  return closed.has(stageId) ? stageId : null;
}

/**
 * Every check whose stage is not in the plan, in the order given. The host removes a stage's checks
 * with it; a file edited outside the product may still hold some, and they are listed, never
 * dropped.
 */
export function checksWithoutStage(snapshot: WorkSnapshot): Check[] {
  const stageIds = new Set(snapshot.stages.map((stage) => stage.id));
  return snapshot.checks.filter((check) => !stageIds.has(check.stageId));
}

// ── Figures ──────────────────────────────────────────────────────────────────

/** A row of a stages figure: one stage, in the state the figure counts. */
export interface StageRow extends ReportRow {
  readonly stageId: string;
  readonly state: StageState;
  readonly startedAt: string | null;
  readonly closedAt: string | null;
}

export const STAGES_LABEL_KEYS = {
  planned: 'checks.figure.planned',
  started: 'checks.figure.started',
  closed: 'checks.figure.closed',
} as const satisfies Record<StageState, string>;

/** The stages in one state, as a counted figure opening onto them, in plan order. */
export function stagesFigure(snapshot: WorkSnapshot, state: StageState): Figure<StageRow> {
  const rows = stagesInOrder(snapshot)
    .filter((stage) => stageState(stage) === state)
    .map((stage) => ({
      key: `stage:${stage.id}`,
      itemId: stage.id,
      title: stage.name,
      day: (stage.closedAt ?? stage.startedAt)?.slice(0, 10) ?? null,
      minutes: 0,
      stageId: stage.id,
      state,
      startedAt: stage.startedAt,
      closedAt: stage.closedAt,
    }));
  return counted(`stages:${state}`, STAGES_LABEL_KEYS[state], rows);
}

/** A row of the gates-held figure: a stage whose next gate is held, and what holds it. */
export interface GateHeldRow extends ReportRow {
  readonly stageId: string;
  readonly gate: Gate;
  readonly holding: readonly GateItem[];
}

export const GATES_HELD_LABEL_KEY = 'checks.figure.gatesHeld';

/**
 * Gates held (the spec's "blocked"): the stages whose next gate (start while planned, close while
 * started) has an unanswered or `no` item, while the stage before them is closed or there is none,
 * so the gate is what stands in the way. A counted figure opening onto each stage and its items.
 */
export function gatesHeldFigure(snapshot: WorkSnapshot): Figure<GateHeldRow> {
  const rows: GateHeldRow[] = [];
  const ordered = stagesInOrder(snapshot);
  ordered.forEach((stage, index) => {
    const state = stageState(stage);
    if (state === 'closed') return;
    const previous = ordered[index - 1];
    if (previous !== undefined && stageState(previous) !== 'closed') return;
    const gate: Gate = state === 'planned' ? 'start' : 'close';
    const status = gateStatus(stage, snapshot.checks, snapshot.checkAnswers, gate);
    if (status.passed) return;
    rows.push({
      key: `stage:${stage.id}`,
      itemId: stage.id,
      title: stage.name,
      day: null,
      minutes: 0,
      stageId: stage.id,
      gate,
      holding: holdingItems(status),
    });
  });
  return counted('gates-held', GATES_HELD_LABEL_KEY, rows);
}
