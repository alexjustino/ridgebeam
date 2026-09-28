/**
 * What if: the plan scheduled again with some durations and lags changed, **in memory only**.
 *
 * A what-if is a question, not a change: `withOverrides` returns a new snapshot and leaves the one
 * it was given untouched, so scheduling it answers "when would we finish if the tiling took eight
 * days?" and nothing is written. **A what-if that is not saved is not a baseline**; keeping it means
 * replanning by hand, with a reason.
 *
 * It respects what the host would refuse and what has already happened: an override naming an
 * activity or a link the plan does not have is refused, and so is a duration outside what the host
 * accepts (a whole number of working days from 1 to 3650; a lag from 0 to 3650), a duration on an
 * activity of a **closed stage** (its work is a fact now), and two overrides of the same thing (one
 * would silently lose; `putOverride` replaces instead). Refusals are results, never exceptions, each
 * with the message key the interface says it with.
 *
 * `whatIfDelta` says how far the finish moved between two schedules, in working days, with the
 * activities whose finish moved as its rows. Against the latest baseline, the slip (`slip.ts`) of
 * the what-if's schedule says the same thing. What this module is not: storage, or text.
 */

import { workingDaysUntil, type WorkingCalendar } from '../calendar';
import { daysFigure, type DaysRow, type Figure } from '../figure';
import type { WorkSnapshot } from '../plan';
import type { Schedule } from './index';

/** One change a what-if makes: an activity's duration, or a link's lag, in working days. */
export type Override =
  | { readonly kind: 'duration'; readonly activityId: string; readonly durationDays: number }
  | { readonly kind: 'lag'; readonly dependencyId: string; readonly lagDays: number };

/** The most working days a duration or a lag may be: the host's limit, so a what-if can be made. */
export const WHAT_IF_LIMIT_DAYS = 3650;

/** How the interface says each refusal. */
export const WHAT_IF_PROBLEM_KEYS = {
  'unknown-activity': 'schedule.whatIf.problem.unknownActivity',
  'unknown-dependency': 'schedule.whatIf.problem.unknownDependency',
  'closed-stage': 'schedule.whatIf.problem.closedStage',
  'invalid-duration': 'schedule.whatIf.problem.invalidDuration',
  'invalid-lag': 'schedule.whatIf.problem.invalidLag',
  duplicate: 'schedule.whatIf.problem.duplicate',
} as const;

/** A refusal's message key. */
export type WhatIfMessageKey = (typeof WHAT_IF_PROBLEM_KEYS)[keyof typeof WHAT_IF_PROBLEM_KEYS];

/** What was refused, and about what. */
export type WhatIfProblemDetail =
  | { readonly code: 'unknown-activity'; readonly activityId: string }
  | { readonly code: 'unknown-dependency'; readonly dependencyId: string }
  | { readonly code: 'closed-stage'; readonly activityId: string; readonly stageId: string }
  | {
      readonly code: 'invalid-duration';
      readonly activityId: string;
      readonly durationDays: number;
    }
  | { readonly code: 'invalid-lag'; readonly dependencyId: string; readonly lagDays: number }
  | { readonly code: 'duplicate'; readonly target: string };

/** Why an override was refused, with the key the interface says it with. */
export type WhatIfProblem = WhatIfProblemDetail & { readonly messageKey: WhatIfMessageKey };

export type WhatIfResult =
  | { readonly ok: true; readonly snapshot: WorkSnapshot }
  | { readonly ok: false; readonly problems: readonly WhatIfProblem[] };

function problem(detail: WhatIfProblemDetail): WhatIfProblem {
  return { ...detail, messageKey: WHAT_IF_PROBLEM_KEYS[detail.code] };
}

/** What an override changes, as one key: `activity:<id>` or `dependency:<id>`. */
export function overrideTarget(override: Override): string {
  return override.kind === 'duration'
    ? `activity:${override.activityId}`
    : `dependency:${override.dependencyId}`;
}

/** The list with `next` in it: in place of an override of the same thing, or added at the end. */
export function putOverride(overrides: readonly Override[], next: Override): Override[] {
  const target = overrideTarget(next);
  const at = overrides.findIndex((override) => overrideTarget(override) === target);
  if (at === -1) return [...overrides, next];
  return overrides.map((override, index) => (index === at ? next : override));
}

const wholeIn = (value: number, min: number): boolean =>
  Number.isInteger(value) && value >= min && value <= WHAT_IF_LIMIT_DAYS;

