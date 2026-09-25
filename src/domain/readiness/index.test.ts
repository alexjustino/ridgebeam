import { describe, expect, it } from 'vitest';

import { link, onStage } from '../__fixtures__/plan';
import { traceable } from '../figure';
import { schedule } from '../schedule';
import type { Activity, Person, Stage, WorkSnapshot } from '../plan';
import {
  READINESS_LABEL_KEY,
  READINESS_MESSAGE_KEYS,
  readiness,
  readinessFigure,
  RULE_EXPLANATION_KEYS,
  RULE_LABEL_KEYS,
  RULES,
  sentenceParts,
} from './index';

/** A synthetic work. Nothing in it is a real place, person or price. */
function snapshot(parts: Partial<WorkSnapshot> = {}): WorkSnapshot {
  return {
    work: {
      workId: 'work-1',
      name: 'Sample bathroom',
      place: 'Sample street',
      startDate: '2026-09-01',
      currency: 'BRL',
      createdAt: '2026-08-20T12:00:00.000Z',
      approvedAt: null,
    },
    calendar: { workingDays: '1111100', hoursPerDay: 8 },
    holidays: [],
    people: [],
    rooms: [],
    stages: [],
    activities: [],
    dependencies: [],
    baselines: [],
    decisions: [],
    ...parts,
  };
}

/** Readiness as the dashboard asks it: with the plan's own schedule, on a fixed day. */
const TODAY = '2026-08-31';
const ready = (plan: WorkSnapshot) => readiness(plan, { schedule: schedule(plan), today: TODAY });

const BATHROOM: Stage = { id: 'bathroom', position: 1, name: 'Bathroom' };
const TILER: Person = { id: 'tiler', name: 'Sample tiler' };

const activity = (
  id: string,
  name: string,
  durationDays: number | null,
  responsibleId: string | null,
  stageId = BATHROOM.id,
  position = 1,
): Activity => ({
  id,
  stageId,
  position,
  name,
  durationDays,
  responsibleId,
  roomIds: [],
  quantity: null,
  unit: null,
});

describe('the rule table', () => {
  it('holds the F0 rules, F2’s linking rule and F3’s two decision rules, as data', () => {
    expect(RULES.map((rule) => [rule.id, rule.appliesTo])).toEqual([
      ['activity.duration', 'activity'],
      ['activity.responsible', 'activity'],
      ['activity.linked', 'activity'],
      ['decision.deadline', 'decision'],
      ['decision.timely', 'decision'],
    ]);
    for (const rule of RULES) {
      expect(rule.messageKey).toBe(READINESS_MESSAGE_KEYS[rule.id]);
      expect(RULE_LABEL_KEYS[rule.id]).toBe(`readiness.rule.${rule.id}`);
      expect(RULE_EXPLANATION_KEYS[rule.id]).toBe(`readiness.explanation.${rule.id}`);
    }
  });

  it('names every message key under readiness., so the i18n tables can be checked for them', () => {
    const keys = [
      ...Object.values(READINESS_MESSAGE_KEYS),
      ...Object.values(RULE_LABEL_KEYS),
      ...Object.values(RULE_EXPLANATION_KEYS),
      READINESS_LABEL_KEY,
    ];
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^readiness\./);
  });
});

describe('quantity', () => {
  it('is not a readiness rule: an activity with no quantity and no room is still ready', () => {
    // The spec's readiness kinds are duration, responsible, decision, check, cost and
    // dependency. Quantity and rooms are useful and optional; the plan does not need them.
    expect(RULES.map((rule) => rule.id)).not.toContain('activity.quantity');
    const plan = snapshot({
      stages: [BATHROOM],
      people: [TILER],
      activities: [activity('tiling', 'Tiling', 3, TILER.id)],
    });
    expect(plan.activities[0]).toMatchObject({ quantity: null, unit: null, roomIds: [] });
    expect(ready(plan)).toMatchObject({ known: 2, mustKnow: 2, ratio: 1, missing: [] });
  });

  it('does not change readiness when it is given', () => {
    const without = snapshot({
      stages: [BATHROOM],
      activities: [activity('tiling', 'Tiling', 3, null)],
    });
    const withQuantity = snapshot({
      ...without,
      activities: [{ ...activity('tiling', 'Tiling', 3, null), quantity: 12, unit: 'm²' }],
    });
    expect(ready(withQuantity)).toEqual(ready(without));
  });
});

