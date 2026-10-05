import {
  type AftercareIcsWords,
  type AftercareTargetKind,
  type AftercareProblem,
  type AftercareTarget,
  type MaintenanceRow,
  type WarrantyRow,
} from '@/domain/aftercare';
import type { WorkSnapshot } from '@/domain/plan';
import type { MessageKey } from '@/i18n/en';
import type { I18n } from '@/i18n/useI18n';

/**
 * The words of after the handover (slice G4), in one place, so the Handover tab, the dashboard's
 * After the handover card, the calendar and the `.ics` file say a warranty and a task the same way:
 * what it covers, how often, the day it ends or is next due **and how far that is, in words, with
 * its unit** (DESIGN_SYSTEM §8, _a day that comes due is said with what it is and how far it is_).
 * Nothing here counts or computes a day: every day and every distance is the domain's
 * (`aftercare.ts`), and only said here.
 */

type Words = Pick<I18n, 't' | 'tp' | 'day'>;

/** What a warranty or a task covers: "the whole work", the room's or stage's name, or a row gone. */
export function aftercareTargetText(i18n: Pick<I18n, 't'>, target: AftercareTarget): string {
  if (target.detached) return i18n.t('documents.target.detached');
  if (target.targetKind === 'work') return i18n.t('aftercare.target.work');
  return target.targetName ?? i18n.t('documents.target.detached');
}

/** "Covers: Shower room". */
export function aftercareCoversText(i18n: Pick<I18n, 't'>, target: AftercareTarget): string {
  return i18n.t('aftercare.covers', { target: aftercareTargetText(i18n, target) });
}

/** "150 days", "1 day" — calendar days, with the unit. */
function daysText(i18n: Pick<I18n, 'tp'>, days: number): string {
  return i18n.tp('aftercare.days', days);
}

/** "24 months", "1 month" — a warranty's length, as stored. */
export function monthsText(i18n: Pick<I18n, 'tp'>, months: number): string {
  return i18n.tp('aftercare.months', months);
}

/** "Every 12 months", "Every month" — a task's cycle. */
export function everyText(i18n: Pick<I18n, 'tp'>, everyMonths: number): string {
  return i18n.tp('aftercare.every', everyMonths);
}

/**
 * When a warranty ends, and how far that is: "Ends on March 15, 2028 — in 150 days", "Ends today,
 * March 15, 2028 — its last day", "Ended on March 15, 2026 — 40 days ago".
 */
export function warrantyEndsText(i18n: Words, row: WarrantyRow): string {
  if (row.endsOn === null) return i18n.t('aftercare.warranty.endsUnknown');
  const day = i18n.day(row.endsOn);
  if (row.daysLeft === null) return i18n.t('aftercare.warranty.ends', { day });
  if (row.daysLeft === 0) return i18n.t('aftercare.warranty.endsToday', { day });
  if (row.daysLeft < 0) {
    return i18n.t('aftercare.warranty.ended', { day, days: daysText(i18n, -row.daysLeft) });
  }
  return i18n.t('aftercare.warranty.endsIn', { day, days: daysText(i18n, row.daysLeft) });
}

/** "From March 15, 2026, for 24 months". */
export function warrantyFromText(i18n: Words, row: WarrantyRow): string {
  return i18n.t('aftercare.warranty.from', {
    day: i18n.day(row.startsOn),
    length: monthsText(i18n, row.months),
  });
}

/**
 * When a task is next due, and how far that is: "Next due on March 4, 2027 — in 150 days", "Next due
 * on October 1, 2026 — 3 days overdue", "First due on … — due today". A task never done says it is
 * first due then.
 */
export function taskDueText(i18n: Words, row: MaintenanceRow): string {
  if (row.nextDueOn === null) return i18n.t('aftercare.task.noNext');
  const said = i18n.t(row.timesDone === 0 ? 'aftercare.task.first' : 'aftercare.task.next', {
    day: i18n.day(row.nextDueOn),
  });
  if (row.overdue && row.daysOverdue !== null) {
    return `${said} — ${i18n.t('aftercare.overdueBy', { days: daysText(i18n, row.daysOverdue) })}`;
  }
  if (row.daysUntilDue === 0) return `${said} — ${i18n.t('aftercare.dueToday')}`;
  if (row.daysUntilDue !== null) {
    return `${said} — ${i18n.t('aftercare.inDays', { days: daysText(i18n, row.daysUntilDue) })}`;
  }
  return said;
}

