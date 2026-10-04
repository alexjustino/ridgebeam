import { describe, expect, it } from 'vitest';

import {
  activity,
  changeDecision,
  changeOrder,
  link,
  person,
  snapshot,
  stage,
  withStageRules,
} from '../__fixtures__/plan';
import { traceable } from '../figure';
import type { WorkSnapshot } from '../plan';
import { schedule } from '../schedule';
import {
  CHANGE_RULES,
  READINESS_MESSAGE_KEYS,
  RULE_EXPLANATION_KEYS,
  RULE_LABEL_KEYS,
  readiness,
  readinessByRule,
  readinessFigure,
  sentenceParts,
} from './index';

const TODAY = '2026-10-02';

/** Two linked activities with everything known, so only change orders can be missing. */
const PLAN = snapshot({
  people: [person('p')],
  stages: [stage('s1', 1, 'Structure')],
  activities: [activity('a', 's1', 1, 3, 'p'), activity('b', 's1', 2, 2, 'p')],
  dependencies: [link('ab', 'a', 'b')],
  work: { ...snapshot().work, approvedAt: '2026-08-31T12:00:00.000Z' },
});

const at = (plan: WorkSnapshot, today = TODAY) => {
  const checked = withStageRules(plan);
  return readiness(checked, { schedule: schedule(checked), today });
};
const withChanges = (...changeOrders: WorkSnapshot['changeOrders']) => ({ ...PLAN, changeOrders });
const waiting = (measure: ReturnType<typeof at>) =>
  measure.rules.find((rule) => rule.ruleId === 'change.waiting')!;

describe('a change order waiting for a decision', () => {
  it('is its own rule, with its own message, label and explanation keys', () => {
    expect(CHANGE_RULES.map((rule) => [rule.id, rule.appliesTo])).toEqual([
      ['change.waiting', 'change'],
    ]);
    expect(READINESS_MESSAGE_KEYS['change.waiting']).toBe('readiness.missing.change.waiting');
    expect(RULE_LABEL_KEYS['change.waiting']).toBe('readiness.rule.change.waiting');
    expect(RULE_EXPLANATION_KEYS['change.waiting']).toBe('readiness.explanation.change.waiting');
  });

  it('asks nothing of a plan with no change orders', () => {
    const measure = at(PLAN);
    expect(waiting(measure)).toEqual({ ruleId: 'change.waiting', known: 0, mustKnow: 0 });
    expect(measure.missing).toEqual([]);
  });

  it('is in time for 7 calendar days', () => {
    const measure = at(withChanges(changeOrder('co1', 1, 's1', '2026-09-25')));
    expect(waiting(measure)).toMatchObject({ known: 1, mustKnow: 1 });
    expect(measure.missing).toEqual([]);
  });

  it('is something the plan does not know on the eighth', () => {
    const measure = at(withChanges(changeOrder('co1', 1, 's1', '2026-09-24')));
    expect(waiting(measure)).toMatchObject({ known: 0, mustKnow: 1 });
    expect(measure.missing).toEqual([
      {
        ruleId: 'change.waiting',
        entity: 'change',
        id: 'co1',
        name: 'Change co1',
        stageName: 'Structure',
        durationRange: null,
      },
    ]);
    expect(sentenceParts(measure.missing)).toEqual([
      { key: 'readiness.missing.change.waiting', count: 1, params: { count: 1 } },
    ]);
    expect(readinessFigure(measure).value).toBeLessThan(100);
    expect(traceable(readinessFigure(measure))).toBe(true);
  });

  it('is known once decided, however long it waited', () => {
    const measure = at(
      withChanges(
        changeOrder('co1', 1, 's1', '2026-09-01', {
          decision: changeDecision('approved', '2026-09-30'),
        }),
        changeOrder('co2', 2, 's1', '2026-09-01', {
          decision: changeDecision('withdrawn', '2026-09-30'),
        }),
      ),
    );
    expect(waiting(measure)).toMatchObject({ known: 2, mustKnow: 2 });
  });

  it('is not asked of a waiting change when today is not a day', () => {
    const measure = at(withChanges(changeOrder('co1', 1, 's1', '2026-09-01')), 'someday');
    expect(waiting(measure)).toMatchObject({ known: 0, mustKnow: 0 });
  });

  it('has a rule line that opens onto its rows, and adds up to the figure', () => {
    const measure = at(
      withChanges(
        changeOrder('co1', 1, 's1', '2026-09-01'),
        changeOrder('co2', 2, 's1', '2026-10-01'),
      ),
    );
    const line = readinessByRule(measure).find((rule) => rule.ruleId === 'change.waiting')!;
    expect(line).toMatchObject({
      known: 1,
      mustKnow: 2,
      counted: true,
      labelKey: 'readiness.rule.change.waiting',
      explanationKey: 'readiness.explanation.change.waiting',
    });
    expect(line.figure!.rows.map((row) => [row.itemId, row.entity])).toEqual([['co1', 'change']]);
    expect(traceable(line.figure!)).toBe(true);
  });
});
