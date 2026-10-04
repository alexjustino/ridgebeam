/**
 * When will it really finish: the finish as a probability, from each activity's range (slice D1,
 * ADR-035).
 *
 * The schedule gives one finish date, from one duration per activity. A person who says "the
 * tiling takes 4 days, maybe 3, at worst 6" has said more than that, and this module uses it: the
 * plan is run again and again with durations drawn from the ranges given, and what comes out is how
 * often the work finished by each day.
 *
 * ## The model (ADR-035, decision 2)
 *
 * Each activity of the plan gets one of three models (`ActivityModel`):
 *
 * - **ranged** — it has a range (`durationMinDays` to `durationMaxDays`, min below max): a
 *   triangular distribution from min to max whose peak is its duration, or the middle of the range
 *   when it has no duration yet. A duration **outside** its range (a row written before D1 checked
 *   ranges: a template's 2–4 and a duration of 5 picked later) **widens the range to take it in**
 *   (2–5, peak 5): both are things somebody said, and a peak outside its own triangle is not a
 *   triangle. The model says so (`widened`);
 * - **certain** — it has a duration and no range (or a range of one number): that duration, in
 *   every run. **No uncertainty is invented**: nothing adds a range the person did not give, and
 *   the result counts how many activities were taken as certain, so the page can say so;
 * - **unplaced** — neither a duration nor a range (or its stage is not in the plan): it takes no
 *   days, as the schedule already does, and the result counts it.
 *
 * Working days are whole: a sample is rounded to the nearest whole day (half up), never below 1.
 * Lags are certain.
 *
 * **What has happened is not simulated.** An activity the diary says is finished is certain at the
 * working days it really took, first entry to the finish, both counted. An activity of a **closed
 * stage** is certain at its duration (its work is a fact now; the what-if refuses to change it for
 * the same reason). An activity the diary says was started keeps what is left of its range: it has
 * already taken the working days from its first entry to its last, so a run never gives it fewer —
 * the triangle is cut there and the rest of it is drawn from, and an activity already past its
 * pessimistic end is certain at what it has taken so far. The diary's own rules decide what started
 * and finished mean (`diary.progress`), and the calendar counts the days.
 *
 * ## The engine (decision 3)
 *
 * The schedule is expanded once, exactly as `schedule()` expands it — the same activity edges, the
 * same topological order (`criticalPath.network`, the part of the plan that does not depend on a
 * duration, now shared by both) — and turned into flat arrays. Each run draws the durations with a
 * seeded generator (`mulberry32`), makes the forward pass (the finish, in working days from day 0)
 * and the backward pass (which activities had no float in that run), exactly as `plan()` does. The
 * offsets are turned into dates with the calendar once, at the end.
 *
 * The seed is a hash of what the runs depend on (the start date, the calendar, every activity's
 * model, every edge and its lag), so the same plan gives the same numbers every time it is opened,
 * and any change to any of them gives new ones. **Nothing here is stored and nothing changes the
 * plan's own dates**: the schedule is read, never written.
 *
 * Runs: `PROBABILITY_RUNS` (2 000). A plan so large that 2 000 runs would take too long gets fewer,
 * never fewer than `PROBABILITY_MIN_RUNS`: the rule is `runsFor`, and the result says when it was
 * applied (`capped`).
 *
 * ## The results (decision 4)
 *
 * The distribution of finish dates; the chance of finishing by any day (`chanceBy`); the P50, P80
 * and P90 dates (the first day the share of runs finished reaches a half, eight tenths, nine
 * tenths); the chance of the plan's own finish date and of the latest baseline's; the criticality
 * index of every activity simulated (the share of runs in which it had no float); and the
 * **drivers**, the ranged activities whose drawn duration moves the finish most (Spearman's rank
 * correlation between the activity's durations and the finish, over the runs), five at most, and
 * only those whose correlation is clearly not noise.
 *
 * Said in natural frequencies (decision 5): `naturalFrequency` turns a chance into "N in 10", by
 * **floor** — a chance of 0.79 reads "7 in 10", never "8 in 10": the words never promise more than
 * the runs showed. "10 in 10" only when every run finished by then; "fewer than 1 in 10" for a
 * chance above 0 and below a tenth; "almost no chance" when no run did (the runs cannot prove never).
 * The engineer's percent is floored the same way, so the two never disagree.
 *
 * What this module is not: text, storage or a clock. It returns data, message keys and params; the
 * interface says them in the person's language.
 */

import { isIsoDay, workingDaysBetween, workingDaysFrom, type WorkingCalendar } from '../calendar';
import { progress as progressOf, type ActivityProgress, type DiaryEntry } from '../diary';
import { chanceFigure, counted, type ChanceFigure, type ChanceRow, type Figure } from '../figure';
import {
  durationRangeOf,
  hasDuration,
  latestBaseline,
  type Activity,
  type WorkSnapshot,
} from '../plan';
import { network } from './criticalPath';
import { edgesInto, edgesOut } from './graph';
import type { Schedule } from './index';

