import { describe, expect, it } from 'vitest';

import { activity, decision, link, snapshot, stage } from '../__fixtures__/plan';
import { traceable } from '../figure';
import type { WorkSnapshot } from '../plan';
import { schedule } from '../schedule';
import { readiness, readinessByRule, readinessFigure, sentenceParts } from './index';

const at = (plan: WorkSnapshot, today: string) =>
  readiness(plan, { schedule: schedule(plan), today });

const PEOPLE = [{ id: 'p', name: 'Sample person' }];

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

describe('readiness keeps its F0–F2 numbers', () => {
  it('reads one activity with a duration and no responsible as 1 of 2', () => {
    const one = snapshot({ stages: [stage('s', 1)], activities: [activity('a', 's', 1, 3)] });
    expect(at(one, '2026-08-31')).toMatchObject({ known: 1, mustKnow: 2 });
  });

  it('reads F2’s four linked activities with no responsible and no decision as 8 of 12', () => {
    expect(at(F2, '2026-08-31')).toMatchObject({ known: 8, mustKnow: 12 });
  });
});

describe('readiness of decisions', () => {
  it('counts a decision in time as known twice: it has a deadline, and it is not overdue', () => {
    const plan = withDecisions(READY, decision('colour', 's2', 1, 1));
    // Finishes first starts on Fri 4 (D); one day of lead puts the deadline on Thu 3, still ahead.
    expect(at(plan, '2026-09-01')).toMatchObject({ known: 14, mustKnow: 14, missing: [] });
  });

  it('says an overdue decision is not ready: "1 decision is overdue"', () => {
    const plan = withDecisions(READY, { ...decision('tile', 's1', 1, 10), name: 'Which tile' });
    const measure = at(plan, '2026-09-01');
    expect(measure).toMatchObject({ known: 13, mustKnow: 14 });
    expect(measure.missing).toEqual([
      {
        ruleId: 'decision.timely',
        entity: 'decision',
        id: 'tile',
        name: 'Which tile',
        stageName: 'Structure',
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
    // decision.deadline asks (and fails); decision.timely does not apply: 12 + 1 asked, 12 known.
    expect(measure).toMatchObject({ known: 12, mustKnow: 13 });
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
    expect(measure).toMatchObject({ known: 15, mustKnow: 15 });
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
  const plan = withDecisions(
    { ...F2, people: PEOPLE, stages: [...F2.stages, stage('garden', 3, 'Garden')] },
    decision('late', 's1', 1, 10),
    decision('fine', 's2', 1, 0),
    decision('plants', 'garden', 1, 0),
  );
  const measure = at(plan, '2026-09-01');
  const rules = readinessByRule(measure);

  it('lists every rule, in rule order, with its count', () => {
    expect(rules.map((rule) => [rule.ruleId, rule.known, rule.mustKnow])).toEqual([
      ['activity.duration', 4, 4],
      ['activity.responsible', 0, 4],
      ['activity.linked', 4, 4],
      ['decision.deadline', 2, 3],
      ['decision.timely', 1, 2],
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

  it('gives a rule that asked nothing no figure, and still lists it', () => {
    const one = snapshot({ stages: [stage('s', 1)], activities: [activity('a', 's', 1, 3)] });
    const byRule = readinessByRule(at(one, '2026-09-01'));
    expect(byRule.map((rule) => [rule.ruleId, rule.mustKnow, rule.figure === null])).toEqual([
      ['activity.duration', 1, false],
      ['activity.responsible', 1, false],
      ['activity.linked', 0, true],
      ['decision.deadline', 0, true],
      ['decision.timely', 0, true],
    ]);
  });

  it('adds up for an empty plan too, where only the plan-level row is missing', () => {
    const empty = at(snapshot(), '2026-09-01');
    const byRule = readinessByRule(empty);
    expect(byRule.every((rule) => rule.mustKnow === 0 && rule.figure === null)).toBe(true);
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
      expect(traceable(readinessFigure(generated))).toBe(true);
    },
  );
});
