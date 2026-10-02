/**
 * The handover book: the work's record for its owner, kept for decades (slice D3, decisions 5–6).
 *
 * A pure selection, in keys and rows, never text; the interface turns it into a document in the
 * owner's words, and turns every photo hash it picks into an image block. In order:
 *
 * - **the cover**: the work, its place and start, the day the last stage closed (`finishedOn`) or,
 *   while any stage is open, "in progress"; the people by trade; where the plan came from.
 * - **the sections**, by **room** in room order when the work has rooms, otherwise by **stage** in
 *   stage order. A room's section holds the activities that touch it and the stages of those
 *   activities; when the work has rooms, one last section (`other`) holds the activities that touch
 *   none and the stages none of whose activities touch a room, so nothing done is left out of the
 *   book. A stage's things (its decisions, its hidden-work photos, its care notes) are told in every
 *   section the stage is in. Each section says:
 *   - **what was done and when**: its finished activities, in plan order, with the day the diary
 *     says they finished (effective entries only), and how many of its activities are not finished;
 *   - **the decisions made** of its stages: name, answer, day;
 *   - **hidden-work photos**: every photo an answer carries on a check that needs one
 *     (`needsPhoto`) of its stages, in check order (stage, then start before close, then position),
 *     each answer by seq — all of them: they are what the book is for, and never cut;
 *   - **other photos**: photos of the effective diary entries naming its activities, at most
 *     `HANDOVER_PHOTO_LIMIT`, picked **the latest per activity first** — each activity's newest
 *     photo in plan order, then each one's second newest, and so on — never one already shown as
 *     hidden work, each photo once; how many were left out is said (`photosNotShown`);
 *   - **its care notes**: the room's (for a room), then those of its stages.
 * - **the documents** the owner keeps, by kind in a fixed order (`HANDOVER_DOCUMENT_KINDS`: permits,
 *   warranties, manuals, contracts, receipts), each with its name, day and what it is attached to.
 * - **who did what**: everyone in the plan, by name, with trade, phone and e-mail, and the stages
 *   they worked — the stages of the activities named by the effective entries that have them present
 *   — with how many days the diary has them on site.
 * - **the care notes for the whole work**, then any note whose room or stage is gone (listed,
 *   never dropped).
 * - **the record**: how many entries the diary holds and its first and last day. The chain is the
 *   host's to verify, at the moment of writing.
 *
 * **Only a photo the work holds is picked**: one whose hash a document of the work names, with
 * width and height (an image, not a PDF). The host refuses an image block for any other hash, so the
 * book never asks it for one.
 *
 * `handoverGaps` is what the book still lacks, counted, with its rows (decision 6): hidden-work
 * checks answered `yes` with no photo the work holds, hidden-work checks never answered, stages not
 * closed, rooms with no photo at all, no warranty or manual, no care note. Writing is allowed
 * anyway: the book may be wanted mid-work, and its cover then says so.
 *
 * What this module is not: text, layout or I/O.
 */

import { breakdown, byRoom } from '../arrangements';
import { latestAnswers, stageState, type StageState } from '../checks';
import { effectiveEntries, progress, type DiaryEntry } from '../diary';
import {
  byKind,
  DOCUMENTS_LABEL_KEYS,
  describeTarget,
  linksOf,
  type TargetDescription,
} from '../documents';
import { counted, type Figure, type ReportRow } from '../figure';
import {
  careNotesOf,
  compareText,
  decisionsInOrder,
  stagesInOrder,
  type Activity,
  type Answer,
  type CareNote,
  type CareTargetKind,
  type Check,
  type DocumentKind,
  type Gate,
  type Stage,
  type WorkSnapshot,
} from '../plan';
import { daysOnSite } from '../people';
import { diaryReport } from './diary';

/** At most this many diary photos per section, besides the hidden-work photos. */
export const HANDOVER_PHOTO_LIMIT = 6;

/** The documents the book lists, by kind, in this order. Photos are shown, not listed. */
export const HANDOVER_DOCUMENT_KINDS = [
  'permit',
  'warranty',
  'manual',
  'contract',
  'receipt',
] as const satisfies readonly DocumentKind[];