// ── Constants ────────────────────────────────────────────────────────────────

/** How many runs a simulation makes, unless the plan is too large for them (`runsFor`). */
export const PROBABILITY_RUNS = 2_000;

/** The fewest runs a simulation makes, however large the plan. */
export const PROBABILITY_MIN_RUNS = 200;

/**
 * How much work one simulation may do, counted in activities plus links passed over, forward and
 * back, in all its runs together. Set from the large-work benchmark (2 000 activities, 400 of them
 * ranged, 3 000 links: 20 million passed over in 2 000 runs, measured at about 110 to 150 ms on
 * the development machine, 2026-09-29), so that the largest simulation stays near 300 ms there: a
 * plan twice the large work's size (10 000 activities and links) is the largest that gets every
 * run (`runsFor`).
 */
export const PROBABILITY_WORK_BUDGET = 40_000_000;

/** How many drivers are named, at most. */
export const PROBABILITY_DRIVERS = 5;

/**
 * The smallest rank correlation a driver may have. Below it an activity barely moves the finish,
 * and with few runs it could be noise: the floor is also three standard errors of a correlation of
 * nothing (`3 / √(runs − 1)`), whichever is larger.
 */
export const PROBABILITY_MIN_DRIVER_CORRELATION = 0.1;

/** The shares of runs the dates are given for: P50, P80, P90, in whole percent. */
export const PROBABILITY_PERCENTILES = [50, 80, 90] as const;

/**
 * Every sentence and figure name this module gives the interface, as message keys, each new in
 * slice D1 and registered by the interface in both languages. Params in braces.
 *
 * - `frequency.*`: the chance in natural frequencies — `none` "almost no chance"; `underOne`
 *   "fewer than 1 in 10 chances"; `inTen` `{n}` "{n} in 10 chances"; `every` "10 in 10 chances".
 * - `headline`: `{chance}` (a frequency, said), `{date}` — "{chance} of finishing by {date}".
 * - `planChance`: `{date}`, `{chance}` — "The plan's date, {date}, has {chance}."
 * - `baselineChance`: `{number}`, `{date}`, `{chance}` — "Baseline {number}'s date, {date}, has
 *   {chance}."
 * - `allCertain` — "Every activity is counted as certain, so the finish is the plan's date. Give
 *   activities an optimistic and a pessimistic duration to see the chance."
 * - `certainCount`: `{certain}`, `{total}` — "{certain} of {total} activities are counted as
 *   certain: they have a duration and no range."
 * - `unplacedCount`: `{unplaced}` — "{unplaced} activities have neither a duration nor a range, and
 *   are left out."
 * - `method`: `{runs}` — "{runs} runs of this schedule with the ranges given; seeded, so the same
 *   plan gives the same numbers."
 * - `capped`: `{runs}`, `{max}` — "This plan is large, so {runs} runs were made instead of {max}."
 * - `leftOut` — "Each activity is drawn on its own: a rainy month that slows everything at once is
 *   not in the runs."
 * - `criticalIn`: `{n}` — "critical in {n} of 10 runs" (a bar's accessible label).
 * - `figure.*`: the figures' names. `problem.*`: why nothing could be simulated.
 */
export const PROBABILITY_MESSAGE_KEYS = {
  title: 'schedule.probability.title',
  frequency: {
    none: 'schedule.probability.frequency.none',
    'under-one': 'schedule.probability.frequency.underOne',
    'in-ten': 'schedule.probability.frequency.inTen',
    every: 'schedule.probability.frequency.every',
  },
  headline: 'schedule.probability.headline',
  planChance: 'schedule.probability.planChance',
  baselineChance: 'schedule.probability.baselineChance',
  allCertain: 'schedule.probability.allCertain',
  certainCount: 'schedule.probability.certainCount',
  unplacedCount: 'schedule.probability.unplacedCount',
  method: 'schedule.probability.method',
  capped: 'schedule.probability.capped',
  leftOut: 'schedule.probability.leftOut',
  criticalIn: 'schedule.probability.criticalIn',
  figure: {
    p80: 'schedule.probability.figure.p80',
    plan: 'schedule.probability.figure.plan',
    baseline: 'schedule.probability.figure.baseline',
    criticality: 'schedule.probability.figure.criticality',
  },
  problem: {
    'invalid-calendar': 'schedule.probability.problem.invalidCalendar',
    'invalid-start': 'schedule.probability.problem.invalidStart',
    cyclic: 'schedule.probability.problem.cyclic',
    'nothing-placed': 'schedule.probability.problem.nothingPlaced',
  },
} as const;

type Keys = typeof PROBABILITY_MESSAGE_KEYS;

// ── Natural frequencies ──────────────────────────────────────────────────────

/** How a chance is said: never more than the runs showed. */
export type FrequencyKind = keyof Keys['frequency'];

