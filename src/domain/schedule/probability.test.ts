import { describe, expect, it } from 'vitest';

import {
  activity,
  entry,
  finished,
  link,
  onStage,
  snapshot,
  stage,
  takeBaseline,
  worked,
} from '../__fixtures__/plan';
import { traceable } from '../figure';
import type { Activity, Dependency, Stage, WorkSnapshot } from '../plan';
import { schedule } from './index';
import {
  PROBABILITY_DRIVERS,
  PROBABILITY_MESSAGE_KEYS,
  PROBABILITY_MIN_RUNS,
  PROBABILITY_RUNS,
  PROBABILITY_WORK_BUDGET,
  activityModel,
  chanceBy,
  finishProbability,
  hashText,
  mulberry32,
  naturalFrequency,
  runsFor,
  type FinishProbability,
  type FinishProbabilityOptions,
} from './probability';

/** An activity with a range, and a duration or none. */
const ranged = (
  id: string,
  stageId: string,
  position: number,
  durationDays: number | null,
  min: number,
  max: number,
): Activity => ({
  ...activity(id, stageId, position, durationDays),
  durationMinDays: min,
  durationMaxDays: max,
});

const closedStage = (id: string, position: number): Stage => ({
  ...stage(id, position),
  startedAt: '2026-09-01T08:00:00.000Z',
  closedAt: '2026-09-20T08:00:00.000Z',
});

/** Simulate, and insist it was simulated. */
function simulate(plan: WorkSnapshot, options: FinishProbabilityOptions = {}): FinishProbability {
  const result = finishProbability(plan, schedule(plan), options);
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result;
}

/** Everything but the function, for comparing two results. */
function data(result: FinishProbability): Omit<FinishProbability, 'chanceBy'> {
  const { chanceBy: _chanceBy, ...rest } = result;
  return rest;
}

/** The mean finish offset of the runs, in working days. */
function meanOffset(result: FinishProbability): number {
  return (
    result.distribution.reduce((sum, point) => sum + point.offset * point.runs, 0) / result.runs
  );
}

/** Tuesday 1 September 2026 on: a (3 days, 2–4) → b (4 days, 3–6) → c (1 day, 1–2). */
function chain(): WorkSnapshot {
  return snapshot({
    stages: [stage('s1', 1)],
    activities: [
      ranged('a', 's1', 1, 3, 2, 4),
      ranged('b', 's1', 2, 4, 3, 6),
      ranged('c', 's1', 3, 1, 1, 2),
    ],
    dependencies: [link('l1', 'a', 'b'), link('l2', 'b', 'c')],
  });
}

/**
 * A random plan: 3 to 14 activities in up to three stages, some with no duration, half with a
 * range around their duration (some with a range and no duration), links from earlier to later with
 * lags, sometimes onto a whole stage, and a holiday.
 */
function randomPlan(seed: number, withRanges: boolean): WorkSnapshot {
  const next = mulberry32(seed);
  const int = (below: number) => Math.floor(next() * below);
  const count = 3 + int(12);
  const stages = [stage('s1', 1), stage('s2', 2), stage('s3', 3)];
  const activities: Activity[] = Array.from({ length: count }, (_, i) => {
    const stageId = `s${1 + Math.floor((i * 3) / count)}`;
    const duration = next() < 0.12 ? null : 1 + int(6);
    const base = activity(`a${i}`, stageId, i + 1, duration);
    if (!withRanges || next() < 0.5) return base;
    if (duration === null) {
      const min = 1 + int(3);
      return { ...base, durationMinDays: min, durationMaxDays: min + 1 + int(4) };
    }
    return {
      ...base,
      durationMinDays: Math.max(1, duration - int(3)),
      durationMaxDays: duration + int(5),
    };
  });
  const dependencies: Dependency[] = [];
  for (let i = 0; i < count * 1.3; i += 1) {
    const from = int(count - 1);
    const to = from + 1 + int(count - from - 1);
    dependencies.push(link(`l${i}`, `a${from}`, `a${to}`, int(3)));
  }
  if (next() < 0.5) dependencies.push(link('ls', onStage('s1'), onStage('s3'), int(2)));
  return snapshot({
    holidays: [{ date: '2026-09-07', name: 'A holiday' }],
    stages,
    activities,
    dependencies,
  });
}

// ── Natural frequencies ──────────────────────────────────────────────────────

