import { describe, expect, it } from 'vitest';

import {
  activity,
  decision,
  link,
  person,
  snapshot,
  stage,
  takeBaseline,
} from './__fixtures__/plan';
import type { Activity, CostLine, WorkSnapshot } from './plan';
import {
  OPTIONAL_QUESTION_KINDS,
  OPTIONAL_QUESTION_MESSAGE_KEYS,
  QUESTION_DECISION_WINDOW_DAYS,
  QUESTION_KINDS,
  QUESTION_MESSAGE_KEYS,
  nextQuestion,
  nextQuestionWithOptional,
  openQuestions,
  openQuestionsWithOptional,
  type AnyQuestion,
} from './questions';
import { readiness } from './readiness';
import { schedule } from './schedule';

/** An activity a template brought: a range of working days, no duration picked yet. */
const ranged = (id: string, stageId: string, position: number, min: number, max: number) =>
  ({
    ...activity(id, stageId, position, null),
    name: `Remove ${id}`,
    durationMinDays: min,
    durationMaxDays: max,
  }) satisfies Activity;

const line = (
  id: string,
  stageId: string,
  activityId: string | null,
  amountCents: number | null,
): CostLine => ({ id, stageId, activityId, label: `Line ${id}`, amountCents });

const TODAY = '2026-09-01';

const ask = (plan: WorkSnapshot, today = TODAY, skipped: ReadonlySet<string> = new Set()) =>
  openQuestions(plan, schedule(plan), today, skipped);
const next = (plan: WorkSnapshot, today = TODAY, skipped: ReadonlySet<string> = new Set()) =>
  nextQuestion(plan, schedule(plan), today, skipped);
const keys = (questions: readonly AnyQuestion[]) => questions.map((question) => question.key);

/**
 * A plan with one of every kind of question, Tuesday 1 September 2026 on. `a1` (5 days, s1) runs
 * 1–7 Sep; `a2` (10 days, s2) waits for it and runs 8–21 Sep; `a3` (s3) waits for `a2` and starts
 * 22 Sep. `r1` and `r2` are a template's ranges, no duration.
 */
function templatePlan(): WorkSnapshot {
  return snapshot({
    people: [person('p')],
    stages: [stage('s1', 1, 'Demolition'), stage('s2', 2, 'Walls'), stage('s3', 3, 'Finish')],
    activities: [
      { ...activity('a1', 's1', 1, 5, 'p') },
      { ...activity('a2', 's2', 1, 10, 'p') },
      { ...activity('a3', 's3', 1, 2, 'p') },
      ranged('r1', 's1', 2, 1, 2),
      { ...ranged('r2', 's2', 2, 3, 3), responsibleId: 'p' },
    ],
    dependencies: [link('l1', 'a1', 'a2'), link('l2', 'a2', 'a3')],
    costLines: [
      line('c-a2', 's2', 'a2', null),
      line('c-s2', 's2', null, null),
      line('c-s1', 's1', null, 0),
      line('c-a1', 's1', 'a1', null),
    ],
    decisions: [
      decision('d-far', 's3', 1, 4),
      decision('d-edge', 's3', 2, 5),
      decision('d-s2', 's2', 1, 0),
      decision('d-s1', 's1', 1, 0),
      decision('d-made', 's3', 3, 0, '2026-08-20T10:00:00.000Z'),
    ],
  });
}