export interface NaturalFrequency {
  readonly kind: FrequencyKind;
  /** Whole tenths, floored: 0 to 9, and 10 only when every run finished by then. */
  readonly n: number;
  /** Whole percent, floored the same way: 100 only when every run did. For the engineer's detail. */
  readonly percent: number;
  readonly messageKey: Keys['frequency'][FrequencyKind];
  readonly params: { readonly n: number };
}

/**
 * Tolerance for a chance that is a whole number of tenths or hundredths but not exactly
 * representable (0.29 × 100 is 28.999…). A share of at most a few thousand runs is never this close
 * to a whole tenth without being on it.
 */
const EPSILON = 1e-9;

/**
 * A chance, from 0 to 1, in natural frequencies. **Floor, not round**: 0.79 is "7 in 10", so the
 * words never promise more than the runs showed; "10 in 10" and 100 % only for a chance of exactly 1;
 * "fewer than 1 in 10" above 0 and below a tenth; "almost no chance" at 0. Throws a `RangeError` for
 * a chance that is not a number from 0 to 1: that is a programming error, not something typed.
 */
export function naturalFrequency(chance: number): NaturalFrequency {
  if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
    throw new RangeError(`A chance is a number from 0 to 1, not ${chance}`);
  }
  const every = chance === 1;
  const n = every ? 10 : Math.min(9, Math.floor(chance * 10 + EPSILON));
  const percent = every ? 100 : Math.min(99, Math.floor(chance * 100 + EPSILON));
  const kind: FrequencyKind = every
    ? 'every'
    : chance === 0
      ? 'none'
      : n === 0
        ? 'under-one'
        : 'in-ten';
  return { kind, n, percent, messageKey: PROBABILITY_MESSAGE_KEYS.frequency[kind], params: { n } };
}

// ── The seeded generator ─────────────────────────────────────────────────────

/**
 * A seeded generator of numbers in `[0, 1)`: mulberry32, 32 bits of state. Small, fast, and the same
 * sequence on every machine for the same seed — what makes the same plan give the same numbers.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, 32 bits, over a text's UTF-16 code units: the seed of a plan's scheduling inputs. */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ── The model of one activity ────────────────────────────────────────────────

/** Why an activity is certain. */
export type CertainSource =
  /** A duration and no range. */
  | 'duration'
  /** The diary says it is finished: the working days it really took. */
  | 'finished'
  /** Its stage is closed: its duration is a fact now. */
  | 'closed'
  /** The diary says it has already taken more than its duration or its pessimistic end. */
  | 'started'
  /** Its range is one number. */
  | 'range-of-one';

export type ActivityModel =
  | {
      readonly kind: 'certain';
      readonly activityId: string;
      /** Working days, in every run. */
      readonly days: number;
      readonly source: CertainSource;
    }
  | {
      readonly kind: 'ranged';
      readonly activityId: string;
      /** The optimistic end, the peak and the pessimistic end, in working days. */
      readonly min: number;
      readonly mode: number;
      readonly max: number;
      /** The fewest working days a run may give it: `min`, or what the diary says it has taken. */
      readonly atLeast: number;
      /** `started` when the diary cut the range; `range` otherwise. */
      readonly source: 'range' | 'started';
      /** The duration lay outside the range given, and the range was widened to take it in. */
      readonly widened: boolean;
    }
  | {
      readonly kind: 'unplaced';
      readonly activityId: string;
      readonly reason: 'no-duration' | 'no-stage';
    };

/** Working days from one diary day to another, both counted, never below 1. */
function daysTaken(calendar: WorkingCalendar, from: string, to: string): number {
  return Math.max(1, workingDaysBetween(calendar, from, to));
}

/** The model of one activity, from the plan, its stage and what the diary says of it. */
export function activityModel(
  activity: Activity,
  stage: { readonly closed: boolean } | null,
  said: ActivityProgress | null,
  calendar: WorkingCalendar,
): ActivityModel {
  const activityId = activity.id;
  if (stage === null) return { kind: 'unplaced', activityId, reason: 'no-stage' };
  if (said !== null && said.state === 'finished') {
    const days = daysTaken(calendar, said.startedOn!, said.finishedOn!);
    return { kind: 'certain', activityId, days, source: 'finished' };
  }
  const duration = hasDuration(activity) ? activity.durationDays! : null;
  if (stage.closed) {
    return duration === null
      ? { kind: 'unplaced', activityId, reason: 'no-duration' }
      : { kind: 'certain', activityId, days: duration, source: 'closed' };
  }

  const taken =
    said !== null && said.state === 'started'
      ? daysTaken(calendar, said.startedOn!, said.lastOn!)
      : 0;
  const certain = (days: number, source: CertainSource): ActivityModel =>
    taken > days
      ? { kind: 'certain', activityId, days: taken, source: 'started' }
      : { kind: 'certain', activityId, days, source };

  const given = durationRangeOf(activity);
  if (given !== null) {
    // A duration outside the range widens it: the peak must lie inside its own triangle.
    const min = duration === null ? given.min : Math.min(given.min, duration);
    const max = duration === null ? given.max : Math.max(given.max, duration);
    if (min === max) return certain(min, 'range-of-one');
    // Already past its pessimistic end: what it has taken so far is all that is known.
    if (taken > max) return certain(taken, 'started');
    return {
      kind: 'ranged',
      activityId,
      min,
      mode: duration ?? (min + max) / 2,
      max,
      atLeast: Math.max(min, taken),
      source: taken > min ? 'started' : 'range',
      widened: min !== given.min || max !== given.max,
    };
  }
  if (duration !== null) return certain(duration, 'duration');
  return { kind: 'unplaced', activityId, reason: 'no-duration' };
}

