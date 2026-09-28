/**
 * The diary, as a document: every entry as it was written, in the order it was written, one row
 * each (decision 5) — corrections beside what they correct, the corrected ones marked, never
 * merged or dropped.
 *
 * The chain's verification is **not** here: the host verifies the chain at the moment it writes the
 * file and prepends its own block saying so — the interface cannot claim it. This document carries
 * only the entries, in the language on screen and the lens on screen.
 *
 * Each entry is one block — its number and day, whether it counts now, and every fact it states,
 * a line each — so a diary of 3 000 entries stays inside the host's 5 000 blocks; a note longer than
 * one string may hold is carried on in the lines beneath it, never cut. Photos are counted, not
 * printed.
 *
 * Pure: the domain's rows, the work and an `I18n` in; a `ReportDocument` out.
 */

import type { ReportBlock, ReportDocument } from '@/data/commands';
import {
  DIARY_ROW_STATUS_KEYS,
  type DiaryReport,
  type DiaryReportRow,
} from '@/domain/reports/diary';
import type { WorkSnapshot } from '@/domain/plan';
import type { MessageKey } from '@/i18n/en';
import type { TermKey } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

import { finished, pieces } from './document';
import { WEATHER_KEYS } from './words';

type Term = (key: TermKey, options?: { capital?: boolean }) => string;

/** What an entry says it corrects, or what corrected it, and whether it counts now. */
function statusText(i18n: I18n, row: DiaryReportRow): string {
  const parts: string[] = [];
  if (row.kind === 'correction' && row.correctsSeq !== null) {
    parts.push(i18n.t('diary.entry.correction', { seq: row.correctsSeq }));
  }
  if (row.correctedBySeq !== null) {
    parts.push(i18n.t('diary.entry.correctedBy', { seq: row.correctedBySeq }));
  }
  parts.push(i18n.t(DIARY_ROW_STATUS_KEYS[row.status] as MessageKey));
  return parts.join(' · ');
}

/**
 * Every fact an entry states, in the order the diary shows them: who wrote it and when with the
 * day's weather and hours on the first line, then a line per activity, who was there, the note
 * whole — its own line breaks kept — and the rest. Few lines, so 3 000 entries stay inside the
 * host's 20 000 rows.
 */
function facts(i18n: I18n, row: DiaryReportRow): string[] {
  const { t, number, instant } = i18n;
  const lines: string[] = [
    [
      t('reports.diary.written', { author: row.authorName, time: instant(row.createdAt) }),
      row.weather === null
        ? null
        : t('diary.entry.weather', { weather: t(WEATHER_KEYS[row.weather]) }),
      row.lostDay ? t('diary.entry.lostDay') : null,
      row.hours === null ? null : t('diary.entry.hours', { hours: number(row.hours) }),
    ]
      .filter((part): part is string => part !== null)
      .join(' · '),
  ];
  for (const line of row.done) {
    const name = [line.number, line.name ?? t('diary.entry.unknownActivity')]
      .filter((part) => part !== null)
      .join(' ');
    const said = t(line.state === 'finished' ? 'diary.entry.finished' : 'diary.entry.worked', {
      name,
    });
    const quantity =
      line.quantity === null ? null : [number(line.quantity), line.unit ?? ''].join(' ').trim();
    lines.push(
      [said, quantity, line.note].filter((part) => part !== null && part !== '').join(' · '),
    );
  }
  if (row.present.length > 0) {
    lines.push(
      t('diary.entry.present', {
        names: row.present
          .map((person) => person.name ?? t('reports.diary.unknownPerson'))
          .join(', '),
      }),
    );
  }
  if (row.note !== null && row.note.trim() !== '') {
    // The note keeps its own line breaks (the host breaks the line there), and a note longer than
    // one string may hold is carried on in the lines beneath it.
    lines.push(...pieces(row.note.trim()));
  }
  if (row.deliveries !== null) {
    lines.push(...pieces(t('diary.entry.deliveries', { text: row.deliveries })));
  }
  if (row.incidents !== null) {
    lines.push(...pieces(t('diary.entry.incidents', { text: row.incidents })));
  }
  if (row.visitors !== null) {
    lines.push(...pieces(t('diary.entry.visitors', { text: row.visitors })));
  }
  if (row.photoCount > 0) lines.push(i18n.tp('reports.diary.photoCount', row.photoCount));
  return lines;
}

/**
 * The diary document, in `i18n`'s language and the words of the lens `term` speaks: a heading, the
 * summary, then one block per entry — its number and day, whether it counts, and every fact it
 * states with its note whole.
 */
export function composeDiary(
  report: DiaryReport,
  snapshot: WorkSnapshot,
  i18n: I18n,
  term: Term,
): ReportDocument {
  const { t, tp, day } = i18n;
  const title = t('nav.diary');

  const summary =
    report.written === 0 || report.firstDay === null || report.lastDay === null
      ? t('reports.diary.empty')
      : [
          tp('reports.diary.summary', report.written, {
            from: day(report.firstDay),
            to: day(report.lastDay),
          }),
          report.corrections > 0 ? tp('reports.diary.corrections', report.corrections) : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' ');

  const blocks: ReportBlock[] = [
    { type: 'paragraph', text: summary },
    { type: 'paragraph', tone: 'muted', text: t('reports.diary.reading') },
  ];
  for (const row of report.rows) {
    blocks.push({
      type: 'figure',
      label: t('reports.diary.entry', {
        entry: term('entry', { capital: true }),
        seq: row.seq,
        day: day(row.day),
      }),
      value: statusText(i18n, row),
      rows: facts(i18n, row),
    });
  }
  if (report.rows.some((row) => row.photoCount > 0)) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.diary.photos') });
  }

  return finished({
    kind: 'diary',
    title,
    subtitle: snapshot.work.name,
    pageSize: 'a4',
    language: i18n.language,
    blocks,
  });
}
