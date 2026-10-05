/**
 * The work told in photos (slice G6, decision 1): every photo the work collected, section by
 * section, each section a timeline from its first photo to its last.
 *
 * A pure selection, in keys and rows, never text. The Diary's "In photos" view shows every photo
 * of it; the handover book and the owner's snapshot pick from it (`pickStory`, `storyBudget`).
 *
 * - **The sections** are the handover book's (`sections.ts`): rooms in room order when the work
 *   has rooms, then `other`; otherwise stages in stage order. A section with no photo has no story
 *   and is not in it: nothing is invented or filled in.
 * - **The photos**, each one the work holds as an image, and only from entries that speak for their
 *   day (effective entries):
 *   - a **diary** photo, on the entry's day, in every section holding an activity its done lines
 *     name, with those activities' names (`activityNames`, in the section's order) and the stage
 *     of the first of them;
 *   - a **hidden-work** photo — every answer's photo on a check that needs one (`needsPhoto`) — on
 *     the day it was answered, in every section its stage is in. A photo on a check that needs
 *     none is not hidden work, and is not told;
 *   - a **snag's problem** photo on the day it was raised, and its **fix** photo on the day it was
 *     fixed, where the snag is (its activity's sections, or its stage's). A withdrawn snag was
 *     raised by mistake, and is not told.
 * - **What no section takes** is told in the last section (`fallbackScope`): **`other`** when the
 *   work has rooms, the **whole work** (`work`) when it has none. That is where a diary entry
 *   naming no activity goes — or naming only activities no section holds — with no activity name.
 * - **The order** is by day, then kind — hidden work, a snag's problem, a snag's fix, then the
 *   diary: what a check or a snag says a photo is comes before the day's diary — then entry seq,
 *   then position (a photo's place in its entry, check order and answer seq, snag number).
 * - **Each photo once per section**, where it first comes in that order. A photo that shows two
 *   rooms is in both rooms' stories.
 * - **Each section's facts**: its first and last day, how many photos, and how many calendar
 *   months they span (the first's month and the last's, both counted).
 *
 * `pickStory` keeps the first and the last and spaces the rest evenly by position; `storyBudget`
 * spreads one budget over the sections, round by round, so every section with photos has its
 * first and its last before any has a third.
 *
 * What this module is not: text, layout, thumbnails or I/O. It never judges a photo: the dull
 * middle one can be picked over a telling one.
 */

import { activitiesInOrder, compareText, stagesInOrder, type WorkSnapshot } from '../plan';
import { effectiveEntries, type DiaryEntry } from '../diary';
import { snagsInOrder } from '../snags';
import {
  fallbackScope,
  hiddenAnswersOf,
  imagesOf,
  namedBy,
  namedIn,
  scopes,
  snagIn,
  type Scope,
  type ScopeBy,
  type ScopeKind,
} from './sections';

/** What a photo of the story is. */
export type StoryPhotoKind = 'diary' | 'hidden-work' | 'snag-problem' | 'snag-fix';

export const STORY_KIND_KEYS = {
  /** A photo from the diary. */
  diary: 'story.kind.diary',
  /** A photo of work before it was covered, on a check. */
  'hidden-work': 'story.kind.hiddenWork',
  /** "Snag #{number} — the problem". */
  'snag-problem': 'story.kind.snagProblem',
  /** "Snag #{number} — fixed". */
  'snag-fix': 'story.kind.snagFix',
} as const satisfies Record<StoryPhotoKind, string>;

export const STORY_LABEL_KEYS = {
  /** The last section's title when the work has rooms: what touches no room. */
  other: 'story.section.other',
  /** The last section's title when the work has no rooms: what no stage takes. */
  work: 'story.section.work',
} as const;

/** Every message key this module names, for the dictionary test. */
export const STORY_MESSAGE_KEYS: readonly string[] = [
  ...Object.values(STORY_KIND_KEYS),
  ...Object.values(STORY_LABEL_KEYS),
];

const KIND_ORDER: Record<StoryPhotoKind, number> = {
  'hidden-work': 0,
  'snag-problem': 1,
  'snag-fix': 2,
  diary: 3,
};

