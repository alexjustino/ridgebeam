/**
 * The snag list (slice E4, decision 4, pt "pendências"): the defects and pending items found near
 * the end of a work, each with where it is, who must fix it, the day it is due and a photo.
 *
 * A snag is **open** until its closure, a fact appended once: **fixed** (with a photo of it fixed)
 * or **withdrawn** (with the reason: a snag raised by mistake is withdrawn, never deleted). One found
 * again after its fix is a new snag. The record is the host's (insert-only); this module reads it.
 *
 * - `snagRows` — every snag as the list shows it, open first: its state, whether it is **overdue**
 *   (open, with a due day before today: due today is still in time), how many calendar days it is
 *   late, how long it has **waited** (open: from the day it was raised to today) or **took** (closed:
 *   from the day it was raised to the day it was closed).
 * - `snagFigures` — what is still open and on whom: open, overdue, and the open ones by person and
 *   by stage, each a figure with its rows; and how many were ever raised, fixed and withdrawn (the
 *   Dashboard's card is hidden when there has never been a snag).
 * - `snagHolds` — what retention asks of the list (`milestones.ts`, decision 3): of one stage's
 *   snags on one person, the open ones and the day the last closed one was closed. **A snag on
 *   nobody holds no retention**: there is no person whose money it could hold.
 * - `validateSnagDraft` / `validateSnagClosure` — what the host refuses, said first, as data.
 *
 * Snags are found at the end, not planned: nothing here changes readiness.
 *
 * What this module is not: storage, text or a clock. `today` is an input. No I/O.
 */

import { calendarDaysBetween, isIsoDay } from './calendar';
import { counted, type Figure, type ReportRow } from './figure';
import { compareText, stagesInOrder, type Snag, type SnagOutcome, type WorkSnapshot } from './plan';

export type { Snag, SnagClosure, SnagOutcome } from './plan';

// ── Limits and words ─────────────────────────────────────────────────────────

/** What the host accepts, in characters (code points, as the host counts them). */
export const SNAG_LIMITS = {
  title: 200,
  description: 2_000,
  note: 2_000,
} as const;

/** Where a snag stands. */
export type SnagState = 'open' | SnagOutcome;

export const SNAG_STATES = ['open', 'fixed', 'withdrawn'] as const satisfies readonly SnagState[];

export const SNAG_OUTCOMES = ['fixed', 'withdrawn'] as const satisfies readonly SnagOutcome[];

/** How each state is said on a row: "Open", "Fixed", "Withdrawn". */
export const SNAG_STATE_KEYS = {
  open: 'snags.state.open',
  fixed: 'snags.state.fixed',
  withdrawn: 'snags.state.withdrawn',
} as const satisfies Record<SnagState, string>;

/**
 * The figures' names: "Still to fix" (open), "Past their day" (overdue); a person's and a stage's
 * open snags (`onPerson`, `onStage`, the name given by the row); and the group of snags on nobody
 * ("Nobody named").
 */
export const SNAG_LABEL_KEYS = {
  open: 'snags.figure.open',
  overdue: 'snags.figure.overdue',
  onPerson: 'snags.figure.onPerson',
  onStage: 'snags.figure.onStage',
  nobody: 'snags.figure.nobody',
} as const;

/** Why a snag, or its closure, is refused before the host is asked. */
export const SNAG_PROBLEM_KEYS = {
  'title-empty': 'snags.problem.titleEmpty',
  'title-too-long': 'snags.problem.titleTooLong',
  'description-too-long': 'snags.problem.descriptionTooLong',
  'unknown-stage': 'snags.problem.unknownStage',
  'unknown-activity': 'snags.problem.unknownActivity',
  'activity-of-another-stage': 'snags.problem.activityOfAnotherStage',
  'unknown-person': 'snags.problem.unknownPerson',
  'invalid-raised-on': 'snags.problem.invalidRaisedOn',
  'invalid-due-on': 'snags.problem.invalidDueOn',
  'due-before-raised': 'snags.problem.dueBeforeRaised',
  'unknown-photo': 'snags.problem.unknownPhoto',
  'unknown-snag': 'snags.problem.unknownSnag',
  'already-closed': 'snags.problem.alreadyClosed',
  'invalid-outcome': 'snags.problem.invalidOutcome',
  'invalid-closed-on': 'snags.problem.invalidClosedOn',
  'closed-before-raised': 'snags.problem.closedBeforeRaised',
  'photo-required': 'snags.problem.photoRequired',
  'note-required': 'snags.problem.noteRequired',
  'note-too-long': 'snags.problem.noteTooLong',
} as const;