export type HandoverDocumentKind = (typeof HANDOVER_DOCUMENT_KINDS)[number];

/** How the book is divided: by room when the work has rooms, by stage otherwise. */
export type HandoverBy = 'room' | 'stage';

/** A section is a room, a stage, or the rest of the work (`other`) when the work has rooms. */
export type HandoverSectionKind = 'room' | 'stage' | 'other';

export const HANDOVER_LABEL_KEYS = {
  /** The gaps figure: "The book has 4 gaps". */
  gaps: 'reports.handover.figure.gaps',
  /** The last section's title when the work has rooms: what touches no room. */
  other: 'reports.handover.section.other',
} as const;

/** What the book can still lack. */
export type HandoverGapKind =
  | 'hidden-without-photo'
  | 'hidden-unanswered'
  | 'stage-open'
  | 'room-without-photo'
  | 'no-warranty-or-manual'
  | 'no-care-note';

export const HANDOVER_GAP_KEYS = {
  'hidden-without-photo': 'reports.handover.gap.hiddenWithoutPhoto',
  'hidden-unanswered': 'reports.handover.gap.hiddenUnanswered',
  'stage-open': 'reports.handover.gap.stageOpen',
  'room-without-photo': 'reports.handover.gap.roomWithoutPhoto',
  'no-warranty-or-manual': 'reports.handover.gap.noWarrantyOrManual',
  'no-care-note': 'reports.handover.gap.noCareNote',
} as const satisfies Record<HandoverGapKind, string>;

// ── The shapes ───────────────────────────────────────────────────────────────

export interface HandoverTrade {
  /** The trade as the people wrote it, trimmed; `null` for the people with none said. */
  readonly trade: string | null;
  /** By name. */
  readonly people: ReadonlyArray<{ readonly personId: string; readonly name: string }>;
}

export interface HandoverCover {
  readonly workName: string;
  readonly place: string;
  readonly startDate: string;
  /** The day the last stage closed, when every stage is closed; `null` otherwise. */
  readonly finishedOn: string | null;
  /** Any stage open, or no stage at all: the book is written while the work is in progress. */
  readonly inProgress: boolean;
  /** The trades in text order, the people with no trade last. */
  readonly trades: readonly HandoverTrade[];
  /** Where the plan came from; `null` for a work started empty. */
  readonly template: {
    readonly id: string;
    readonly version: number | null;
    readonly title: string | null;
  } | null;
}

/** A stage a section speaks of, with where it is in its life. */
export interface HandoverStageRow {
  readonly stageId: string;
  readonly name: string;
  readonly state: StageState;
  /** `YYYY-MM-DD`, from the stage's start and close; `null` when not. */
  readonly startedOn: string | null;
  readonly closedOn: string | null;
}

/** A finished activity: what was done, and the day the diary says it finished. */
export interface HandoverDoneRow {
  readonly activityId: string;
  readonly name: string;
  /** The breakdown number (`1.2`); `null` when its stage is not in the plan. */
  readonly number: string | null;
  readonly stageId: string;
  readonly stageName: string | null;
  readonly finishedOn: string;
}

/** A decision made. */
export interface HandoverDecisionRow {
  readonly decisionId: string;
  readonly name: string;
  readonly answer: string | null;
  /** `YYYY-MM-DD`, the day it was made. */
  readonly madeOn: string;
  readonly stageId: string;
  readonly stageName: string;
}

/** A photo of hidden work: an answer's photo on a check that needs one. */
export interface HandoverHiddenPhoto {
  readonly photoHash: string;
  /** The document's file name, for a caption that wants it. */
  readonly fileName: string;
  readonly checkId: string;
  readonly checkName: string;
  readonly gate: Gate;
  readonly stageId: string;
  readonly stageName: string;
  readonly answer: Answer;
  /** The answer's seq for its check. */
  readonly seq: number;
  /** `YYYY-MM-DD`, the day it was answered. */
  readonly day: string;
}

/** A diary photo of an entry naming one of the section's activities. */
export interface HandoverDiaryPhoto {
  readonly photoHash: string;
  readonly fileName: string;
  /** The day of the entry it came with. */
  readonly day: string;
  readonly entrySeq: number;
  /** The activity it was picked for. */
  readonly activityId: string;
  readonly activityName: string;
}