// ── The shapes ───────────────────────────────────────────────────────────────

/** How the story is divided: by room when the work has rooms, by stage otherwise. */
export type StoryBy = ScopeBy;

export type StorySectionKind = ScopeKind;

/** One photo of the story, with what a caption needs. */
export interface StoryPhoto {
  readonly photoHash: string;
  /** The document's file name. */
  readonly fileName: string;
  /** `YYYY-MM-DD`: the entry's day, the answer's, the day the snag was raised or fixed. */
  readonly day: string;
  readonly kind: StoryPhotoKind;
  /** The diary entry it came with; `null` for any other kind. */
  readonly entrySeq: number | null;
  /**
   * What it shows, by name: for a diary photo, the activities its entry names that this section
   * holds (none in the last section for an entry naming none); for a snag's, the snag's activity
   * when it names one the plan has; none for hidden work.
   */
  readonly activityNames: readonly string[];
  /** The stage: the check's, the snag's, or a diary photo's first activity's; `null` when gone. */
  readonly stageName: string | null;
  /** The check, for hidden work; `null` otherwise. */
  readonly checkName: string | null;
  /** The snag, for a snag's photos; `null` otherwise. */
  readonly snagNumber: number | null;
  readonly snagTitle: string | null;
}

export interface StorySection {
  /** `room:<id>`, `stage:<id>`, `other` or `work`. */
  readonly key: string;
  readonly kind: StorySectionKind;
  /** The room's or the stage's id; `null` for `other` and `work`. */
  readonly id: string | null;
  /** The room's or the stage's name; `null` for `other` and `work` (see `labelKey`). */
  readonly name: string | null;
  /** The title's key for `other` and `work`; `null` for a room or a stage. */
  readonly labelKey: (typeof STORY_LABEL_KEYS)[keyof typeof STORY_LABEL_KEYS] | null;
  /** First to last; never empty. */
  readonly photos: readonly StoryPhoto[];
  /** `YYYY-MM-DD`, the first photo's day and the last's. */
  readonly first: string;
  readonly last: string;
  readonly count: number;
  /** How many calendar months the photos span, the first's and the last's both counted. */
  readonly months: number;
}

export interface Story {
  readonly by: StoryBy;
  /** Only the sections with photos, in section order. */
  readonly sections: readonly StorySection[];
  /** Distinct photos in the whole story; 0 when the work has none. */
  readonly count: number;
}

// ── Telling ──────────────────────────────────────────────────────────────────

/** What the telling reads: the plan, the entries that speak for their day, the images held. */
export interface StoryInput {
  readonly snapshot: WorkSnapshot;
  readonly effective: readonly DiaryEntry[];
  readonly images: ReadonlyMap<string, string>;
}

interface Draft {
  readonly photo: StoryPhoto;
  /** Its place inside its kind: entry photo position, check order and seq, snag number. */
  readonly order: number;
}

const compareDrafts = (a: Draft, b: Draft): number =>
  compareText(a.photo.day, b.photo.day) ||
  KIND_ORDER[a.photo.kind] - KIND_ORDER[b.photo.kind] ||
  (a.photo.entrySeq ?? 0) - (b.photo.entrySeq ?? 0) ||
  a.order - b.order;

/**
 * Every section's photos, first to last, each once, keyed by section key — the fallback's too,
 * when something falls to it. A section with no photo has an empty list. The one place a photo is
 * attributed: the handover book reads its sections' photos from here.
 */