/**
 * The triangular distribution's cumulative share at `x`, strictly between `a` and `b` (it is only
 * asked where a started activity's range is cut, which is always inside it).
 */
function triangularCdf(x: number, a: number, c: number, b: number): number {
  if (x <= c) return ((x - a) * (x - a)) / ((b - a) * (c - a));
  return 1 - ((b - x) * (b - x)) / ((b - a) * (b - c));
}

/** The triangular distribution's value at cumulative share `u`, from 0 to 1. */
function triangularAt(u: number, a: number, c: number, b: number): number {
  const peak = (c - a) / (b - a);
  return u < peak
    ? a + Math.sqrt(u * (b - a) * (c - a))
    : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

// ── The result ───────────────────────────────────────────────────────────────

/** One finish date the runs gave, and how often. */
export interface FinishPoint {
  readonly date: string;
  /** Working days from day 0 to the finish, the finish day counted (day 0 alone is 1). */
  readonly offset: number;
  /** Runs that finished on this date. */
  readonly runs: number;
  /** Runs that finished on or before this date. */
  readonly cumulative: number;
  /** `cumulative / runs of the simulation`: the chance of finishing by this date. */
  readonly chance: number;
}

/** A date and the chance of finishing by it. */
export interface DateChance {
  readonly date: string;
  readonly chance: number;
  /** Runs finished by the date. */
  readonly hits: number;
  readonly frequency: NaturalFrequency;
}

/** How often an activity had no float, across the runs. */
export interface ActivityCriticality {
  readonly activityId: string;
  readonly name: string;
  /** Runs in which it had no float. */
  readonly criticalRuns: number;
  /** `criticalRuns / runs`: its criticality index, from 0 to 1. */
  readonly index: number;
  /** "Critical in N of 10 runs", floored as every frequency is. */
  readonly frequency: NaturalFrequency;
}

/** An activity whose drawn duration moves the finish. */
export interface Driver {
  readonly activityId: string;
  readonly name: string;
  /** Spearman's rank correlation between its drawn durations and the finish: above 0, at most 1. */
  readonly correlation: number;
  /** Its criticality index. */
  readonly criticality: number;
  readonly min: number;
  readonly mode: number;
  readonly max: number;
}

/** How the plan's activities were counted. */
export interface ProbabilityCounts {
  /** Taken as certain: the same duration in every run. */
  readonly certain: number;
  /** Drawn from a range. */
  readonly ranged: number;
  /** Neither: no days, left out. */
  readonly unplaced: number;
  /** Every activity of the plan. */
  readonly total: number;
}

/** The finish, as a probability. */
export interface FinishProbability {
  readonly ok: true;
  /** Runs made. */
  readonly runs: number;
  /** Fewer runs than `PROBABILITY_RUNS`, because the plan is large (`runsFor`). */
  readonly capped: boolean;
  /** The seed the runs were drawn with: a hash of the scheduling inputs, unless one was given. */
  readonly seed: number;
  /** Day 0: the first working day on or after the start date. */
  readonly day0: string;
  /** Every finish date the runs gave, in order, with how often. */
  readonly distribution: readonly FinishPoint[];
  /** The earliest and the latest finish of any run (P0 and P100). */
  readonly earliest: string;
  readonly latest: string;
  /** The first date by which half, eight tenths, nine tenths of the runs had finished. */
  readonly p50: string;
  readonly p80: string;
  readonly p90: string;
  /** The headline: the P80 date and the chance of finishing by it. */
  readonly headline: DateChance;
  /** The plan's own finish date and its chance; `null` when the schedule places nothing. */
  readonly plan: DateChance | null;
  /** The latest baseline's finish date and its chance; `null` when there is none. */
  readonly baseline: (DateChance & { readonly number: number }) | null;
  /** Every activity simulated, in plan order, with its criticality index. */
  readonly criticality: readonly ActivityCriticality[];
  /** Up to five ranged activities that move the finish most, strongest first. */
  readonly drivers: readonly Driver[];
  /** How every activity of the plan was modelled, in plan order. */
  readonly models: readonly ActivityModel[];
  readonly counts: ProbabilityCounts;
  /** Nothing has a range: every run is the same, and the page says so (`allCertain`). */
  readonly allCertain: boolean;
  /** The figures that carry their rows. */
  readonly figures: {
    /** The P80 chance; its rows are the drivers, then the activities counted as certain. */
    readonly p80: ChanceFigure<ChanceRow>;
    /** The plan's date's chance, with the same rows; `null` with `plan`. */
    readonly plan: ChanceFigure<ChanceRow> | null;
    /** The latest baseline's date's chance, with the same rows; `null` with `baseline`. */
    readonly baseline: ChanceFigure<ChanceRow> | null;
    /** Every activity simulated, each with its criticality index. */
    readonly criticality: Figure<ChanceRow>;
  };
  /** The chance of finishing by `date` (`chanceBy`). */
  readonly chanceBy: (date: string) => number;
}

/** Why nothing could be simulated. */
export type ProbabilityProblem = keyof Keys['problem'];

export interface FinishProbabilityRefused {
  readonly ok: false;
  readonly code: ProbabilityProblem;
  readonly messageKey: Keys['problem'][ProbabilityProblem];
}

export type FinishProbabilityResult = FinishProbability | FinishProbabilityRefused;

/**
 * One run, as the per-run hook sees it (slice E2): where each activity fell in it, in working-day
 * offsets from day 0. The arrays are the engine's own and are **overwritten by the next run**: a hook
 * reads them while it is called and copies whatever it keeps.
 */
export interface SimulatedRun {
  /** The run, from 0. */
  readonly run: number;
  /**
   * The activities the runs place, in the order the arrays use (the network's topological order);
   * the same array in every call.
   */
  readonly activityIds: readonly string[];
  /** Each activity's first working day, as an offset from day 0 (day 0 is offset 0). */
  readonly start: Int32Array;
  /**
   * Each activity's end, as an offset: its first day plus its working days, so its last working day
   * is `finish − 1`. An activity that takes no days (`placed` 0) has no day at all.
   */
  readonly finish: Int32Array;
  /** 1 when the activity takes days in the runs (a duration or a range), 0 when it is left out. */
  readonly placed: Uint8Array;
  /** The run's finish, as `finish` counts: the work's last working day is `end − 1`. */
  readonly end: number;
}

export interface FinishProbabilityOptions {
  /** The diary, for what has already happened. None: nothing has. */
  readonly entries?: readonly DiaryEntry[];
  /** Runs to make instead of `runsFor`'s, a whole number from 1 (tests; never the screen). */
  readonly runs?: number;
  /** A seed instead of the plan's own (tests; never the screen). */
  readonly seed?: number;
  /** A work budget instead of `PROBABILITY_WORK_BUDGET`, for `runsFor` (tests; never the screen). */
  readonly workBudget?: number;
  /**
   * Called once per run, after its forward pass, with where every activity fell (slice E2: the
   * runway's chance places money on each run's dates). It only reads: it draws nothing, so the runs,
   * the seed and every result are exactly what they are without it.
   */
  readonly onRun?: (run: SimulatedRun) => void;
}

/**
 * How many runs a plan of `activities` activities and `links` activity edges gets:
 * `PROBABILITY_RUNS`, or, when that would pass over more than `budget` (`PROBABILITY_WORK_BUDGET`)
 * activities
 * and links in all (forward and back, so twice each per run), as many as fit, rounded down to a
 * hundred, and never fewer than `PROBABILITY_MIN_RUNS`.
 */
export function runsFor(
  activities: number,
  links: number,
  budget: number = PROBABILITY_WORK_BUDGET,
): number {
  const perRun = 2 * (activities + links);
  if (perRun * PROBABILITY_RUNS <= budget) return PROBABILITY_RUNS;
  const fit = Math.floor(budget / perRun / 100) * 100;
  return Math.max(PROBABILITY_MIN_RUNS, fit);
}

/**
 * The chance of finishing by `date`: the share of runs whose finish is on or before it. 0 before
 * the earliest finish; 1 from the latest. Throws a `RangeError` for a day that is not `YYYY-MM-DD`.
 */
export function chanceBy(distribution: readonly FinishPoint[], date: string): number {
  if (!isIsoDay(date)) throw new RangeError(`Not a YYYY-MM-DD day: ${JSON.stringify(date)}`);
  let low = 0;
  let high = distribution.length;
  // The number of points on or before the date.
  while (low < high) {
    const middle = (low + high) >> 1;
    if (distribution[middle]!.date <= date) low = middle + 1;
    else high = middle;
  }
  return low === 0 ? 0 : distribution[low - 1]!.chance;
}

// ── The simulation ───────────────────────────────────────────────────────────

/** Average ranks, 1-based, of small whole numbers: ties share the mean of their places. */
function ranksOf(values: Int32Array, from: number, length: number): Float64Array {
  let low = values[from]!;
  let high = low;
  for (let i = from; i < from + length; i += 1) {
    const value = values[i]!;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const counts = new Int32Array(high - low + 1);
  for (let i = from; i < from + length; i += 1) {
    const j = values[i]! - low;
    counts[j] = counts[j]! + 1;
  }
  const rankOf = new Float64Array(counts.length);
  let below = 0;
  for (let j = 0; j < counts.length; j += 1) {
    rankOf[j] = below + (counts[j]! + 1) / 2;
    below += counts[j]!;
  }
  const ranks = new Float64Array(length);
  for (let i = 0; i < length; i += 1) ranks[i] = rankOf[values[from + i]! - low]!;
  return ranks;
}

/** Pearson's correlation of two rank lists of the same length; `null` when either never varies. */
function correlationOf(x: Float64Array, y: Float64Array): number | null {
  const mean = (x.length + 1) / 2;
  let xy = 0;
  let xx = 0;
  let yy = 0;
  for (let i = 0; i < x.length; i += 1) {
    const dx = x[i]! - mean;
    const dy = y[i]! - mean;
    xy += dx * dy;
    xx += dx * dx;
    yy += dy * dy;
  }
  if (xx === 0 || yy === 0) return null;
  return Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy)));
}

