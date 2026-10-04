import { FORECAST_PROBLEM_KEYS, type Forecast } from '@/domain/schedule/forecast';
import type { MessageKey } from '@/i18n/en';
import type { termsFor } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

/**
 * The words of **As things stand** (slice E3), in one place, so the Schedule page, the weekly report
 * and the owner's snapshot say the forecast the same way: when it finishes, against the baseline and
 * against the plan's own date — each labelled as what it is, so the plan's date and the forecast are
 * never read as one number — and what the forecast assumes. Nothing here counts a day: every date and
 * every number of working days is the domain's (`forecast.ts`), only said here.
 */

type Words = Pick<I18n, 't' | 'tp' | 'day'>;
type Term = ReturnType<typeof termsFor>;

/** A number of working days, as said inside a sentence: "1 working day", "5 working days". */
function workingDays(i18n: Words, days: number): string {
  return i18n.tp('plan.checklist.days', Math.abs(days));
}

/**
 * The forecast against the baseline, in one sentence — "As things stand it finishes on 23 Oct — 5
 * working days after the baseline's 16 Oct." — or, without a forecast, why there is none. Before
 * approval it says the date alone; the caller adds `forecastNoBaselineText`.
 */
export function forecastSentence(i18n: Words, term: Term, forecast: Forecast): string {
  if (forecast.problem !== null) {
    return i18n.t(FORECAST_PROBLEM_KEYS[forecast.problem] as MessageKey);
  }
  if (forecast.finishDate === null) {
    return i18n.t('schedule.forecast.nothing', { forecast: term('forecast') });
  }
  const day = i18n.day(forecast.finishDate);
  const days = forecast.daysAgainstBaseline;
  if (forecast.baselineFinish === null || days === null) {
    return i18n.t('schedule.forecast.sentence.plain', { day });
  }
  const params = {
    day,
    days: workingDays(i18n, days),
    baseline: term('baseline'),
    baselineDay: i18n.day(forecast.baselineFinish),
  };
  if (days > 0) return i18n.t('schedule.forecast.sentence.later', params);
  if (days < 0) return i18n.t('schedule.forecast.sentence.earlier', params);
  return i18n.t('schedule.forecast.sentence.same', params);
}

/** Before approval there is nothing to stand against: said so, and when there will be. */
export function forecastNoBaselineText(i18n: Words, term: Term): string {
  return i18n.t('schedule.forecast.noBaseline', {
    baseline: term('baseline'),
    forecast: term('forecast'),
  });
}

/**
 * The forecast against the plan's own finish date — the two are different answers and the sentence
 * says which is which: "The plan's own finish date is 20 Oct: the forecast is 3 working days later,
 * from what the diary records." `null` when either date is missing.
 */
export function forecastPlanText(i18n: Words, term: Term, forecast: Forecast): string | null {
  if (forecast.planFinish === null || forecast.daysAgainstPlan === null) return null;
  const days = forecast.daysAgainstPlan;
  const params = {
    day: i18n.day(forecast.planFinish),
    days: workingDays(i18n, days),
    forecast: term('forecast'),
  };
  if (days > 0) return i18n.t('schedule.forecast.plan.later', params);
  if (days < 0) return i18n.t('schedule.forecast.plan.earlier', params);
  return i18n.t('schedule.forecast.plan.same', params);
}

/**
 * What the forecast assumes, and what it leaves out — said beside it, never behind a tooltip (§8, a
 * projection says what it counts and what it does not): the planned durations from today, and the
 * activities it could not place, counted.
 */
export function forecastAssumesText(
  i18n: Words,
  term: Term,
  forecast: Forecast,
  activities: number,
): string {
  const parts = [i18n.t('schedule.forecast.assumes', { forecast: term('forecast') })];
  const leftOut = forecast.problem === null ? activities - forecast.dates.size : 0;
  if (leftOut > 0) parts.push(i18n.tp('schedule.forecast.leftOut', leftOut));
  return parts.join(' ');
}
