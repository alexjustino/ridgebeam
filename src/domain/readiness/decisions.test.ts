import { describe, expect, it } from 'vitest';

import {
  activity,
  changeDecision,
  changeOrder,
  decision,
  link,
  snapshot,
  stage,
  withStageRules,
} from '../__fixtures__/plan';
import { traceable } from '../figure';
import type { WorkSnapshot } from '../plan';
import { schedule } from '../schedule';
import {
  RULES,
  RULE_UNCOUNTED_KEY,
  readiness,
  readinessByRule,
  readinessFigure,
  sentenceParts,
} from './index';

/**
 * Readiness on `today`, every stage given a check at each gate: these tests are about decisions, so
 * the stage rules are known and add two known and two must-know per stage, and the work's funding
 * rule (E2) one known and one must-know to the plan.
 */
const at = (plan: WorkSnapshot, today: string) => {
  const checked = withStageRules(plan);
  return readiness(checked, { schedule: schedule(checked), today });
};

const PEOPLE = [
  {
    id: 'p',
    name: 'Sample person',
    trade: null,
    phone: null,
    email: null,
    note: null,
    availability: null,
    stageIds: [],
  },
];

/**
 * F2's plan, everything known but responsibles: four activities, all linked.
 * A (3 d) +1 → B (2 d) → C (1 d); A → D (1 d). From Tuesday 1 September 2026.
 */
const F2 = snapshot({
  stages: [stage('s1', 1, 'Structure'), stage('s2', 2, 'Finishes')],
  activities: [
    activity('a', 's1', 1, 3),
    activity('b', 's1', 2, 2),
    activity('c', 's2', 1, 1),
    activity('d', 's2', 2, 1),
  ],
  dependencies: [link('ab', 'a', 'b', 1), link('bc', 'b', 'c'), link('ad', 'a', 'd')],
});

/** The same, with responsibles, so only decisions can be missing. */
const READY = {
  ...F2,
  people: PEOPLE,
  activities: F2.activities.map((a) => ({ ...a, responsibleId: 'p' })),
};

const withDecisions = (plan: WorkSnapshot, ...decisions: WorkSnapshot['decisions']) => ({
  ...plan,
  decisions,
});

describe('readiness keeps its F0–F2 numbers for activities, each stage adding its own', () => {
  it('reads one activity with a duration and no responsible as 1 of 2, and 4 of 5 with its stage and its funding', () => {
    const one = snapshot({ stages: [stage('s', 1)], activities: [activity('a', 's', 1, 3)] });
    const measure = at(one, '2026-08-31');
    expect(measure).toMatchObject({ known: 4, mustKnow: 5 });
    const activities = readinessByRule(measure).filter((rule) =>
      rule.ruleId.startsWith('activity.'),
    );
    expect(activities.reduce((sum, rule) => sum + rule.known, 0)).toBe(1);
    expect(activities.reduce((sum, rule) => sum + rule.mustKnow, 0)).toBe(2);
  });

  it('reads F2’s four linked activities with no responsible as 8 of 12, and 13 of 17 with two stages and the funding', () => {
    const measure = at(F2, '2026-08-31');
    expect(measure).toMatchObject({ known: 13, mustKnow: 17 });
    const activities = readinessByRule(measure).filter((rule) =>
      rule.ruleId.startsWith('activity.'),
    );
    expect(activities.reduce((sum, rule) => sum + rule.known, 0)).toBe(8);
    expect(activities.reduce((sum, rule) => sum + rule.mustKnow, 0)).toBe(12);
  });
});