/** A care note as the book prints it. */
export interface HandoverCareNote {
  readonly noteId: string;
  readonly targetKind: CareTargetKind;
  readonly targetId: string;
  /** The room's, stage's or work's name; `null` when the target is gone. */
  readonly targetName: string | null;
  readonly text: string;
  /** The room or stage it names is not in the plan. */
  readonly detached: boolean;
}

export interface HandoverSection {
  /** `room:<id>`, `stage:<id>` or `other`. */
  readonly key: string;
  readonly kind: HandoverSectionKind;
  /** The room's or the stage's id; `null` for `other`. */
  readonly id: string | null;
  /** The room's or the stage's name; `null` for `other` (`HANDOVER_LABEL_KEYS.other`). */
  readonly name: string | null;
  readonly stages: readonly HandoverStageRow[];
  /** How many activities the section holds; `done` lists the finished ones. */
  readonly activities: number;
  readonly done: readonly HandoverDoneRow[];
  readonly decisions: readonly HandoverDecisionRow[];
  readonly hiddenWork: readonly HandoverHiddenPhoto[];
  readonly photos: readonly HandoverDiaryPhoto[];
  /** Diary photos of the section's activities that the limit left out. */
  readonly photosNotShown: number;
  readonly careNotes: readonly HandoverCareNote[];
}

export interface HandoverDocumentRow {
  readonly documentId: string;
  readonly title: string;
  readonly fileName: string;
  readonly addedOn: string;
  /** What it is attached to, each target once. */
  readonly attachedTo: readonly TargetDescription[];
}

export interface HandoverDocumentGroup {
  readonly kind: HandoverDocumentKind;
  readonly labelKey: (typeof DOCUMENTS_LABEL_KEYS)[HandoverDocumentKind];
  /** Newest first, as the Documents page lists them; empty when the work has none. */
  readonly documents: readonly HandoverDocumentRow[];
}

export interface HandoverPersonRow {
  readonly personId: string;
  readonly name: string;
  readonly trade: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  /** The stages they worked, in plan order, from the diary. */
  readonly stages: ReadonlyArray<{ readonly stageId: string; readonly name: string }>;
  readonly daysOnSite: number;
  readonly firstOnSite: string | null;
  readonly lastOnSite: string | null;
}

export interface HandoverRecord {
  /** Entries written, corrections included. */
  readonly written: number;
  readonly corrections: number;
  readonly firstDay: string | null;
  readonly lastDay: string | null;
}

/** One thing the book still lacks. */
export interface HandoverGapRow extends ReportRow {
  readonly kind: HandoverGapKind;
  readonly messageKey: (typeof HANDOVER_GAP_KEYS)[HandoverGapKind];
}

export interface Handover {
  readonly cover: HandoverCover;
  readonly by: HandoverBy;
  readonly sections: readonly HandoverSection[];
  readonly documents: readonly HandoverDocumentGroup[];
  readonly people: readonly HandoverPersonRow[];
  /** The notes on the whole work, then the notes whose target is gone. */
  readonly careNotes: readonly HandoverCareNote[];
  readonly record: HandoverRecord;
  readonly gaps: Figure<HandoverGapRow>;
}

// ── Reading the work ─────────────────────────────────────────────────────────

const dayOf = (instant: string | null): string | null => instant?.slice(0, 10) ?? null;

/** What every section reads, computed once. */
interface Reading {
  readonly snapshot: WorkSnapshot;
  readonly effective: readonly DiaryEntry[];
  readonly stageById: ReadonlyMap<string, Stage>;
  /** The images the work holds, by hash: what the book may show. */
  readonly images: ReadonlyMap<string, string>;
  readonly finishedOn: ReadonlyMap<string, string>;
  readonly numbers: ReadonlyMap<string, string | null>;
}

