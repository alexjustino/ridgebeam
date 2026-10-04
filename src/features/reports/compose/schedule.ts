/**
 * The schedule printed, as a document (decision 6): a landscape page with the Gantt — a bar per
 * activity on a day grid, the critical path marked, the baseline a thin bar beneath — and then the
 * table of every activity: number, name, stage, start, finish, duration, float and who answers for
 * it. An activity the schedule could not place is a row with its reason, never left out; when
 * nothing can be drawn, the page says why where the chart would be and still prints the table.
 *
 * The words are the lens on screen's, in the language on screen: the schedule is the plan, read by
 * whoever is reading the Schedule page. The critical path is said in words beside each critical row
 * and in the legend, never by the bar's fill alone (DESIGN_SYSTEM §8).
 *
 * Pure: the domain's `scheduleReport`, the work and an `I18n` in; a `ReportDocument` out.
 */

import type { ReportBlock, ReportDocument } from '@/data/commands';
import { SCHEDULE_BLOCKED_KEYS, type ScheduleReport } from '@/domain/reports/schedule';
import { weekdayIndex } from '@/domain/calendar';
import type { WorkSnapshot } from '@/domain/plan';
import type { MessageKey } from '@/i18n/en';
import { formatDayMonth } from '@/i18n/format';
import type { TermKey } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

import { finished, tableRows } from './document';
import { UNPLACED_KEYS } from './words';

type Term = (key: TermKey, options?: { capital?: boolean }) => string;

/**
 * The label over each day column: the date on the first column and on every Monday, nothing on
 * the rest — a grid of 120 columns cannot carry 120 dates, and a week is how the plan is read.
 */
function dayLabels(report: ScheduleReport, i18n: I18n): string[] {
  const columns = report.gantt?.columns ?? [];
  return columns.map((column, index) =>
    index === 0 || weekdayIndex(column.date) === 0
      ? formatDayMonth(i18n.language, column.date)
      : '',
  );
}

/** The schedule document, in `i18n`'s language and the words of the lens `term` speaks. */
export function composeSchedule(
  report: ScheduleReport,
  snapshot: WorkSnapshot,
  i18n: I18n,
  term: Term,
): ReportDocument {
  const { t, tp, day, dayShort, number } = i18n;
  const title = term('schedule', { capital: true });
  const blocks: ReportBlock[] = [];

  const critical = report.table.filter((row) => row.critical).length;
  blocks.push({
    type: 'paragraph',
    text: [
      t('reports.schedule.finish', {
        finishDate: term('finishDate', { capital: true }),
        day: report.finishDate === null ? t('reports.schedule.noFinish') : day(report.finishDate),
      }),
      // The dashboard's own sentence, so the page counts the critical path the way the screen does.
      tp('dashboard.critical', critical, { label: term('criticalPath', { capital: true }) }),
    ].join(' '),
  });

  if (report.gantt === null) {
    blocks.push({
      type: 'paragraph',
      tone: 'strong',
      text: t(SCHEDULE_BLOCKED_KEYS[report.blocked ?? 'nothing-placed'] as MessageKey),
    });
  } else {
    blocks.push({
      type: 'paragraph',
      tone: 'muted',
      text: [
        t('reports.schedule.legend', { criticalPath: term('criticalPath', { capital: true }) }),
        report.baselineNumber === null
          ? t('reports.schedule.noBaseline', { baseline: term('baseline') })
          : t('reports.schedule.baseline', {
              baseline: term('baseline', { capital: true }),
              number: report.baselineNumber,
            }),
      ].join(' '),
    });
    blocks.push({
      type: 'gantt',
      days: report.gantt.days,
      dayLabels: dayLabels(report, i18n),
      rows: report.gantt.rows.map((row) => ({
        label: [row.number, row.name].filter((part) => part !== null).join(' '),
        start: row.start,
        length: row.length,
        critical: row.critical,
        baselineStart: row.baselineStart,
        baselineLength: row.baselineLength,
      })),
    });
  }

  blocks.push({
    type: 'table',
    columns: [
      { text: t('reports.schedule.col.number'), align: 'left', width: 0.05 },
      { text: term('activity', { capital: true }), align: 'left', width: 0.27 },
      { text: term('stage', { capital: true }), align: 'left', width: 0.14 },
      { text: t('reports.schedule.col.start'), align: 'left', width: 0.11 },
      { text: t('reports.schedule.col.finish'), align: 'left', width: 0.11 },
      { text: t('reports.schedule.col.duration'), align: 'right', width: 0.08 },
      { text: t('reports.schedule.col.float'), align: 'right', width: 0.08 },
      { text: term('responsible', { capital: true }), align: 'left', width: 0.16 },
    ],
    rows: tableRows(
      report.table.map((row) => [
        row.number ?? '',
        row.critical
          ? t('reports.schedule.criticalRow', { name: row.name, label: term('criticalPath') })
          : row.name,
        row.stageName ?? '',
        row.start === null ? t(UNPLACED_KEYS[row.unplaced ?? 'no-duration']) : dayShort(row.start),
        row.finish === null ? '' : dayShort(row.finish),
        row.durationDays === null ? '' : number(row.durationDays),
        row.float === null ? '' : number(row.float),
        row.responsibleName ?? t('reports.schedule.nobody'),
      ]),
    ),
  });
  blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.schedule.units') });

  return finished({
    kind: 'schedule',
    title,
    subtitle: snapshot.work.name,
    pageSize: 'a4-landscape',
    language: i18n.language,
    blocks,
  });
}