/** "Every 12 months · done 2 times · last done on October 4, 2026", or "… · not done yet". */
export function taskCycleText(i18n: Words, row: MaintenanceRow): string {
  const parts = [everyText(i18n, row.everyMonths)];
  if (row.timesDone === 0) parts.push(i18n.t('aftercare.task.neverDone'));
  else {
    parts.push(i18n.tp('aftercare.task.timesDone', row.timesDone));
    if (row.lastDoneOn !== null) {
      parts.push(i18n.t('aftercare.task.lastDone', { day: i18n.day(row.lastDoneOn) }));
    }
  }
  return parts.join(' · ');
}

/** "Overdue by 3 days", for a calendar item and a figure's row. */
export function overdueText(i18n: Pick<I18n, 't' | 'tp'>, days: number): string {
  return i18n.t('aftercare.overdueBy', { days: daysText(i18n, days) });
}

/** A task as a figure's row says it: what, what it covers, and when it is due, in words. */
export function taskRowLine(i18n: Words, row: MaintenanceRow): string {
  return [row.title, aftercareTargetText(i18n, row), taskDueText(i18n, row)].join(' — ');
}

/** A warranty as a figure's row says it: what, what it covers, and when it ends, in words. */
export function warrantyRowLine(i18n: Words, row: WarrantyRow): string {
  return [row.title, aftercareTargetText(i18n, row), warrantyEndsText(i18n, row)].join(' — ');
}

/** The domain's refusals as sentences, each once, in the order found. */
export function aftercareProblemsText(
  i18n: Pick<I18n, 't'>,
  problems: readonly AftercareProblem[],
): string[] {
  return [...new Set(problems.map((problem) => i18n.t(problem.messageKey as MessageKey)))];
}

/** A text and, when there is one, the person's note under it. */
function withNote(text: string, note: string | null): string {
  return note === null || note.trim() === '' ? text : `${text}\n${note.trim()}`;
}

/**
 * The words of the `.ics` file, in the language on screen. They stay within what SECURITY.md
 * promises the file holds: a task's title, what it covers, how often and the person's note; a
 * warranty's title, what it covers, who gives it, from when and for how long, and the person's
 * note. Never a phone, an e-mail, an amount, a document or a path.
 */
export function aftercareIcsWords(i18n: Words, snapshot: WorkSnapshot): AftercareIcsWords {
  return {
    calendarName: i18n.t('aftercare.ics.calendarName', { work: snapshot.work.name }),
    taskSummary: (title) => i18n.t('aftercare.ics.task', { title }),
    taskDescription: (row) =>
      withNote(
        [aftercareCoversText(i18n, row), everyText(i18n, row.everyMonths)].join(' · '),
        row.note,
      ),
    warrantySummary: (title) => i18n.t('aftercare.ics.warranty', { title }),
    warrantyDescription: (row) =>
      withNote(
        [
          aftercareCoversText(i18n, row),
          row.givenBy === null ? null : i18n.t('aftercare.warranty.givenBy', { name: row.givenBy }),
          warrantyFromText(i18n, row),
        ]
          .filter((part): part is string => part !== null)
          .join(' · '),
        row.note,
      ),
    warrantyAlarm: (title) => i18n.t('aftercare.ics.alarm', { title }),
  };
}

/** The day the last stage closed, when every stage is closed; `null` while the work is open. */
export function workFinishedOn(snapshot: WorkSnapshot): string | null {
  if (snapshot.stages.length === 0) return null;
  let latest: string | null = null;
  for (const stage of snapshot.stages) {
    if (stage.closedAt === null) return null;
    const day = stage.closedAt.slice(0, 10);
    if (latest === null || day > latest) latest = day;
  }
  return latest;
}

/** What a warranty or a task covers, as the select holds it: `work:<id>`, `room:<id>`, `stage:<id>`. */
export function targetValue(targetKind: AftercareTargetKind, targetId: string): string {
  return `${targetKind}:${targetId}`;
}

/** The select's value read back; an unknown kind reads as itself, and the domain refuses it. */
export function targetOf(value: string): { targetKind: AftercareTargetKind; targetId: string } {
  const at = value.indexOf(':');
  return {
    targetKind: value.slice(0, at) as AftercareTargetKind,
    targetId: value.slice(at + 1),
  };
}