/** Check one override against the plan, before it is added. Every problem is reported. */
export function validateOverride(snapshot: WorkSnapshot, override: Override): WhatIfProblem[] {
  if (override.kind === 'lag') {
    const problems: WhatIfProblem[] = [];
    const { dependencyId, lagDays } = override;
    if (!snapshot.dependencies.some((dependency) => dependency.id === dependencyId)) {
      problems.push(problem({ code: 'unknown-dependency', dependencyId }));
    }
    if (!wholeIn(lagDays, 0))
      problems.push(problem({ code: 'invalid-lag', dependencyId, lagDays }));
    return problems;
  }
  const { activityId, durationDays } = override;
  const problems: WhatIfProblem[] = [];
  const activity = snapshot.activities.find((each) => each.id === activityId);
  if (activity === undefined) {
    problems.push(problem({ code: 'unknown-activity', activityId }));
  } else {
    const stage = snapshot.stages.find((each) => each.id === activity.stageId);
    if (stage !== undefined && stage.closedAt !== null) {
      problems.push(problem({ code: 'closed-stage', activityId, stageId: stage.id }));
    }
  }
  if (!wholeIn(durationDays, 1)) {
    problems.push(problem({ code: 'invalid-duration', activityId, durationDays }));
  }
  return problems;
}

/**
 * The plan with the overrides applied, as a new snapshot; the one given is never touched. Refused,
 * with every problem, when any override is. No overrides give back an equal, new snapshot.
 */
export function withOverrides(
  snapshot: WorkSnapshot,
  overrides: readonly Override[],
): WhatIfResult {
  const problems: WhatIfProblem[] = [];
  const seen = new Set<string>();
  const durations = new Map<string, number>();
  const lags = new Map<string, number>();
  for (const override of overrides) {
    const target = overrideTarget(override);
    if (seen.has(target)) problems.push(problem({ code: 'duplicate', target }));
    seen.add(target);
    problems.push(...validateOverride(snapshot, override));
    if (override.kind === 'duration') durations.set(override.activityId, override.durationDays);
    else lags.set(override.dependencyId, override.lagDays);
  }
  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    snapshot: {
      ...snapshot,
      activities: snapshot.activities.map((activity) =>
        durations.has(activity.id)
          ? { ...activity, durationDays: durations.get(activity.id)! }
          : activity,
      ),
      dependencies: snapshot.dependencies.map((dependency) =>
        lags.has(dependency.id) ? { ...dependency, lagDays: lags.get(dependency.id)! } : dependency,
      ),
    },
  };
}

// ── How far it moved ─────────────────────────────────────────────────────────

/** How an activity's finish differs in the what-if. */
export type WhatIfChange = 'moved' | 'placed' | 'unplaced';

/** An activity whose finish is not the same in the what-if. */
export interface WhatIfRow extends DaysRow {
  readonly activityId: string;
  readonly name: string;
  readonly change: WhatIfChange;
  readonly beforeFinish: string | null;
  readonly afterFinish: string | null;
}

/** The what-if's figure name, as a message key. */
export const WHAT_IF_LABEL_KEY = 'schedule.whatIf.figure.moved';

export interface WhatIfDelta {
  /** The finish before, and in the what-if. */
  readonly from: string | null;
  readonly to: string | null;
  /** Working days the finish moved, signed; `null` when either has no finish to count from. */
  readonly days: number | null;
  /** The move as a days figure (0 when it cannot be counted), the activities that moved its rows. */
  readonly moved: Figure<WhatIfRow>;
}

/**
 * How far the finish moved from `before` to `after` (today's plan, and the what-if), in working
 * days on `calendar`, with every activity whose finish moved. Never throws.
 */
export function whatIfDelta(
  before: Schedule,
  after: Schedule,
  calendar: WorkingCalendar | null,
): WhatIfDelta {
  // A schedule's dates are days the calendar produced: always real ones.
  const diff = (from: string | null, to: string | null): number | null =>
    calendar === null || from === null || to === null ? null : workingDaysUntil(calendar, from, to);
  const reference = before.finishDate;

  const rows: WhatIfRow[] = [];
  for (const activity of after.activities) {
    const then = before.dates.get(activity.id)?.finish ?? null;
    const now = after.dates.get(activity.id)?.finish ?? null;
    if (then === now) continue;
    const change: WhatIfChange =
      then !== null && now !== null ? 'moved' : now === null ? 'unplaced' : 'placed';
    rows.push({
      key: `activity:${activity.id}`,
      itemId: activity.id,
      title: activity.name,
      day: now ?? then,
      minutes: 0,
      days: change === 'moved' ? (diff(then, now) ?? 0) : 0,
      againstFinish: diff(reference, now),
      activityId: activity.id,
      name: activity.name,
      change,
      beforeFinish: then,
      afterFinish: now,
    });
  }

  const days = diff(reference, after.finishDate);
  return {
    from: reference,
    to: after.finishDate,
    days,
    moved: daysFigure('whatIf', WHAT_IF_LABEL_KEY, days ?? 0, rows),
  };
}