export type SnagProblemCode = keyof typeof SNAG_PROBLEM_KEYS;

/** A refusal, with the key the interface says it with. */
export interface SnagProblem {
  readonly code: SnagProblemCode;
  readonly messageKey: (typeof SNAG_PROBLEM_KEYS)[SnagProblemCode];
}

/** Every message key this module adds, for the dictionaries' completeness test. */
export const SNAG_MESSAGE_KEYS: readonly string[] = [
  ...Object.values(SNAG_STATE_KEYS),
  ...Object.values(SNAG_LABEL_KEYS),
  ...Object.values(SNAG_PROBLEM_KEYS),
];

// ── The record, read ─────────────────────────────────────────────────────────

export function snagState(snag: Snag): SnagState {
  return snag.closure?.outcome ?? 'open';
}

/** The snags by number (the order they were raised in), then by id. */
export function snagsInOrder(snapshot: WorkSnapshot): Snag[] {
  return [...snapshot.snags].sort((a, b) => a.number - b.number || compareText(a.id, b.id));
}

/** One snag as the list, the Dashboard and the reports read it. */
export interface SnagRow extends ReportRow {
  readonly snagId: string;
  readonly number: number;
  readonly description: string | null;
  readonly stageId: string;
  /** `null` when its stage (activity, person) is no longer in the plan, or none was named. */
  readonly stageName: string | null;
  readonly activityId: string | null;
  readonly activityName: string | null;
  readonly personId: string | null;
  readonly personName: string | null;
  readonly raisedOn: string;
  readonly dueOn: string | null;
  /** The photo of the problem. */
  readonly photoHash: string | null;
  readonly state: SnagState;
  readonly closedOn: string | null;
  /** The photo of it fixed; `null` while open, and for a withdrawal without one. */
  readonly fixPhotoHash: string | null;
  /** The closure's note: the reason, for a withdrawal. */
  readonly note: string | null;
  /** Open, with a due day before today. */
  readonly overdue: boolean;
  /** Calendar days past its due day, from 1, while overdue; `null` otherwise. */
  readonly overdueDays: number | null;
  /** Open: calendar days from the day it was raised to today (0 that day); `null` once closed. */
  readonly waitedDays: number | null;
  /** Closed: calendar days from the day it was raised to the day it was closed; `null` while open. */
  readonly tookDays: number | null;
}

/** A days count between two days, or `null` when either is not a day; never below zero. */
function daysFromTo(from: string, to: string): number | null {
  if (!isIsoDay(from) || !isIsoDay(to)) return null;
  return Math.max(0, calendarDaysBetween(from, to));
}

function rowsOf(snapshot: WorkSnapshot, today: string): SnagRow[] {
  const stages = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  const activities = new Map(snapshot.activities.map((each) => [each.id, each.name]));
  const people = new Map(snapshot.people.map((person) => [person.id, person.name]));
  const todayKnown = isIsoDay(today);
  return snagsInOrder(snapshot).map((snag) => {
    const state = snagState(snag);
    const open = state === 'open';
    const overdue =
      open && todayKnown && snag.dueOn !== null && isIsoDay(snag.dueOn) && snag.dueOn < today;
    const closure = snag.closure;
    return {
      key: `snag:${snag.id}`,
      itemId: snag.id,
      title: snag.title,
      day: snag.raisedOn,
      minutes: 0,
      snagId: snag.id,
      number: snag.number,
      description: snag.description,
      stageId: snag.stageId,
      stageName: stages.get(snag.stageId) ?? null,
      activityId: snag.activityId,
      activityName: snag.activityId === null ? null : (activities.get(snag.activityId) ?? null),
      personId: snag.personId,
      personName: snag.personId === null ? null : (people.get(snag.personId) ?? null),
      raisedOn: snag.raisedOn,
      dueOn: snag.dueOn,
      photoHash: snag.photoHash,
      state,
      closedOn: closure?.closedOn ?? null,
      fixPhotoHash: closure?.photoHash ?? null,
      note: closure?.note ?? null,
      overdue,
      overdueDays: overdue ? calendarDaysBetween(snag.dueOn!, today) : null,
      waitedDays: open && todayKnown ? daysFromTo(snag.raisedOn, today) : null,
      tookDays: closure === null ? null : daysFromTo(snag.raisedOn, closure.closedOn),
    };
  });
}

