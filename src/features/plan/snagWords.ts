import type { Snag, WorkSnapshot } from '@/domain/plan';
import {
  SNAG_LABEL_KEYS,
  SNAG_STATE_KEYS,
  type SnagFigures,
  type SnagPersonGroup,
  type SnagProblem,
  type SnagRow,
} from '@/domain/snags';
import type { MessageKey } from '@/i18n/en';
import { capitalised, type TermKey } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

/**
 * The words of a snag (slice E4), in one place, so the Snags tab, the dashboard's Still to fix card,
 * the weekly report, the owner's snapshot and the handover book say a snag the same way: its number
 * and title, where it is, who must fix it, its day and whether it is past it, and how it was closed.
 * Nothing here counts: every number is the domain's (`snags.ts`), and only said here.
 */

type Term = (key: TermKey, options?: { capital?: boolean }) => string;

/** "snag #3 Cracked tile": a snag named in a sentence. */
export function snagName(
  i18n: Pick<I18n, 't'>,
  term: Term,
  snag: Pick<Snag, 'number' | 'title'>,
): string {
  return i18n.t('snags.name', { snag: term('snag'), number: snag.number, title: snag.title });
}

/** The same, opening a sentence or a heading. */
export function snagNameCapital(
  i18n: Pick<I18n, 't' | 'language'>,
  term: Term,
  snag: Pick<Snag, 'number' | 'title'>,
): string {
  return capitalised(i18n.language, snagName(i18n, term, snag));
}

/** "#3 Cracked tile": a snag in a list, where the list already says what it is. */
export function snagRowTitle(
  i18n: Pick<I18n, 't'>,
  snag: { readonly number: number; readonly title: string },
): string {
  return i18n.t('snags.row.title', { number: snag.number, title: snag.title });
}

/** Where it is: "Stage: Finishes · Job: Lay the tiles", in the lens's words. */
export function snagWhereText(i18n: Pick<I18n, 't'>, term: Term, row: SnagRow): string {
  return [
    i18n.t('snags.row.where', {
      stage: term('stage', { capital: true }),
      name: row.stageName ?? i18n.t('snags.row.goneStage'),
    }),
    row.activityId === null
      ? null
      : i18n.t('snags.row.activity', {
          activity: term('activity', { capital: true }),
          name: row.activityName ?? i18n.t('snags.row.goneActivity'),
        }),
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

/** Who must fix it: "To fix it: Sample tiler", or that nobody is named. */
export function snagWhoText(i18n: Pick<I18n, 't'>, row: SnagRow): string {
  if (row.personId === null) return i18n.t('snags.row.nobody');
  return row.personName === null
    ? i18n.t('snags.row.personGone')
    : i18n.t('snags.row.person', { name: row.personName });
}

/**
 * An open snag's day: "Overdue by 2 days — it was due on 1 Oct", "Due on 9 Oct", or that no day was
 * set. `null` once it is closed: a closed snag's day no longer matters.
 */
export function snagDueText(i18n: Pick<I18n, 't' | 'tp' | 'day'>, row: SnagRow): string | null {
  if (row.state !== 'open') return null;
  if (row.dueOn === null) return i18n.t('snags.row.noDue');
  if (row.overdue && row.overdueDays !== null) {
    return i18n.tp('snags.row.overdue', row.overdueDays, { day: i18n.day(row.dueOn) });
  }
  return i18n.t('snags.row.dueOn', { day: i18n.day(row.dueOn) });
}

/** How long an open snag has waited: "raised today", "open for 3 days"; `null` once closed. */
export function snagWaitedText(i18n: Pick<I18n, 't' | 'tp'>, row: SnagRow): string | null {
  if (row.waitedDays === null) return null;
  return row.waitedDays === 0
    ? i18n.t('snags.row.waited.today')
    : i18n.tp('snags.row.waited', row.waitedDays);
}

/** Its state in a word, from the domain's keys; an open one past its day says so. */
export function snagStateText(i18n: Pick<I18n, 't'>, row: SnagRow): string {
  if (row.state === 'open' && row.overdue) return i18n.t('snags.state.overdue');
  return i18n.t(SNAG_STATE_KEYS[row.state] as MessageKey);
}

/**
 * How it was closed, with who did it: "Fixed on 3 Oct by Sample author", "Withdrawn on … by …";
 * `null` while it is open.
 */
export function snagClosureText(
  i18n: Pick<I18n, 't' | 'day'>,
  row: SnagRow,
  snag: Snag | undefined,
): string | null {
  if (row.state === 'open' || row.closedOn === null) return null;
  return i18n.t(row.state === 'fixed' ? 'snags.row.fixed' : 'snags.row.withdrawn', {
    day: i18n.day(row.closedOn),
    author: snag?.closure?.authorName ?? '',
  });
}

/** The closure's note: "Why: raised twice" for a withdrawal, "Note: …" for a fix; `null` if none. */
export function snagNoteText(i18n: Pick<I18n, 't'>, row: SnagRow): string | null {
  if (row.note === null || row.note.trim() === '') return null;
  return i18n.t(row.state === 'withdrawn' ? 'snags.row.reason' : 'snags.row.note', {
    note: row.note,
  });
}

/** The domain's refusals, said: one sentence each, the nouns in the lens's words. */
export function snagProblemsText(
  i18n: Pick<I18n, 't'>,
  term: Term,
  problems: readonly SnagProblem[],
): string[] {
  return [
    ...new Set(
      problems.map((problem) =>
        i18n.t(problem.messageKey as MessageKey, {
          stage: term('stage'),
          activity: term('activity'),
          person: term('person'),
        }),
      ),
    ),
  ];
}

/** A person's group of open snags, named: "On Sample tiler", "On nobody named". */
export function snagGroupLabel(i18n: Pick<I18n, 't'>, group: SnagPersonGroup): string {
  if (group.personId === null) return i18n.t(SNAG_LABEL_KEYS.nobody);
  return i18n.t(SNAG_LABEL_KEYS.onPerson, {
    name: group.name ?? i18n.t('snags.row.personGone'),
  });
}

/**
 * What is still open and on whom, in sentences: "2 snags are still to fix. 1 of them is past its
 * day. On whom: Sample tiler (1), nobody named (1)." — or, with nothing open, how every snag was
 * closed. Counted by the domain; said here.
 */
export function snagSentence(
  i18n: Pick<I18n, 't' | 'tp' | 'number'>,
  figures: SnagFigures,
): string {
  const open = figures.open.value;
  if (open === 0) {
    return i18n.t('snags.sentence.none', {
      fixed: i18n.number(figures.fixed),
      withdrawn: i18n.number(figures.withdrawn),
    });
  }
  const on = figures.byPerson.map((group) =>
    i18n.t('snags.sentence.onPerson', {
      name:
        group.personId === null
          ? i18n.t('snags.sentence.nobody')
          : (group.name ?? i18n.t('snags.sentence.gone')),
      count: i18n.number(group.open.value),
    }),
  );
  return [
    i18n.tp('snags.sentence.open', open),
    figures.overdue.value > 0 ? i18n.tp('snags.sentence.overdue', figures.overdue.value) : null,
    on.length > 0 ? i18n.t('snags.sentence.on', { list: on.join(', ') }) : null,
  ]
    .filter((part) => part !== null)
    .join(' ');
}

/** A photo's file name, for its thumbnail's `alt`: the document the work holds by that hash. */
export function photoFileName(snapshot: WorkSnapshot, hash: string, fallback: string): string {
  return snapshot.documents.find((document) => document.fileHash === hash)?.fileName ?? fallback;
}
