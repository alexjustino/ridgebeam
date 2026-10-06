/**
 * The handover book: the work's record for its owner, kept for decades (slice D3, decisions 5–6).
 *
 * A pure selection, in keys and rows, never text; the interface turns it into a document in the
 * owner's words, and turns every photo hash it picks into an image block. In order:
 *
 * - **the cover**: the work, its place and start, the day the last stage closed (`finishedOn`) or,
 *   while any stage is open, "in progress"; the people by trade; where the plan came from.
 * - **the sections**, by **room** in room order when the work has rooms, otherwise by **stage** in
 *   stage order (`sections.ts`, shared with the work told in photos). A room's section holds the
 *   activities that touch it and the stages of those activities; when the work has rooms, one last
 *   section (`other`) holds the activities that touch none and the stages none of whose activities
 *   touch a room, so nothing done is left out of the book. A stage's things (its decisions, its
 *   hidden-work photos, its care notes) are told in every section the stage is in. When the story
 *   in photos has photos no section takes (an entry naming no activity), the book ends the sections
 *   with that story's last one — `other` when the work has rooms, the whole work (`work`) when it
 *   has none — holding only those photos. Each section says:
 *   - **what was done and when**: its finished activities, in plan order, with the day the diary
 *     says they finished (effective entries only), and how many of its activities are not finished;
 *   - **the decisions made** of its stages: name, answer, day;
 *   - **hidden-work photos**: every photo an answer carries on a check that needs one
 *     (`needsPhoto`) of its stages, in check order (stage, then start before close, then position),
 *     each answer by seq — all of them: they are what the book is for, and never cut;
 *   - **in photos, first to last** (slice G6, amending D3's latest-per-activity pick): the
 *     section's story (`story.ts`: its diary photos, hidden-work photos and snag photos, by day)
 *     minus the photos it already shows as hidden work or as a snag fixed, picked with `pickStory`:
 *     at most `HANDOVER_STORY_LIMIT`, the first and the last always, the rest evenly spaced; how
 *     many were left out is said (`photosNotShown`), with that story's first and last day and its
 *     count before picking (`storyFirst`, `storyLast`, `storyCount`). The whole book stays within
 *     `HANDOVER_IMAGE_CAP` photos: hidden work and snags are never cut, and what they leave of the
 *     cap is spread over the sections round by round (`allotStory`) — every section its first and
 *     its last before any its third — so a work with many rooms shows fewer per room, never more
 *     than the host prints. Only when hidden work and snags alone pass the cap is the cut the
 *     host's;
 *   - **snags fixed** (slice E4): each fixed snag of its stages, by number, with **both photos** —
 *     the problem and the fix — when the work holds them. A snag naming an activity is told where
 *     that activity is; one naming none, in every section its stage is in. A withdrawn snag is not
 *     work done, and is not printed. Its photos are never shown again as diary photos;
 *   - **its care notes**: the room's (for a room), then those of its stages.
 * - **the documents** the owner keeps, by kind in a fixed order (`HANDOVER_DOCUMENT_KINDS`: permits,
 *   warranties, manuals, contracts, receipts), each with its name, day and what it is attached to.
 * - **who did what**: everyone in the plan, by name, with trade, phone and e-mail, and the stages
 *   they worked — the stages of the activities named by the effective entries that have them present
 *   — with how many days the diary has them on site.
 * - **the care notes for the whole work**, then any note whose room or stage is gone (listed,
 *   never dropped).
 * - **the warranties** (slice G4), as care notes are ordered — the work's, then each room's in room
 *   order, then each stage's in stage order, then those whose target is gone, by position inside a
 *   target (`aftercareOrder`): what each is, what it covers (the work, a room or a stage,
 *   described as care notes are, a target gone said so), who gives it, from and to (the last day
 *   it covers, `aftercare.ts`), its filed document and its note. All of them, an ended one too: the
 *   book is not as of a day.
 * - **the maintenance** (slice G4), in the same order: what each task is, what it covers, how
 *   often, the day it is next due, and the record of every time it was done, by seq.
 * - **the record**: how many entries the diary holds and its first and last day. The chain is the
 *   host's to verify, at the moment of writing.
 *
 * **Only a photo the work holds is picked**: one whose hash a document of the work names, with
 * width and height (an image, not a PDF). The host refuses an image block for any other hash, so the
 * book never asks it for one.
 *
 * `handoverGaps` is what the book still lacks, counted, with its rows (decision 6): hidden-work
 * checks answered `yes` with no photo the work holds, hidden-work checks never answered, stages not
 * closed, **every snag still open** ("Still to fix", slice E4, by number), rooms with no photo at
 * all, no warranty or manual, no care note. Aftercare (slice G4) adds no gap: a work may have no
 * warranty to record. Writing is allowed anyway: the book may be wanted mid-work, and its cover then
 * says so.
 *
 * What this module is not: text, layout or I/O.
 */