/** The text a plan's seed is the hash of: everything the runs depend on, and nothing else. */
function seedText(
  snapshot: WorkSnapshot,
  ordered: readonly number[],
  models: readonly ActivityModel[],
  predecessors: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
): string {
  const parts: string[] = [
    snapshot.work.startDate,
    snapshot.calendar.workingDays,
    [...snapshot.holidays.map((holiday) => holiday.date)].sort().join(','),
  ];
  for (const at of ordered) {
    const model = models[at]!;
    const own =
      model.kind === 'certain'
        ? `c${model.days}`
        : model.kind === 'ranged'
          ? `r${model.min},${model.mode},${model.max},${model.atLeast}`
          : 'u';
    const links = predecessors[at]!.map(([from, lag]) => `${models[from]!.activityId}+${lag}`);
    parts.push(`${model.activityId}:${own}<${links.join(';')}`);
  }
  return parts.join('\u0000');
}

/**
 * The finish as a probability: `runs` runs of the schedule with each activity's duration drawn from
 * its range, and what they say. `scheduled` is `schedule(snapshot)`; the diary, when given, says
 * what has already happened. Refused, with the reason, when nothing can be simulated: the calendar
 * or the start date cannot be counted on, the links hold a cycle, or no activity has a duration or a
 * range. Never throws for a plan the host could hand over.
 */