describe('readiness of decisions', () => {
  it('counts a decision in time as known twice: it has a deadline, and it is not overdue', () => {
    const plan = withDecisions(READY, decision('colour', 's2', 1, 1));
    // Finishes first starts on Fri 4 (D); one day of lead puts the deadline on Thu 3, still ahead.
    expect(at(plan, '2026-09-01')).toMatchObject({ known: 19, mustKnow: 19, missing: [] });
  });

  it('says an overdue decision is not ready: "1 decision is overdue"', () => {
    const plan = withDecisions(READY, { ...decision('tile', 's1', 1, 10), name: 'Which tile' });
    const measure = at(plan, '2026-09-01');
    expect(measure).toMatchObject({ known: 18, mustKnow: 19 });
    expect(measure.missing).toEqual([
      {
        ruleId: 'decision.timely',
        entity: 'decision',
        id: 'tile',
        name: 'Which tile',
        stageName: 'Structure',
        durationRange: null,
      },
    ]);
    expect(sentenceParts(measure.missing)).toEqual([
      { key: 'readiness.missing.decision.timely', count: 1, params: { count: 1 } },
    ]);
  });

  it('counts a decision with no deadline as missing one, and does not ask whether it is late', () => {
    const plan = withDecisions(
      { ...READY, stages: [...READY.stages, stage('garden', 3, 'Garden')] },
      decision('plants', 'garden', 1, 5),
    );
    const measure = at(plan, '2030-01-01');
    // decision.deadline asks (and fails); decision.timely does not apply: decisions: 1 asked, 0 known.
    expect(measure).toMatchObject({ known: 19, mustKnow: 20 });
    expect(measure.missing.map((row) => row.ruleId)).toEqual(['decision.deadline']);
    expect(sentenceParts(measure.missing)).toEqual([
      { key: 'readiness.missing.decision.deadline', count: 1, params: { count: 1 } },
    ]);
  });

  it('counts a decision in a stage whose activities have no duration as having no deadline', () => {
    const plan = withDecisions(
      {
        ...READY,
        activities: READY.activities.map((a) =>
          a.stageId === 's2' ? { ...a, durationDays: null } : a,
        ),
      },
      decision('colour', 's2', 1, 0),
    );
    expect(at(plan, '2026-09-01').missing.filter((row) => row.entity === 'decision')).toEqual([
      expect.objectContaining({ ruleId: 'decision.deadline', id: 'colour' }),
    ]);
  });

  it('never counts a made decision as missing, even past its deadline or with none', () => {
    const made = '2026-08-20T10:00:00.000Z';
    const plan = withDecisions(
      { ...READY, stages: [...READY.stages, stage('garden', 3, 'Garden')] },
      { ...decision('late', 's1', 1, 10), madeAt: made },
      { ...decision('plants', 'garden', 1, 0), madeAt: made },
    );
    const measure = at(plan, '2026-12-01');
    expect(measure.missing).toEqual([]);
    // late: deadline and timely both known; plants: deadline known (made), timely not asked.
    expect(measure).toMatchObject({ known: 22, mustKnow: 22 });
  });

  it('lists a decision on a stage that is not in the plan, as having no deadline', () => {
    const plan = withDecisions(READY, decision('orphan', 'gone', 1, 0));
    expect(at(plan, '2026-09-01').missing).toEqual([
      {
        ruleId: 'decision.deadline',
        entity: 'decision',
        id: 'orphan',
        name: 'Decision orphan',
        stageName: null,
        durationRange: null,
      },
    ]);
  });

  it('does not count the decisions of a plan with no activity: the plan says it has none', () => {
    const plan = withDecisions(snapshot({ stages: [stage('s', 1)] }), decision('x', 's', 1, 0));
    const measure = at(plan, '2026-09-01');
    expect(measure).toMatchObject({ known: 0, mustKnow: 0, ratio: 0 });
    expect(measure.missing.map((row) => row.ruleId)).toEqual(['plan.activity']);
  });

  it('lists activity rows first, then decision rows, each in plan order', () => {
    const plan = withDecisions(F2, decision('d2', 's2', 1, 10), decision('d1', 's1', 1, 10));
    const entities = at(plan, '2026-09-01').missing.map((row) => `${row.entity}:${row.id}`);
    expect(entities.slice(-2)).toEqual(['decision:d1', 'decision:d2']);
    expect(entities.slice(0, 4).every((e) => e.startsWith('activity:'))).toBe(true);
  });
});

