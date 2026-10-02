import { describe, expect, it } from 'vitest';

import { activity, link, person, snapshot, stage } from '../__fixtures__/plan';
import { traceable } from '../figure';
import type { CostLine, WorkSnapshot } from '../plan';
import { schedule } from '../schedule';
import {
  READINESS_MESSAGE_KEYS,
  RULE_EXPLANATION_KEYS,
  RULE_LABEL_KEYS,
  WORK_RULES,
  plannedCentsOf,
  readiness,
  readinessByRule,
  readinessFigure,
  sentenceParts,
} from './index';

const TODAY = '2026-08-31';

const line = (id: string, stageId: string, amountCents: number | null): CostLine => ({
  id,
  stageId,
  activityId: null,
  label: `Line ${id}`,
  amountCents,
});

/** Two linked activities with everything known but money: only the funding rule is in question. */
const PLAN = snapshot({
  people: [person('p')],
  stages: [stage('s1', 1, 'Structure')],
  activities: [activity('a', 's1', 1, 3, 'p'), activity('b', 's1', 2, 2, 'p')],
  dependencies: [link('ab', 'a', 'b')],
  checks: [
    { id: 'c1', stageId: 's1', gate: 'start', position: 1, name: 'S', needsPhoto: false },
    { id: 'c2', stageId: 's1', gate: 'close', position: 1, name: 'C', needsPhoto: false },
  ],
});

const at = (plan: WorkSnapshot) => readiness(plan, { schedule: schedule(plan), today: TODAY });
const fundingRule = (plan: WorkSnapshot) =>
  at(plan).rules.find((rule) => rule.ruleId === 'work.funding')!;
const FUND = {
  id: 'f1',
  position: 1,
  label: 'Savings',
  source: null,
  amountCents: 100_00,
  expectedOn: TODAY,
  note: null,
};

describe('where the money comes from (E2)', () => {
  it('is its own rule over the work, with its own message, label and explanation keys', () => {
    expect(WORK_RULES.map((rule) => [rule.id, rule.appliesTo])).toEqual([['work.funding', 'work']]);
    expect(READINESS_MESSAGE_KEYS['work.funding']).toBe('readiness.missing.work.funding');
    expect(RULE_LABEL_KEYS['work.funding']).toBe('readiness.rule.work.funding');
    expect(RULE_EXPLANATION_KEYS['work.funding']).toBe('readiness.explanation.work.funding');
  });

  it('asks nothing of a work with no money planned', () => {
    expect(fundingRule(PLAN)).toEqual({ ruleId: 'work.funding', known: 0, mustKnow: 0 });
    // A line not priced yet, or priced at zero, is no money to fund.
    const unpriced = { ...PLAN, costLines: [line('l1', 's1', null), line('l2', 's1', 0)] };
    expect(plannedCentsOf(unpriced)).toBe(0);
    expect(fundingRule(unpriced)).toEqual({ ruleId: 'work.funding', known: 0, mustKnow: 0 });
  });

  it('says a work with money planned and no funding row does not know where it comes from', () => {
    const plan = { ...PLAN, costLines: [line('l1', 's1', 500_00)] };
    const measure = at(plan);
    expect(fundingRule(plan)).toEqual({ ruleId: 'work.funding', known: 0, mustKnow: 1 });
    expect(measure.missing).toEqual([
      {
        ruleId: 'work.funding',
        entity: 'work',
        id: 'work-1',
        name: 'Sample work',
        stageName: null,
        durationRange: null,
      },
    ]);
    expect(sentenceParts(measure.missing)).toEqual([
      { key: 'readiness.missing.work.funding', count: 1, params: { count: 1 } },
    ]);
    const figure = readinessFigure(measure);
    expect(figure.rows.map((row) => row.key)).toEqual(['work.funding:work-1']);
    expect(traceable(figure)).toBe(true);
  });

  it('is known once one funding row is written down; a receipt alone is not a plan', () => {
    const priced = { ...PLAN, costLines: [line('l1', 's1', 500_00)] };
    const receiptOnly = {
      ...priced,
      fundingReceipts: [
        {
          seq: 1,
          fundingId: null,
          amountCents: 100_00,
          day: TODAY,
          note: null,
          reversesSeq: null,
          authorName: 'Sample author',
          createdAt: `${TODAY}T12:00:00.000Z`,
        },
      ],
    };
    expect(fundingRule(receiptOnly)).toEqual({ ruleId: 'work.funding', known: 0, mustKnow: 1 });
    const funded = { ...priced, funding: [FUND] };
    expect(fundingRule(funded)).toEqual({ ruleId: 'work.funding', known: 1, mustKnow: 1 });
    expect(at(funded).missing).toEqual([]);
    expect(readinessFigure(at(funded)).value).toBe(100);
  });

  it('is listed with its own line, last of the rules, and adds up with the rest', () => {
    const plan = { ...PLAN, costLines: [line('l1', 's1', 500_00)] };
    const byRule = readinessByRule(at(plan));
    const own = byRule.find((rule) => rule.ruleId === 'work.funding')!;
    expect(own).toMatchObject({
      known: 0,
      mustKnow: 1,
      counted: true,
      labelKey: 'readiness.rule.work.funding',
      explanationKey: 'readiness.explanation.work.funding',
    });
    expect(traceable(own.figure!)).toBe(true);
    const measure = at(plan);
    expect(byRule.reduce((sum, rule) => sum + rule.mustKnow, 0)).toBe(measure.mustKnow);
  });
});
