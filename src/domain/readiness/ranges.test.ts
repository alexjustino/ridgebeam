import { describe, expect, it } from 'vitest';

import { activity, link, snapshot, stage, withStageRules } from '../__fixtures__/plan';
import { stageOfLine } from '../money';
import type { WorkSnapshot } from '../plan';
import { schedule } from '../schedule';
import { readiness, readinessFigure } from './index';

/**
 * Readiness after slice F9: an activity's duration row carries the range its template gave it, and
 * a stage's money needs a **priced** line. Nothing moves for a work planned before F9.
 */

const measure = (plan: WorkSnapshot) =>
  readiness(plan, { schedule: schedule(plan), today: '2026-09-01' });

describe('the duration rule and a range', () => {
  const plan = withStageRules(
    snapshot({
      stages: [stage('s', 1)],
      activities: [
        { ...activity('ranged', 's', 1, null), durationMinDays: 3, durationMaxDays: 5 },
        { ...activity('bare', 's', 2, null) },
        { ...activity('picked', 's', 3, 4), durationMinDays: 3, durationMaxDays: 5 },
      ],
      dependencies: [link('k1', 'ranged', 'bare'), link('k2', 'bare', 'picked')],
    }),
  );

  it('says the range on the row of an activity with no duration yet', () => {
    const rows = measure(plan).missing.filter((row) => row.ruleId === 'activity.duration');
    expect(rows.map((row) => [row.id, row.durationRange])).toEqual([
      ['ranged', { min: 3, max: 5 }],
      ['bare', null],
    ]);
  });

  it('puts it on the figure rows too, and nothing on the other rules', () => {
    const rows = readinessFigure(measure(plan)).rows;
    expect(rows.find((row) => row.key === 'activity.duration:ranged')!.durationRange).toEqual({
      min: 3,
      max: 5,
    });
    expect(
      rows
        .filter((row) => row.ruleId !== 'activity.duration')
        .every((row) => row.durationRange === null),
    ).toBe(true);
  });

  it('still counts a range as no duration: a range is not a promise', () => {
    const duration = measure(plan).rules.find((rule) => rule.ruleId === 'activity.duration')!;
    expect(duration).toEqual({ ruleId: 'activity.duration', known: 1, mustKnow: 3 });
  });
});

describe('the money rule and a line not priced yet', () => {
  const base = snapshot({
    stages: [stage('s1', 1), stage('s2', 2)],
    activities: [activity('a1', 's1', 1, 2), activity('a2', 's2', 1, 2)],
    dependencies: [link('k', 'a1', 'a2')],
  });
  const line = (
    id: string,
    stageId: string,
    amountCents: number | null,
    activityId: string | null = null,
  ) => ({
    id,
    stageId,
    activityId,
    label: `Line ${id}`,
    amountCents,
  });
  const money = (plan: WorkSnapshot) =>
    measure(plan)
      .missing.filter((row) => row.ruleId === 'stage.money')
      .map((row) => row.id);

  it('is not met by a label alone', () => {
    expect(
      money({ ...base, costLines: [line('u1', 's1', null), line('u2', 's2', null, 'a2')] }),
    ).toEqual(['s1', 's2']);
  });

  it('is met once one line of the stage, its own or an activity’s, is priced, zero included', () => {
    expect(
      money({
        ...base,
        costLines: [line('u1', 's1', null), line('p1', 's1', 0), line('p2', 's2', 50_00, 'a2')],
      }),
    ).toEqual([]);
  });

  it('moves nothing for a work planned before F9: every line there has an amount', () => {
    // The rule as it was (F6): any line of the stage. Every pre-F9 line is priced (the column was
    // NOT NULL until migration 010), so the two agree on every such work.
    const before = (plan: WorkSnapshot) =>
      plan.stages
        .filter((each) => !plan.costLines.some((l) => stageOfLine(plan, l) === each.id))
        .map((each) => each.id);
    const plans = [
      base,
      { ...base, costLines: [line('p1', 's1', 100_00)] },
      { ...base, costLines: [line('p1', 's1', 0, 'a1'), line('p2', 's2', 1)] },
      withStageRules(base),
    ];
    for (const plan of plans) expect(money(plan)).toEqual(before(plan));
    // The fixture the earlier readiness tests count on reads what it read before F9: durations 2/2,
    // responsible 0/2, linked 2/2, checks 2/2, money 2/2.
    const { known, mustKnow } = measure(withStageRules(base));
    expect({ known, mustKnow }).toEqual({ known: 8, mustKnow: 10 });
  });
});