export function storyOfScopes(
  input: StoryInput,
  sections: readonly Scope[],
  fallback: Scope,
): Map<string, StoryPhoto[]> {
  const { snapshot, images } = input;
  const drafts = new Map<string, Draft[]>(sections.map((each) => [each.key, []]));
  const place = (targets: readonly Scope[], order: number, make: (target: Scope) => StoryPhoto) => {
    for (const target of targets.length > 0 ? targets : [fallback]) {
      const list = drafts.get(target.key) ?? [];
      list.push({ photo: make(target), order });
      drafts.set(target.key, list);
    }
  };
  const stageNames = new Map(snapshot.stages.map((stage) => [stage.id, stage.name]));
  const stageName = (stageId: string) => stageNames.get(stageId) ?? null;
  let order = 0;

  // Hidden work: in check order, each answer by seq.
  for (const hidden of hiddenAnswersOf(snapshot, stagesInOrder(snapshot))) {
    const fileName = images.get(hidden.photoHash);
    if (fileName === undefined) continue;
    order += 1;
    place(
      sections.filter((each) => each.stageIds.has(hidden.stage.id)),
      order,
      () => ({
        photoHash: hidden.photoHash,
        fileName,
        day: hidden.answer.answeredAt.slice(0, 10),
        kind: 'hidden-work',
        entrySeq: null,
        activityNames: [],
        stageName: hidden.stage.name,
        checkName: hidden.check.name,
        snagNumber: null,
        snagTitle: null,
      }),
    );
  }

  // Snags, by number: the problem, then the fix.
  const activities = new Map(snapshot.activities.map((activity) => [activity.id, activity]));
  for (const snag of snagsInOrder(snapshot)) {
    if (snag.closure?.outcome === 'withdrawn') continue;
    const targets = sections.filter((each) => snagIn(each, snag, activities));
    const activity = snag.activityId === null ? undefined : activities.get(snag.activityId);
    const photo = (hash: string | null, day: string, kind: StoryPhotoKind) => {
      const fileName = hash === null ? undefined : images.get(hash);
      if (hash === null || fileName === undefined) return;
      order += 1;
      place(targets, order, () => ({
        photoHash: hash,
        fileName,
        day,
        kind,
        entrySeq: null,
        activityNames: activity === undefined ? [] : [activity.name],
        stageName: stageName(snag.stageId),
        checkName: null,
        snagNumber: snag.number,
        snagTitle: snag.title,
      }));
    };
    photo(snag.photoHash, snag.raisedOn, 'snag-problem');
    if (snag.closure?.outcome === 'fixed') {
      photo(snag.closure.photoHash, snag.closure.closedOn, 'snag-fix');
    }
  }

  // The diary: the entries that speak for their day, each photo in its place.
  const planOrder = activitiesInOrder(snapshot);
  for (const entry of input.effective) {
    const named = namedBy(entry);
    const targets = sections.filter((each) => namedIn(each, named).length > 0);
    const where = targets.length > 0 ? targets : [fallback];
    const names = new Map(
      where.map((target) => [
        target.key,
        targets.length > 0
          ? namedIn(target, named)
          : planOrder.filter((activity) => named.has(activity.id)),
      ]),
    );
    entry.photos.forEach((photo, position) => {
      const fileName = images.get(photo.fileHash);
      if (fileName === undefined) return;
      place(where, position, (target) => {
        const own = names.get(target.key) ?? [];
        return {
          photoHash: photo.fileHash,
          fileName,
          day: entry.day,
          kind: 'diary',
          entrySeq: entry.seq,
          activityNames: own.map((activity) => activity.name),
          stageName: own.length > 0 ? stageName(own[0]!.stageId) : null,
          checkName: null,
          snagNumber: null,
          snagTitle: null,
        };
      });
    });
  }

  const result = new Map<string, StoryPhoto[]>();
  for (const [key, list] of drafts) {
    const seen = new Set<string>();
    const told: StoryPhoto[] = [];
    for (const { photo } of [...list].sort(compareDrafts)) {
      if (seen.has(photo.photoHash)) continue;
      seen.add(photo.photoHash);
      told.push(photo);
    }
    result.set(key, told);
  }
  return result;
}

/** How many calendar months two days span, both months counted. */
function monthsBetween(first: string, last: string): number {
  const index = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7));
  return index(last) - index(first) + 1;
}

