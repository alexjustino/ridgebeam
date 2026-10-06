/**
 * The sections of a work's record, and which of them a thing belongs to (slices D3 and G6).
 *
 * One place decides how a work is divided and where a photo is told, so the handover book
 * (`handover.ts`) and the work told in photos (`story.ts`) never disagree:
 *
 * - **the sections** (`scopes`), by **room** in room order when the work has rooms, otherwise by
 *   **stage** in stage order. A room's section holds the activities that touch it and the stages
 *   of those activities; when the work has rooms, one last section (`other`) holds the activities
 *   that touch none and the stages none of whose activities touch a room.
 * - **a stage's things** (its hidden-work photos, its decisions, its care notes) belong to every
 *   section the stage is in (`scope.stageIds`).
 * - **a diary entry** belongs to every section holding an activity its done lines name
 *   (`namedIn`), with those activities.
 * - **a snag** belongs where its activity is, when it names one the plan has; otherwise to every
 *   section its stage is in (`snagIn`).
 * - **a photo** is one the work holds as an image (`imagesOf`): a document of the work with width
 *   and height. The host refuses an image block for any other hash, so nothing asks it for one.
 *
 * What no section takes — a diary entry naming no activity of a section, a snag whose stage and
 * activity are both gone — has one last place, `fallbackScope`: `other` when the work has rooms,
 * the whole work (`work`) when it has none. The story tells it there; the book adds that section
 * only when the story has something in it.
 *
 * What this module is not: text, picking, or I/O.
 */

import { byRoom } from '../arrangements';
import type { DiaryEntry } from '../diary';
import {
  compareText,
  stagesInOrder,
  type Activity,
  type Check,
  type CheckAnswer,
  type Gate,
  type Snag,
  type Stage,
  type WorkSnapshot,
} from '../plan';

/** How the work is divided: by room when it has rooms, by stage otherwise. */
export type ScopeBy = 'room' | 'stage';

/**
 * A section is a room, a stage, the rest of the work when it has rooms (`other`), or — when it has
 * none — the whole work (`work`), for what no stage takes.
 */
export type ScopeKind = 'room' | 'stage' | 'other' | 'work';

/** A section's scope: its activities in plan order, and its stages in plan order. */
export interface Scope {
  /** `room:<id>`, `stage:<id>`, `other` or `work`. */
  readonly key: string;
  readonly kind: ScopeKind;
  /** The room's or the stage's id; `null` for `other` and `work`. */
  readonly id: string | null;
  /** The room's or the stage's name; `null` for `other` and `work`. */
  readonly name: string | null;
  readonly activities: readonly Activity[];
  readonly stages: readonly Stage[];
  readonly activityIds: ReadonlySet<string>;
  readonly stageIds: ReadonlySet<string>;
  /** The room's own notes come first, for a room. */
  readonly roomId: string | null;
}

function scope(
  key: string,
  kind: ScopeKind,
  id: string | null,
  name: string | null,
  activities: readonly Activity[],
  stages: readonly Stage[],
  roomId: string | null,
): Scope {
  return {
    key,
    kind,
    id,
    name,
    activities,
    stages,
    activityIds: new Set(activities.map((activity) => activity.id)),
    stageIds: new Set(stages.map((stage) => stage.id)),
    roomId,
  };
}