describe('the plan’s questions, in the order they are asked', () => {
  const plan = templatePlan();
  const open = ask(plan);

  it('asks ranges, then responsibles, then prices, then decisions due', () => {
    expect(keys(open.questions)).toEqual([
      'duration:r1',
      'duration:r2',
      'responsible:r1',
      'price:c-a1',
      'price:c-s2',
      'price:c-a2',
      'decision:d-s1',
      'decision:d-s2',
      'decision:d-edge',
    ]);
    expect(QUESTION_KINDS).toEqual(['duration', 'responsible', 'price', 'decision']);
    expect(open.questions.map((question) => question.kind)).toEqual(
      [...open.questions.map((question) => question.kind)].sort(
        (a, b) => QUESTION_KINDS.indexOf(a) - QUESTION_KINDS.indexOf(b),
      ),
    );
  });

  it('counts what is answered: N of M', () => {
    // Durations: none of 2. Responsibles: 4 of 5. Prices: c-s1 (priced at 0) of 4. Decisions:
    // d-made, and 3 open being asked (d-far is not asked yet).
    expect(open).toMatchObject({ locked: false, answered: 6, total: 15, skipped: 0, remaining: 9 });
    expect(open.total).toBe(open.answered + open.questions.length);
  });

  it('says a range in plain words, and what the answer writes', () => {
    expect(open.questions[0]).toEqual({
      kind: 'duration',
      key: 'duration:r1',
      messageKey: 'nextQuestion.ask.duration',
      params: { name: 'Remove r1', min: 1, max: 2, days: 2 },
      stageId: 's1',
      stageName: 'Demolition',
      activityId: 'r1',
      range: { min: 1, max: 2 },
      answer: { command: 'activity_update', targetId: 'r1', field: 'durationDays' },
    });
  });

  it('says a range of one number as that number', () => {
    expect(open.questions[1]).toMatchObject({
      messageKey: QUESTION_MESSAGE_KEYS.durationExact,
      params: { name: 'Remove r2', days: 3 },
    });
  });

  it('asks who answers for an activity, with the command that sets it', () => {
    expect(open.questions[2]).toEqual({
      kind: 'responsible',
      key: 'responsible:r1',
      messageKey: 'nextQuestion.ask.responsible',
      params: { name: 'Remove r1' },
      stageId: 's1',
      stageName: 'Demolition',
      activityId: 'r1',
      answer: { command: 'activity_update', targetId: 'r1', field: 'responsibleId' },
    });
  });

  it('asks the price of a line, stage by stage, the stage’s own lines before its activities’', () => {
    expect(open.questions[3]).toEqual({
      kind: 'price',
      key: 'price:c-a1',
      messageKey: 'nextQuestion.ask.price',
      params: { label: 'Line c-a1' },
      stageId: 's1',
      stageName: 'Demolition',
      costLineId: 'c-a1',
      activityId: 'a1',
      activityName: 'Activity a1',
      answer: { command: 'cost_line_update', targetId: 'c-a1', field: 'amountCents' },
    });
    expect(open.questions[4]).toMatchObject({ activityId: null, activityName: null });
  });

  it('asks a decision due within the window, most urgent first, with its deadline', () => {
    expect(open.questions[6]).toEqual({
      kind: 'decision',
      key: 'decision:d-s1',
      messageKey: 'nextQuestion.ask.decision',
      params: { name: 'Decision d-s1', deadline: '2026-09-01' },
      stageId: 's1',
      stageName: 'Demolition',
      decisionId: 'd-s1',
      status: 'due',
      deadline: '2026-09-01',
      daysLeft: 0,
      answer: { command: 'decision_make', targetId: 'd-s1', field: 'answer' },
    });
    expect(open.questions[7]).toMatchObject({ deadline: '2026-09-08', daysLeft: 5 });
  });

  it('asks a decision whose deadline is the 14th day, and not one on the 15th', () => {
    expect(QUESTION_DECISION_WINDOW_DAYS).toBe(14);
    expect(open.questions[8]).toMatchObject({ key: 'decision:d-edge', deadline: '2026-09-15' });
    // d-far's deadline is 16 September, 15 calendar days away: not asked yet, not counted.
    expect(keys(open.questions)).not.toContain('decision:d-far');
    expect(keys(ask(plan, '2026-09-02').questions)).toContain('decision:d-far');
  });

  it('says an overdue decision is overdue', () => {
    const late = ask(plan, '2026-09-02').questions.find((q) => q.key === 'decision:d-s1')!;
    expect(late).toMatchObject({
      messageKey: 'nextQuestion.ask.decisionOverdue',
      status: 'overdue',
      daysLeft: -1,
      params: { deadline: '2026-09-01' },
    });
    // Overdue before due, whatever the plan order.
    expect(keys(ask(plan, '2026-09-02').questions).slice(-4, -2)).toEqual([
      'decision:d-s1',
      'decision:d-s2',
    ]);
  });

  it('asks the first question first', () => {
    expect(next(plan)?.key).toBe('duration:r1');
  });
});

