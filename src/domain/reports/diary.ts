/**
 * The diary as a document: every entry, in the order it was written, for the record (slice F10,
 * decision 5).
 *
 * **Nothing is left out and nothing is merged.** An entry that was corrected is printed as it was
 * written, marked `corrected`, with the correction that corrected it (`correctedBySeq`) and the entry
 * that now speaks for its day (`supersededBySeq`); a correction is printed with the seq it corrects.
 * Exactly one entry of every family (an original, its corrections, their corrections) is
 * `effective`: the one everything the product derives reads (`effectiveEntries`). So the page shows
 * both what was said and what counts, and which is which.
 *
 * Names are resolved against the plan as it is now: an activity or person the plan no longer has
 * keeps its id and gets no name (`null`), never a guessed one. The chain is not checked here: the
 * host verifies it at the moment of writing (`diary_verify`) and prints that verification itself;
 * this module only carries each entry's hash and the previous one's.
 *
 * What this module is not: text, or the CSV (the host writes that from the file itself).
 */

import { breakdown } from '../arrangements';
import {
  correctedBy,
  effectiveEntries,
  rootsOf,
  type DiaryEntry,
  type DoneState,
  type EntryKind,
  type LostCause,
  type Weather,
} from '../diary';
import type { WorkSnapshot } from '../plan';

/** Whether an entry speaks for its day, or was corrected. */
export type DiaryRowStatus = 'effective' | 'corrected';

export const DIARY_ROW_STATUS_KEYS = {
  effective: 'reports.diary.status.effective',
  corrected: 'reports.diary.status.corrected',
} as const satisfies Record<DiaryRowStatus, string>;

/** One done line of an entry, with the activity's name and number as the plan has them now. */
export interface DiaryDoneLine {
  readonly activityId: string;
  /** `null` when the activity is no longer in the plan. */
  readonly name: string | null;
  /** The breakdown number (`1.2`); `null` when unnumbered or no longer in the plan. */
  readonly number: string | null;
  readonly state: DoneState;
  readonly quantity: number | null;
  /** The activity's unit, as the plan has it now; `null` when none (or no activity). */
  readonly unit: string | null;
  readonly note: string | null;
}

/** One person an entry says was on site. */
export interface DiaryPresent {
  readonly personId: string;
  /** `null` when the person is no longer in the plan. */
  readonly name: string | null;
}

/** One entry of the diary document. */
export interface DiaryReportRow {
  readonly seq: number;
  readonly day: string;
  readonly kind: EntryKind;
  /** For a correction, the seq it corrects; `null` for an entry. */
  readonly correctsSeq: number | null;
  /** `effective`: it speaks for its day now; `corrected`: a later entry does. */
  readonly status: DiaryRowStatus;
  /** The correction that names this entry, the latest one; `null` when none does. */
  readonly correctedBySeq: number | null;
  /** For a `corrected` entry, the entry that speaks for its family now; `null` when effective. */
  readonly supersededBySeq: number | null;
  readonly authorName: string;
  readonly createdAt: string;
  readonly weather: Weather | null;
  readonly lostDay: boolean;
  /** Why the day was lost, when the entry says (slice E3); `null` otherwise. */
  readonly lostCause: LostCause | null;
  /** Who the entry puts the lost day down to; `name` is `null` once they left the plan. */
  readonly lostParty: DiaryPresent | null;
  readonly hours: number | null;
  readonly note: string | null;
  readonly deliveries: string | null;
  readonly incidents: string | null;
  readonly visitors: string | null;
  readonly done: readonly DiaryDoneLine[];
  readonly present: readonly DiaryPresent[];
  readonly photoCount: number;
  /** The photos' file hashes, in the entry's order. */
  readonly photoHashes: readonly string[];
  readonly hash: string;
  readonly prevHash: string;
}

export interface DiaryReport {
  /** Every entry, by seq. */
  readonly rows: readonly DiaryReportRow[];
  /** How many entries were written, corrections included. */
  readonly written: number;
  readonly corrections: number;
  /** How many entries speak for their day: one per family. */
  readonly effective: number;
  /** The earliest and latest day any entry is about; `null` for an empty diary. */
  readonly firstDay: string | null;
  readonly lastDay: string | null;
  /** The hash of the last entry written (the chain's head); `null` for an empty diary. */
  readonly headHash: string | null;
}

/** The diary document's rows and its summary, from every entry and the plan as it is now. */
export function diaryReport(snapshot: WorkSnapshot, entries: readonly DiaryEntry[]): DiaryReport {
  const ordered = [...entries].sort((a, b) => a.seq - b.seq);
  const effective = effectiveEntries(ordered);
  const speaking = new Map<number, number>();
  const roots = rootsOf(ordered);
  for (const entry of effective) speaking.set(roots.get(entry.seq)!, entry.seq);
  const corrected = correctedBy(ordered);

  const activities = new Map(snapshot.activities.map((activity) => [activity.id, activity]));
  const numbers = new Map<string, string | null>();
  for (const row of breakdown(snapshot))
    if (row.kind === 'activity') numbers.set(row.id, row.number);
  const people = new Map(snapshot.people.map((person) => [person.id, person.name]));

  const rows = ordered.map((entry): DiaryReportRow => {
    const speaker = speaking.get(roots.get(entry.seq)!)!;
    const status: DiaryRowStatus = speaker === entry.seq ? 'effective' : 'corrected';
    return {
      seq: entry.seq,
      day: entry.day,
      kind: entry.kind,
      correctsSeq: entry.correctsSeq,
      status,
      correctedBySeq: corrected.get(entry.seq) ?? null,
      supersededBySeq: status === 'corrected' ? speaker : null,
      authorName: entry.authorName,
      createdAt: entry.createdAt,
      weather: entry.weather,
      lostDay: entry.lostDay,
      lostCause: entry.lostCause,
      lostParty:
        entry.lostPartyPersonId === null
          ? null
          : {
              personId: entry.lostPartyPersonId,
              name: people.get(entry.lostPartyPersonId) ?? null,
            },
      hours: entry.hours,
      note: entry.note,
      deliveries: entry.deliveries,
      incidents: entry.incidents,
      visitors: entry.visitors,
      done: entry.done.map((line) => {
        const activity = activities.get(line.activityId);
        return {
          activityId: line.activityId,
          name: activity?.name ?? null,
          number: numbers.get(line.activityId) ?? null,
          state: line.state,
          quantity: line.quantity,
          unit: activity?.unit ?? null,
          note: line.note,
        };
      }),
      present: entry.present.map((personId) => ({ personId, name: people.get(personId) ?? null })),
      photoCount: entry.photos.length,
      photoHashes: entry.photos.map((photo) => photo.fileHash),
      hash: entry.hash,
      prevHash: entry.prevHash,
    };
  });

  const days = ordered.map((entry) => entry.day).sort();
  return {
    rows,
    written: ordered.length,
    corrections: ordered.filter((entry) => entry.kind === 'correction').length,
    effective: effective.length,
    firstDay: days[0] ?? null,
    lastDay: days.at(-1) ?? null,
    headHash: ordered.at(-1)?.hash ?? null,
  };
}
