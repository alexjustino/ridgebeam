/**
 * The few sentences a screen and a report both say, as pure functions of the i18n table.
 *
 * A report says what the screen says, in the same words (DESIGN_SYSTEM §8): the slip's days, a
 * decision's status, what a readiness row lacks and the weather are worded here once, and the hooks
 * the screens use (`useDaysText`, `useStatusText`) and the report composers both call these — so the
 * page can never word a state the screen words another way.
 */

import type { DecisionRow } from '@/domain/decisions';
import type { Weather } from '@/domain/diary';
import type { MissingId, MissingRow } from '@/domain/readiness';
import type { Schedule, UnplacedReason } from '@/domain/schedule';
import {
  PROBABILITY_MESSAGE_KEYS,
  type DateChance,
  type Driver,
  type NaturalFrequency,
} from '@/domain/schedule/probability';
import type { SlipRow } from '@/domain/schedule/slip';
import type { MessageKey } from '@/i18n/en';
import { capitalised } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

/** A signed number of working days, as a person says it: "2 days", "0 days", "3 days early". */
export function daysText(i18n: Pick<I18n, 't' | 'tp'>, days: number): string {
  return days === 0
    ? i18n.t('slip.none')
    : days > 0
      ? i18n.tp('slip.late', days)
      : i18n.tp('slip.early', -days);
}

/**
 * A decision's status: "Due in 3 working days", "Due today", "Overdue by 2 working days", "Made on
 * 25 September 2026", "No deadline yet".
 */
export function decisionStatusText(
  i18n: Pick<I18n, 't' | 'tp' | 'day'>,
  row: Pick<DecisionRow, 'status' | 'daysLeft' | 'madeAt'>,
): string {
  switch (row.status) {
    case 'made':
      return i18n.t('decisions.status.made', { day: i18n.day((row.madeAt ?? '').slice(0, 10)) });
    case 'unknown':
      return i18n.t('decisions.status.unknown');
    case 'overdue':
      return i18n.tp('decisions.status.overdue', Math.abs(row.daysLeft ?? 0));
    case 'due':
      return (row.daysLeft ?? 0) === 0
        ? i18n.t('decisions.status.today')
        : i18n.tp('decisions.status.due', row.daysLeft ?? 0);
  }
}

/** What each kind of missing row lacks, said on the row itself. */
export const READINESS_ROW_KEYS: Record<MissingId, MessageKey> = {
  'activity.duration': 'readiness.row.activity.duration',
  'activity.responsible': 'readiness.row.activity.responsible',
  'activity.linked': 'readiness.row.activity.linked',
  'decision.deadline': 'readiness.row.decision.deadline',
  'decision.timely': 'readiness.row.decision.timely',
  'stage.checks': 'readiness.row.stage.checks',
  'stage.money': 'readiness.row.stage.money',
  'plan.activity': 'readiness.row.plan.activity',
};

/**
 * What a missing row lacks, in words. An activity a template gave a range says so — "a range of 3–5
 * working days, no duration yet" — because a range is shown as a range until a person picks (F9).
 */
export function readinessRowText(
  i18n: Pick<I18n, 't' | 'number'>,
  row: Pick<MissingRow, 'ruleId' | 'durationRange'>,
): string {
  if (row.ruleId === 'activity.duration' && row.durationRange !== null) {
    return i18n.t('readiness.row.activity.durationRange', {
      range: i18n.t('plan.range', {
        min: i18n.number(row.durationRange.min),
        max: i18n.number(row.durationRange.max),
      }),
    });
  }
  return i18n.t(READINESS_ROW_KEYS[row.ruleId]);
}

/** What each weather is called: in the diary's form, on every entry and on the page. */
export const WEATHER_KEYS: Record<Weather, MessageKey> = {
  sun: 'diary.weather.sun',
  cloud: 'diary.weather.cloud',
  rain: 'diary.weather.rain',
  storm: 'diary.weather.storm',
  wind: 'diary.weather.wind',
  other: 'diary.weather.somethingElse',
};

/** Why an activity is not on the calendar, as the Schedule page and the printed table say it. */
export const UNPLACED_KEYS: Record<UnplacedReason, MessageKey> = {
  'no-duration': 'schedule.unplaced.noDuration',
  'no-stage': 'schedule.unplaced.noStage',
  'invalid-calendar': 'schedule.unplaced.invalidCalendar',
  'invalid-start': 'schedule.unplaced.invalidStart',
  cyclic: 'schedule.unplaced.cyclic',
};

/**
 * The finish date as the dashboard says it: the day, or why it is not known yet — a loop, a
 * calendar that cannot be counted on, a start that is not a day, or nothing with a duration.
 */
export function finishText(
  i18n: Pick<I18n, 't' | 'day'>,
  scheduled: Pick<Schedule, 'finishDate' | 'cyclic' | 'unplaced'>,
): string {
  if (scheduled.finishDate !== null) return i18n.day(scheduled.finishDate);
  if (scheduled.cyclic) return i18n.t('dashboard.finish.cyclic');
  const reasons = new Set(scheduled.unplaced.map((row) => row.reason));
  if (reasons.has('invalid-calendar')) return i18n.t('dashboard.finish.invalidCalendar');
  if (reasons.has('invalid-start')) return i18n.t('dashboard.finish.invalidStart');
  return i18n.t('dashboard.finish.unknown');
}