/**
 * Every snag as of `today`: the open ones first, then the closed ones, each by number. A `today`
 * that is not a day marks nothing overdue and counts no wait. Never throws.
 */
export function snagRows(snapshot: WorkSnapshot, today: string): SnagRow[] {
  const rows = rowsOf(snapshot, today);
  return [
    ...rows.filter((row) => row.state === 'open'),
    ...rows.filter((row) => row.state !== 'open'),
  ];
}

// ── The figures ──────────────────────────────────────────────────────────────

/** One person's open snags, or the snags on nobody (`personId: null`). */
export interface SnagPersonGroup {
  /** `person:<id>`, or `nobody`. */
  readonly key: string;
  readonly personId: string | null;
  /** Their name in the plan; `null` for nobody, and for a person no longer in the plan. */
  readonly name: string | null;
  readonly open: Figure<SnagRow>;
  readonly overdue: Figure<SnagRow>;
}

/** One stage's open snags. */
export interface SnagStageGroup {
  readonly key: string;
  readonly stageId: string;
  /** `null` when the stage is no longer in the plan. */
  readonly name: string | null;
  readonly open: Figure<SnagRow>;
  readonly overdue: Figure<SnagRow>;
}

export interface SnagFigures {
  /** Snags ever raised, whatever became of them: 0 means the Dashboard's card is not shown. */
  readonly raised: number;
  readonly fixed: number;
  readonly withdrawn: number;
  /** "Still to fix": every open snag, by number. */
  readonly open: Figure<SnagRow>;
  /** "Past their day": the open snags whose due day is before today, the latest first. */
  readonly overdue: Figure<SnagRow>;
  /**
   * The open snags by who must fix them: the people of the plan by name, then people no longer in
   * the plan, then nobody. Only the groups with something open.
   */
  readonly byPerson: readonly SnagPersonGroup[];
  /** The open snags by stage, in plan order, then stages no longer in the plan. Only those with some. */
  readonly byStage: readonly SnagStageGroup[];
}

/**
 * What is still open and on whom, as of `today`: each number a figure with its rows (`traceable`),
 * the groups' rows together exactly the open rows. Never throws.
 */
