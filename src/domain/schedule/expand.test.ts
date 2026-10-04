import { describe, expect, it } from 'vitest';

import { activity, link, onActivity, onStage, snapshot, stage } from '../__fixtures__/plan';
import { describeCycle } from './graph';
import { cycleIfAdded, endpointActivities, expandDependencies, indexOf } from './expand';

/**
 * Two stages and an empty one:
 *
 *   Structure (1): Foundations (1), Walls (2)
 *   Finishes  (2): Plaster (1), Paint (2)
 *   Garden    (3): nothing yet
 */
const PLAN = snapshot({
  stages: [
    stage('structure', 1, 'Structure'),
    stage('finishes', 2, 'Finishes'),
    stage('garden', 3),
  ],
  activities: [
    { ...activity('walls', 'structure', 2, 3), name: 'Walls' },
    { ...activity('foundations', 'structure', 1, 2), name: 'Foundations' },
    { ...activity('paint', 'finishes', 2, 1), name: 'Paint' },
    { ...activity('plaster', 'finishes', 1, 2), name: 'Plaster' },
  ],
});
const nameOf = (id: string) => PLAN.activities.find((a) => a.id === id)?.name ?? '';

describe('an endpoint', () => {
  it('stands for itself when it is an activity, and for all its activities when it is a stage', () => {
    expect(endpointActivities(PLAN, onActivity('walls'))).toEqual(['walls']);
    expect(endpointActivities(PLAN, onStage('structure'))).toEqual(['foundations', 'walls']);
  });

  it('stands for nothing when it is an empty stage, and is unknown when it is not in the plan', () => {
    expect(endpointActivities(PLAN, onStage('garden'))).toEqual([]);
    expect(endpointActivities(PLAN, onStage('gone'))).toBeNull();
    expect(endpointActivities(PLAN, onActivity('gone'))).toBeNull();
  });

  it('is unknown for an activity whose stage is not in the plan', () => {
    const orphan = snapshot({ ...PLAN, activities: [activity('ghost', 'gone', 1, 1)] });
    expect(endpointActivities(orphan, onActivity('ghost'))).toBeNull();
    expect(indexOf(orphan).activityIds.has('ghost')).toBe(false);
  });
});

