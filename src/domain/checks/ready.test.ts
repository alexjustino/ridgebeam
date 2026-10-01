import { describe, expect, it } from 'vitest';

import { snapshot, stage } from '../__fixtures__/plan';
import { traceable } from '../figure';
import type { Check, CheckAnswer, Stage } from '../plan';
import { gatesHeldFigure, STAGES_READY_LABEL_KEY, stagesReadyFigure } from './index';

const startCheck = (id: string, stageId: string): Check => ({
  id,
  stageId,
  gate: 'start',
  position: 1,
  name: `Check ${id}`,
  needsPhoto: false,
});

const yes = (checkId: string): CheckAnswer => ({
  id: `answer-${checkId}`,
  checkId,
  seq: 1,
  answer: 'yes',
  reason: null,
  photoHash: null,
  authorName: 'Sample author',
  answeredAt: '2026-09-01T12:00:00.000Z',
});

const started = (each: Stage): Stage => ({ ...each, startedAt: '2026-09-01T08:00:00.000Z' });
const closed = (each: Stage): Stage => ({ ...started(each), closedAt: '2026-09-04T17:00:00.000Z' });

describe('stages ready to start', () => {
  it('is the first planned stage when its start gate asks nothing', () => {
    const figure = stagesReadyFigure(
      snapshot({ stages: [stage('a', 1, 'Tiling'), stage('b', 2)] }),
    );
    expect(figure.label).toBe(STAGES_READY_LABEL_KEY);
    expect(figure.rows).toEqual([
      {
        key: 'stage:a',
        itemId: 'a',
        title: 'Tiling',
        day: null,
        minutes: 0,
        stageId: 'a',
        state: 'planned',
        startedAt: null,
        closedAt: null,
      },
    ]);
    expect(traceable(figure)).toBe(true);
  });

  it('is never a stage whose start gate is held: that one is held, not ready', () => {
    const plan = snapshot({ stages: [stage('a', 1)], checks: [startCheck('c', 'a')] });
    expect(stagesReadyFigure(plan).value).toBe(0);
    expect(gatesHeldFigure(plan).value).toBe(1);
    expect(stagesReadyFigure({ ...plan, checkAnswers: [yes('c')] }).value).toBe(1);
  });

  it('waits for the stage before it to close, and is never a started or closed stage', () => {
    const plan = snapshot({
      stages: [closed(stage('a', 1)), started(stage('b', 2)), stage('c', 3), stage('d', 4)],
    });
    expect(stagesReadyFigure(plan).value).toBe(0);
    const next = snapshot({ stages: [closed(stage('a', 1)), stage('b', 2), stage('c', 3)] });
    expect(stagesReadyFigure(next).rows.map((row) => row.stageId)).toEqual(['b']);
  });
});