describe('readiness', () => {
  it('counts an activity with a duration and no responsible as 1 of 2, 50 %', () => {
    const plan = snapshot({
      stages: [BATHROOM],
      activities: [activity('tiling', 'Tiling', 3, null)],
    });
    const measure = ready(plan);
    expect(measure).toMatchObject({
      known: 1,
      mustKnow: 2,
      ratio: 0.5,
      missing: [
        {
          ruleId: 'activity.responsible',
          entity: 'activity',
          id: 'tiling',
          name: 'Tiling',
          stageName: 'Bathroom',
        },
      ],
    });
    expect(readinessFigure(measure).value).toBe(50);
    expect(sentenceParts(measure.missing)).toEqual([
      { key: 'readiness.missing.activity.responsible', count: 1, params: { count: 1 } },
    ]);
  });

  it('counts an activity with no duration as not ready', () => {
    const plan = snapshot({
      stages: [BATHROOM],
      people: [TILER],
      activities: [activity('tiling', 'Tiling', null, TILER.id)],
    });
    const measure = ready(plan);
    expect(measure.known).toBe(1);
    expect(measure.mustKnow).toBe(2);
    expect(measure.missing.map((row) => row.ruleId)).toEqual(['activity.duration']);
    expect(sentenceParts(measure.missing)).toEqual([
      { key: 'readiness.missing.activity.duration', count: 1, params: { count: 1 } },
    ]);
  });

  it.each([[0], [-3], [2.5]])('counts a duration of %o as no duration', (days) => {
    const plan = snapshot({
      stages: [BATHROOM],
      people: [TILER],
      activities: [activity('tiling', 'Tiling', days, TILER.id)],
    });
    expect(ready(plan).missing.map((row) => row.ruleId)).toEqual(['activity.duration']);
  });

  it('says both things when both are missing, in the rule order', () => {
    const plan = snapshot({
      stages: [BATHROOM],
      activities: [activity('tiling', 'Tiling', null, null)],
    });
    const measure = ready(plan);
    expect(measure.known).toBe(0);
    expect(measure.ratio).toBe(0);
    expect(readinessFigure(measure).value).toBe(0);
    expect(sentenceParts(measure.missing)).toEqual([
      { key: 'readiness.missing.activity.duration', count: 1, params: { count: 1 } },
      { key: 'readiness.missing.activity.responsible', count: 1, params: { count: 1 } },
    ]);
  });

  it('reads 100 % with nothing missing and nothing to say once everything is known', () => {
    const plan = snapshot({
      stages: [BATHROOM],
      people: [TILER],
      activities: [activity('tiling', 'Tiling', 3, TILER.id)],
    });
    const measure = ready(plan);
    expect(measure).toMatchObject({ known: 2, mustKnow: 2, ratio: 1, missing: [] });
    expect(readinessFigure(measure).value).toBe(100);
    expect(readinessFigure(measure).rows).toEqual([]);
    expect(sentenceParts(measure.missing)).toEqual([]);
  });

  it('is not ready with no activity, and explains that the plan has none', () => {
    const measure = ready(snapshot({ stages: [BATHROOM] }));
    expect(measure).toMatchObject({
      known: 0,
      mustKnow: 0,
      ratio: 0,
      missing: [
        {
          ruleId: 'plan.activity',
          entity: 'plan',
          id: 'work-1',
          name: 'Sample bathroom',
          stageName: null,
        },
      ],
    });
    expect(readinessFigure(measure).value).toBe(0);
    expect(sentenceParts(measure.missing)).toEqual([
      { key: 'readiness.missing.plan.activity', count: 1, params: { count: 1 } },
    ]);
  });

  it('does not take a responsible who is not in the plan as known', () => {
    const plan = snapshot({
      stages: [BATHROOM],
      people: [TILER],
      activities: [activity('tiling', 'Tiling', 3, 'somebody-removed')],
    });
    expect(ready(plan).missing.map((row) => row.ruleId)).toEqual(['activity.responsible']);
  });

  it('counts every rule for every activity, and groups the sentence by rule', () => {
    const plan = snapshot({
      stages: [BATHROOM, { id: 'kitchen', position: 2, name: 'Kitchen' }],
      people: [TILER],
      activities: [
        activity('grout', 'Grout', null, null, 'bathroom', 2),
        activity('tiling', 'Tiling', 3, null, 'bathroom', 1),
        activity('sink', 'Sink', null, TILER.id, 'kitchen', 1),
      ],
      dependencies: [link('l1', 'tiling', 'grout')],
    });
    const measure = ready(plan);
    // Three activities, three rules each; tiling and grout are linked, the sink is not.
    expect(measure.mustKnow).toBe(9);
    expect(measure.known).toBe(4);
    expect(readinessFigure(measure).value).toBe(44);
    // Plan order: stage by stage, activity by position, then rule by rule.
    expect(measure.missing.map((row) => `${row.id}/${row.ruleId}/${row.stageName}`)).toEqual([
      'tiling/activity.responsible/Bathroom',
      'grout/activity.duration/Bathroom',
      'grout/activity.responsible/Bathroom',
      'sink/activity.duration/Kitchen',
      'sink/activity.linked/Kitchen',
    ]);
    expect(sentenceParts(measure.missing)).toEqual([
      { key: 'readiness.missing.activity.duration', count: 2, params: { count: 2 } },
      { key: 'readiness.missing.activity.responsible', count: 2, params: { count: 2 } },
      { key: 'readiness.missing.activity.linked', count: 1, params: { count: 1 } },
    ]);
  });

  it('names no stage for an activity whose stage is not in the plan', () => {
    const plan = snapshot({ activities: [activity('ghost', 'Ghost', 1, null, 'gone')] });
    expect(ready(plan).missing).toEqual([
      {
        ruleId: 'activity.responsible',
        entity: 'activity',
        id: 'ghost',
        name: 'Ghost',
        stageName: null,
      },
    ]);
  });
});

