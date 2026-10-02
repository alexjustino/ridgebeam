/**
 * The backup reminder: when the front door says, quietly, that the work should be backed up
 * (slice U1, decision 3). The product never backs up on its own; it only says when it is time.
 *
 * Two cases, and nothing else:
 *
 * - **never**: this machine has no record of a backup of the work, and the work has something in
 *   it (at least one diary entry or one activity). An empty work is not worth a reminder.
 * - **stale**: the last backup was more than `BACKUP_STALE_DAYS` calendar days before today, and
 *   the work changed after the backup's day. Exactly seven days is not stale; eight is. A backup
 *   that old of a work nobody touched since is still a whole copy, and the product says nothing.
 *
 * **What counts as a change** (`workChanges`): every moment the work records — a diary entry
 * written, a payment or a reversal, a check answered, a stage started or closed, a decision made,
 * a document added, a baseline taken, a replanning opened, a care note written, a change order
 * raised or decided, the plan approved, the work created. These are the timestamps the snapshot and the diary carry. Editing a row of
 * the plan in place (renaming an activity, changing a duration) leaves no timestamp, so it is not
 * seen: the reminder may come later than it could, never wrongly.
 *
 * **Days, not moments.** The host records only the day of a backup (`backup_last`, this machine's
 * local day), so a change is "after the backup" when its day is later than the backup's day. A
 * change on the day of the backup is taken as backed up: writing the day's entry and then backing
 * up is the usual order, and a reminder that the work "changed since" would then be false. A
 * timestamp's day is its first ten characters (UTC), as everywhere in the domain; around midnight
 * it can be a day off the local one, which can only move a quiet reminder by a day.
 *
 * **Today is an input.** No clock, no I/O: the interface passes what `backup_last` said, today,
 * and the work's changes.
 */

import { calendarDaysBetween, isIsoDay } from './calendar';
import type { DiaryEntry } from './diary';
import type { WorkSnapshot } from './plan';

/** A backup older than this many calendar days, of a work that changed since, is reminded of. */
export const BACKUP_STALE_DAYS = 7;

/** What the reminder says: never backed up, or backed up `days` calendar days ago. */
export type BackupDue =
  | { readonly kind: 'never'; readonly days: null }
  | { readonly kind: 'stale'; readonly days: number };

export interface BackupFacts {
  /** The day of the last backup on this machine (`backup_last`), or `null` when there was none. */
  readonly lastBackupAt: string | null;
  /** The latest change the work records (a timestamp or a day), or `null` when none. */
  readonly lastChangeAt: string | null;
  /** Today, `YYYY-MM-DD`. */
  readonly today: string;
  /** The work has at least one diary entry or one activity. */
  readonly hasContent: boolean;
}

/** A timestamp's day, or the day itself; `null` when it is neither. */
function dayOfMoment(at: string | null): string | null {
  if (at === null) return null;
  const day = at.slice(0, 10);
  return isIsoDay(day) ? day : null;
}

/**
 * Whether the work should be backed up now, and why; `null` when not. Never throws: a today or a
 * backup day that is not a day says nothing, and so does a backup dated after today.
 */
export function backupDue(facts: BackupFacts): BackupDue | null {
  const { lastBackupAt, today, hasContent } = facts;
  if (!isIsoDay(today)) return null;
  if (lastBackupAt === null) return hasContent ? { kind: 'never', days: null } : null;
  if (!isIsoDay(lastBackupAt)) return null;
  const days = calendarDaysBetween(lastBackupAt, today);
  if (days <= BACKUP_STALE_DAYS) return null;
  const changed = dayOfMoment(facts.lastChangeAt);
  return changed !== null && changed > lastBackupAt ? { kind: 'stale', days } : null;
}

/** What `backupDue` needs to know of the work, read from its snapshot and its diary. */
export interface WorkChanges {
  /** The latest moment the work records (see the module's comment), or `null`. */
  readonly lastChangeAt: string | null;
  /** At least one diary entry or one activity. */
  readonly hasContent: boolean;
}

/** The latest change the work records, and whether it has anything in it. */
export function workChanges(snapshot: WorkSnapshot, entries: readonly DiaryEntry[]): WorkChanges {
  const moments: Array<string | null> = [
    snapshot.work.createdAt,
    snapshot.work.approvedAt,
    snapshot.replanning?.openedAt ?? null,
    ...entries.map((entry) => entry.createdAt),
    ...snapshot.payments.map((payment) => payment.createdAt),
    ...snapshot.checkAnswers.map((answer) => answer.answeredAt),
    ...snapshot.stages.flatMap((stage) => [stage.startedAt, stage.closedAt]),
    ...snapshot.decisions.map((decision) => decision.madeAt),
    ...snapshot.documents.map((document) => document.createdAt),
    ...snapshot.baselines.map((baseline) => baseline.takenAt),
    ...snapshot.careNotes.map((note) => note.createdAt),
    ...snapshot.changeOrders.flatMap((change) => [
      change.createdAt,
      change.decision?.createdAt ?? null,
    ]),
  ];
  let latest: string | null = null;
  for (const moment of moments) {
    if (moment !== null && (latest === null || moment > latest)) latest = moment;
  }
  return {
    lastChangeAt: latest,
    hasContent: entries.length > 0 || snapshot.activities.length > 0,
  };
}