describe('skipping', () => {
  const plan = templatePlan();

  it('passes over a skipped question, for as long as the session keeps it skipped', () => {
    expect(next(plan, TODAY, new Set(['duration:r1']))?.key).toBe('duration:r2');
    expect(next(plan, TODAY, new Set(['duration:r1', 'duration:r2']))?.key).toBe('responsible:r1');
  });

  it('keeps a skipped question open, and in the count', () => {
    const open = ask(plan, TODAY, new Set(['duration:r1', 'price:c-s2']));
    expect(open).toMatchObject({ answered: 6, total: 15, skipped: 2, remaining: 7 });
    expect(keys(open.questions)).toContain('duration:r1');
  });

  it('ignores a skipped key that is no question of this plan any more', () => {
    expect(ask(plan, TODAY, new Set(['duration:gone', 'x']))).toMatchObject({
      skipped: 0,
      remaining: 9,
    });
  });

  it('has no next question once every open one is skipped', () => {
    const all = new Set(keys(ask(plan).questions));
    expect(next(plan, TODAY, all)).toBeNull();
    expect(ask(plan, TODAY, all)).toMatchObject({ remaining: 0, skipped: 9 });
  });
});

describe('answering moves the card on', () => {
  it('asks the next question once the plan knows the answer', () => {
    const plan = templatePlan();
    const answered: WorkSnapshot = {
      ...plan,
      activities: plan.activities.map((each) =>
        each.id === 'r1' ? { ...each, durationDays: 2 } : each,
      ),
    };
    expect(next(answered)?.key).toBe('duration:r2');
    expect(ask(answered)).toMatchObject({ answered: 7, total: 15 });
  });

  it('asks nothing of a plan that knows everything', () => {
    const plan = snapshot({
      people: [person('p')],
      stages: [stage('s', 1)],
      activities: [{ ...ranged('a', 's', 1, 1, 2), durationDays: 2, responsibleId: 'p' }],
      costLines: [line('c', 's', 'a', 100)],
    });
    expect(next(plan)).toBeNull();
    expect(ask(plan)).toMatchObject({ questions: [], answered: 3, total: 3, remaining: 0 });
  });

  it('asks nothing of an empty plan, and counts nothing', () => {
    expect(ask(snapshot())).toEqual({
      locked: false,
      questions: [],
      answered: 0,
      total: 0,
      skipped: 0,
      remaining: 0,
    });
  });
});

describe('what is not asked', () => {
  it('asks nothing while the plan is locked, and again once a replanning is open', () => {
    const plan = templatePlan();
    const approved: WorkSnapshot = {
      ...plan,
      work: { ...plan.work, approvedAt: '2026-08-31T12:00:00.000Z' },
      baselines: [takeBaseline(plan, 1)],
    };
    expect(next(approved)).toBeNull();
    expect(ask(approved)).toEqual({
      locked: true,
      questions: [],
      answered: 0,
      total: 0,
      skipped: 0,
      remaining: 0,
    });
    const replanning: WorkSnapshot = {
      ...approved,
      replanning: {
        id: 'rp',
        reason: 'The client changed the tiles',
        openedAt: '2026-09-01T09:00:00.000Z',
        authorName: 'Sample author',
      },
    };
    expect(next(replanning)?.key).toBe('duration:r1');
  });

  it('asks nothing of a closed stage’s activities and lines, and does not count them', () => {
    const plan = templatePlan();
    const closed: WorkSnapshot = {
      ...plan,
      stages: plan.stages.map((each) =>
        each.id === 's1' ? { ...each, closedAt: '2026-09-01T17:00:00.000Z' } : each,
      ),
    };
    const open = ask(closed);
    expect(keys(open.questions)).not.toContain('duration:r1');
    expect(keys(open.questions)).not.toContain('responsible:r1');
    expect(keys(open.questions)).not.toContain('price:c-a1');
    // Out of the count: r1 (range, responsible), a1 (responsible), c-s1 and c-a1.
    expect(open).toMatchObject({ answered: 4, total: 10 });
  });

  it('does not ask for a duration an activity with no range lacks: readiness says that', () => {
    const plan = snapshot({
      people: [person('p')],
      stages: [stage('s', 1)],
      activities: [activity('a', 's', 1, null, 'p')],
    });
    expect(ask(plan)).toMatchObject({ questions: [], answered: 1, total: 1 });
  });

  it('asks who answers for an activity whose responsible is no longer in the plan', () => {
    const plan = snapshot({
      stages: [stage('s', 1)],
      activities: [activity('a', 's', 1, 3, 'gone')],
    });
    expect(keys(ask(plan).questions)).toEqual(['responsible:a']);
  });

  it('asks of an activity whose stage is not in the plan, with no stage name', () => {
    const plan = snapshot({ activities: [ranged('a', 'gone', 1, 2, 4)] });
    expect(ask(plan).questions.map((q) => [q.key, q.stageId, q.stageName])).toEqual([
      ['duration:a', 'gone', null],
      ['responsible:a', 'gone', null],
    ]);
  });

  it('asks no decision on a day that is not a day, and none with no deadline yet', () => {
    const plan = templatePlan();
    expect(ask(plan, 'someday').questions.some((q) => q.kind === 'decision')).toBe(false);
    const unscheduled = snapshot({
      stages: [stage('s', 1)],
      decisions: [decision('d', 's', 1, 0)],
    });
    expect(ask(unscheduled)).toMatchObject({ questions: [], answered: 0, total: 0 });
  });
});