describe('linking', () => {
  const people = [TILER];
  const three = snapshot({
    stages: [BATHROOM],
    people,
    activities: [
      activity('a', 'A', 3, TILER.id, 'bathroom', 1),
      activity('b', 'B', 2, TILER.id, 'bathroom', 2),
      activity('c', 'C', 1, TILER.id, 'bathroom', 3),
    ],
    dependencies: [link('ab', 'a', 'b', 1)],
  });

  it('says an activity linked to no other is not ready: "1 activity is not linked to any other"', () => {
    const measure = ready(three);
    expect(measure.missing.map((row) => `${row.id}/${row.ruleId}`)).toEqual(['c/activity.linked']);
    expect(sentenceParts(measure.missing)).toEqual([
      { key: 'readiness.missing.activity.linked', count: 1, params: { count: 1 } },
    ]);
    expect(measure).toMatchObject({ known: 8, mustKnow: 9 });
  });

  it('is satisfied once the activity is linked, in either direction', () => {
    const linked = { ...three, dependencies: [...three.dependencies, link('bc', 'b', 'c')] };
    expect(ready(linked)).toMatchObject({ known: 9, mustKnow: 9, ratio: 1, missing: [] });
    const before = { ...three, dependencies: [...three.dependencies, link('ca', 'c', 'a')] };
    expect(ready(before).missing).toEqual([]);
  });

  it('asks nothing of a plan with one activity: there is nothing to link it to', () => {
    const one = snapshot({
      stages: [BATHROOM],
      people,
      activities: [activity('a', 'A', 3, TILER.id)],
    });
    expect(ready(one)).toMatchObject({ known: 2, mustKnow: 2, ratio: 1, missing: [] });
  });

  it('counts a link through a stage as linking every activity of the stage', () => {
    const kitchen = { id: 'kitchen', position: 2, name: 'Kitchen' };
    const staged = {
      ...three,
      stages: [BATHROOM, kitchen],
      activities: [...three.activities, activity('k', 'K', 1, TILER.id, 'kitchen', 1)],
      dependencies: [link('s', onStage('bathroom'), onStage('kitchen'))],
    };
    expect(ready(staged).missing).toEqual([]);
  });

  it('does not count a link that does nothing: onto an empty stage, or naming something gone', () => {
    const empty = { id: 'empty', position: 2, name: 'Empty' };
    const inert = {
      ...three,
      stages: [BATHROOM, empty],
      dependencies: [
        link('e', 'c', onStage('empty')),
        link('g', 'c', 'gone'),
        link('ab', 'a', 'b'),
      ],
    };
    expect(ready(inert).missing.map((row) => row.id)).toEqual(['c']);
  });

  it('does not count an activity linked only to itself through its own stage', () => {
    const kitchen = { id: 'kitchen', position: 2, name: 'Kitchen' };
    const selfOnly = {
      ...three,
      stages: [BATHROOM, kitchen],
      activities: [...three.activities, activity('k', 'K', 1, TILER.id, 'kitchen', 1)],
      dependencies: [
        link('ab', 'a', 'b'),
        link('bc', 'b', 'c'),
        link('self', 'k', onStage('kitchen')),
      ],
    };
    expect(ready(selfOnly).missing.map((row) => `${row.id}/${row.ruleId}`)).toEqual([
      'k/activity.linked',
    ]);
  });
});

