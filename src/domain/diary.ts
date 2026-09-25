/**
 * The diary: what actually happened on site, day by day, and everything the plan derives from it.
 *
 * **The plan is intent; the diary is fact.** Nobody types progress. An entry says, for one day,
 * which activities were worked on or finished (and how much), who was on site, the weather,
 * deliveries, incidents, visitors, hours, photos; and progress, actual dates, days lost to weather
 * and days nobody wrote anything are all worked out here, from the entries.
 *
 * **An entry is never edited: it is corrected.** A correction is a new entry that names the one it
 * corrects and restates the day in full. For everything derived, an entry that has been corrected
 * contributes nothing; the latest statement in its family (the original, its corrections, their
 * corrections) contributes instead. The originals stay in the record, struck through on screen.
 * There is no function here that changes an entry, because there is no such thing.
 *
 * **Progress is a state, not a number anyone typed.** An activity is not started, started (the diary
 * says it was worked on) or finished (the diary says so). A share is given only when both the
 * activity's quantity and the quantities done exist, and never reads 100 before the diary says
 * finished. Otherwise there is no percent: none is invented.
 *
 * **Today is an input**, as everywhere in the domain.
 *
 * What this module is not: the chain. Each entry carries its hash and the previous one's, and the
 * host computes and verifies them (SHA-256, `diary_verify`); the domain only carries them. Nor is it
 * storage, or text: it returns rows, codes and figures.
 */

import { addCalendarDays, isIsoDay, isWorkingDay, type WorkingCalendar } from './calendar';
import { counted, type Figure, type ReportRow } from './figure';
import { activitiesInOrder, compareText, stagesInOrder, type WorkSnapshot } from './plan';

// ── The host's contract ──────────────────────────────────────────────────────

export const WEATHER = ['sun', 'cloud', 'rain', 'storm', 'wind', 'other'] as const;
export type Weather = (typeof WEATHER)[number];

/** What an entry says of one activity: it was worked on that day, or finished. */
export type DoneState = 'worked' | 'finished';

export interface DoneLine {
  readonly activityId: string;
  readonly state: DoneState;
  /** How much was done that day, in the activity's unit; `null` when not said. */
  readonly quantity: number | null;
  readonly note: string | null;
}

/** A photo the work owns: copied into its folder by the host, named by its hash. */
export interface Photo {
  readonly fileHash: string;
  readonly fileName: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  /** Whether a thumbnail could be made. A photo without one is kept, and the row says so. */
  readonly thumbnail: boolean;
}

export type EntryKind = 'entry' | 'correction';

/** One entry of the diary: a fact about one day. Insert-only, chained by hash. */
export interface DiaryEntry {
  /** 1, 2, 3 …: the order entries were written. */
  readonly seq: number;
  /** The day it is about, `YYYY-MM-DD`; never in the future. */
  readonly day: string;
  readonly kind: EntryKind;
  /** For a correction, the entry it corrects; `null` for an entry. */
  readonly correctsSeq: number | null;
  readonly note: string | null;
  readonly weather: Weather | null;
  /** No work was possible that day. */
  readonly lostDay: boolean;
  readonly hours: number | null;
  readonly deliveries: string | null;
  readonly incidents: string | null;
  readonly visitors: string | null;
  /** The Windows account that wrote it, as the host read it. The product has no accounts. */
  readonly authorName: string;
  readonly createdAt: string;
  /** The previous entry's hash; `''` for the first. Carried, never checked here. */
  readonly prevHash: string;
  readonly hash: string;
  readonly done: readonly DoneLine[];
  /** The ids of the people on site. */
  readonly present: readonly string[];
  readonly photos: readonly Photo[];
}

/** A new entry as the interface asks the host to write it. */
export interface EntryDraft {
  readonly day: string;
  readonly kind: EntryKind;
  readonly correctsSeq: number | null;
  readonly note: string | null;
  readonly weather: Weather | null;
  readonly lostDay: boolean;
  readonly hours: number | null;
  readonly deliveries: string | null;
  readonly incidents: string | null;
  readonly visitors: string | null;
  readonly done: readonly DoneLine[];
  readonly present: readonly string[];
  /** Files the person chose, which the host copies in under its caps. */
  readonly photoPaths: readonly string[];
  /** Photos already in the work, attached again by hash (a correction restating the day). */
  readonly photoHashes: readonly string[];
}

// ── Corrections ──────────────────────────────────────────────────────────────

/** By seq, ascending, without changing what was given. */
function bySeq(entries: readonly DiaryEntry[]): DiaryEntry[] {
  return [...entries].sort((a, b) => a.seq - b.seq);
}

/**
 * The original an entry belongs to: follow `correctsSeq` back to an entry that corrects nothing.
 * A correction that names a seq that is not there, or not earlier than itself, is its own
 * original: it is kept, never dropped.
 */
