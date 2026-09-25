import { describe, expect, it } from 'vitest';

import type { Activity, Dependency, Stage, WorkSnapshot } from '../plan';
import { snapshot } from '../__fixtures__/plan';
import { ganttLayout } from './gantt';
import { schedule } from './index';

/**
 * The benchmark SPEC §4 asks for, and KEYSTONE's confirmation of the one-engine decision
 * (ADR-015): 2 000 activities in 40 stages with 3 000 links, scheduled (expanded, planned in
 * working days, put on the calendar) in under 100 ms, and laid out for the Gantt in under 500 ms.
 * CI machines are slower and shared, so the assertion allows three times the budget; the medians
 * are printed so the real number is on record, not only the pass.
 */

const ACTIVITIES = 2_000;
const STAGES = 40;
const LINKS = 3_000;
const RUNS = 5;

/** A seeded generator (mulberry32), so every run schedules the same plan. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The plan: 40 stages of 50 activities, 1–10 working days each, and 3 000 distinct links from an
 * earlier activity to a later one, mostly near each other (as real plans are) with some long
 * jumps, lags of 0–3 days. Earlier-to-later means there is no cycle to refuse.
 */
function bigPlan(): WorkSnapshot {
  const next = random(20260925);
  const perStage = ACTIVITIES / STAGES;
  const stages: Stage[] = Array.from({ length: STAGES }, (_, i) => ({
    id: `s${i}`,
    position: i + 1,
    name: `Stage ${i + 1}`,
  }));
  const activities: Activity[] = Array.from({ length: ACTIVITIES }, (_, i) => ({
    id: `a${i}`,
    stageId: `s${Math.floor(i / perStage)}`,
    position: (i % perStage) + 1,
    name: `Activity ${i + 1}`,
    durationDays: 1 + Math.floor(next() * 10),
    responsibleId: null,
    roomIds: [],
    quantity: null,
    unit: null,
  }));
  const seen = new Set<string>();
  const dependencies: Dependency[] = [];
  while (dependencies.length < LINKS) {
    const from = Math.floor(next() * (ACTIVITIES - 1));
    const reach = next() < 0.9 ? 1 + Math.floor(next() * 60) : 1 + Math.floor(next() * ACTIVITIES);
    const to = Math.min(ACTIVITIES - 1, from + reach);
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dependencies.push({
      id: `d${dependencies.length}`,
      blocker: { kind: 'activity', id: `a${from}` },
      blocked: { kind: 'activity', id: `a${to}` },
      lagDays: Math.floor(next() * 4),
    });
  }
  return snapshot({
    holidays: [
      { date: '2026-11-02', name: 'A holiday' },
      { date: '2026-12-25', name: 'Another holiday' },
    ],
    stages,
    activities,
    dependencies,
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function measure(run: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    run();
    times.push(performance.now() - started);
  }
  return median(times);
}

describe('the 2 000-activity benchmark', () => {
  const plan = bigPlan();

  it('is the plan it says it is', () => {
    expect(plan.activities).toHaveLength(ACTIVITIES);
    expect(plan.stages).toHaveLength(STAGES);
    expect(plan.dependencies).toHaveLength(LINKS);
    const result = schedule(plan);
    // Everything is placed and nothing is inert or cyclic: the timing below is of real work.
    expect(result.cyclic).toBe(false);
    expect(result.inert).toEqual([]);
    expect(result.dates.size).toBe(ACTIVITIES);
    expect(result.critical.size).toBeGreaterThan(0);
  });

  it('schedules in under 300 ms (3 × the 100 ms budget), median of 5', () => {
    schedule(plan); // warm the code paths once, as a running app would have
    const ms = measure(() => schedule(plan));
    console.log(`[bench] schedule(): 2000 activities, 3000 links — median ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(300);
  });

  it('lays out the Gantt in under 1 500 ms (3 × the 500 ms budget), median of 5', () => {
    const scheduled = schedule(plan);
    ganttLayout(scheduled, plan, scheduled.calendar!);
    const ms = measure(() => ganttLayout(scheduled, plan, scheduled.calendar!));
    const layout = ganttLayout(scheduled, plan, scheduled.calendar!);
    console.log(
      `[bench] ganttLayout(): ${layout.rows.length} rows, ${layout.columns.length} columns, ` +
        `${layout.arrows.length} arrows — median ${ms.toFixed(1)} ms`,
    );
    expect(layout.arrows).toHaveLength(LINKS);
    expect(ms).toBeLessThan(1_500);
  });
});
