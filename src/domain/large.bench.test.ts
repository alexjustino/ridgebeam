import { describe, expect, it } from 'vitest';

import { LARGE, LARGE_TODAY, largeWork } from './__fixtures__/large';
import { effectiveEntries } from './diary';
import { moneyByStage, moneyByTrade, moneyOfWork, overCommittedFigure, sCurve } from './money';
import { openQuestions } from './questions';
import { readiness, readinessByRule, readinessFigure } from './readiness';
import { diaryReport } from './reports/diary';
import { weekly } from './reports/weekly';
import { schedule } from './schedule';

/**
 * The large-work benchmark (slice F11, decision 8f): a work of 2 000 activities (40 stages, 3 000
 * links), 2 000 payments and 3 000 diary entries, generated from a seed (`__fixtures__/large.ts`),
 * and every computation the screens make of it on each change, each under a budget.
 *
 * Each budget is five times the median first measured on the development machine (`BUDGETS_MS`,
 * recorded in ADR/CHANGELOG), so a slower or busier CI runner passes and a change that makes a computation
 * several times slower does not. The medians are printed on every run, so the real number is on
 * record, not only the pass.
 *
 * The first run found two computations that grew with the square of the work, and they were fixed
 * before the budgets were set: money searched the activity, payment and commitment lists once per
 * row (By stage 657 ms, over committed 842 ms; now indexed once per snapshot), and the working days
 * to a deadline were walked day by day (readiness 123 ms, weekly 279 ms, the questions 74 ms, with
 * deadlines years back; now counted by whole weeks).
 */

const RUNS = 5;

/**
 * Each computation's budget, in milliseconds, and the median it was set from: five times the first
 * measurement (2026-09-28, development machine, `vitest run`), rounded up to 5 ms, and never under
 * 25 ms — a budget of a few milliseconds would fail on a garbage-collection pause, not on a slower
 * computation. Under coverage instrumentation the medians run about twice as long, still inside.
 */
const BUDGETS_MS = {
  schedule: 35, // measured 6.3
  readiness: 40, // measured 7.4 (readiness + its figure + rule by rule)
  weekly: 85, // measured 16.4
  moneyOfWork: 25, // measured 1.3
  moneyByStage: 260, // measured 51.4
  moneyByTrade: 25, // measured 4.3
  overCommittedFigure: 225, // measured 45.0
  sCurve: 135, // measured 26.8
  diaryReport: 25, // measured 3.9
  openQuestions: 30, // measured 5.6
} as const;
/** Median of five runs, after one warm-up run, as a running app would have warmed the code. */
function measure(run: () => unknown): number {
  run();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    run();
    times.push(performance.now() - started);
  }
  return [...times].sort((a, b) => a - b)[Math.floor(RUNS / 2)]!;
}

function bench(name: keyof typeof BUDGETS_MS, run: () => unknown): void {
  const budgetMs = BUDGETS_MS[name];
  const ms = measure(run);
  console.log(`[bench] ${name}: median ${ms.toFixed(1)} ms (budget ${budgetMs} ms)`);
  expect(ms, name).toBeLessThan(budgetMs);
}

describe('the large-work benchmark', () => {
  const { plan, entries } = largeWork();
  const scheduled = schedule(plan);

  it('is the work it says it is', () => {
    expect(plan.activities).toHaveLength(LARGE.activities);
    expect(plan.dependencies).toHaveLength(LARGE.links);
    expect(plan.payments).toHaveLength(LARGE.payments);
    expect(entries).toHaveLength(LARGE.entries);
    expect(plan.payments.some((payment) => payment.reversesSeq !== null)).toBe(true);
    expect(entries.some((entry) => entry.kind === 'correction')).toBe(true);
    // Everything is placed, and every entry and payment is on or before today: real work.
    expect(scheduled.cyclic).toBe(false);
    expect(scheduled.dates.size).toBe(LARGE.activities);
    expect(entries.every((entry) => entry.day <= LARGE_TODAY)).toBe(true);
    expect(plan.payments.every((payment) => payment.day <= LARGE_TODAY)).toBe(true);
    // Generated from a seed: the same work every run.
    expect(largeWork()).toEqual({ plan, entries });
    expect(effectiveEntries(entries).length).toBeLessThan(LARGE.entries);
  });

  it('schedules', () => {
    bench('schedule', () => schedule(plan));
  });

  it('measures readiness, its figure and its rules', () => {
    bench('readiness', () => {
      const measured = readiness(plan, { schedule: scheduled, today: LARGE_TODAY });
      readinessFigure(measured);
      readinessByRule(measured);
    });
  });

  it('makes the weekly report', () => {
    const result = weekly(plan, scheduled, entries, null, LARGE_TODAY);
    expect(result.ok).toBe(true);
    bench('weekly', () => weekly(plan, scheduled, entries, null, LARGE_TODAY));
  });

  it('makes the money figures: the work, by stage, by trade, over committed, the S-curve', () => {
    bench('moneyOfWork', () => moneyOfWork(plan));
    bench('moneyByStage', () => moneyByStage(plan));
    bench('moneyByTrade', () => moneyByTrade(plan));
    bench('overCommittedFigure', () => overCommittedFigure(plan));
    bench('sCurve', () => sCurve(plan, scheduled, plan.payments, LARGE_TODAY));
  });

  it('makes the diary document', () => {
    expect(diaryReport(plan, entries).written).toBe(LARGE.entries);
    bench('diaryReport', () => diaryReport(plan, entries));
  });

  it('asks the plan’s questions', () => {
    bench('openQuestions', () => openQuestions(plan, scheduled, LARGE_TODAY));
  });
});