function rootsOf(entries: readonly DiaryEntry[]): Map<number, number> {
  const bySeqMap = new Map(entries.map((entry) => [entry.seq, entry]));
  const root = new Map<number, number>();
  for (const entry of bySeq(entries)) {
    const target = entry.correctsSeq;
    const corrected = target === null ? undefined : bySeqMap.get(target);
    root.set(
      entry.seq,
      corrected !== undefined && corrected.seq < entry.seq ? root.get(corrected.seq)! : entry.seq,
    );
  }
  return root;
}

/**
 * The entries that speak for their day: for every original, the latest statement in its family
 * (itself if nobody corrected it, otherwise the correction with the highest seq, whichever entry of
 * the family it names). In seq order. Everything derived reads these, and only these.
 */
export function effectiveEntries(entries: readonly DiaryEntry[]): DiaryEntry[] {
  const root = rootsOf(entries);
  const latest = new Map<number, DiaryEntry>();
  for (const entry of bySeq(entries)) latest.set(root.get(entry.seq)!, entry);
  return [...latest.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Which entry corrected each corrected entry: the correction with the highest seq that names it
 * directly. What the day view shows as "corrected by #N". An entry nobody corrected is absent.
 */
export function correctedBy(entries: readonly DiaryEntry[]): Map<number, number> {
  const seqs = new Set(entries.map((entry) => entry.seq));
  const result = new Map<number, number>();
  for (const entry of bySeq(entries)) {
    const target = entry.correctsSeq;
    if (target !== null && seqs.has(target) && target < entry.seq) result.set(target, entry.seq);
  }
  return result;
}

/** Every entry grouped by its day, newest day first, the entries of a day in seq order. */
export function entriesByDay(
  entries: readonly DiaryEntry[],
): Array<{ day: string; entries: DiaryEntry[] }> {
  const days = new Map<string, DiaryEntry[]>();
  for (const entry of bySeq(entries)) {
    const list = days.get(entry.day);
    if (list === undefined) days.set(entry.day, [entry]);
    else list.push(entry);
  }
  return [...days.entries()]
    .sort(([a], [b]) => compareText(b, a))
    .map(([day, list]) => ({ day, entries: list }));
}

// ── Progress ─────────────────────────────────────────────────────────────────

export type ProgressState = 'not-started' | 'started' | 'finished';

export interface ActivityProgress {
  readonly activityId: string;
  readonly state: ProgressState;
  /** The first day the diary says it was worked on or finished. */
  readonly startedOn: string | null;
  /** The first day the diary says it was finished. */
  readonly finishedOn: string | null;
  /** The last day the diary mentions it. */
  readonly lastOn: string | null;
  /** The quantities the diary says were done, added up; `null` when no line gave one. */
  readonly quantityDone: number | null;
  /**
   * Percent done, only when the activity has a quantity and the diary gave quantities: at most 99
   * until finished, 100 once finished. `null` otherwise: no percent is invented.
   */
  readonly share: number | null;
}

/**
 * Progress of every activity of the plan (plan order), from the effective entries. Lines naming an
 * activity that is not in the plan are not anyone's progress.
 */
export function progress(
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
): Map<string, ActivityProgress> {
  const lines = new Map<string, Array<{ day: string; line: DoneLine }>>();
  const ordered = effectiveEntries(entries).sort(
    (a, b) => compareText(a.day, b.day) || a.seq - b.seq,
  );
  for (const entry of ordered) {
    for (const line of entry.done) {
      const list = lines.get(line.activityId);
      if (list === undefined) lines.set(line.activityId, [{ day: entry.day, line }]);
      else list.push({ day: entry.day, line });
    }
  }

  const result = new Map<string, ActivityProgress>();
  for (const activity of activitiesInOrder(snapshot)) {
    const said = lines.get(activity.id) ?? [];
    const finished = said.find(({ line }) => line.state === 'finished');
    const state: ProgressState =
      finished !== undefined ? 'finished' : said.length > 0 ? 'started' : 'not-started';
    const quantities = said
      .map(({ line }) => line.quantity)
      .filter((quantity): quantity is number => quantity !== null && Number.isFinite(quantity));
    const quantityDone =
      quantities.length === 0 ? null : quantities.reduce((sum, quantity) => sum + quantity, 0);
    const planned = activity.quantity;
    let share: number | null = null;
    if (planned !== null && planned > 0 && quantityDone !== null) {
      share = state === 'finished' ? 100 : Math.min(99, Math.round((100 * quantityDone) / planned));
    }
    result.set(activity.id, {
      activityId: activity.id,
      state,
      startedOn: said[0]?.day ?? null,
      finishedOn: finished?.day ?? null,
      lastOn: said.at(-1)?.day ?? null,
      quantityDone,
      share,
    });
  }
  return result;
}

export interface StageProgress {
  readonly stageId: string;
  readonly notStarted: number;
  readonly started: number;
  readonly finished: number;
  readonly total: number;
}

/** How many activities of each stage are in each state, stage by stage in plan order. */
export function stageProgress(
  snapshot: WorkSnapshot,
  progressById: ReadonlyMap<string, ActivityProgress>,
): StageProgress[] {
  return stagesInOrder(snapshot).map((stage) => {
    const states = snapshot.activities
      .filter((activity) => activity.stageId === stage.id)
      .map((activity) => progressById.get(activity.id)?.state ?? 'not-started');
    return {
      stageId: stage.id,
      notStarted: states.filter((state) => state === 'not-started').length,
      started: states.filter((state) => state === 'started').length,
      finished: states.filter((state) => state === 'finished').length,
      total: states.length,
    };
  });
}

// ── Days ─────────────────────────────────────────────────────────────────────

/**
 * The working days nobody wrote anything about, from the later of the work's start and the first
 * entry, up to yesterday: today is not over, so it is not yet a day without an entry. A day counts
 * as written when an effective entry is about it (a correction that moved an entry to another day
 * moves it too). Oldest first.
 */
export function daysWithoutEntry(
  calendar: WorkingCalendar,
  today: string,
  workStart: string,
  entries: readonly DiaryEntry[],
): string[] {
  if (!isIsoDay(today) || !isIsoDay(workStart)) return [];
  const effective = effectiveEntries(entries);
  const written = new Set(effective.map((entry) => entry.day));
  const first = effective.reduce<string | null>(
    (earliest, entry) => (earliest === null || entry.day < earliest ? entry.day : earliest),
    null,
  );
  const from = first !== null && first > workStart ? first : workStart;
  const days: string[] = [];
  for (let day = from; day < today; day = addCalendarDays(day, 1)) {
    if (isWorkingDay(calendar, day) && !written.has(day)) days.push(day);
  }
  return days;
}

/** The days an effective entry says no work was possible, oldest first, each once. */
export function lostDays(entries: readonly DiaryEntry[]): string[] {
  const days = new Set(
    effectiveEntries(entries)
      .filter((entry) => entry.lostDay)
      .map((entry) => entry.day),
  );
  return [...days].sort();
}

export interface ThisWeek {
  /** The seven calendar days ending today. */
  readonly from: string;
  readonly to: string;
  /** Days with an effective entry, oldest first. */
  readonly days: readonly string[];
  /** The people any of those entries says were on site, each once, in the order first seen. */
  readonly people: readonly string[];
  /** Those entries, in seq order. */
  readonly entries: readonly DiaryEntry[];
}

/** This week on site: the effective entries of the seven calendar days ending today. */
export function thisWeek(entries: readonly DiaryEntry[], today: string): ThisWeek {
  const from = isIsoDay(today) ? addCalendarDays(today, -6) : today;
  const inWeek = effectiveEntries(entries).filter(
    (entry) => entry.day >= from && entry.day <= today,
  );
  return {
    from,
    to: today,
    days: [...new Set(inWeek.map((entry) => entry.day))].sort(),
    people: [...new Set(inWeek.flatMap((entry) => entry.present))],
    entries: inWeek,
  };
}

// ── Checking a draft before the host is asked ────────────────────────────────

/** Why a draft is refused. The interface turns each code into a sentence. */
export type DraftProblem =
  | { readonly code: 'invalid-day' }
  | { readonly code: 'future-day' }
  | { readonly code: 'unknown-activity'; readonly activityId: string }
  | { readonly code: 'unknown-person'; readonly personId: string }
  | { readonly code: 'correction-without-seq' }
  | { readonly code: 'entry-with-corrects' }
  | { readonly code: 'corrects-unknown'; readonly seq: number }
  | { readonly code: 'correction-note-empty' }
  | { readonly code: 'negative-quantity'; readonly activityId: string }
  | { readonly code: 'worked-and-finished'; readonly activityId: string }
  | { readonly code: 'duplicate-activity'; readonly activityId: string }
  | { readonly code: 'invalid-weather' }
  | { readonly code: 'invalid-hours' }
  | { readonly code: 'too-long'; readonly field: string };

const LIMITS = { note: 4000, deliveries: 2000, incidents: 2000, visitors: 2000, doneNote: 500 };

/**
 * Check a draft against today, the plan and the diary before the host is asked. Never throws;
 * every problem is reported, in the order of the form. An empty list means the host may be asked
 * (and will check again).
 *
 * Refused: a day that is not a day, or is after today; a done line or a person that is not in the
 * plan; a correction that names nothing, or a seq the diary does not have, or has no note saying
 * what was wrong; an entry that names a seq; a negative quantity; one activity said twice in one
 * entry (worked and finished at once is the named case); an unknown weather; hours outside 0–24;
 * text over its limit. A second entry on a day that has one is not a problem: it is added and
 * ordered after it. There is no replacement.
 */
export function validateDraft(
  draft: EntryDraft,
  today: string,
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
): DraftProblem[] {
  const problems: DraftProblem[] = [];

  if (!isIsoDay(draft.day)) problems.push({ code: 'invalid-day' });
  else if (isIsoDay(today) && draft.day > today) problems.push({ code: 'future-day' });

  if (draft.kind === 'correction') {
    if (draft.correctsSeq === null) {
      problems.push({ code: 'correction-without-seq' });
    } else if (!entries.some((entry) => entry.seq === draft.correctsSeq)) {
      problems.push({ code: 'corrects-unknown', seq: draft.correctsSeq });
    }
    if ((draft.note ?? '').trim() === '') problems.push({ code: 'correction-note-empty' });
  } else if (draft.correctsSeq !== null) {
    problems.push({ code: 'entry-with-corrects' });
  }

  const activityIds = new Set(snapshot.activities.map((activity) => activity.id));
  const seen = new Map<string, DoneState>();
  for (const line of draft.done) {
    if (!activityIds.has(line.activityId)) {
      problems.push({ code: 'unknown-activity', activityId: line.activityId });
    }
    if (line.quantity !== null && !(line.quantity >= 0)) {
      problems.push({ code: 'negative-quantity', activityId: line.activityId });
    }
    const before = seen.get(line.activityId);
    if (before !== undefined) {
      problems.push({
        code: before === line.state ? 'duplicate-activity' : 'worked-and-finished',
        activityId: line.activityId,
      });
    }
    seen.set(line.activityId, line.state);
    if ((line.note ?? '').length > LIMITS.doneNote)
      problems.push({ code: 'too-long', field: 'done.note' });
  }

  const personIds = new Set(snapshot.people.map((person) => person.id));
  for (const personId of draft.present) {
    if (!personIds.has(personId)) problems.push({ code: 'unknown-person', personId });
  }

  if (draft.weather !== null && !(WEATHER as readonly string[]).includes(draft.weather)) {
    problems.push({ code: 'invalid-weather' });
  }
  if (draft.hours !== null && !(draft.hours >= 0 && draft.hours <= 24)) {
    problems.push({ code: 'invalid-hours' });
  }
  for (const field of ['note', 'deliveries', 'incidents', 'visitors'] as const) {
    if ((draft[field] ?? '').length > LIMITS[field]) problems.push({ code: 'too-long', field });
  }
  return problems;
}

// ── Figures ──────────────────────────────────────────────────────────────────

/** A row of the done figure: an activity in the state the figure counts. */
export interface DoneRow extends ReportRow {
  readonly activityId: string;
  readonly state: ProgressState;
  readonly startedOn: string | null;
  readonly finishedOn: string | null;
}

export const DONE_LABEL_KEYS = {
  finished: 'diary.figure.finished',
  started: 'diary.figure.started',
  'not-started': 'diary.figure.notStarted',
} as const satisfies Record<ProgressState, string>;

/**
 * The activities in one state (finished by default: "Done"), as a counted figure opening onto
 * them, in plan order. The three states' figures together hold every activity once.
 */
export function doneFigure(
  snapshot: WorkSnapshot,
  progressById: ReadonlyMap<string, ActivityProgress>,
  state: ProgressState = 'finished',
): Figure<DoneRow> {
  const rows: DoneRow[] = [];
  for (const activity of activitiesInOrder(snapshot)) {
    const known = progressById.get(activity.id);
    const current = known?.state ?? 'not-started';
    if (current !== state) continue;
    rows.push({
      key: `activity:${activity.id}`,
      itemId: activity.id,
      title: activity.name,
      day: known?.finishedOn ?? known?.startedOn ?? null,
      minutes: 0,
      activityId: activity.id,
      state: current,
      startedOn: known?.startedOn ?? null,
      finishedOn: known?.finishedOn ?? null,
    });
  }
  return counted(`done:${state}`, DONE_LABEL_KEYS[state], rows);
}

function dayRows(days: readonly string[]): ReportRow[] {
  return days.map((day) => ({ key: `day:${day}`, itemId: null, title: day, day, minutes: 0 }));
}

/** Working days without an entry, as a counted figure opening onto the days. */
export function daysWithoutEntryFigure(days: readonly string[]): Figure {
  return counted('days-without-entry', 'diary.figure.daysWithoutEntry', dayRows(days));
}

/** Days lost (no work was possible), as a counted figure opening onto the days. */
export function lostDaysFigure(days: readonly string[]): Figure {
  return counted('lost-days', 'diary.figure.lostDays', dayRows(days));
}