export function snagFigures(snapshot: WorkSnapshot, today: string): SnagFigures {
  const rows = rowsOf(snapshot, today);
  const open = rows.filter((row) => row.state === 'open');
  const overdue = open
    .filter((row) => row.overdue)
    .sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0) || a.number - b.number);

  const people = new Map(snapshot.people.map((person) => [person.id, person.name]));
  const personOrder = (id: string | null): [number, string, string] => {
    if (id === null) return [2, '', ''];
    const name = people.get(id);
    return name === undefined ? [1, '', id] : [0, name, id];
  };
  const personIds = [...new Set(open.map((row) => row.personId))].sort((a, b) => {
    const [ra, na, ia] = personOrder(a);
    const [rb, nb, ib] = personOrder(b);
    return ra - rb || compareText(na, nb) || compareText(ia, ib);
  });
  const byPerson: SnagPersonGroup[] = personIds.map((personId) => {
    const own = open.filter((row) => row.personId === personId);
    const scope = personId === null ? 'nobody' : `person:${personId}`;
    const label = personId === null ? SNAG_LABEL_KEYS.nobody : SNAG_LABEL_KEYS.onPerson;
    return {
      key: scope,
      personId,
      name: personId === null ? null : (people.get(personId) ?? null),
      open: counted(`snags:open:${scope}`, label, own),
      overdue: counted(
        `snags:overdue:${scope}`,
        SNAG_LABEL_KEYS.overdue,
        own.filter((row) => row.overdue),
      ),
    };
  });

  const ordered = stagesInOrder(snapshot);
  const known = new Set(ordered.map((stage) => stage.id));
  const stageIds = [
    ...ordered.map((stage) => stage.id),
    ...[...new Set(open.map((row) => row.stageId))]
      .filter((id) => !known.has(id))
      .sort(compareText),
  ];
  const stageNames = new Map(ordered.map((stage) => [stage.id, stage.name]));
  const byStage: SnagStageGroup[] = stageIds.flatMap((stageId) => {
    const own = open.filter((row) => row.stageId === stageId);
    if (own.length === 0) return [];
    return [
      {
        key: `stage:${stageId}`,
        stageId,
        name: stageNames.get(stageId) ?? null,
        open: counted(`snags:open:stage:${stageId}`, SNAG_LABEL_KEYS.onStage, own),
        overdue: counted(
          `snags:overdue:stage:${stageId}`,
          SNAG_LABEL_KEYS.overdue,
          own.filter((row) => row.overdue),
        ),
      },
    ];
  });

  return {
    raised: rows.length,
    fixed: rows.filter((row) => row.state === 'fixed').length,
    withdrawn: rows.filter((row) => row.state === 'withdrawn').length,
    open: counted('snags:open', SNAG_LABEL_KEYS.open, open),
    overdue: counted('snags:overdue', SNAG_LABEL_KEYS.overdue, overdue),
    byPerson,
    byStage,
  };
}

// ── What retention asks of the list ──────────────────────────────────────────

/** Of one stage's snags on one person: the open ones, and the day the last closed one was closed. */
export interface SnagHold {
  /** By number. */
  readonly open: readonly Snag[];
  /** The latest `closedOn` among the closed ones (fixed or withdrawn); `null` when none is closed. */
  readonly lastClosedOn: string | null;
}

const NO_HOLD: SnagHold = { open: [], lastClosedOn: null };

const holdsCache = new WeakMap<WorkSnapshot, Map<string, SnagHold>>();

const holdKey = (stageId: string, personId: string): string => `${stageId}\u0000${personId}`;

/**
 * What a stage's snags on a person hold: read in one pass per snapshot and remembered. A snag on
 * nobody, or a person `null`, holds nothing; a snag of another stage, or on another person, does not
 * count. Both closures close a snag: a withdrawn one holds no more than a fixed one.
 */
export function snagHold(
  snapshot: WorkSnapshot,
  stageId: string,
  personId: string | null,
): SnagHold {
  if (personId === null) return NO_HOLD;
  let holds = holdsCache.get(snapshot);
  if (holds === undefined) {
    const building = new Map<string, { open: Snag[]; lastClosedOn: string | null }>();
    for (const snag of snagsInOrder(snapshot)) {
      if (snag.personId === null) continue;
      const key = holdKey(snag.stageId, snag.personId);
      const hold = building.get(key) ?? { open: [], lastClosedOn: null };
      if (snag.closure === null) hold.open.push(snag);
      else if (hold.lastClosedOn === null || snag.closure.closedOn > hold.lastClosedOn) {
        hold.lastClosedOn = snag.closure.closedOn;
      }
      building.set(key, hold);
    }
    holds = building;
    holdsCache.set(snapshot, holds);
  }
  return holds.get(holdKey(stageId, personId)) ?? NO_HOLD;
}

// ── Checking before the host is asked ────────────────────────────────────────

/** A snag as the interface asks the host to raise it. */
export interface SnagDraft {
  readonly title: string;
  readonly description: string | null;
  readonly stageId: string;
  readonly activityId: string | null;
  readonly personId: string | null;
  readonly raisedOn: string;
  readonly dueOn: string | null;
  readonly photoHash: string | null;
}

/** A closure as the interface asks the host to record it. */
export interface SnagClosureDraft {
  readonly snagId: string;
  readonly outcome: SnagOutcome;
  readonly closedOn: string;
  readonly photoHash: string | null;
  readonly note: string | null;
}