describe('cost lines in plan order', () => {
  it('puts a line whose activity or stage is not in the plan last, in the order given', () => {
    const plan = snapshot({
      people: [person('p')],
      stages: [stage('s2', 2), stage('s1', 1)],
      activities: [activity('b', 's2', 1, 1, 'p'), activity('a', 's1', 1, 1, 'p')],
      costLines: [
        line('gone-stage', 'nowhere', null, null),
        line('gone-activity', 's2', 'gone', null),
        line('on-b', 's1', 'b', null),
        line('on-s2', 's2', null, null),
        line('on-a', 's1', 'a', null),
        line('on-s1', 's1', null, null),
        line('on-s1-again', 's1', null, null),
      ],
    });
    const prices = ask(plan).questions.filter((q) => q.kind === 'price');
    expect(keys(prices)).toEqual([
      'price:on-s1',
      'price:on-s1-again',
      'price:on-a',
      'price:on-s2',
      'price:on-b',
      'price:gone-activity',
      'price:gone-stage',
    ]);
    // A line counts for its activity's stage (`stageOfLine`): `on-b` names s1 but is b's, in s2.
    expect(prices.find((q) => q.key === 'price:on-b')).toMatchObject({
      stageId: 's2',
      stageName: 'Stage s2',
    });
    expect(prices.find((q) => q.key === 'price:gone-activity')).toMatchObject({
      stageId: 's2',
      activityId: 'gone',
      activityName: null,
    });
    expect(prices.find((q) => q.key === 'price:gone-stage')).toMatchObject({
      stageId: 'nowhere',
      stageName: null,
    });
  });

  it('asks nothing of a line whose own stage is closed, though its activity is elsewhere', () => {
    const plan = snapshot({
      people: [person('p')],
      stages: [stage('s1', 1), { ...stage('s2', 2), closedAt: '2026-09-01T17:00:00.000Z' }],
      activities: [activity('a', 's1', 1, 1, 'p')],
      costLines: [line('odd', 's2', 'a', null)],
    });
    expect(ask(plan)).toMatchObject({ questions: [], answered: 1, total: 1 });
  });
});

describe('the questions and readiness agree', () => {
  it('asks who answers for exactly the activities readiness finds without one', () => {
    const plan = templatePlan();
    const missing = readiness(plan, { schedule: schedule(plan), today: TODAY })
      .missing.filter((row) => row.ruleId === 'activity.responsible')
      .map((row) => `responsible:${row.id}`);
    expect(keys(ask(plan).questions.filter((q) => q.kind === 'responsible'))).toEqual(missing);
  });

  it('asks for a duration only where readiness offers a range', () => {
    const plan = templatePlan();
    const ranges = readiness(plan, { schedule: schedule(plan), today: TODAY })
      .missing.filter((row) => row.ruleId === 'activity.duration' && row.durationRange !== null)
      .map((row) => `duration:${row.id}`);
    expect(keys(ask(plan).questions.filter((q) => q.kind === 'duration'))).toEqual(ranges);
  });
});