/** The work told in photos, section by section, from the plan and every diary entry. */
export function photoStory(snapshot: WorkSnapshot, entries: readonly DiaryEntry[]): Story {
  const found = scopes(snapshot);
  const fallback = fallbackScope(found.by);
  const told = storyOfScopes(
    { snapshot, effective: effectiveEntries(entries), images: imagesOf(snapshot) },
    found.scopes,
    fallback,
  );
  const ordered = found.scopes.some((each) => each.key === fallback.key)
    ? found.scopes
    : [...found.scopes, fallback];

  const sections: StorySection[] = [];
  const all = new Set<string>();
  for (const each of ordered) {
    const photos = told.get(each.key) ?? [];
    if (photos.length === 0) continue;
    for (const photo of photos) all.add(photo.photoHash);
    const first = photos[0]!.day;
    const last = photos.at(-1)!.day;
    sections.push({
      key: each.key,
      kind: each.kind,
      id: each.id,
      name: each.name,
      labelKey:
        each.kind === 'other'
          ? STORY_LABEL_KEYS.other
          : each.kind === 'work'
            ? STORY_LABEL_KEYS.work
            : null,
      photos,
      first,
      last,
      count: photos.length,
      months: monthsBetween(first, last),
    });
  }
  return { by: found.by, sections, count: all.size };
}

// ── Picking ──────────────────────────────────────────────────────────────────

/** What a pick shows, in story order, and how many it leaves out. */
export interface StoryPick<T> {
  readonly shown: readonly T[];
  readonly notShown: number;
}

/**
 * At most `limit` of `photos`, in their order. All of them when they fit. Otherwise the first and
 * the last always, and the rest evenly spaced by position — index `round(i × (n − 1) / (limit −
 * 1))`, a duplicate moved to the next unused index. A limit of 1 shows the first only; a limit of
 * 0 or less, none. Deterministic: the same photos and limit pick the same.
 */
export function pickStory<T>(photos: readonly T[], limit: number): StoryPick<T> {
  const n = photos.length;
  const wanted = Math.floor(limit);
  if (n <= wanted) return { shown: [...photos], notShown: 0 };
  if (wanted <= 0) return { shown: [], notShown: n };
  if (wanted === 1) return { shown: [photos[0]!], notShown: n - 1 };

  const used = new Set<number>();
  for (let i = 0; i < wanted; i += 1) {
    let index = Math.round((i * (n - 1)) / (wanted - 1));
    while (used.has(index) && index < n - 1) index += 1;
    while (used.has(index)) index -= 1;
    used.add(index);
  }
  const shown = [...used].sort((a, b) => a - b).map((index) => photos[index]!);
  return { shown, notShown: n - shown.length };
}

/**
 * How many each count gets of `total`, at most `perSection` each: round by round in order — the
 * first of each, then the second of each, and so on — so every one gets `min(2, its count)` before
 * any gets a third, whenever the total allows. Where it does not, the earlier ones come first.
 */
export function allotStory(counts: readonly number[], total: number, perSection: number): number[] {
  const caps = counts.map((count) =>
    Math.max(0, Math.min(Math.floor(count), Math.floor(perSection))),
  );
  const given = caps.map(() => 0);
  let left = Math.max(0, Math.floor(total));
  const deepest = Math.max(0, ...caps);
  for (let round = 1; round <= deepest && left > 0; round += 1) {
    for (let i = 0; i < caps.length && left > 0; i += 1) {
      if (caps[i]! >= round) {
        given[i] = round;
        left -= 1;
      }
    }
  }
  return given;
}

/** One section's share of a budget, and what it picks with it. */
export interface StoryBudgetRow extends StoryPick<StoryPhoto> {
  readonly section: StorySection;
  /** How many photos it may show. */
  readonly allotted: number;
}

/**
 * A total photo budget spread over the story's sections (the owner's snapshot, decision 4): each
 * section with photos gets `min(2, its count)` first — its first and its last — then the rest
 * round by round, up to `perSection`; each then picks with `pickStory`. One row per section, in
 * order. Deterministic. When the total cannot give every section two, the earlier sections get
 * theirs first, and a section left with none says how many it leaves out.
 */
export function storyBudget(story: Story, total: number, perSection: number): StoryBudgetRow[] {
  const allotted = allotStory(
    story.sections.map((section) => section.count),
    total,
    perSection,
  );
  return story.sections.map((section, i) => ({
    section,
    allotted: allotted[i]!,
    ...pickStory(section.photos, allotted[i]!),
  }));
}