function read(snapshot: WorkSnapshot, entries: readonly DiaryEntry[]): Reading {
  const images = new Map<string, string>();
  for (const document of snapshot.documents) {
    if (document.width !== null && document.height !== null && !images.has(document.fileHash)) {
      images.set(document.fileHash, document.fileName);
    }
  }
  const finishedOn = new Map<string, string>();
  for (const [id, each] of progress(snapshot, entries)) {
    if (each.finishedOn !== null) finishedOn.set(id, each.finishedOn);
  }
  const numbers = new Map<string, string | null>();
  for (const row of breakdown(snapshot)) {
    if (row.kind === 'activity') numbers.set(row.id, row.number);
  }
  return {
    snapshot,
    effective: effectiveEntries(entries),
    stageById: new Map(snapshot.stages.map((stage) => [stage.id, stage])),
    images,
    finishedOn,
    numbers,
  };
}

/** A section's scope: its activities in plan order, and its stages in plan order. */
interface Scope {
  readonly key: string;
  readonly kind: HandoverSectionKind;
  readonly id: string | null;
  readonly name: string | null;
  readonly activities: readonly Activity[];
  readonly stages: readonly Stage[];
  /** The room's own notes come first, for a room. */
  readonly roomId: string | null;
}

function scopes(snapshot: WorkSnapshot): { by: HandoverBy; scopes: Scope[] } {
  const ordered = stagesInOrder(snapshot);
  const stagesOf = (activities: readonly Activity[]) => {
    const ids = new Set(activities.map((activity) => activity.stageId));
    return ordered.filter((stage) => ids.has(stage.id));
  };

  if (snapshot.rooms.length === 0) {
    return {
      by: 'stage',
      scopes: ordered.map((stage) => ({
        key: `stage:${stage.id}`,
        kind: 'stage',
        id: stage.id,
        name: stage.name,
        activities: snapshot.activities
          .filter((activity) => activity.stageId === stage.id)
          .sort((a, b) => a.position - b.position || compareText(a.id, b.id)),
        stages: [stage],
        roomId: null,
      })),
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
    result.push({
      key: `room:${group.roomId}`,
      kind: 'room',
      id: group.roomId,
      name: group.name,
      activities: group.activities,
      stages: stagesOf(group.activities),
      roomId: group.roomId,
    });
  }
  const restStages = new Set(stagesOf(rest).map((stage) => stage.id));
  const others = ordered.filter((stage) => restStages.has(stage.id) || !roomed.has(stage.id));
  if (rest.length > 0 || others.length > 0) {
    result.push({
      key: 'other',
      kind: 'other',
      id: null,
      name: null,
      activities: rest,
      stages: others,
      roomId: null,
    });
  }
  return { by: 'room', scopes: result };
}

function careNoteRow(
  note: CareNote,
  targetName: string | null,
  detached: boolean,
): HandoverCareNote {
  return {
    noteId: note.id,
    targetKind: note.targetKind,
    targetId: note.targetId,
    targetName,
    text: note.text,
    detached,
  };
}

/** A stage's checks that need a photo: start before close, then by position. */
function hiddenChecks(snapshot: WorkSnapshot, stage: Stage): Check[] {
  const gateOrder: Record<Gate, number> = { start: 0, close: 1 };
  return snapshot.checks
    .filter((check) => check.stageId === stage.id && check.needsPhoto)
    .sort(
      (a, b) =>
        gateOrder[a.gate] - gateOrder[b.gate] || a.position - b.position || compareText(a.id, b.id),
    );
}

/** Every answer's photo on a check that needs one, of these stages, in check order, each once. */
function hiddenWorkOf(reading: Reading, stages: readonly Stage[]): HandoverHiddenPhoto[] {
  const { snapshot, images } = reading;
  const photos: HandoverHiddenPhoto[] = [];
  const seen = new Set<string>();
  for (const stage of stages) {
    const checks = hiddenChecks(snapshot, stage);
    for (const check of checks) {
      const answers = snapshot.checkAnswers
        .filter((answer) => answer.checkId === check.id)
        .sort((a, b) => a.seq - b.seq);
      for (const answer of answers) {
        const hash = answer.photoHash;
        if (hash === null || seen.has(hash)) continue;
        const fileName = images.get(hash);
        if (fileName === undefined) continue;
        seen.add(hash);
        photos.push({
          photoHash: hash,
          fileName,
          checkId: check.id,
          checkName: check.name,
          gate: check.gate,
          stageId: stage.id,
          stageName: stage.name,
          answer: answer.answer,
          seq: answer.seq,
          day: answer.answeredAt.slice(0, 10),
        });
      }
    }
  }
  return photos;
}

/**
 * The diary photos of a section, the latest per activity first: round by round, each activity's
 * next newest photo in plan order, until the limit; never a hash already taken. Returns the picked
 * photos and how many distinct others there were.
 */
function diaryPhotosOf(
  reading: Reading,
  activities: readonly Activity[],
  taken: ReadonlySet<string>,
): { photos: HandoverDiaryPhoto[]; notShown: number } {
  const newestFirst = [...reading.effective].sort(
    (a, b) => compareText(b.day, a.day) || b.seq - a.seq,
  );
  const queues = activities.map((activity) => {
    const queue: HandoverDiaryPhoto[] = [];
    const own = new Set<string>();
    for (const entry of newestFirst) {
      if (!entry.done.some((line) => line.activityId === activity.id)) continue;
      for (const photo of entry.photos) {
        const fileName = reading.images.get(photo.fileHash);
        if (fileName === undefined || own.has(photo.fileHash) || taken.has(photo.fileHash)) {
          continue;
        }
        own.add(photo.fileHash);
        queue.push({
          photoHash: photo.fileHash,
          fileName,
          day: entry.day,
          entrySeq: entry.seq,
          activityId: activity.id,
          activityName: activity.name,
        });
      }
    }
    return queue;
  });

  const picked: HandoverDiaryPhoto[] = [];
  const used = new Set<string>();
  const longest = Math.max(0, ...queues.map((queue) => queue.length));
  for (let round = 0; round < longest && picked.length < HANDOVER_PHOTO_LIMIT; round += 1) {
    for (const queue of queues) {
      const photo = queue[round];
      if (photo === undefined || used.has(photo.photoHash)) continue;
      used.add(photo.photoHash);
      picked.push(photo);
      if (picked.length === HANDOVER_PHOTO_LIMIT) break;
    }
  }
  const all = new Set(queues.flatMap((queue) => queue.map((photo) => photo.photoHash)));
  return { photos: picked, notShown: all.size - picked.length };
}

function section(reading: Reading, scope: Scope): HandoverSection {
  const { snapshot } = reading;
  const stageIds = new Set(scope.stages.map((stage) => stage.id));

  const done: HandoverDoneRow[] = [];
  for (const activity of scope.activities) {
    const finishedOn = reading.finishedOn.get(activity.id);
    if (finishedOn === undefined) continue;
    done.push({
      activityId: activity.id,
      name: activity.name,
      number: reading.numbers.get(activity.id) ?? null,
      stageId: activity.stageId,
      stageName: reading.stageById.get(activity.stageId)?.name ?? null,
      finishedOn,
    });
  }

  const decisions: HandoverDecisionRow[] = decisionsInOrder(snapshot)
    .filter((decision) => stageIds.has(decision.stageId) && decision.madeAt !== null)
    .map((decision) => ({
      decisionId: decision.id,
      name: decision.name,
      answer: decision.answer,
      madeOn: decision.madeAt!.slice(0, 10),
      stageId: decision.stageId,
      stageName: reading.stageById.get(decision.stageId)!.name,
    }));

  const hiddenWork = hiddenWorkOf(reading, scope.stages);
  const { photos, notShown } = diaryPhotosOf(
    reading,
    scope.activities,
    new Set(hiddenWork.map((photo) => photo.photoHash)),
  );

  const careNotes: HandoverCareNote[] = [];
  if (scope.roomId !== null) {
    for (const note of careNotesOf(snapshot, 'room', scope.roomId)) {
      careNotes.push(careNoteRow(note, scope.name, false));
    }
  }
  for (const stage of scope.stages) {
    for (const note of careNotesOf(snapshot, 'stage', stage.id)) {
      careNotes.push(careNoteRow(note, stage.name, false));
    }
  }

  return {
    key: scope.key,
    kind: scope.kind,
    id: scope.id,
    name: scope.name,
    stages: scope.stages.map((stage) => ({
      stageId: stage.id,
      name: stage.name,
      state: stageState(stage),
      startedOn: dayOf(stage.startedAt),
      closedOn: dayOf(stage.closedAt),
    })),
    activities: scope.activities.length,
    done,
    decisions,
    hiddenWork,
    photos,
    photosNotShown: notShown,
    careNotes,
  };
}

function cover(snapshot: WorkSnapshot): HandoverCover {
  const { work } = snapshot;
  const open = snapshot.stages.some((stage) => stage.closedAt === null);
  let finishedOn: string | null = null;
  if (snapshot.stages.length > 0 && !open) {
    finishedOn = snapshot.stages
      .map((stage) => stage.closedAt!.slice(0, 10))
      .reduce((latest, day) => (day > latest ? day : latest));
  }

  const trades = new Map<string | null, Array<{ personId: string; name: string }>>();
  for (const person of snapshot.people) {
    const said = person.trade?.trim() ?? '';
    const trade = said === '' ? null : said;
    const list = trades.get(trade) ?? [];
    list.push({ personId: person.id, name: person.name });
    trades.set(trade, list);
  }
  const tradeRows: HandoverTrade[] = [...trades.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : compareText(a, b)))
    .map(([trade, people]) => ({
      trade,
      people: people.sort(
        (a, b) => compareText(a.name, b.name) || compareText(a.personId, b.personId),
      ),
    }));

  return {
    workName: work.name,
    place: work.place,
    startDate: work.startDate,
    finishedOn,
    inProgress: finishedOn === null,
    trades: tradeRows,
    template:
      work.templateId === null
        ? null
        : { id: work.templateId, version: work.templateVersion, title: work.templateTitle },
  };
}