describe('natural frequencies', () => {
  it('floors, so the words never promise more than the runs showed', () => {
    expect(naturalFrequency(0.79)).toMatchObject({ kind: 'in-ten', n: 7, percent: 79 });
    expect(naturalFrequency(0.8)).toMatchObject({ kind: 'in-ten', n: 8, percent: 80 });
    expect(naturalFrequency(0.1)).toMatchObject({ kind: 'in-ten', n: 1, percent: 10 });
    expect(naturalFrequency(0.29)).toMatchObject({ n: 2, percent: 29 });
    expect(naturalFrequency(0.7)).toMatchObject({ n: 7, percent: 70 });
    expect(naturalFrequency(1999 / 2000)).toMatchObject({ kind: 'in-ten', n: 9, percent: 99 });
  });

  it('says every, fewer than one, and almost none in their own words', () => {
    expect(naturalFrequency(1)).toEqual({
      kind: 'every',
      n: 10,
      percent: 100,
      messageKey: 'schedule.probability.frequency.every',
      params: { n: 10 },
    });
    expect(naturalFrequency(0.05)).toEqual({
      kind: 'under-one',
      n: 0,
      percent: 5,
      messageKey: 'schedule.probability.frequency.underOne',
      params: { n: 0 },
    });
    expect(naturalFrequency(1 / 2000)).toMatchObject({ kind: 'under-one', percent: 0 });
    expect(naturalFrequency(0)).toMatchObject({
      kind: 'none',
      n: 0,
      percent: 0,
      messageKey: PROBABILITY_MESSAGE_KEYS.frequency.none,
    });
    expect(naturalFrequency(0.8).messageKey).toBe('schedule.probability.frequency.inTen');
  });

  it('refuses what is not a chance', () => {
    for (const bad of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => naturalFrequency(bad)).toThrow(RangeError);
    }
  });
});

// ── The generator and the seed ───────────────────────────────────────────────

describe('the seeded generator', () => {
  it('gives the same numbers for the same seed, in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const drawn = Array.from({ length: 1000 }, () => a());
    expect(drawn).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(drawn.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(mulberry32(43)()).not.toBe(mulberry32(42)());
  });

  it('hashes text the same way every time, and differently for a different text', () => {
    expect(hashText('')).toBe(0x811c9dc5);
    expect(hashText('ridgebeam')).toBe(hashText('ridgebeam'));
    expect(hashText('range 2-4')).not.toBe(hashText('range 2-5'));
    expect(Number.isInteger(hashText('x')) && hashText('x') >= 0).toBe(true);
  });
});

// ── How each activity is modelled ────────────────────────────────────────────

describe('the model of an activity', () => {
  const calendar = schedule(snapshot()).calendar!;
  const open = { closed: false };
  const notSaid = null;

  it('draws from a triangle when there is a range, peaked at the duration or the middle', () => {
    expect(activityModel(ranged('a', 's1', 1, 3, 2, 4), open, notSaid, calendar)).toEqual({
      kind: 'ranged',
      activityId: 'a',
      min: 2,
      mode: 3,
      max: 4,
      atLeast: 2,
      source: 'range',
      widened: false,
    });
    expect(activityModel(ranged('a', 's1', 1, null, 2, 5), open, notSaid, calendar)).toMatchObject({
      kind: 'ranged',
      min: 2,
      mode: 3.5,
      max: 5,
    });
  });

  it('widens a range that leaves out the duration, so the peak is inside its triangle', () => {
    expect(activityModel(ranged('a', 's1', 1, 5, 2, 4), open, notSaid, calendar)).toMatchObject({
      kind: 'ranged',
      min: 2,
      mode: 5,
      max: 5,
      widened: true,
    });
    expect(activityModel(ranged('a', 's1', 1, 1, 2, 4), open, notSaid, calendar)).toMatchObject({
      kind: 'ranged',
      min: 1,
      mode: 1,
      max: 4,
      widened: true,
    });
  });

  it('takes as certain a duration with no range, or a range of one number', () => {
    expect(activityModel(activity('a', 's1', 1, 4), open, notSaid, calendar)).toEqual({
      kind: 'certain',
      activityId: 'a',
      days: 4,
      source: 'duration',
    });
    expect(activityModel(ranged('a', 's1', 1, 3, 3, 3), open, notSaid, calendar)).toMatchObject({
      kind: 'certain',
      days: 3,
      source: 'range-of-one',
    });
    expect(activityModel(ranged('a', 's1', 1, null, 2, 2), open, notSaid, calendar)).toMatchObject({
      kind: 'certain',
      days: 2,
      source: 'range-of-one',
    });
  });

  it('leaves out what has neither, and what has no stage', () => {
    expect(activityModel(activity('a', 's1', 1, null), open, notSaid, calendar)).toEqual({
      kind: 'unplaced',
      activityId: 'a',
      reason: 'no-duration',
    });
    expect(activityModel(activity('a', 's9', 1, 3), null, notSaid, calendar)).toEqual({
      kind: 'unplaced',
      activityId: 'a',
      reason: 'no-stage',
    });
    // A range that is not one (the host never stores it) is no range.
    expect(
      activityModel(
        { ...activity('a', 's1', 1, null), durationMinDays: 5, durationMaxDays: 2 },
        open,
        notSaid,
        calendar,
      ),
    ).toMatchObject({ kind: 'unplaced' });
  });
});