/** What one row of the slip says after its name: its days and dates, or what happened to it. */
export function slipRowText(i18n: Pick<I18n, 't' | 'tp' | 'day'>, row: SlipRow): string {
  switch (row.change) {
    case 'moved':
      return `${daysText(i18n, row.days)} — ${i18n.t('slip.row.moved', {
        baseline: i18n.day(row.baselineFinish ?? ''),
        current: i18n.day(row.currentFinish ?? ''),
      })}`;
    case 'added':
      return i18n.t('slip.row.added');
    case 'removed':
      return i18n.t('slip.row.removed');
    case 'unplaced':
      return i18n.t('slip.row.unplaced');
    case 'placed':
      return i18n.t('slip.row.placed', { current: i18n.day(row.currentFinish ?? '') });
  }
}

/** A chance in natural frequencies, as the domain floors it: "8 in 10 chances", "almost no chance". */
export function frequencyText(
  i18n: Pick<I18n, 't' | 'number'>,
  frequency: Pick<NaturalFrequency, 'messageKey' | 'params'>,
): string {
  return i18n.t(frequency.messageKey as MessageKey, { n: i18n.number(frequency.params.n) });
}

/** The same, short, for a column or a cell: "8 in 10", "under 1 in 10". */
export function frequencyShort(
  i18n: Pick<I18n, 't' | 'number'>,
  frequency: Pick<NaturalFrequency, 'kind' | 'n'>,
): string {
  return frequency.kind === 'under-one'
    ? i18n.t('schedule.probability.short.underOne')
    : i18n.t('schedule.probability.short', { n: i18n.number(frequency.n) });
}

/** A share as the engineer reads it, floored as the words are: "83 %". */
export function frequencyPercent(
  i18n: Pick<I18n, 't' | 'number'>,
  frequency: Pick<NaturalFrequency, 'percent'>,
): string {
  return i18n.t('figure.percent', { value: i18n.number(frequency.percent) });
}

/**
 * The finish as a probability, in one sentence (D1, decision 5): "8 in 10 chances of finishing by
 * 14 November 2026" — the owner's and the architect's; the engineer's adds which percentile it is,
 * "(P80)". Opening a sentence, so its first letter is a capital whatever the frequency.
 */
export function headlineText(
  i18n: Pick<I18n, 't' | 'number' | 'day' | 'language'>,
  at: Pick<DateChance, 'date' | 'frequency'>,
  engineer: { percentile: number } | null = null,
): string {
  const sentence = capitalised(
    i18n.language,
    i18n.t(PROBABILITY_MESSAGE_KEYS.headline, {
      chance: frequencyText(i18n, at.frequency),
      date: i18n.day(at.date),
    }),
  );
  return engineer === null
    ? sentence
    : i18n.t('schedule.probability.engineer', {
        sentence,
        percentile: i18n.number(engineer.percentile),
      });
}

/** "The plan's date, 2 October 2026, has 3 in 10 chances." */
export function planChanceText(
  i18n: Pick<I18n, 't' | 'number' | 'day'>,
  at: Pick<DateChance, 'date' | 'frequency'>,
): string {
  return i18n.t(PROBABILITY_MESSAGE_KEYS.planChance, {
    date: i18n.day(at.date),
    chance: frequencyText(i18n, at.frequency),
  });
}

/** "Baseline 1's date, 30 September 2026, has 1 in 10 chances." */
export function baselineChanceText(
  i18n: Pick<I18n, 't' | 'number' | 'day'>,
  at: Pick<DateChance, 'date' | 'frequency'> & { readonly number: number },
): string {
  return i18n.t(PROBABILITY_MESSAGE_KEYS.baselineChance, {
    number: i18n.number(at.number),
    date: i18n.day(at.date),
    chance: frequencyText(i18n, at.frequency),
  });
}

/** A driver's range in words: "2–4 working days, likeliest 3". */
export function driverRangeText(
  i18n: Pick<I18n, 't' | 'number'>,
  driver: Pick<Driver, 'min' | 'mode' | 'max'>,
): string {
  return i18n.t('schedule.probability.driver.range', {
    range: i18n.t('plan.range', { min: i18n.number(driver.min), max: i18n.number(driver.max) }),
    mode: i18n.number(Math.round(driver.mode * 10) / 10),
  });
}

/**
 * How often an activity was critical in the runs: "critical in 8 of 10 runs", floored as every
 * frequency is — and, at the two ends a floor would blur, "never critical in the runs" and
 * "critical in fewer than 1 of 10 runs".
 */
export function criticalText(
  i18n: Pick<I18n, 't' | 'number'>,
  frequency: Pick<NaturalFrequency, 'kind' | 'n'>,
): string {
  if (frequency.kind === 'none') return i18n.t('schedule.probability.criticalNever');
  if (frequency.kind === 'under-one') return i18n.t('schedule.probability.criticalUnderOne');
  return i18n.t(PROBABILITY_MESSAGE_KEYS.criticalIn, { n: i18n.number(frequency.n) });
}