function documentsOfBook(
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
): HandoverDocumentGroup[] {
  const groups = byKind(snapshot.documents);
  return HANDOVER_DOCUMENT_KINDS.map((kind) => ({
    kind,
    labelKey: DOCUMENTS_LABEL_KEYS[kind],
    documents: groups[kind].map((document) => ({
      documentId: document.id,
      title: document.title,
      fileName: document.fileName,
      addedOn: document.addedOn,
      attachedTo: linksOf(document).map((link) => describeTarget(snapshot, link, entries)),
    })),
  }));
}

function peopleOfBook(reading: Reading, entries: readonly DiaryEntry[]): HandoverPersonRow[] {
  const { snapshot } = reading;
  const stageOfActivity = new Map(
    snapshot.activities.map((activity) => [activity.id, activity.stageId]),
  );
  const ordered = stagesInOrder(snapshot);
  return [...snapshot.people]
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id))
    .map((person) => {
      const worked = new Set<string>();
      for (const entry of reading.effective) {
        if (!entry.present.includes(person.id)) continue;
        for (const line of entry.done) {
          const stageId = stageOfActivity.get(line.activityId);
          if (stageId !== undefined) worked.add(stageId);
        }
      }
      const days = daysOnSite(person, entries);
      return {
        personId: person.id,
        name: person.name,
        trade: person.trade,
        phone: person.phone,
        email: person.email,
        stages: ordered
          .filter((stage) => worked.has(stage.id))
          .map((stage) => ({ stageId: stage.id, name: stage.name })),
        daysOnSite: days.length,
        firstOnSite: days[0] ?? null,
        lastOnSite: days.at(-1) ?? null,
      };
    });
}