export function finishProbability(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  options: FinishProbabilityOptions = {},
): FinishProbabilityResult {
  const refuse = (code: ProbabilityProblem): FinishProbabilityRefused => ({
    ok: false,
    code,
    messageKey: PROBABILITY_MESSAGE_KEYS.problem[code],
  });
  const calendar = scheduled.calendar;
  if (calendar === null) return refuse('invalid-calendar');
  if (scheduled.day0 === null) return refuse('invalid-start');
  if (scheduled.cyclic) return refuse('cyclic');

  // ── Every activity's model, in plan order ─────────────────────────────────
  const stages = new Map(
    snapshot.stages.map((stage) => [stage.id, { closed: stage.closedAt !== null }]),
  );
  const said = progressOf(snapshot, options.entries ?? []);
  const activities = scheduled.activities;
  const models = activities.map((activity) =>
    activityModel(
      activity,
      stages.get(activity.stageId) ?? null,
      // The diary's progress holds every activity of the plan.
      said.get(activity.id)!,
      calendar,
    ),
  );
  const counts: ProbabilityCounts = {
    certain: models.filter((model) => model.kind === 'certain').length,
    ranged: models.filter((model) => model.kind === 'ranged').length,
    unplaced: models.filter((model) => model.kind === 'unplaced').length,
    total: models.length,
  };
  if (counts.certain + counts.ranged === 0) return refuse('nothing-placed');

  // ── The network, exactly as the schedule plans it ─────────────────────────
  // The activities `schedule()` passes to `plan()`: those whose stage is in the plan.
  const planIndex = new Map<string, number>();
  const plannableIds: string[] = [];
  activities.forEach((activity, index) => {
    if (!stages.has(activity.stageId)) return;
    planIndex.set(activity.id, index);
    plannableIds.push(activity.id);
  });
  const net = network(plannableIds, scheduled.edges);
  const n = net.ordered.length;
  /** Topological position → plan position. */
  const ordered = net.ordered.map((id) => planIndex.get(id)!);
  const topo = new Map(net.ordered.map((id, at) => [id, at]));

  const predecessors: Array<Array<readonly [number, number]>> = activities.map(() => []);
  const predOffset = new Int32Array(n + 1);
  const succOffset = new Int32Array(n + 1);
  const predIndex: number[] = [];
  const predLag: number[] = [];
  const succIndex: number[] = [];
  const succLag: number[] = [];
  for (let at = 0; at < n; at += 1) {
    const id = net.ordered[at]!;
    for (const edge of edgesInto(net.graph, id)) {
      predIndex.push(topo.get(edge.blockerId)!);
      predLag.push(edge.lagDays);
      predecessors[ordered[at]!]!.push([planIndex.get(edge.blockerId)!, edge.lagDays]);
    }
    predOffset[at + 1] = predIndex.length;
    for (const edge of edgesOut(net.graph, id)) {
      succIndex.push(topo.get(edge.blockedId)!);
      succLag.push(edge.lagDays);
    }
    succOffset[at + 1] = succIndex.length;
  }
  const preds = Int32Array.from(predIndex);
  const predLags = Int32Array.from(predLag);
  const succs = Int32Array.from(succIndex);
  const succLags = Int32Array.from(succLag);

  // Durations: certain ones set once; ranged ones redrawn every run.
  const duration = new Int32Array(n);
  const placed = new Uint8Array(n);
  const rangedAt: number[] = [];
  const rangedModels: Array<Extract<ActivityModel, { kind: 'ranged' }>> = [];
  for (let at = 0; at < n; at += 1) {
    const model = models[ordered[at]!]!;
    if (model.kind === 'unplaced') continue;
    placed[at] = 1;
    if (model.kind === 'certain') {
      duration[at] = model.days;
    } else {
      rangedAt.push(at);
      rangedModels.push(model);
    }
  }
  const r = rangedAt.length;
  const low = new Float64Array(r);
  const lowShare = new Float64Array(r);
  const mode = new Float64Array(r);
  const high = new Float64Array(r);
  rangedModels.forEach((model, k) => {
    low[k] = model.min;
    mode[k] = model.mode;
    high[k] = model.max;
    // A started activity is drawn from what is left of its triangle: every value rounding to at
    // least the days it has taken.
    lowShare[k] =
      model.atLeast > model.min
        ? triangularCdf(model.atLeast - 0.5, model.min, model.mode, model.max)
        : 0;
  });

  const edgeCount = preds.length;
  const runs =
    options.runs !== undefined
      ? Math.max(1, Math.floor(options.runs))
      : runsFor(n, edgeCount, options.workBudget);
  const seed =
    options.seed !== undefined
      ? options.seed >>> 0
      : hashText(seedText(snapshot, ordered, models, predecessors));
  const random = mulberry32(seed);

  // ── The runs ──────────────────────────────────────────────────────────────
  const finishes = new Int32Array(runs);
  const samples = new Int32Array(runs * r);
  const criticalRuns = new Int32Array(n);
  const earliestStart = new Int32Array(n);
  const earliestFinish = new Int32Array(n);
  const latestStart = new Int32Array(n);
  const onRun = options.onRun;
  const seen: { -readonly [K in keyof SimulatedRun]: SimulatedRun[K] } = {
    run: 0,
    activityIds: net.ordered,
    start: earliestStart,
    finish: earliestFinish,
    placed,
    end: 0,
  };

  for (let run = 0; run < runs; run += 1) {
    for (let k = 0; k < r; k += 1) {
      const u = lowShare[k]! + random() * (1 - lowShare[k]!);
      const days = Math.max(1, Math.round(triangularAt(u, low[k]!, mode[k]!, high[k]!)));
      duration[rangedAt[k]!] = days;
      samples[k * runs + run] = days;
    }

    // Forward: as `plan()`, the end is the latest finish of anything, the finish of anything placed.
    let end = 0;
    let finish = 0;
    for (let at = 0; at < n; at += 1) {
      let start = 0;
      for (let p = predOffset[at]!; p < predOffset[at + 1]!; p += 1) {
        const ready = earliestFinish[preds[p]!]! + predLags[p]!;
        if (ready > start) start = ready;
      }
      const done = start + duration[at]!;
      earliestStart[at] = start;
      earliestFinish[at] = done;
      if (done > end) end = done;
      if (placed[at] === 1 && done > finish) finish = done;
    }
    finishes[run] = finish;
    if (onRun !== undefined) {
      seen.run = run;
      seen.end = finish;
      onRun(seen);
    }

    // Backward: no float in this run is what "critical" means, as in `plan()`.
    for (let at = n - 1; at >= 0; at -= 1) {
      let latest = end;
      for (let s = succOffset[at]!; s < succOffset[at + 1]!; s += 1) {
        const due = latestStart[succs[s]!]! - succLags[s]!;
        if (due < latest) latest = due;
      }
      const start = latest - duration[at]!;
      latestStart[at] = start;
      if (placed[at] === 1 && start === earliestStart[at]) criticalRuns[at] = criticalRuns[at]! + 1;
    }
  }

  // ── The distribution, on the calendar once ────────────────────────────────
  let first = finishes[0]!;
  let last = first;
  for (let run = 1; run < runs; run += 1) {
    if (finishes[run]! < first) first = finishes[run]!;
    if (finishes[run]! > last) last = finishes[run]!;
  }
  const tally = new Int32Array(last - first + 1);
  for (let run = 0; run < runs; run += 1)
    tally[finishes[run]! - first] = tally[finishes[run]! - first]! + 1;
  const days = workingDaysFrom(calendar, snapshot.work.startDate, last);
  const distribution: FinishPoint[] = [];
  let cumulative = 0;
  for (let j = 0; j < tally.length; j += 1) {
    if (tally[j] === 0) continue;
    cumulative += tally[j]!;
    const offset = first + j;
    distribution.push({
      date: days[offset - 1]!,
      offset,
      runs: tally[j]!,
      cumulative,
      chance: cumulative / runs,
    });
  }
  const by = (date: string) => chanceBy(distribution, date);
  const dateChance = (date: string): DateChance => {
    const chance = by(date);
    return { date, chance, hits: Math.round(chance * runs), frequency: naturalFrequency(chance) };
  };
  // The first date by which `percent` % of the runs had finished.
  const percentile = (percent: number): string =>
    distribution.find((point) => point.cumulative * 100 >= percent * runs)!.date;
  const [p50, p80, p90] = PROBABILITY_PERCENTILES.map(percentile) as [string, string, string];

  // ── Criticality and drivers ───────────────────────────────────────────────
  const topoOf = new Map(ordered.map((planAt, at) => [planAt, at]));
  const criticality: ActivityCriticality[] = [];
  const criticalityOf = new Map<string, number>();
  activities.forEach((activity, planAt) => {
    const at = topoOf.get(planAt);
    if (at === undefined || placed[at] === 0) return;
    const index = criticalRuns[at]! / runs;
    criticalityOf.set(activity.id, index);
    criticality.push({
      activityId: activity.id,
      name: activity.name,
      criticalRuns: criticalRuns[at]!,
      index,
      frequency: naturalFrequency(index),
    });
  });

  const threshold = Math.max(PROBABILITY_MIN_DRIVER_CORRELATION, 3 / Math.sqrt(runs - 1));
  const finishRanks = ranksOf(finishes, 0, runs);
  const candidates: Array<Driver & { readonly planAt: number }> = [];
  rangedModels.forEach((model, k) => {
    const correlation = correlationOf(ranksOf(samples, k * runs, runs), finishRanks);
    if (correlation === null || correlation < threshold) return;
    const planAt = ordered[rangedAt[k]!]!;
    candidates.push({
      activityId: model.activityId,
      name: activities[planAt]!.name,
      correlation,
      criticality: criticalityOf.get(model.activityId)!,
      min: model.min,
      mode: model.mode,
      max: model.max,
      planAt,
    });
  });
  // Plan order first, then strongest first: the sort is stable, so equals keep plan order.
  const drivers: Driver[] = candidates
    .sort((a, b) => a.planAt - b.planAt)
    .sort((a, b) => b.correlation - a.correlation)
    .slice(0, PROBABILITY_DRIVERS)
    .map(({ planAt: _planAt, ...driver }) => driver);

  // ── The dates people ask about ────────────────────────────────────────────
  const headline = dateChance(p80);
  const plan = scheduled.finishDate === null ? null : dateChance(scheduled.finishDate);
  const latest = latestBaseline(snapshot);
  const baseline =
    latest !== null && isIsoDay(latest.finishDate)
      ? { number: latest.number, ...dateChance(latest.finishDate) }
      : null;

  // ── The figures ───────────────────────────────────────────────────────────
  const names = new Map(activities.map((activity) => [activity.id, activity.name]));
  const row = (role: ChanceRow['role'], activityId: string, share: number | null): ChanceRow => ({
    key: `${role}:${activityId}`,
    itemId: activityId,
    title: names.get(activityId)!,
    day: null,
    minutes: 0,
    role,
    share,
  });
  const dependsOn: ChanceRow[] = [
    ...drivers.map((driver) => row('driver', driver.activityId, driver.correlation)),
    ...models
      .filter((model) => model.kind === 'certain')
      .map((model) => row('certain', model.activityId, null)),
  ];
  const keys = PROBABILITY_MESSAGE_KEYS.figure;
  const figureOf = (id: string, label: string, at: DateChance): ChanceFigure<ChanceRow> =>
    chanceFigure(id, label, at.hits, runs, at.date, dependsOn);

  return {
    ok: true,
    runs,
    capped: runs < PROBABILITY_RUNS && options.runs === undefined,
    seed,
    day0: scheduled.day0,
    distribution,
    earliest: distribution[0]!.date,
    latest: distribution.at(-1)!.date,
    p50,
    p80,
    p90,
    headline,
    plan,
    baseline,
    criticality,
    drivers,
    models,
    counts,
    allCertain: counts.ranged === 0,
    figures: {
      p80: figureOf('probability.p80', keys.p80, headline),
      plan: plan === null ? null : figureOf('probability.plan', keys.plan, plan),
      baseline:
        baseline === null ? null : figureOf('probability.baseline', keys.baseline, baseline),
      criticality: counted(
        'probability.criticality',
        keys.criticality,
        criticality.map((each) => row('critical', each.activityId, each.index)),
      ),
    },
    chanceBy: by,
  };
}
