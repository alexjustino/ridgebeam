import { describe, expect, it } from 'vitest';

import { activity, snapshot, stage } from '../__fixtures__/plan';
import { traceable } from '../figure';
import type { Answer, Check, CheckAnswer, Stage, WorkSnapshot } from '../plan';
import { readiness, readinessByRule, readinessFigure, sentenceParts } from '../readiness';
import { schedule } from '../schedule';
import {
  checksAt,
  checksWithoutStage,
  closedStageIfAdded,
  DEFAULT_CHECK_KEYS,
  DEFAULT_CHECKS_NEEDING_PHOTO,
  defaultCheckNeedsPhoto,
  gatesHeldFigure,
  gateStatus,
  holdingItems,
  latestAnswers,
  stageActionProblem,
  stagesFigure,
  stageState,
  validateAnswer,
} from './index';

const check = (id: string, stageId: string, gate: Check['gate'], position: number): Check => ({
  id,
  stageId,
  gate,
  position,
  name: `Check ${id}`,
  needsPhoto: false,
});

let answerId = 0;
const answer = (
  checkId: string,
  seq: number,
  value: Answer,
  reason: string | null = value === 'na' ? 'Not here' : null,
): CheckAnswer => ({
  id: `answer-${(answerId += 1)}`,
  checkId,
  seq,
  answer: value,
  reason,
  photoHash: null,
  authorName: 'Sample author',
  answeredAt: `2026-09-0${Math.min(9, seq)}T12:00:00.000Z`,
});

const started = (each: Stage, at = '2026-09-01T08:00:00.000Z'): Stage => ({
  ...each,
  startedAt: at,
});
const closed = (each: Stage, at = '2026-09-04T17:00:00.000Z'): Stage => ({
  ...started(each),
  closedAt: at,
});

/**
 * Tiling, then Painting. Tiling asks two things before it starts and two before it closes; Painting
 * asks one of each.
 */
const TILING = stage('tiling', 1, 'Tiling');
const PAINTING = stage('painting', 2, 'Painting');
const CHECKS: Check[] = [
  check('materials', 'tiling', 'start', 1),
  check('area', 'tiling', 'start', 2),
  check('photos', 'tiling', 'close', 2),
  check('inspected', 'tiling', 'close', 1),
  check('paint-start', 'painting', 'start', 1),
  check('paint-close', 'painting', 'close', 1),
];
const PLAN = snapshot({
  stages: [TILING, PAINTING],
  activities: [activity('tile', 'tiling', 1, 3), activity('paint', 'painting', 1, 2)],
  checks: CHECKS,
});

const withStages = (plan: WorkSnapshot, ...stages: Stage[]): WorkSnapshot => ({ ...plan, stages });
const withAnswers = (plan: WorkSnapshot, ...checkAnswers: CheckAnswer[]): WorkSnapshot => ({
  ...plan,
  checkAnswers,
});

describe('a stage’s lifecycle', () => {
  it('is planned, then started, then closed, as the person decides', () => {
    expect(stageState(TILING)).toBe('planned');
    expect(stageState(started(TILING))).toBe('started');
    expect(stageState(closed(TILING))).toBe('closed');
  });

  it('is closed whenever it says closed, even without a start', () => {
    expect(stageState({ ...TILING, closedAt: '2026-09-04T17:00:00.000Z' })).toBe('closed');
  });
});

describe('answers', () => {
  it('count by their latest: the highest seq wins, whatever order they come in', () => {
    const latest = latestAnswers([
      answer('materials', 2, 'no'),
      answer('materials', 3, 'yes'),
      answer('materials', 1, 'yes'),
      answer('area', 1, 'na'),
    ]);
    expect(latest.get('materials')).toMatchObject({ seq: 3, answer: 'yes' });
    expect(latest.get('area')).toMatchObject({ answer: 'na' });
    expect(latest.has('photos')).toBe(false);
  });
});