/** The work's sections, in order. */
export function scopes(snapshot: WorkSnapshot): { by: ScopeBy; scopes: Scope[] } {
  const ordered = stagesInOrder(snapshot);
  const stagesOf = (activities: readonly Activity[]) => {
    const ids = new Set(activities.map((activity) => activity.stageId));
    return ordered.filter((stage) => ids.has(stage.id));
  };

  if (snapshot.rooms.length === 0) {
    return {
      by: 'stage',
      scopes: ordered.map((stage) =>
        scope(
          `stage:${stage.id}`,
          'stage',
          stage.id,
          stage.name,
          snapshot.activities
            .filter((activity) => activity.stageId === stage.id)
            .sort((a, b) => a.position - b.position || compareText(a.id, b.id)),
          [stage],
          null,
        ),
      ),
    };
  }

  const result: Scope[] = [];
  const roomed = new Set<string>();
  let rest: readonly Activity[] = [];
  for (const group of byRoom(snapshot)) {
    if (group.roomId === null) {
      rest = group.activities;
      continue;
    }
    for (const activity of group.activities) roomed.add(activity.stageId);
    result.push(
      scope(
        `room:${group.roomId}`,
        'room',
        group.roomId,
        group.name,
        group.activities,
        stagesOf(group.activities),
        group.roomId,
      ),
    );
  }
  const restStages = new Set(stagesOf(rest).map((stage) => stage.id));
  const others = ordered.filter((stage) => restStages.has(stage.id) || !roomed.has(stage.id));
  if (rest.length > 0 || others.length > 0) {
    result.push(scope('other', 'other', null, null, rest, others, null));
  }
  return { by: 'room', scopes: result };
}

/**
 * Where what no section takes is told: `other` when the work has rooms (the same key as the
 * section of the rest, when there is one), the whole work (`work`) when it has none. It holds no
 * activity and no stage of its own.
 */
export function fallbackScope(by: ScopeBy): Scope {
  return by === 'room'
    ? scope('other', 'other', null, null, [], [], null)
    : scope('work', 'work', null, null, [], [], null);
}

/** The images the work holds, by hash, with their file name: the only photos told. */
export function imagesOf(snapshot: WorkSnapshot): Map<string, string> {
  const images = new Map<string, string>();
  for (const document of snapshot.documents) {
    if (document.width !== null && document.height !== null && !images.has(document.fileHash)) {
      images.set(document.fileHash, document.fileName);
    }
  }
  return images;
}

/** A stage's checks that need a photo: start before close, then by position. */
export function hiddenChecks(snapshot: WorkSnapshot, stage: Stage): Check[] {
  const gateOrder: Record<Gate, number> = { start: 0, close: 1 };
  return snapshot.checks
    .filter((check) => check.stageId === stage.id && check.needsPhoto)
    .sort(
      (a, b) =>
        gateOrder[a.gate] - gateOrder[b.gate] || a.position - b.position || compareText(a.id, b.id),
    );
}

/** An answer carrying a photo, on a check that needs one. */
export interface HiddenAnswer {
  readonly stage: Stage;
  readonly check: Check;
  readonly answer: CheckAnswer;
  readonly photoHash: string;
}

/**
 * Every answer with a photo on a check that needs one, of these stages, in check order (stage,
 * then start before close, then position), each answer by seq. Not deduplicated, not filtered by
 * what the work holds: the caller does both.
 */
export function hiddenAnswersOf(snapshot: WorkSnapshot, stages: readonly Stage[]): HiddenAnswer[] {
  const result: HiddenAnswer[] = [];
  for (const stage of stages) {
    for (const check of hiddenChecks(snapshot, stage)) {
      const answers = snapshot.checkAnswers
        .filter((answer) => answer.checkId === check.id)
        .sort((a, b) => a.seq - b.seq);
      for (const answer of answers) {
        if (answer.photoHash !== null) {
          result.push({ stage, check, answer, photoHash: answer.photoHash });
        }
      }
    }
  }
  return result;
}

/** The ids of the activities an entry's done lines name. */
export function namedBy(entry: DiaryEntry): Set<string> {
  return new Set(entry.done.map((line) => line.activityId));
}

/** The section's activities an entry names (`namedBy`), in the section's order. */
export function namedIn(scope: Scope, named: ReadonlySet<string>): Activity[] {
  return scope.activities.filter((activity) => named.has(activity.id));
}

/**
 * Whether a snag belongs to the section: one naming an activity the plan has, where that activity
 * is; one naming none (or one no longer in the plan), in every section its stage is in.
 */
export function snagIn(
  scope: Scope,
  snag: Snag,
  activities: ReadonlyMap<string, Activity>,
): boolean {
  const activity = snag.activityId === null ? undefined : activities.get(snag.activityId);
  return activity !== undefined
    ? scope.activityIds.has(activity.id)
    : scope.stageIds.has(snag.stageId);
}