import {
  aftercareDocumentOf,
  describeAftercareTarget,
  maintenanceInOrder,
  maintenanceStory,
  warrantiesInOrder,
  warrantyEndsOn,
  type AftercareDocument,
  type AftercareTarget,
} from '../aftercare';
import { breakdown } from '../arrangements';
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
import { snagsInOrder } from '../snags';
import {
  careNotesOf,
  compareText,
  decisionsInOrder,
  stagesInOrder,
  type Answer,
  type CareNote,
  type CareTargetKind,
  type DocumentKind,
  type Gate,
  type Stage,
  type WorkSnapshot,
} from '../plan';
import { daysOnSite } from '../people';
import { diaryReport } from './diary';
import {
  fallbackScope,
  hiddenAnswersOf,
  hiddenChecks,
  imagesOf,
  scopes,
  snagIn,
  type Scope,
  type ScopeBy,
  type ScopeKind,
} from './sections';
import { allotStory, pickStory, storyOfScopes, type StoryPhoto } from './story';

/** At most this many photos per section "in photos", besides its hidden work and snags fixed. */
export const HANDOVER_STORY_LIMIT = 12;

/**
 * At most this many distinct photos in the whole book: the host's cap on the images of one
 * document (`REPORT_LIMITS.images`). The story's picks keep within what hidden work and snags
 * leave of it.
 */
export const HANDOVER_IMAGE_CAP = 400;

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
export type HandoverBy = ScopeBy;

/**
 * A section is a room, a stage, the rest of the work (`other`) when the work has rooms, or — only
 * for photos no stage takes, when it has none — the whole work (`work`).
 */
export type HandoverSectionKind = ScopeKind;

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
  | 'snag-open'
  | 'room-without-photo'
  | 'no-warranty-or-manual'
  | 'no-care-note';