function problem(code: SnagProblemCode): SnagProblem {
  return { code, messageKey: SNAG_PROBLEM_KEYS[code] };
}

const length = (text: string): number => [...text].length;

const blank = (text: string | null): boolean => text === null || text.trim() === '';

const holdsDocument = (snapshot: WorkSnapshot, hash: string): boolean =>
  snapshot.documents.some((document) => document.fileHash === hash);

/**
 * Check a snag before it is raised: a title (1–200 characters), a description of at most 2 000; a
 * stage of the plan (a closed one too: snags are found after closing); an activity, when named, of
 * the plan and of that stage; a person, when named, of the plan; days that are days, the due day
 * not before the day raised; a photo, when given, a document of the work. Every problem, in that
 * order; `[]` when none. Never throws.
 */
export function validateSnagDraft(snapshot: WorkSnapshot, draft: SnagDraft): SnagProblem[] {
  const problems: SnagProblem[] = [];
  if (draft.title.trim() === '') problems.push(problem('title-empty'));
  else if (length(draft.title) > SNAG_LIMITS.title) problems.push(problem('title-too-long'));
  if (draft.description !== null && length(draft.description) > SNAG_LIMITS.description) {
    problems.push(problem('description-too-long'));
  }
  if (!snapshot.stages.some((stage) => stage.id === draft.stageId)) {
    problems.push(problem('unknown-stage'));
  }
  if (draft.activityId !== null) {
    const activity = snapshot.activities.find((each) => each.id === draft.activityId);
    if (activity === undefined) problems.push(problem('unknown-activity'));
    else if (activity.stageId !== draft.stageId)
      problems.push(problem('activity-of-another-stage'));
  }
  if (draft.personId !== null && !snapshot.people.some((person) => person.id === draft.personId)) {
    problems.push(problem('unknown-person'));
  }
  const raisedKnown = isIsoDay(draft.raisedOn);
  if (!raisedKnown) problems.push(problem('invalid-raised-on'));
  if (draft.dueOn !== null) {
    if (!isIsoDay(draft.dueOn)) problems.push(problem('invalid-due-on'));
    else if (raisedKnown && draft.dueOn < draft.raisedOn)
      problems.push(problem('due-before-raised'));
  }
  if (draft.photoHash !== null && !holdsDocument(snapshot, draft.photoHash)) {
    problems.push(problem('unknown-photo'));
  }
  return problems;
}

/**
 * Check a closure before it is recorded: a snag of the work not closed already (one closure per
 * snag); `fixed` or `withdrawn`; a day that is a day, not before the snag was raised; `fixed` with a
 * photo (a document of the work), `withdrawn` with its reason; a note of at most 2 000 characters.
 * Every problem; `[]` when none. Never throws.
 */
export function validateSnagClosure(
  snapshot: WorkSnapshot,
  draft: SnagClosureDraft,
): SnagProblem[] {
  const snag = snapshot.snags.find((each) => each.id === draft.snagId);
  if (snag === undefined) return [problem('unknown-snag')];
  const problems: SnagProblem[] = [];
  if (snag.closure !== null) problems.push(problem('already-closed'));
  const outcome: string = draft.outcome;
  if (!(SNAG_OUTCOMES as readonly string[]).includes(outcome)) {
    problems.push(problem('invalid-outcome'));
  }
  if (!isIsoDay(draft.closedOn)) problems.push(problem('invalid-closed-on'));
  else if (isIsoDay(snag.raisedOn) && draft.closedOn < snag.raisedOn) {
    problems.push(problem('closed-before-raised'));
  }
  if (draft.outcome === 'fixed' && draft.photoHash === null)
    problems.push(problem('photo-required'));
  if (draft.photoHash !== null && !holdsDocument(snapshot, draft.photoHash)) {
    problems.push(problem('unknown-photo'));
  }
  if (draft.outcome === 'withdrawn' && blank(draft.note)) problems.push(problem('note-required'));
  if (draft.note !== null && length(draft.note) > SNAG_LIMITS.note) {
    problems.push(problem('note-too-long'));
  }
  return problems;
}