// ── What has happened is not simulated ───────────────────────────────────────

describe('what the diary and the closed stages say', () => {
  it('takes a finished activity as certain at the working days it really took', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [ranged('a', 's1', 1, 5, 4, 8), activity('b', 's1', 2, 2)],
      dependencies: [link('l1', 'a', 'b')],
    });
    // Worked Thursday 3, finished Monday 7 September: Thursday, Friday, Monday — 3 working days.
    const entries = [
      entry(1, '2026-09-03', { done: [worked('a')] }),
      entry(2, '2026-09-07', { done: [finished('a')] }),
    ];
    const result = simulate(plan, { entries, runs: 50 });
    expect(result.models[0]).toEqual({
      kind: 'certain',
      activityId: 'a',
      days: 3,
      source: 'finished',
    });
    expect(result.counts).toEqual({ certain: 2, ranged: 0, unplaced: 0, total: 2 });
    expect(result.distribution).toHaveLength(1);
    expect(result.distribution[0]!.offset).toBe(5);
    expect(result.allCertain).toBe(true);
  });

  it('takes a finished activity with no duration and no range at its real length too', () => {
    const plan = snapshot({ stages: [stage('s1', 1)], activities: [activity('a', 's1', 1, null)] });
    const entries = [entry(1, '2026-09-05', { done: [finished('a')] })]; // a Saturday
    // Placed by the diary even though the schedule cannot place it; never below one day.
    expect(simulate(plan, { entries, runs: 10 }).models[0]).toMatchObject({
      kind: 'certain',
      days: 1,
    });
  });

  it('takes the activities of a closed stage as certain at their duration', () => {
    const plan = snapshot({
      stages: [closedStage('s1', 1), stage('s2', 2)],
      activities: [
        ranged('a', 's1', 1, 3, 2, 9),
        activity('n', 's1', 2, null),
        ranged('b', 's2', 1, 2, 1, 4),
      ],
      dependencies: [link('l1', 'a', 'b')],
    });
    const result = simulate(plan, { runs: 300 });
    expect(result.models).toEqual([
      { kind: 'certain', activityId: 'a', days: 3, source: 'closed' },
      { kind: 'unplaced', activityId: 'n', reason: 'no-duration' },
      expect.objectContaining({ kind: 'ranged', activityId: 'b' }),
    ]);
    // a is 3 days every run; b is 1 to 4: the finish is 4 to 7 working days from day 0.
    expect(result.distribution[0]!.offset).toBeGreaterThanOrEqual(4);
    expect(result.distribution.at(-1)!.offset).toBeLessThanOrEqual(7);
  });

  it('keeps what is left of a started activity’s range: never fewer days than it has taken', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [ranged('a', 's1', 1, 3, 2, 6)],
    });
    // Worked Tuesday 1 to Friday 4 September: four working days taken already.
    const entries = [
      entry(1, '2026-09-01', { done: [worked('a')] }),
      entry(2, '2026-09-04', { done: [worked('a')] }),
    ];
    const result = simulate(plan, { entries, runs: 500 });
    expect(result.models[0]).toMatchObject({
      kind: 'ranged',
      min: 2,
      max: 6,
      atLeast: 4,
      source: 'started',
    });
    expect(result.distribution[0]!.offset).toBe(4);
    expect(result.distribution.at(-1)!.offset).toBeLessThanOrEqual(6);
    // Without the diary, the same activity finishes in fewer than four days in some runs.
    expect(simulate(plan, { runs: 500 }).distribution[0]!.offset).toBeLessThan(4);
  });

  it('takes a started activity past its range, or past its duration, at what it has taken', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [ranged('a', 's1', 1, 2, 1, 3), activity('b', 's1', 2, 2)],
    });
    // Both worked Tuesday 1 to Monday 7 September: five working days.
    const entries = [
      entry(1, '2026-09-01', { done: [worked('a'), worked('b')] }),
      entry(2, '2026-09-07', { done: [worked('a'), worked('b')] }),
    ];
    const result = simulate(plan, { entries, runs: 20 });
    expect(result.models).toEqual([
      { kind: 'certain', activityId: 'a', days: 5, source: 'started' },
      { kind: 'certain', activityId: 'b', days: 5, source: 'started' },
    ]);
  });

  it('cuts the triangle before its peak as well as after it', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [ranged('a', 's1', 1, 6, 2, 8)],
    });
    // Worked Tuesday 1 to Thursday 3 September: three working days, before the peak of 6.
    const entries = [
      entry(1, '2026-09-01', { done: [worked('a')] }),
      entry(2, '2026-09-03', { done: [worked('a')] }),
    ];
    const result = simulate(plan, { entries, runs: 500 });
    expect(result.models[0]).toMatchObject({ atLeast: 3, source: 'started' });
    expect(result.distribution[0]!.offset).toBe(3);
    expect(result.distribution.at(-1)!.offset).toBeLessThanOrEqual(8);
  });

  it('leaves a started activity whose range starts above what it has taken as it was', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [ranged('a', 's1', 1, 4, 3, 6)],
    });
    const entries = [entry(1, '2026-09-01', { done: [worked('a')] })];
    expect(simulate(plan, { entries, runs: 10 }).models[0]).toMatchObject({
      atLeast: 3,
      source: 'range',
    });
  });
});