describe('expanding dependencies', () => {
  it('turns an activity link into one edge, with its lag', () => {
    const plan = snapshot({ ...PLAN, dependencies: [link('d1', 'foundations', 'walls', 2)] });
    expect(expandDependencies(plan)).toEqual({
      edges: [{ blockerId: 'foundations', blockedId: 'walls', lagDays: 2 }],
      inert: [],
    });
  });

  it('turns stage → activity into an edge from every activity of the stage', () => {
    const plan = snapshot({
      ...PLAN,
      dependencies: [link('d1', onStage('structure'), 'plaster')],
    });
    expect(expandDependencies(plan).edges.map((e) => `${e.blockerId}>${e.blockedId}`)).toEqual([
      'foundations>plaster',
      'walls>plaster',
    ]);
  });

  it('turns activity → stage into an edge to every activity of the stage', () => {
    const plan = snapshot({ ...PLAN, dependencies: [link('d1', 'walls', onStage('finishes'), 1)] });
    expect(expandDependencies(plan).edges).toEqual([
      { blockerId: 'walls', blockedId: 'plaster', lagDays: 1 },
      { blockerId: 'walls', blockedId: 'paint', lagDays: 1 },
    ]);
  });

  it('turns stage → stage into every pair', () => {
    const plan = snapshot({
      ...PLAN,
      dependencies: [link('d1', onStage('structure'), onStage('finishes'))],
    });
    expect(expandDependencies(plan).edges).toHaveLength(4);
  });

  it('merges two links onto the same pair into one edge with the longer lag', () => {
    const plan = snapshot({
      ...PLAN,
      dependencies: [
        link('d1', 'walls', 'plaster', 1),
        link('d2', onStage('structure'), onStage('finishes'), 3),
      ],
    });
    const edges = expandDependencies(plan).edges;
    expect(edges.filter((e) => e.blockerId === 'walls' && e.blockedId === 'plaster')).toEqual([
      { blockerId: 'walls', blockedId: 'plaster', lagDays: 3 },
    ]);
    expect(edges).toHaveLength(4);
  });

  it('reports a link onto an empty stage as inert, never dropping it in silence', () => {
    const plan = snapshot({
      ...PLAN,
      dependencies: [
        link('d1', onStage('finishes'), onStage('garden')),
        link('d2', 'walls', 'paint'),
      ],
    });
    expect(expandDependencies(plan)).toEqual({
      edges: [{ blockerId: 'walls', blockedId: 'paint', lagDays: 0 }],
      inert: [{ dependencyId: 'd1', reason: 'empty-stage' }],
    });
  });

  it('reports a link naming something that is gone as inert, and keeps the others', () => {
    // The schema has no cascade trigger; a file edited outside the product can hold these.
    const plan = snapshot({
      ...PLAN,
      dependencies: [
        link('d1', 'removed-activity', 'walls'),
        link('d2', 'foundations', 'walls'),
        link('d3', onStage('removed-stage'), 'paint'),
      ],
    });
    expect(expandDependencies(plan)).toEqual({
      edges: [{ blockerId: 'foundations', blockedId: 'walls', lagDays: 0 }],
      inert: [
        { dependencyId: 'd1', reason: 'unknown-endpoint' },
        { dependencyId: 'd3', reason: 'unknown-endpoint' },
      ],
    });
  });

  it.each([[-1], [1.5], [Number.NaN]])(
    'reports a lag of %o as inert rather than guessing',
    (lag) => {
      const plan = snapshot({ ...PLAN, dependencies: [link('d1', 'foundations', 'walls', lag)] });
      expect(expandDependencies(plan)).toEqual({
        edges: [],
        inert: [{ dependencyId: 'd1', reason: 'invalid-lag' }],
      });
    },
  );

  it('keeps an activity linked to its own stage as a self-edge, so the loop is seen', () => {
    const plan = snapshot({ ...PLAN, dependencies: [link('d1', 'walls', onStage('structure'))] });
    expect(expandDependencies(plan).edges).toContainEqual({
      blockerId: 'walls',
      blockedId: 'walls',
      lagDays: 0,
    });
  });
});

describe('a loop, refused before the host is asked', () => {
  const built = snapshot({
    ...PLAN,
    dependencies: [link('d1', 'foundations', 'walls'), link('d2', 'walls', 'plaster')],
  });

  it('is named the way the host names it', () => {
    const chain = cycleIfAdded(built, onActivity('plaster'), onActivity('foundations'));
    expect(describeCycle(chain!, nameOf)).toBe('Plaster → Foundations → Walls → Plaster');
  });

  it('is found through a stage endpoint', () => {
    const plan = snapshot({
      ...PLAN,
      dependencies: [link('d1', onStage('structure'), onStage('finishes'))],
    });
    expect(
      describeCycle(cycleIfAdded(plan, onActivity('paint'), onActivity('walls'))!, nameOf),
    ).toBe('Paint → Walls → Paint');
  });

  it('is an activity made to wait on its own stage, or a stage on its own activity', () => {
    expect(
      describeCycle(cycleIfAdded(PLAN, onActivity('walls'), onStage('structure'))!, nameOf),
    ).toBe('Walls → Walls');
    expect(
      describeCycle(cycleIfAdded(PLAN, onStage('structure'), onActivity('foundations'))!, nameOf),
    ).toBe('Foundations → Foundations');
  });

  it('is not closed by a link that only repeats an existing route', () => {
    expect(cycleIfAdded(built, onActivity('foundations'), onActivity('plaster'))).toBeNull();
  });

  it('cannot be closed by a link that would be inert', () => {
    expect(cycleIfAdded(built, onStage('garden'), onActivity('foundations'))).toBeNull();
    expect(cycleIfAdded(built, onActivity('plaster'), onStage('gone'))).toBeNull();
    expect(cycleIfAdded(built, onActivity('gone'), onActivity('foundations'))).toBeNull();
  });
});