describe('the message keys', () => {
  it('are all new, one namespace, and distinct', () => {
    const values = Object.values(QUESTION_MESSAGE_KEYS);
    expect(new Set(values).size).toBe(values.length);
    for (const key of values) expect(key.startsWith('nextQuestion.')).toBe(true);
  });
});

describe('the optional question, asked last (slice D1)', () => {
  const askAll = (plan: WorkSnapshot, skipped: ReadonlySet<string> = new Set()) =>
    openQuestionsWithOptional(plan, schedule(plan), TODAY, skipped);

  it('asks the most a critical activity with a duration and no range could take, after the rest', () => {
    const plan = templatePlan();
    const all = askAll(plan);
    // a1 → a2 → a3 is the critical path; r1 and r2 have no duration and are not asked it.
    expect(keys(all.questions)).toEqual([
      ...keys(ask(plan).questions),
      'most:a1',
      'most:a2',
      'most:a3',
    ]);
    expect(all.questions.at(-3)).toEqual({
      kind: 'most',
      optional: true,
      key: 'most:a1',
      messageKey: 'nextQuestion.ask.most',
      params: { name: 'Activity a1', days: 5 },
      stageId: 's1',
      stageName: 'Demolition',
      activityId: 'a1',
      durationDays: 5,
      answer: {
        command: 'activity_update',
        targetId: 'a1',
        field: 'durationMaxDays',
        with: { durationMinDays: 5 },
      },
    });
    expect(OPTIONAL_QUESTION_KINDS).toEqual(['most']);
    expect(OPTIONAL_QUESTION_MESSAGE_KEYS.most).toBe('nextQuestion.ask.most');
    // Not in the count; asked, so skipped and remaining know them.
    expect(all).toMatchObject({ answered: 6, total: 15, optional: 3, skipped: 0, remaining: 12 });
  });

  it('comes only once nothing else is left to ask, and can be skipped like any other', () => {
    const plan = templatePlan();
    const required = new Set(keys(ask(plan).questions));
    expect(nextQuestionWithOptional(plan, schedule(plan), TODAY)?.key).toBe('duration:r1');
    expect(nextQuestionWithOptional(plan, schedule(plan), TODAY, required)?.key).toBe('most:a1');
    const skipped = new Set([...required, 'most:a1']);
    expect(nextQuestionWithOptional(plan, schedule(plan), TODAY, skipped)?.key).toBe('most:a2');
    expect(askAll(plan, skipped)).toMatchObject({ skipped: 10, remaining: 2 });
    const everything = new Set([...skipped, 'most:a2', 'most:a3']);
    expect(nextQuestionWithOptional(plan, schedule(plan), TODAY, everything)).toBeNull();
    // The questions without the optional ones never change.
    expect(nextQuestion(plan, schedule(plan), TODAY, required)?.key).toBeUndefined();
  });

  it('is not asked of an activity that has a range, is not critical, or is in a closed stage', () => {
    const plan = snapshot({
      stages: [stage('s1', 1), { ...stage('s2', 2), closedAt: '2026-09-01T17:00:00.000Z' }],
      activities: [
        { ...ranged('r', 's1', 1, 2, 5), durationDays: 3 },
        activity('long', 's1', 2, 10),
        activity('short', 's1', 3, 1),
        activity('shut', 's2', 1, 20),
      ],
      // r → long → shut is the critical path; short runs beside it.
      dependencies: [link('l1', 'r', 'long'), link('l2', 'long', 'shut')],
    });
    expect(schedule(plan).critical).toEqual(new Set(['r', 'long', 'shut']));
    expect(keys(askAll(plan).questions).filter((key) => key.startsWith('most:'))).toEqual([
      'most:long',
    ]);
  });

  it('is not asked while the plan is locked', () => {
    const plan = templatePlan();
    const approved: WorkSnapshot = {
      ...plan,
      work: { ...plan.work, approvedAt: '2026-08-31T12:00:00.000Z' },
      baselines: [takeBaseline(plan, 1)],
    };
    expect(askAll(approved)).toEqual({
      locked: true,
      questions: [],
      answered: 0,
      total: 0,
      skipped: 0,
      remaining: 0,
      optional: 0,
    });
  });
});