// ── Refusals ─────────────────────────────────────────────────────────────────

describe('when nothing can be simulated', () => {
  const refused = (plan: WorkSnapshot) => finishProbability(plan, schedule(plan));

  it('says why, with the key the interface says it with', () => {
    const one = { stages: [stage('s1', 1)], activities: [ranged('a', 's1', 1, 2, 1, 3)] };
    expect(
      refused(snapshot({ ...one, calendar: { workingDays: '0000000', hoursPerDay: 8 } })),
    ).toEqual({
      ok: false,
      code: 'invalid-calendar',
      messageKey: 'schedule.probability.problem.invalidCalendar',
    });
    const badStart = snapshot(one);
    expect(
      refused({ ...badStart, work: { ...badStart.work, startDate: '2026-02-30' } }),
    ).toMatchObject({ ok: false, code: 'invalid-start' });
    expect(
      refused(
        snapshot({
          stages: [stage('s1', 1)],
          activities: [activity('a', 's1', 1, 2), activity('b', 's1', 2, 2)],
          dependencies: [link('l1', 'a', 'b'), link('l2', 'b', 'a')],
        }),
      ),
    ).toMatchObject({
      ok: false,
      code: 'cyclic',
      messageKey: PROBABILITY_MESSAGE_KEYS.problem.cyclic,
    });
    expect(
      refused(snapshot({ stages: [stage('s1', 1)], activities: [activity('a', 's1', 1, null)] })),
    ).toMatchObject({ ok: false, code: 'nothing-placed' });
    expect(refused(snapshot())).toMatchObject({ ok: false, code: 'nothing-placed' });
  });
});

// ── Decision 7: determinism ──────────────────────────────────────────────────

describe('the same plan gives the same numbers', () => {
  it('draws the same runs from the same inputs', () => {
    const first = simulate(chain());
    const again = simulate(chain());
    expect(data(again)).toEqual(data(first));
    expect(first.runs).toBe(PROBABILITY_RUNS);
    expect(first.capped).toBe(false);
  });

  it('seeds from the scheduling inputs: any change to a range, a duration, a lag gives a new seed', () => {
    const base = simulate(chain(), { runs: 50 }).seed;
    const change = (edit: (plan: WorkSnapshot) => WorkSnapshot) =>
      simulate(edit(chain()), { runs: 50 }).seed;
    const withActivity = (id: string, parts: Partial<Activity>) => (plan: WorkSnapshot) => ({
      ...plan,
      activities: plan.activities.map((each) => (each.id === id ? { ...each, ...parts } : each)),
    });
    const seeds = [
      change(withActivity('a', { durationMaxDays: 5 })),
      change(withActivity('b', { durationMinDays: 2 })),
      change(withActivity('c', { durationMinDays: null, durationMaxDays: null })),
      change(withActivity('a', { durationDays: 2 })),
      change((plan) => ({
        ...plan,
        dependencies: plan.dependencies.map((each) => ({ ...each, lagDays: 1 })),
      })),
      change((plan) => ({ ...plan, holidays: [{ date: '2026-09-02', name: 'A holiday' }] })),
      change((plan) => ({ ...plan, work: { ...plan.work, startDate: '2026-09-02' } })),
    ];
    for (const seed of seeds) expect(seed).not.toBe(base);
    expect(new Set(seeds).size).toBe(seeds.length);
    // And the numbers follow: a wider range moves the P90.
    expect(
      simulate(withActivity('b', { durationMaxDays: 30 })(chain())).p90 > simulate(chain()).p90,
    ).toBe(true);
  });

  it('does not change for what the runs do not depend on', () => {
    const base = simulate(chain(), { runs: 50 });
    const renamed = chain();
    const again = simulate(
      {
        ...renamed,
        work: { ...renamed.work, name: 'Another name' },
        activities: renamed.activities.map((each) => ({ ...each, name: `${each.name}!` })),
      },
      { runs: 50 },
    );
    expect(again.seed).toBe(base.seed);
    expect(again.distribution).toEqual(base.distribution);
  });

  it('draws other runs from another seed, when one is given', () => {
    const seeded = simulate(chain(), { seed: 7 });
    expect(seeded.seed).toBe(7);
    expect(seeded.distribution).not.toEqual(simulate(chain()).distribution);
    expect(data(simulate(chain(), { seed: 7 }))).toEqual(data(seeded));
  });
});