/** The notes on the whole work, then every note whose room or stage is not in the plan. */
function workNotes(snapshot: WorkSnapshot): HandoverCareNote[] {
  const rooms = new Set(snapshot.rooms.map((room) => room.id));
  const stages = new Set(snapshot.stages.map((stage) => stage.id));
  const byPosition = (a: CareNote, b: CareNote) =>
    a.position - b.position || compareText(a.id, b.id);
  const onWork = snapshot.careNotes
    .filter((note) => note.targetKind === 'work')
    .sort(byPosition)
    .map((note) => careNoteRow(note, snapshot.work.name, false));
  const gone = snapshot.careNotes
    .filter(
      (note) =>
        (note.targetKind === 'room' && !rooms.has(note.targetId)) ||
        (note.targetKind === 'stage' && !stages.has(note.targetId)),
    )
    .sort(byPosition)
    .map((note) => careNoteRow(note, null, true));
  return [...onWork, ...gone];
}

// ── Gaps ─────────────────────────────────────────────────────────────────────

function gapsOf(reading: Reading, sections: readonly HandoverSection[]): Figure<HandoverGapRow> {
  const { snapshot } = reading;
  const rows: HandoverGapRow[] = [];
  const gap = (
    kind: HandoverGapKind,
    key: string,
    itemId: string | null,
    title: string,
  ): HandoverGapRow => ({
    key,
    itemId,
    title,
    day: null,
    minutes: 0,
    kind,
    messageKey: HANDOVER_GAP_KEYS[kind],
  });

  // Hidden work, in check order, each kind together: answered without a photo, then not answered.
  const latest = latestAnswers(snapshot.checkAnswers);
  const unanswered: HandoverGapRow[] = [];
  for (const check of stagesInOrder(snapshot).flatMap((stage) => hiddenChecks(snapshot, stage))) {
    const answer = latest.get(check.id);
    if (answer === undefined) {
      unanswered.push(
        gap('hidden-unanswered', `hidden-unanswered:${check.id}`, check.id, check.name),
      );
      continue;
    }
    if (answer.answer !== 'yes') continue;
    const photographed = snapshot.checkAnswers.some(
      (each) =>
        each.checkId === check.id && each.photoHash !== null && reading.images.has(each.photoHash),
    );
    if (!photographed) {
      rows.push(
        gap('hidden-without-photo', `hidden-without-photo:${check.id}`, check.id, check.name),
      );
    }
  }
  rows.push(...unanswered);

  for (const stage of stagesInOrder(snapshot)) {
    if (stageState(stage) !== 'closed') {
      rows.push(gap('stage-open', `stage-open:${stage.id}`, stage.id, stage.name));
    }
  }

  for (const each of sections) {
    if (each.kind === 'room' && each.hiddenWork.length + each.photos.length === 0) {
      rows.push(gap('room-without-photo', `room-without-photo:${each.id}`, each.id, each.name!));
    }
  }

  if (
    !snapshot.documents.some(
      (document) => document.kind === 'warranty' || document.kind === 'manual',
    )
  ) {
    rows.push(gap('no-warranty-or-manual', 'no-warranty-or-manual', null, snapshot.work.name));
  }
  if (snapshot.careNotes.length === 0) {
    rows.push(gap('no-care-note', 'no-care-note', null, snapshot.work.name));
  }

  return counted('handover-gaps', HANDOVER_LABEL_KEYS.gaps, rows);
}