export const HANDOVER_GAP_KEYS = {
  'hidden-without-photo': 'reports.handover.gap.hiddenWithoutPhoto',
  'hidden-unanswered': 'reports.handover.gap.hiddenUnanswered',
  'stage-open': 'reports.handover.gap.stageOpen',
  /** "Still to fix: {title}", one per open snag. */
  'snag-open': 'reports.handover.gap.snagOpen',
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

/**
 * A photo of the section's story, with what its caption needs: the day, what it is (`kind`), and
 * the activities, the check or the snag it shows (slice G6).
 */
export type HandoverStoryPhoto = StoryPhoto;

/** A photo the work holds, as the book shows it. */
export interface HandoverPhoto {
  readonly photoHash: string;
  readonly fileName: string;
}

/** A snag fixed (slice E4): the problem and the fix, each photo when the work holds it. */
export interface HandoverSnagRow {
  readonly snagId: string;
  readonly number: number;
  readonly title: string;
  readonly description: string | null;
  readonly stageId: string;
  readonly stageName: string | null;
  readonly activityId: string | null;
  readonly activityName: string | null;
  readonly personId: string | null;
  readonly personName: string | null;
  readonly raisedOn: string;
  readonly closedOn: string;
  /** The photo of the problem; `null` when none was taken or the work does not hold it. */
  readonly before: HandoverPhoto | null;
  /** The photo of it fixed; `null` only when the work does not hold it as an image. */
  readonly after: HandoverPhoto | null;
  readonly note: string | null;
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
  /** `room:<id>`, `stage:<id>`, `other` or `work`. */
  readonly key: string;
  readonly kind: HandoverSectionKind;
  /** The room's or the stage's id; `null` for `other` and `work`. */
  readonly id: string | null;
  /** The room's or the stage's name; `null` for `other` (`HANDOVER_LABEL_KEYS.other`) and `work`. */
  readonly name: string | null;
  readonly stages: readonly HandoverStageRow[];
  /** How many activities the section holds; `done` lists the finished ones. */
  readonly activities: number;
  readonly done: readonly HandoverDoneRow[];
  readonly decisions: readonly HandoverDecisionRow[];
  readonly hiddenWork: readonly HandoverHiddenPhoto[];
  /** In photos, first to last: the picked photos of its story not shown above, in story order. */
  readonly photos: readonly HandoverStoryPhoto[];
  /** The photos of that story the pick left out. */
  readonly photosNotShown: number;
  /** That story's first and last day, before picking; `null` when it has no photo. */
  readonly storyFirst: string | null;
  readonly storyLast: string | null;
  /** How many photos that story holds before picking: `photos` plus `photosNotShown`. */
  readonly storyCount: number;
  /** The snags of the section fixed, by number, with both photos (slice E4). */
  readonly snagsFixed: readonly HandoverSnagRow[];
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

/** A warranty as the book prints it (slice G4): what, what it covers, who gives it, from and to. */
export interface HandoverWarrantyRow extends AftercareTarget {
  readonly warrantyId: string;
  readonly title: string;
  readonly givenBy: string | null;
  /** `YYYY-MM-DD`. */
  readonly startsOn: string;
  readonly months: number;
  /** The last day it covers; `null` when it cannot be read. */
  readonly endsOn: string | null;
  /** Its filed document; `null` when none is filed. */
  readonly document: AftercareDocument | null;
  readonly note: string | null;
}

/** One time a task was done, as the book prints it. */
export interface HandoverDoneRecord {
  readonly seq: number;
  /** `YYYY-MM-DD`. */
  readonly doneOn: string;
  readonly note: string | null;
  readonly authorName: string;
}

/** A maintenance task as the book prints it (slice G4): what, how often, next due, its record. */
export interface HandoverMaintenanceRow extends AftercareTarget {
  readonly taskId: string;
  readonly title: string;
  readonly everyMonths: number;
  readonly firstDueOn: string;
  /** The day it is next due: the first due day, or months after it was last done. */
  readonly nextDueOn: string | null;
  readonly note: string | null;
  /** Every time it was done, by seq; empty while it never was. */
  readonly done: readonly HandoverDoneRecord[];
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
  /** The warranties, by target then position (slice G4, `aftercareOrder`). */
  readonly warranties: readonly HandoverWarrantyRow[];
  /** The maintenance tasks, by target then position, each with its record (slice G4). */
  readonly maintenance: readonly HandoverMaintenanceRow[];
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
  const images = imagesOf(snapshot);
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

/** Every answer's photo on a check that needs one, of these stages, in check order, each once. */
function hiddenWorkOf(reading: Reading, stages: readonly Stage[]): HandoverHiddenPhoto[] {
  const photos: HandoverHiddenPhoto[] = [];
  const seen = new Set<string>();
  for (const { stage, check, answer, photoHash } of hiddenAnswersOf(reading.snapshot, stages)) {
    if (seen.has(photoHash)) continue;
    const fileName = reading.images.get(photoHash);
    if (fileName === undefined) continue;
    seen.add(photoHash);
    photos.push({
      photoHash,
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
  return photos;
}

/**
 * The fixed snags of a section, by number: those naming one of its activities, and those naming no
 * activity (or one no longer in the plan) whose stage is one of its stages.
 */
function snagsFixedOf(reading: Reading, scope: Scope): HandoverSnagRow[] {
  const { snapshot, images } = reading;
  const activities = new Map(snapshot.activities.map((activity) => [activity.id, activity]));
  const people = new Map(snapshot.people.map((person) => [person.id, person.name]));
  const photo = (hash: string | null): HandoverPhoto | null => {
    if (hash === null) return null;
    const fileName = images.get(hash);
    return fileName === undefined ? null : { photoHash: hash, fileName };
  };
  const rows: HandoverSnagRow[] = [];
  for (const snag of snagsInOrder(snapshot)) {
    const closure = snag.closure;
    if (closure === null || closure.outcome !== 'fixed') continue;
    if (!snagIn(scope, snag, activities)) continue;
    const activity = snag.activityId === null ? undefined : activities.get(snag.activityId);
    rows.push({
      snagId: snag.id,
      number: snag.number,
      title: snag.title,
      description: snag.description,
      stageId: snag.stageId,
      stageName: reading.stageById.get(snag.stageId)?.name ?? null,
      activityId: snag.activityId,
      activityName: activity?.name ?? null,
      personId: snag.personId,
      personName: snag.personId === null ? null : (people.get(snag.personId) ?? null),
      raisedOn: snag.raisedOn,
      closedOn: closure.closedOn,
      before: photo(snag.photoHash),
      after: photo(closure.photoHash),
      note: closure.note,
    });
  }
  return rows;
}

/** What a section shows before its story in photos is picked. */
interface Shown {
  readonly scope: Scope;
  readonly hiddenWork: readonly HandoverHiddenPhoto[];
  readonly snagsFixed: readonly HandoverSnagRow[];
  /** Its story, minus what its hidden work and its snags fixed already show. */
  readonly rest: readonly StoryPhoto[];
}

/** The photos a section's hidden work and snags fixed show. */
function fixedPhotos(
  hiddenWork: readonly HandoverHiddenPhoto[],
  snagsFixed: readonly HandoverSnagRow[],
): string[] {
  return [
    ...hiddenWork.map((photo) => photo.photoHash),
    ...snagsFixed.flatMap((row) =>
      [row.before, row.after].flatMap((photo) => (photo === null ? [] : [photo.photoHash])),
    ),
  ];
}

function shownOf(reading: Reading, scope: Scope, story: readonly StoryPhoto[]): Shown {
  const hiddenWork = hiddenWorkOf(reading, scope.stages);
  const snagsFixed = snagsFixedOf(reading, scope);
  const taken = new Set(fixedPhotos(hiddenWork, snagsFixed));
  return {
    scope,
    hiddenWork,
    snagsFixed,
    rest: story.filter((photo) => !taken.has(photo.photoHash)),
  };
}

function section(reading: Reading, shown: Shown, limit: number): HandoverSection {
  const { snapshot } = reading;
  const { scope, hiddenWork, snagsFixed, rest } = shown;
  const stageIds = scope.stageIds;

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

  const picked = pickStory(rest, limit);

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
    photos: picked.shown,
    photosNotShown: picked.notShown,
    storyFirst: rest[0]?.day ?? null,
    storyLast: rest.at(-1)?.day ?? null,
    storyCount: rest.length,
    snagsFixed,
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

/** The warranties, by target then position, each with its end and its document. */
function warrantiesOfBook(snapshot: WorkSnapshot): HandoverWarrantyRow[] {
  return warrantiesInOrder(snapshot).map((warranty) => ({
    ...describeAftercareTarget(snapshot, warranty.targetKind, warranty.targetId),
    warrantyId: warranty.id,
    title: warranty.title,
    givenBy: warranty.givenBy,
    startsOn: warranty.startsOn,
    months: warranty.months,
    endsOn: warrantyEndsOn(warranty),
    document: aftercareDocumentOf(snapshot, warranty.documentId),
    note: warranty.note,
  }));
}

/** The maintenance tasks, by target then position, each with its next due day and its record. */
function maintenanceOfBook(snapshot: WorkSnapshot): HandoverMaintenanceRow[] {
  return maintenanceInOrder(snapshot).map((task) => {
    const story = maintenanceStory(task);
    return {
      ...describeAftercareTarget(snapshot, task.targetKind, task.targetId),
      taskId: task.id,
      title: task.title,
      everyMonths: task.everyMonths,
      firstDueOn: task.firstDueOn,
      nextDueOn: story.nextDueOn,
      note: task.note,
      done: story.records.map((record) => ({
        seq: record.seq,
        doneOn: record.doneOn,
        note: record.note,
        authorName: record.authorName,
      })),
    };
  });
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

  // Still to fix: every open snag, by number, whatever its stage.
  for (const snag of snagsInOrder(snapshot)) {
    if (snag.closure === null) {
      rows.push({
        ...gap('snag-open', `snag-open:${snag.id}`, snag.id, snag.title),
        day: snag.dueOn,
      });
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

/**
 * The sections, each with its story in photos picked: up to `HANDOVER_STORY_LIMIT` each, within
 * what hidden work and snags leave of `HANDOVER_IMAGE_CAP`, spread round by round. It counts
 * places, not distinct photos — a photo in two sections counts twice — so the book never passes
 * the cap while hidden work and snags alone do not.
 */
function sectionsOf(reading: Reading): { by: HandoverBy; sections: HandoverSection[] } {
  const found = scopes(reading.snapshot);
  const fallback = fallbackScope(found.by);
  const told = storyOfScopes(reading, found.scopes, fallback);
  const all =
    found.scopes.some((each) => each.key === fallback.key) ||
    (told.get(fallback.key)?.length ?? 0) === 0
      ? found.scopes
      : [...found.scopes, fallback];

  const shown = all.map((scope) => shownOf(reading, scope, told.get(scope.key) ?? []));
  const fixed = new Set(shown.flatMap((each) => fixedPhotos(each.hiddenWork, each.snagsFixed)));
  const limits = allotStory(
    shown.map((each) => each.rest.length),
    HANDOVER_IMAGE_CAP - fixed.size,
    HANDOVER_STORY_LIMIT,
  );
  return {
    by: found.by,
    sections: shown.map((each, i) => section(reading, each, limits[i]!)),
  };
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
    warranties: warrantiesOfBook(snapshot),
    maintenance: maintenanceOfBook(snapshot),
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