describe('the readiness figure', () => {
  const plans: Array<[string, WorkSnapshot]> = [
    ['an empty plan', snapshot()],
    [
      'half known',
      snapshot({ stages: [BATHROOM], activities: [activity('tiling', 'Tiling', 3, null)] }),
    ],
    [
      'nothing known',
      snapshot({ stages: [BATHROOM], activities: [activity('tiling', 'Tiling', null, null)] }),
    ],
    [
      'everything known',
      snapshot({
        stages: [BATHROOM],
        people: [TILER],
        activities: [activity('tiling', 'Tiling', 3, TILER.id)],
      }),
    ],
  ];

  it.each(plans)('is traceable for %s', (_name, plan) => {
    expect(traceable(readinessFigure(ready(plan)))).toBe(true);
  });

  it('opens onto the missing rows, each keyed by rule and activity', () => {
    const figure = readinessFigure(
      ready(snapshot({ stages: [BATHROOM], activities: [activity('tiling', 'Tiling', 3, null)] })),
    );
    expect(figure).toMatchObject({
      id: 'readiness',
      label: READINESS_LABEL_KEY,
      unit: 'percent',
      known: 1,
      mustKnow: 2,
      value: 50,
    });
    expect(figure.rows).toEqual([
      {
        key: 'activity.responsible:tiling',
        itemId: 'tiling',
        title: 'Tiling',
        day: null,
        minutes: 0,
        ruleId: 'activity.responsible',
        entity: 'activity',
        stageName: 'Bathroom',
      },
    ]);
  });

  it('is caught when it is broken', () => {
    const honest = readinessFigure(
      ready(
        snapshot({ stages: [BATHROOM], activities: [activity('tiling', 'Tiling', null, null)] }),
      ),
    );
    expect(traceable(honest)).toBe(true);
    // A value that does not match the counts.
    expect(traceable({ ...honest, value: 50 })).toBe(false);
    // A missing row dropped: the list hides something the number still counts.
    expect(traceable({ ...honest, rows: honest.rows.slice(1) })).toBe(false);
    // An empty plan claiming 0 % with nothing said about why.
    const empty = readinessFigure(ready(snapshot()));
    expect(traceable({ ...empty, rows: [] })).toBe(false);
  });
});