// ── Entry points ─────────────────────────────────────────────────────────────

function sectionsOf(reading: Reading): { by: HandoverBy; sections: HandoverSection[] } {
  const found = scopes(reading.snapshot);
  return { by: found.by, sections: found.scopes.map((scope) => section(reading, scope)) };
}

/** The handover book's content, from the plan and every diary entry. Never throws. */
export function handover(snapshot: WorkSnapshot, entries: readonly DiaryEntry[]): Handover {
  const reading = read(snapshot, entries);
  const { by, sections } = sectionsOf(reading);
  const diary = diaryReport(snapshot, entries);
  return {
    cover: cover(snapshot),
    by,
    sections,
    documents: documentsOfBook(snapshot, entries),
    people: peopleOfBook(reading, entries),
    careNotes: workNotes(snapshot),
    record: {
      written: diary.written,
      corrections: diary.corrections,
      firstDay: diary.firstDay,
      lastDay: diary.lastDay,
    },
    gaps: gapsOf(reading, sections),
  };
}

/**
 * What the handover book still lacks, counted, a row per thing: the Reports card says it before
 * the book is written ("The book has 4 gaps: …"). The same figure as `handover(…).gaps`.
 */
export function handoverGaps(
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
): Figure<HandoverGapRow> {
  const reading = read(snapshot, entries);
  return gapsOf(reading, sectionsOf(reading).sections);
}