// ── The per-run hook (slice E2) ──────────────────────────────────────────────

describe('the per-run hook', () => {
  it('changes no result and no seed: every result is the same with and without it', () => {
    const plans = [chain(), ...[1, 2, 3, 4, 5].map((seed) => randomPlan(seed, true))];
    for (const plan of plans) {
      let calls = 0;
      const without = simulate(plan);
      const withHook = simulate(plan, { onRun: () => (calls += 1) });
      expect(data(withHook)).toEqual(data(without));
      expect(withHook.seed).toBe(without.seed);
      expect(calls).toBe(without.runs);
      // And for a given seed and run count too.
      const seeded = simulate(plan, { seed: 11, runs: 120 });
      expect(data(simulate(plan, { seed: 11, runs: 120, onRun: () => undefined }))).toEqual(
        data(seeded),
      );
    }
  });

  it('hands each run its offsets: a run of the plan’s durations is the schedule’s own', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [activity('a', 's1', 1, 3), activity('b', 's1', 2, 2), activity('c', 's1', 3, 1)],
      dependencies: [link('ab', 'a', 'b', 1), link('ac', 'a', 'c')],
    });
    const scheduled = schedule(plan);
    const seen: Array<{ run: number; end: number; offsets: Record<string, [number, number]> }> = [];
    simulate(plan, {
      runs: 3,
      onRun: (each) => {
        const offsets: Record<string, [number, number]> = {};
        each.activityIds.forEach((id, at) => {
          if (each.placed[at] === 1) offsets[id] = [each.start[at]!, each.finish[at]!];
        });
        seen.push({ run: each.run, end: each.end, offsets });
      },
    });
    const timing = (id: string): [number, number] => {
      const each = scheduled.plan.timing.get(id)!;
      return [each.earliestStart, each.earliestFinish];
    };
    expect(seen).toHaveLength(3);
    for (const [index, each] of seen.entries()) {
      expect(each.run).toBe(index);
      expect(each.offsets).toEqual({ a: timing('a'), b: timing('b'), c: timing('c') });
      expect(each.end).toBe(6);
    }
  });

  it('draws the ranged activities anew in every run, within their ranges', () => {
    const ends = new Set<number>();
    simulate(chain(), {
      runs: 200,
      onRun: (each) => {
        ends.add(each.end);
        each.activityIds.forEach((_id, at) => {
          expect(each.finish[at]! - each.start[at]!).toBeGreaterThanOrEqual(1);
        });
      },
    });
    expect(ends.size).toBeGreaterThan(1);
    for (const end of ends) expect(end >= 4 && end <= 12).toBe(true);
  });
});

// ── Decision 7: a plan with no range is a point at the plan's date ───────────

