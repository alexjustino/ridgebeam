import type { ActualRow } from '@/domain/schedule/actuals';
import type { I18n } from '@/i18n/useI18n';

/**
 * The words of **Planned and actual** (slice G3), in one place, so a row and the figure rows that
 * open onto it say the same thing (DESIGN_SYSTEM §2, _two readings of one fact agree_). Nothing here
 * counts a day: every number is the domain's (`activityActuals`), only said here.
 *
 * Planned and actual are two numbers side by side, and the difference is said as a number with a
 * word — _more_, _less_, _as planned_ — never as a sign or a colour alone:
 *
 * - finished: "Planned 3 working days · took 5 — 2 more";
 * - running: "Planned 3 working days · so far 4 — already 1 more than planned";
 * - with a range: "… · inside the range it was given (2 to 6)";
 * - with no planned duration: "No duration was planned · took 5".
 */

type Words = Pick<I18n, 't' | 'tp' | 'day' | 'number'>;

/** What the plan gave it: "Planned 3 working days", or that it had no duration. */
function plannedText(i18n: Words, row: ActualRow): string {
  return row.planned === null
    ? i18n.t('schedule.actuals.row.noPlan')
    : i18n.t('schedule.actuals.row.planned', {
        days: i18n.tp('plan.checklist.days', row.planned),
      });
}

/** What the diary says it took, or has taken so far, with the difference in words. */
function actualText(i18n: Words, row: ActualRow): string {
  const { t, number } = i18n;
  if (row.tookDays !== null) {
    const took = t('schedule.actuals.row.took', { count: number(row.tookDays) });
    const difference = row.differenceDays;
    if (difference === null) return took;
    const said =
      difference > 0
        ? t('schedule.actuals.row.more', { count: number(difference) })
        : difference < 0
          ? t('schedule.actuals.row.less', { count: number(-difference) })
          : t('schedule.actuals.row.asPlanned');
    return `${took} — ${said}`;
  }
  if (row.soFarDays !== null) {
    const soFar = t('schedule.actuals.row.soFar', { count: number(row.soFarDays) });
    if (!row.overrunning || row.planned === null) return soFar;
    const over = row.soFarDays - row.planned;
    return `${soFar} — ${t('schedule.actuals.row.alreadyMore', { count: number(over) })}`;
  }
  return t('schedule.actuals.row.notCounted');
}

/**
 * One activity, planned against actual, in one sentence with its unit: what was planned, what it
 * took or has taken so far with the difference in words, and — finished, with a range — whether it
 * fell inside the range it was given.
 */
export function actualSentence(i18n: Words, row: ActualRow): string {
  const parts = [plannedText(i18n, row), actualText(i18n, row)];
  if (row.inRange !== null && row.range !== null) {
    parts.push(
      i18n.t(row.inRange ? 'schedule.actuals.row.inside' : 'schedule.actuals.row.outside', {
        min: i18n.number(row.range.min),
        max: i18n.number(row.range.max),
      }),
    );
  }
  return parts.join(' · ');
}

/** The days the diary gives: "Started on 1 Sep", or "Started on 1 Sep, finished on 8 Sep". */
export function actualDaysText(i18n: Words, row: ActualRow): string | null {
  if (row.startedOn === null) return null;
  if (row.finishedOn === null) {
    return i18n.t('schedule.actuals.row.started', { day: i18n.day(row.startedOn) });
  }
  return i18n.t('schedule.actuals.row.finishedOn', {
    start: i18n.day(row.startedOn),
    finish: i18n.day(row.finishedOn),
  });
}