describe('readiness rule by rule', () => {
  const plan = {
    ...withDecisions(
      { ...F2, people: PEOPLE, stages: [...F2.stages, stage('garden', 3, 'Garden')] },
      decision('late', 's1', 1, 10),
      decision('fine', 's2', 1, 0),
      decision('plants', 'garden', 1, 0),
    ),
    // E1: one change decided, one waiting twelve days.
    changeOrders: [
      changeOrder('co1', 1, 's1', '2026-08-10', {
        decision: changeDecision('declined', '2026-08-12'),
      }),
      changeOrder('co2', 2, 's2', '2026-08-20'),
    ],
  };
  const measure = at(plan, '2026-09-01');
  const rules = readinessByRule(measure);

  it('lists every rule, in rule order, with its count', () => {
    expect(rules.map((rule) => [rule.ruleId, rule.known, rule.mustKnow])).toEqual([
      ['activity.duration', 4, 4],
      ['activity.responsible', 0, 4],
      ['activity.linked', 4, 4],
      ['decision.deadline', 2, 3],
      ['decision.timely', 1, 2],
      ['stage.checks', 3, 3],
      ['stage.money', 3, 3],
      ['change.waiting', 1, 2],
      ['work.funding', 1, 1],
    ]);
  });

  it('adds up to the whole: the rules’ counts sum to the figure’s', () => {
    expect(rules.reduce((sum, rule) => sum + rule.known, 0)).toBe(measure.known);
    expect(rules.reduce((sum, rule) => sum + rule.mustKnow, 0)).toBe(measure.mustKnow);
    expect(rules.flatMap((rule) => rule.missing)).toHaveLength(measure.missing.length);
    expect(new Set(rules.flatMap((rule) => rule.missing))).toEqual(new Set(measure.missing));
  });

  it('gives every rule a traceable figure of its own that opens onto its rows', () => {
    for (const rule of rules) {
      expect(rule.figure, rule.ruleId).not.toBeNull();
      expect(traceable(rule.figure!), rule.ruleId).toBe(true);
      expect(rule.figure!.rows.map((row) => row.itemId)).toEqual(rule.missing.map((row) => row.id));
    }
    expect(rules.find((rule) => rule.ruleId === 'decision.timely')!.figure).toMatchObject({
      id: 'readiness:decision.timely',
      label: 'readiness.rule.decision.timely',
      value: 50,
    });
    expect(traceable(readinessFigure(measure))).toBe(true);
  });

  it('names each rule and explains it by message key', () => {
    expect(rules[0]).toMatchObject({
      labelKey: 'readiness.rule.activity.duration',
      explanationKey: 'readiness.explanation.activity.duration',
    });
  });

  it('gives a rule that asked nothing no figure, and still lists it — last (F11)', () => {
    const one = snapshot({ stages: [stage('s', 1)], activities: [activity('a', 's', 1, 3)] });
    const byRule = readinessByRule(at(one, '2026-09-01'));
    expect(
      byRule.map((rule) => [rule.ruleId, rule.mustKnow, rule.figure === null, rule.counted]),
    ).toEqual([
      ['activity.duration', 1, false, true],
      ['activity.responsible', 1, false, true],
      ['stage.checks', 1, false, true],
      ['stage.money', 1, false, true],
      ['work.funding', 1, false, true],
      ['activity.linked', 0, true, false],
      ['decision.deadline', 0, true, false],
      ['decision.timely', 0, true, false],
      ['change.waiting', 0, true, false],
    ]);
  });

  it('names the line of a rule that counted nothing by its own message key (F11)', () => {
    expect(RULE_UNCOUNTED_KEY).toBe('readiness.rule.uncounted');
  });

  it('marks every rule of a plan that asks everything as counted, in rule order (F11)', () => {
    expect(rules.every((rule) => rule.counted)).toBe(true);
    expect(rules.map((rule) => rule.ruleId)).toEqual(RULES.map((rule) => rule.id));
  });

  it('moves no number when it sorts the uncounted rules last (F11)', () => {
    const one = snapshot({ stages: [stage('s', 1)], activities: [activity('a', 's', 1, 3)] });
    const measure = at(one, '2026-09-01');
    const byRule = readinessByRule(measure);
    // The measure's own rule counts keep rule order; the lines are the same counts, re-ordered.
    expect(measure.rules.map((rule) => rule.ruleId)).toEqual(RULES.map((rule) => rule.id));
    const counts = (list: ReadonlyArray<{ ruleId: string; known: number; mustKnow: number }>) =>
      Object.fromEntries(list.map((rule) => [rule.ruleId, [rule.known, rule.mustKnow]]));
    expect(counts(byRule)).toEqual(counts(measure.rules));
    expect(byRule.reduce((sum, rule) => sum + rule.known, 0)).toBe(measure.known);
    expect(byRule.reduce((sum, rule) => sum + rule.mustKnow, 0)).toBe(measure.mustKnow);
    expect(readinessFigure(measure).value).toBe(Math.min(99, Math.round((100 * 4) / 5)));
  });

  it('adds up for an empty plan too, where only the plan-level row is missing', () => {
    const empty = at(snapshot(), '2026-09-01');
    const byRule = readinessByRule(empty);
    expect(byRule.every((rule) => rule.mustKnow === 0 && rule.figure === null)).toBe(true);
    // Nothing counted: every line says so, and they keep rule order among themselves.
    expect(byRule.every((rule) => !rule.counted)).toBe(true);
    expect(byRule.map((rule) => rule.ruleId)).toEqual(RULES.map((rule) => rule.id));
    expect(byRule.flatMap((rule) => rule.missing)).toEqual([]);
    expect(empty.missing.map((row) => row.ruleId)).toEqual(['plan.activity']);
  });

  it.each(Array.from({ length: 40 }, (_, seed) => seed))(
    'adds up, and every figure is traceable, for generated plan %i',
    (seed) => {
      // A small seeded plan with every kind of hole: durations, people, links, decisions.
      let state = seed + 1;
      const next = () => (state = (state * 48271) % 2147483647) / 2147483647;
      const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
      const stages = [stage('s1', 1), stage('s2', 2), stage('s3', 3)];
      const activities = Array.from({ length: Math.floor(next() * 6) }, (_, i) =>
        activity(`a${i}`, pick(['s1', 's2', 's3']), i, pick([null, 1, 2, 4]), pick([null, 'p'])),
      );
      const ids = activities.map((a) => a.id);
      const dependencies = ids.length < 2 ? [] : [link('l', ids[0]!, ids[1]!, pick([0, 2]))];
      const decisions = Array.from({ length: Math.floor(next() * 4) }, (_, i) => ({
        ...decision(`d${i}`, pick(['s1', 's2', 's3', 'gone']), i, pick([0, 1, 5, 20])),
        madeAt: pick([null, null, '2026-08-01T00:00:00.000Z']),
      }));
      const plan = snapshot({ people: PEOPLE, stages, activities, dependencies, decisions });
      const generated = at(plan, pick(['2026-08-20', '2026-09-01', '2026-09-05', '2026-10-01']));
      const byRule = readinessByRule(generated);
      expect(byRule.reduce((sum, rule) => sum + rule.known, 0)).toBe(generated.known);
      expect(byRule.reduce((sum, rule) => sum + rule.mustKnow, 0)).toBe(generated.mustKnow);
      for (const rule of byRule)
        if (rule.figure !== null) expect(traceable(rule.figure)).toBe(true);
      // Counted lines first, uncounted last; `counted` is exactly "the rule asked something".
      const flags = byRule.map((rule) => rule.counted);
      expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
      for (const rule of byRule) expect(rule.counted).toBe(rule.mustKnow > 0);
      expect(traceable(readinessFigure(generated))).toBe(true);
    },
  );
});