describe('a plan with no range', () => {
  it('gives every run the plan’s date, and says every activity is certain', () => {
    const plan = snapshot({
      holidays: [{ date: '2026-09-07', name: 'A holiday' }],
      stages: [stage('s1', 1), stage('s2', 2)],
      activities: [
        activity('a', 's1', 1, 3),
        activity('b', 's1', 2, 2),
        activity('c', 's2', 1, 4),
        activity('n', 's2', 2, null),
      ],
      dependencies: [link('l1', 'a', 'c', 2), link('l2', onStage('s1'), 'n')],
    });
    const scheduled = schedule(plan);
    const result = simulate(plan);
    expect(result.distribution).toEqual([
      {
        date: scheduled.finishDate,
        offset: scheduled.plan.timing.get('c')!.earliestFinish,
        runs: PROBABILITY_RUNS,
        cumulative: PROBABILITY_RUNS,
        chance: 1,
      },
    ]);
    expect([result.earliest, result.p50, result.p80, result.p90, result.latest]).toEqual(
      Array(5).fill(scheduled.finishDate),
    );
    expect(result.plan).toMatchObject({ date: scheduled.finishDate, chance: 1, hits: 2000 });
    expect(result.plan!.frequency.kind).toBe('every');
    expect(result.allCertain).toBe(true);
    expect(result.counts).toEqual({ certain: 3, ranged: 0, unplaced: 1, total: 4 });
    expect(result.drivers).toEqual([]);
    expect(result.baseline).toBeNull();
    expect(result.figures.baseline).toBeNull();
  });

  it('agrees with the schedule on the finish and the critical path, on any plan (property)', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const plan = randomPlan(seed, false);
      const scheduled = schedule(plan);
      const result = finishProbability(plan, scheduled, { runs: 3 });
      if (scheduled.finishDate === null) {
        expect(result.ok, `seed ${seed}`).toBe(false);
        continue;
      }
      expect(result.ok, `seed ${seed}`).toBe(true);
      if (!result.ok) continue;
      expect(
        result.distribution.map((point) => point.date),
        `seed ${seed}`,
      ).toEqual([scheduled.finishDate]);
      expect(result.criticality.map((each) => each.activityId).sort()).toEqual(
        [...scheduled.dates.keys()].sort(),
      );
      for (const each of result.criticality) {
        expect(each.index, `seed ${seed} ${each.activityId}`).toBe(
          scheduled.critical.has(each.activityId) ? 1 : 0,
        );
      }
    }
  });
});

// ── Decision 7: the order of the dates ───────────────────────────────────────