describe('a gate', () => {
  it('lists its checks by position, and only this stage’s at this gate', () => {
    expect(checksAt(CHECKS, 'tiling', 'close').map((c) => c.id)).toEqual(['inspected', 'photos']);
    const tied = [check('b', 's', 'start', 1), check('a', 's', 'start', 1)];
    expect(checksAt(tied, 's', 'start').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('is held by an unanswered item', () => {
    const status = gateStatus(TILING, CHECKS, [answer('materials', 1, 'yes')], 'start');
    expect(status.passed).toBe(false);
    expect(holdingItems(status).map((item) => item.check.id)).toEqual(['area']);
    expect(
      status.items.map((item) => [item.check.id, item.latest?.answer ?? null, item.holds]),
    ).toEqual([
      ['materials', 'yes', false],
      ['area', null, true],
    ]);
  });

  it('is held by a no', () => {
    const status = gateStatus(
      TILING,
      CHECKS,
      [answer('materials', 1, 'yes'), answer('area', 1, 'no')],
      'start',
    );
    expect(status.passed).toBe(false);
    expect(holdingItems(status).map((item) => item.check.id)).toEqual(['area']);
  });

  it('is passed by yes and not applicable', () => {
    const status = gateStatus(
      TILING,
      CHECKS,
      [answer('materials', 1, 'yes'), answer('area', 1, 'na')],
      'start',
    );
    expect(status).toMatchObject({ stageId: 'tiling', gate: 'start', passed: true });
    expect(holdingItems(status)).toEqual([]);
  });

  it('is held again by a no answered after a yes: the latest counts', () => {
    const answers = [
      answer('materials', 1, 'yes'),
      answer('area', 1, 'yes'),
      answer('area', 2, 'no'),
    ];
    expect(gateStatus(TILING, CHECKS, answers, 'start').passed).toBe(false);
    expect(gateStatus(TILING, CHECKS, [...answers, answer('area', 3, 'yes')], 'start').passed).toBe(
      true,
    );
  });

  it('asks nothing with no checks, and so is passed', () => {
    expect(gateStatus(stage('empty', 3), CHECKS, [], 'close')).toEqual({
      stageId: 'empty',
      gate: 'close',
      items: [],
      passed: true,
    });
  });
});

describe('starting, closing and reopening a stage', () => {
  const allStart = [answer('materials', 1, 'yes'), answer('area', 1, 'na')];
  const allClose = [answer('inspected', 1, 'yes'), answer('photos', 1, 'yes')];

  it('refuses to start while the start gate is held, and names the items', () => {
    const problem = stageActionProblem(PLAN, 'tiling', 'start');
    expect(problem).toMatchObject({ code: 'gate-open', gate: 'start' });
    expect(problem?.code === 'gate-open' && problem.items.map((item) => item.check.name)).toEqual([
      'Check materials',
      'Check area',
    ]);
  });

  it('starts once the start gate passes', () => {
    expect(stageActionProblem(withAnswers(PLAN, ...allStart), 'tiling', 'start')).toBeNull();
  });

  it('refuses to start a started stage', () => {
    const plan = withStages(withAnswers(PLAN, ...allStart), started(TILING), PAINTING);
    expect(stageActionProblem(plan, 'tiling', 'start')).toEqual({ code: 'already-started' });
  });

  it('refuses to close a planned stage, which has not started', () => {
    const plan = withAnswers(PLAN, ...allStart, ...allClose);
    expect(stageActionProblem(plan, 'tiling', 'close')).toEqual({ code: 'not-started' });
  });

  it('refuses to close with an unanswered item, and names it', () => {
    const plan = withStages(
      withAnswers(PLAN, ...allStart, answer('inspected', 1, 'yes')),
      started(TILING),
      PAINTING,
    );
    const problem = stageActionProblem(plan, 'tiling', 'close');
    expect(problem).toMatchObject({ code: 'gate-open', gate: 'close' });
    expect(problem?.code === 'gate-open' && problem.items.map((item) => item.check.id)).toEqual([
      'photos',
    ]);
  });

  it('closes a started stage whose close gate passes', () => {
    const plan = withStages(withAnswers(PLAN, ...allStart, ...allClose), started(TILING), PAINTING);
    expect(stageActionProblem(plan, 'tiling', 'close')).toBeNull();
  });

  it('refuses to start or close a closed stage, and reopens only a closed one', () => {
    const plan = withStages(withAnswers(PLAN, ...allStart, ...allClose), closed(TILING), PAINTING);
    expect(stageActionProblem(plan, 'tiling', 'start')).toEqual({ code: 'already-closed' });
    expect(stageActionProblem(plan, 'tiling', 'close')).toEqual({ code: 'already-closed' });
    expect(stageActionProblem(plan, 'tiling', 'reopen')).toBeNull();
    expect(stageActionProblem(plan, 'painting', 'reopen')).toEqual({ code: 'not-closed' });
  });

  it('closes again after reopening, and a no answered since holds it', () => {
    const reopened = { ...closed(TILING), closedAt: null };
    const plan = withStages(withAnswers(PLAN, ...allStart, ...allClose), reopened, PAINTING);
    expect(stageState(reopened)).toBe('started');
    expect(stageActionProblem(plan, 'tiling', 'close')).toBeNull();
    const since = withAnswers(plan, ...allStart, ...allClose, answer('photos', 2, 'no'));
    expect(stageActionProblem(since, 'tiling', 'close')).toMatchObject({ code: 'gate-open' });
  });

  it('refuses a stage that is not in the plan', () => {
    expect(stageActionProblem(PLAN, 'gone', 'start')).toEqual({ code: 'unknown-stage' });
  });
});

describe('an answer, checked before the host is asked', () => {
  it('refuses not applicable without a reason', () => {
    expect(validateAnswer(PLAN, 'area', 'na', null)).toEqual([{ code: 'na-without-reason' }]);
    expect(validateAnswer(PLAN, 'area', 'na', '   ')).toEqual([{ code: 'na-without-reason' }]);
    expect(validateAnswer(PLAN, 'area', 'na', 'The area is already clear')).toEqual([]);
  });

  it('accepts yes and no with or without a reason', () => {
    expect(validateAnswer(PLAN, 'area', 'yes', null)).toEqual([]);
    expect(validateAnswer(PLAN, 'area', 'no', 'The tiles are not here')).toEqual([]);
  });

  it('refuses an unknown check, an unknown answer and a reason over 500 characters, all at once', () => {
    expect(validateAnswer(PLAN, 'gone', 'maybe' as Answer, 'x'.repeat(501))).toEqual([
      { code: 'unknown-check' },
      { code: 'invalid-answer' },
      { code: 'reason-too-long' },
    ]);
  });
});

describe('a closed stage is closed', () => {
  const plan = withStages(PLAN, closed(TILING), PAINTING);

  it('refuses a dependency that makes an activity of a closed stage wait, naming the stage', () => {
    expect(closedStageIfAdded(plan, { kind: 'activity', id: 'tile' })).toBe('tiling');
    expect(closedStageIfAdded(plan, { kind: 'stage', id: 'tiling' })).toBe('tiling');
  });

  it('lets anything wait on it, and lets an open stage be made to wait', () => {
    expect(closedStageIfAdded(plan, { kind: 'activity', id: 'paint' })).toBeNull();
    expect(closedStageIfAdded(plan, { kind: 'stage', id: 'painting' })).toBeNull();
  });

  it('says nothing about an endpoint that is not in the plan', () => {
    expect(closedStageIfAdded(plan, { kind: 'activity', id: 'gone' })).toBeNull();
    expect(closedStageIfAdded(plan, { kind: 'stage', id: 'gone' })).toBeNull();
  });
});

describe('a check on a stage that is gone', () => {
  it('is listed, never dropped', () => {
    const plan = { ...PLAN, checks: [...CHECKS, check('orphan', 'gone', 'close', 1)] };
    expect(checksWithoutStage(plan).map((c) => c.id)).toEqual(['orphan']);
    expect(checksWithoutStage(PLAN)).toEqual([]);
  });
});

describe('the stages figures', () => {
  const plan = withStages(PLAN, closed(TILING), started(PAINTING), stage('garden', 3, 'Garden'));

  it('count the stages in each state, opening onto them, and hold every stage once', () => {
    const figures = (['planned', 'started', 'closed'] as const).map((state) =>
      stagesFigure(plan, state),
    );
    expect(figures.map((figure) => [figure.id, figure.value])).toEqual([
      ['stages:planned', 1],
      ['stages:started', 1],
      ['stages:closed', 1],
    ]);
    expect(figures.flatMap((figure) => figure.rows.map((row) => row.stageId)).sort()).toEqual([
      'garden',
      'painting',
      'tiling',
    ]);
    for (const figure of figures) expect(traceable(figure)).toBe(true);
    expect(figures[2]!.rows[0]).toMatchObject({
      key: 'stage:tiling',
      title: 'Tiling',
      day: '2026-09-04',
      state: 'closed',
    });
    expect(figures[2]!.label).toBe('checks.figure.closed');
    expect(figures[0]!.rows[0]!.day).toBeNull();
  });
});

describe('gates held', () => {
  it('lists the first stage whose start gate is held, with the items that hold it', () => {
    const figure = gatesHeldFigure(PLAN);
    // Painting's gate is held too, but Tiling is not closed: Painting is waiting on Tiling, not on
    // its gate.
    expect(
      figure.rows.map((row) => [row.stageId, row.gate, row.holding.map((i) => i.check.id)]),
    ).toEqual([['tiling', 'start', ['materials', 'area']]]);
    expect(figure).toMatchObject({ id: 'gates-held', label: 'checks.figure.gatesHeld', value: 1 });
    expect(traceable(figure)).toBe(true);
  });

  it('lists a started stage held at its close gate, and the next stage once the one before closes', () => {
    const answers = [
      answer('materials', 1, 'yes'),
      answer('area', 1, 'yes'),
      answer('inspected', 1, 'no'),
    ];
    const running = withStages(withAnswers(PLAN, ...answers), started(TILING), PAINTING);
    expect(gatesHeldFigure(running).rows.map((row) => [row.stageId, row.gate])).toEqual([
      ['tiling', 'close'],
    ]);
    const done = withStages(withAnswers(PLAN, ...answers), closed(TILING), PAINTING);
    expect(gatesHeldFigure(done).rows.map((row) => [row.stageId, row.gate])).toEqual([
      ['painting', 'start'],
    ]);
  });

  it('holds nothing when every next gate passes, or asks nothing', () => {
    const noChecks = { ...PLAN, checks: [] };
    expect(gatesHeldFigure(noChecks).value).toBe(0);
    const allClosed = withStages(PLAN, closed(TILING), closed(PAINTING));
    expect(gatesHeldFigure(allClosed).rows).toEqual([]);
  });
});

describe('the usual checks', () => {
  it('are four to start and five to close, as message keys, each once', () => {
    expect(DEFAULT_CHECK_KEYS.start).toHaveLength(4);
    expect(DEFAULT_CHECK_KEYS.close).toHaveLength(5);
    const keys = [...DEFAULT_CHECK_KEYS.start, ...DEFAULT_CHECK_KEYS.close];
    expect(new Set(keys).size).toBe(9);
    for (const key of keys) expect(key).toMatch(/^checks\.default\.(start|close)\./);
  });

  it('flag one of them, at the close gate, as hidden work: its yes needs a photo', () => {
    expect(DEFAULT_CHECKS_NEEDING_PHOTO).toEqual(['checks.default.close.hiddenWorkPhotographed']);
    expect(DEFAULT_CHECK_KEYS.close).toContain('checks.default.close.hiddenWorkPhotographed');
    const flagged = [...DEFAULT_CHECK_KEYS.start, ...DEFAULT_CHECK_KEYS.close].filter((key) =>
      defaultCheckNeedsPhoto(key),
    );
    expect(flagged).toEqual(['checks.default.close.hiddenWorkPhotographed']);
  });
});

describe('readiness: every stage has its checks', () => {
  const measure = (plan: WorkSnapshot) =>
    readiness(plan, { schedule: schedule(plan), today: '2026-09-01' });

  it('is known for a stage with a check at each gate', () => {
    const rule = readinessByRule(measure(PLAN)).find((each) => each.ruleId === 'stage.checks')!;
    expect(rule).toMatchObject({ known: 2, mustKnow: 2, missing: [] });
  });

  it('is missing for a stage with checks on one gate only, and for a stage with none', () => {
    const plan = {
      ...PLAN,
      stages: [TILING, PAINTING, stage('garden', 3, 'Garden')],
      checks: CHECKS.filter((c) => !(c.stageId === 'painting' && c.gate === 'close')),
    };
    const result = measure(plan);
    expect(result.missing.filter((row) => row.ruleId === 'stage.checks')).toEqual([
      {
        ruleId: 'stage.checks',
        entity: 'stage',
        id: 'painting',
        name: 'Painting',
        stageName: 'Painting',
        durationRange: null,
      },
      {
        ruleId: 'stage.checks',
        entity: 'stage',
        id: 'garden',
        name: 'Garden',
        stageName: 'Garden',
        durationRange: null,
      },
    ]);
    expect(
      sentenceParts(result.missing).find((part) => part.key === 'readiness.missing.stage.checks'),
    ).toEqual({
      key: 'readiness.missing.stage.checks',
      count: 2,
      params: { count: 2 },
    });
    const rule = readinessByRule(result).find((each) => each.ruleId === 'stage.checks')!;
    expect(rule).toMatchObject({ known: 1, mustKnow: 3, labelKey: 'readiness.rule.stage.checks' });
    expect(traceable(rule.figure!)).toBe(true);
  });

  it.each(Array.from({ length: 40 }, (_, seed) => seed))(
    'adds up rule by rule, stage rule included, for generated plan %i',
    (seed) => {
      let state = seed + 11;
      const next = () => (state = (state * 48271) % 2147483647) / 2147483647;
      const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
      const stages = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, i) =>
        stage(`s${i}`, i),
      );
      const activities = Array.from({ length: Math.floor(next() * 5) }, (_, i) =>
        activity(`a${i}`, pick(stages).id, i, pick([null, 2]), pick([null, 'p'])),
      );
      const checks = Array.from({ length: Math.floor(next() * 6) }, (_, i) =>
        check(
          `c${i}`,
          pick([...stages.map((s) => s.id), 'gone']),
          pick(['start', 'close'] as const),
          i,
        ),
      );
      const plan = snapshot({
        people: [
          {
            id: 'p',
            name: 'P',
            trade: null,
            phone: null,
            email: null,
            note: null,
            availability: null,
            stageIds: [],
          },
        ],
        stages,
        activities,
        checks,
      });
      const result = measure(plan);
      const byRule = readinessByRule(result);
      expect(byRule.reduce((sum, rule) => sum + rule.known, 0)).toBe(result.known);
      expect(byRule.reduce((sum, rule) => sum + rule.mustKnow, 0)).toBe(result.mustKnow);
      for (const rule of byRule)
        if (rule.figure !== null) expect(traceable(rule.figure)).toBe(true);
      expect(traceable(readinessFigure(result))).toBe(true);
    },
  );
});