describe('the dates of a plan with ranges (property)', () => {
  it('lie between every activity at its optimistic end and every one at its pessimistic end', () => {
    const at = (plan: WorkSnapshot, end: 'durationMinDays' | 'durationMaxDays') =>
      schedule({
        ...plan,
        activities: plan.activities.map((each) =>
          each.durationMinDays === null ? each : { ...each, durationDays: each[end] },
        ),
      }).finishDate!;
    let checked = 0;
    for (let seed = 100; seed < 140; seed += 1) {
      const plan = randomPlan(seed, true);
      const result = finishProbability(plan, schedule(plan), { runs: 400 });
      if (!result.ok) continue;
      checked += 1;
      const { earliest, p50, p80, p90, latest } = result;
      expect([earliest, p50, p80, p90, latest], `seed ${seed}`).toEqual(
        [earliest, p50, p80, p90, latest].sort(),
      );
      expect(at(plan, 'durationMinDays') <= earliest, `seed ${seed}`).toBe(true);
      expect(latest <= at(plan, 'durationMaxDays'), `seed ${seed}`).toBe(true);
      expect(result.distribution.at(-1)!.cumulative).toBe(result.runs);
      expect(result.chanceBy(p80)).toBeGreaterThanOrEqual(0.8);
      expect(result.chanceBy(p50)).toBeGreaterThanOrEqual(0.5);
      expect(result.chanceBy(p90)).toBeGreaterThanOrEqual(0.9);
      expect(result.counts.certain + result.counts.ranged + result.counts.unplaced).toBe(
        plan.activities.length,
      );
      for (const figure of Object.values(result.figures)) {
        if (figure !== null) expect(traceable(figure), `seed ${seed} ${figure.id}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});

// ── Decision 7: the statistics of a two-activity chain ───────────────────────

/** The mean and variance of a triangular sample rounded to the nearest whole day (half up). */
function roundedTriangle(a: number, c: number, b: number): { mean: number; variance: number } {
  const cdf = (x: number) =>
    x <= a
      ? 0
      : x >= b
        ? 1
        : x <= c
          ? ((x - a) * (x - a)) / ((b - a) * (c - a))
          : 1 - ((b - x) * (b - x)) / ((b - a) * (b - c));
  let mean = 0;
  let square = 0;
  for (let k = a; k <= b; k += 1) {
    const p = cdf(k + 0.5) - cdf(k - 0.5);
    mean += k * p;
    square += k * k * p;
  }
  return { mean, variance: square - mean * mean };
}

describe('a two-activity chain', () => {
  it('finishes, on average, at the sum of its two rounded triangles', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [ranged('a', 's1', 1, 3, 2, 4), ranged('b', 's1', 2, 4, 3, 6)],
      dependencies: [link('l1', 'a', 'b')],
    });
    const a = roundedTriangle(2, 3, 4);
    const b = roundedTriangle(3, 4, 6);
    // The continuous means are 3 and 13/3; rounding keeps them close.
    expect(a.mean).toBeCloseTo(3, 10);
    expect(b.mean).toBeCloseTo(13 / 3, 1);
    for (const seed of [1, 2, 3]) {
      const result = simulate(plan, { seed });
      const standardError = Math.sqrt((a.variance + b.variance) / result.runs);
      expect(Math.abs(meanOffset(result) - (a.mean + b.mean)), `seed ${seed}`).toBeLessThan(
        4 * standardError,
      );
      expect(result.distribution[0]!.offset).toBeGreaterThanOrEqual(5);
      expect(result.distribution.at(-1)!.offset).toBeLessThanOrEqual(10);
    }
  });

  it('never draws a day below one, nor a number that is not a whole day', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [ranged('a', 's1', 1, 5, 2, 4), ranged('b', 's1', 2, null, 1, 2)],
    });
    const result = simulate(plan);
    for (const point of result.distribution) {
      expect(Number.isInteger(point.offset) && point.offset >= 1).toBe(true);
      expect(Number.isFinite(point.chance)).toBe(true);
    }
    // a widened to 2–5, peaked at 5: never past 5, and the plan's own 5 days has some chance.
    expect(result.distribution.at(-1)!.offset).toBeLessThanOrEqual(5);
    expect(result.plan!.chance).toBe(1);
  });
});

// ── The results ──────────────────────────────────────────────────────────────

describe('what the simulation says', () => {
  const plan = chain();
  const result = simulate(plan);

  it('gives the chance of any day', () => {
    expect(result.chanceBy('2026-08-01')).toBe(0);
    expect(result.chanceBy(result.latest)).toBe(1);
    expect(result.chanceBy('2027-01-01')).toBe(1);
    const middle = result.distribution[1]!;
    expect(result.chanceBy(middle.date)).toBe(middle.chance);
    expect(chanceBy(result.distribution, middle.date)).toBe(middle.chance);
    expect(() => result.chanceBy('soon')).toThrow(RangeError);
    // Dates fall on working days only.
    expect(
      result.distribution.every((point) => !['2026-09-05', '2026-09-06'].includes(point.date)),
    ).toBe(true);
  });

  it('gives the headline at P80, the plan’s date and its chance', () => {
    expect(result.headline.date).toBe(result.p80);
    expect(result.headline.chance).toBe(result.chanceBy(result.p80));
    expect(result.headline.frequency.n).toBeGreaterThanOrEqual(8);
    const scheduled = schedule(plan);
    expect(result.plan).toMatchObject({ date: scheduled.finishDate });
    expect(result.plan!.hits).toBe(Math.round(result.plan!.chance * result.runs));
    expect(result.plan!.chance).toBeGreaterThan(0);
    expect(result.plan!.chance).toBeLessThan(1);
    expect(result.day0).toBe('2026-09-01');
  });

  it('gives the latest baseline’s date and its chance', () => {
    const approved = { ...plan, baselines: [takeBaseline(plan, 1), takeBaseline(plan, 2)] };
    const withBaseline = simulate(approved);
    expect(withBaseline.baseline).toMatchObject({
      number: 2,
      date: schedule(plan).finishDate,
      chance: withBaseline.plan!.chance,
    });
    expect(traceable(withBaseline.figures.baseline!)).toBe(true);
    expect(withBaseline.figures.baseline!.label).toBe('schedule.probability.figure.baseline');
    const noDate = { ...plan, baselines: [takeBaseline(plan, 1, { finishDate: null })] };
    expect(simulate(noDate, { runs: 10 }).baseline).toBeNull();
  });

  it('counts every activity critical in every run of a chain', () => {
    expect(result.criticality.map((each) => [each.activityId, each.index])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 1],
    ]);
    expect(result.criticality[0]!.frequency.kind).toBe('every');
  });

  it('carries its rows: the drivers and the certain activities under the chance, every activity under criticality', () => {
    const { p80, plan: planFigure, criticality } = result.figures;
    expect(p80).toMatchObject({
      id: 'probability.p80',
      label: 'schedule.probability.figure.p80',
      unit: 'chance',
      runs: PROBABILITY_RUNS,
      date: result.p80,
    });
    expect(p80.rows.map((row) => row.key)).toEqual(
      result.drivers.map((driver) => `driver:${driver.activityId}`),
    );
    expect(traceable(p80)).toBe(true);
    expect(traceable(planFigure!)).toBe(true);
    expect(planFigure!.value).toBe(result.plan!.chance);
    expect(criticality).toMatchObject({ unit: 'count', value: 3 });
    expect(criticality.rows.map((row) => [row.key, row.role, row.share])).toEqual([
      ['critical:a', 'critical', 1],
      ['critical:b', 'critical', 1],
      ['critical:c', 'critical', 1],
    ]);
    expect(traceable(criticality)).toBe(true);
  });
});

describe('the drivers', () => {
  it('are the ranged activities that move the finish most, strongest first, five at most', () => {
    // A chain of seven ranged activities of growing spread, and a short ranged branch that never
    // decides the finish.
    const spreads = [1, 2, 3, 4, 6, 8, 10];
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [
        ...spreads.map((spread, i) => ranged(`k${i}`, 's1', i + 1, 2, 1, 2 + spread)),
        ranged('side', 's1', 20, 1, 1, 2),
        activity('fixed', 's1', 21, 3),
      ],
      dependencies: [
        ...spreads.slice(1).map((_, i) => link(`l${i}`, `k${i}`, `k${i + 1}`)),
        link('ls', 'side', 'k6'),
      ],
    });
    const result = simulate(plan);
    expect(result.drivers).toHaveLength(PROBABILITY_DRIVERS);
    expect(result.drivers.map((driver) => driver.activityId)).toEqual([
      'k6',
      'k5',
      'k4',
      'k3',
      'k2',
    ]);
    const correlations = result.drivers.map((driver) => driver.correlation);
    expect(correlations).toEqual([...correlations].sort((a, b) => b - a));
    expect(correlations.every((value) => value >= 0.1 && value <= 1)).toBe(true);
    expect(result.drivers[0]).toMatchObject({ name: 'Activity k6', min: 1, mode: 2, max: 12 });
    expect(result.drivers[0]!.criticality).toBe(1);
    // The rows: the drivers, then what is certain.
    expect(result.figures.p80.rows.map((row) => [row.key, row.role])).toEqual([
      ...['k6', 'k5', 'k4', 'k3', 'k2'].map((id) => [`driver:${id}`, 'driver']),
      ['certain:fixed', 'certain'],
    ]);
    expect(result.figures.p80.rows.at(-1)!.share).toBeNull();
    const side = result.criticality.find((each) => each.activityId === 'side')!;
    expect(side.index).toBeLessThan(0.5);
  });

  it('leaves out an activity whose stage is not in the plan, as the schedule does', () => {
    const plan = { ...chain(), activities: [...chain().activities, activity('lost', 's9', 1, 50)] };
    const result = simulate(plan, { runs: 50 });
    expect(result.models.at(-1)).toEqual({
      kind: 'unplaced',
      activityId: 'lost',
      reason: 'no-stage',
    });
    expect(result.counts).toEqual({ certain: 0, ranged: 3, unplaced: 1, total: 4 });
    expect(result.criticality.map((each) => each.activityId)).toEqual(['a', 'b', 'c']);
  });

  it('lists only the dates some run finished on', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [ranged('a', 's1', 1, null, 1, 100)],
    });
    const result = simulate(plan, { runs: 5, seed: 1 });
    const offsets = result.distribution.map((point) => point.offset);
    expect(offsets.at(-1)! - offsets[0]!).toBeGreaterThan(offsets.length);
    expect(result.distribution.reduce((sum, point) => sum + point.runs, 0)).toBe(5);
  });

  it('are none with a single run, where nothing can be told from noise', () => {
    const result = simulate(chain(), { runs: 1 });
    expect(result.runs).toBe(1);
    expect(result.drivers).toEqual([]);
    expect(result.distribution).toHaveLength(1);
    expect(simulate(chain(), { runs: 0.5 }).runs).toBe(1);
  });
});

// ── Runs ─────────────────────────────────────────────────────────────────────

describe('how many runs', () => {
  it('makes every run for a plan up to the budget, fewer for a larger one, never too few', () => {
    expect(runsFor(3, 2)).toBe(PROBABILITY_RUNS);
    expect(runsFor(2_000, 3_000)).toBe(PROBABILITY_RUNS);
    expect(runsFor(4_000, 6_000)).toBe(PROBABILITY_RUNS);
    expect(2 * (4_000 + 6_000) * PROBABILITY_RUNS).toBe(PROBABILITY_WORK_BUDGET);
    expect(runsFor(4_000, 6_001)).toBe(1_900);
    expect(runsFor(10_000, 15_000)).toBe(800);
    expect(runsFor(500_000, 0)).toBe(PROBABILITY_MIN_RUNS);
  });

  it('says when a large plan got fewer runs', () => {
    // The chain's three activities and two links pass over 10 a run: a budget of 12 000 fits 1 200.
    expect(runsFor(3, 2, 12_000)).toBe(1_200);
    const result = simulate(chain(), { workBudget: 12_000 });
    expect(result.runs).toBe(1_200);
    expect(result.capped).toBe(true);
    // Runs asked for are not a cap.
    expect(simulate(chain(), { runs: 900 }).capped).toBe(false);
  });
});
