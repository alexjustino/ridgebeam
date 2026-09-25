import { describe, expect, it } from 'vitest';

import { traceable } from '../figure';
import type { Activity, Person, Stage, WorkSnapshot } from '../plan';
import {
  READINESS_LABEL_KEY,
  READINESS_MESSAGE_KEYS,
  readiness,
  readinessFigure,
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
    },
    calendar: { workingDays: '1111100', hoursPerDay: 8 },
    holidays: [],
    people: [],
    stages: [],
    activities: [],
    ...parts,
  };
}

const BATHROOM: Stage = { id: 'bathroom', position: 1, name: 'Bathroom' };
const TILER: Person = { id: 'tiler', name: 'Sample tiler' };

const activity = (
  id: string,
  name: string,
  durationDays: number | null,
  responsibleId: string | null,
  stageId = BATHROOM.id,
  position = 1,
): Activity => ({ id, stageId, position, name, durationDays, responsibleId });

describe('the rule table', () => {
  it('holds the two F0 rules, as data, each with its own message key', () => {
    expect(RULES.map((rule) => rule.id)).toEqual(['activity.duration', 'activity.responsible']);
    for (const rule of RULES) {
      expect(rule.appliesTo).toBe('activity');
      expect(rule.messageKey).toBe(READINESS_MESSAGE_KEYS[rule.id]);
    }
  });

  it('names every message key under readiness., so the i18n tables can be checked for them', () => {
    const keys = [...Object.values(READINESS_MESSAGE_KEYS), READINESS_LABEL_KEY];
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^readiness\./);
  });
});

describe('readiness', () => {
  it('counts an activity with a duration and no responsible as 1 of 2, 50 %', () => {
    const plan = snapshot({
      stages: [BATHROOM],
      activities: [activity('tiling', 'Tiling', 3, null)],
    });
    const measure = readiness(plan);
    expect(measure).toEqual({
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
    const measure = readiness(plan);
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
    expect(readiness(plan).missing.map((row) => row.ruleId)).toEqual(['activity.duration']);
  });

  it('says both things when both are missing, in the rule order', () => {
    const plan = snapshot({
      stages: [BATHROOM],
      activities: [activity('tiling', 'Tiling', null, null)],
    });
    const measure = readiness(plan);
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
    const measure = readiness(plan);
    expect(measure).toEqual({ known: 2, mustKnow: 2, ratio: 1, missing: [] });
    expect(readinessFigure(measure).value).toBe(100);
    expect(readinessFigure(measure).rows).toEqual([]);
    expect(sentenceParts(measure.missing)).toEqual([]);
  });

  it('is not ready with no activity, and explains that the plan has none', () => {
    const measure = readiness(snapshot({ stages: [BATHROOM] }));
    expect(measure).toEqual({
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
    expect(readiness(plan).missing.map((row) => row.ruleId)).toEqual(['activity.responsible']);
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
    });
    const measure = readiness(plan);
    expect(measure.mustKnow).toBe(6);
    expect(measure.known).toBe(2);
    expect(readinessFigure(measure).value).toBe(33);
    // Plan order: stage by stage, activity by position, then rule by rule.
    expect(measure.missing.map((row) => `${row.id}/${row.ruleId}/${row.stageName}`)).toEqual([
      'tiling/activity.responsible/Bathroom',
      'grout/activity.duration/Bathroom',
      'grout/activity.responsible/Bathroom',
      'sink/activity.duration/Kitchen',
    ]);
    expect(sentenceParts(measure.missing)).toEqual([
      { key: 'readiness.missing.activity.duration', count: 2, params: { count: 2 } },
      { key: 'readiness.missing.activity.responsible', count: 2, params: { count: 2 } },
    ]);
  });

  it('names no stage for an activity whose stage is not in the plan', () => {
    const plan = snapshot({ activities: [activity('ghost', 'Ghost', 1, null, 'gone')] });
    expect(readiness(plan).missing).toEqual([
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
    expect(traceable(readinessFigure(readiness(plan)))).toBe(true);
  });

  it('opens onto the missing rows, each keyed by rule and activity', () => {
    const figure = readinessFigure(
      readiness(
        snapshot({ stages: [BATHROOM], activities: [activity('tiling', 'Tiling', 3, null)] }),
      ),
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
      readiness(
        snapshot({ stages: [BATHROOM], activities: [activity('tiling', 'Tiling', null, null)] }),
      ),
    );
    expect(traceable(honest)).toBe(true);
    // A value that does not match the counts.
    expect(traceable({ ...honest, value: 50 })).toBe(false);
    // A missing row dropped: the list hides something the number still counts.
    expect(traceable({ ...honest, rows: honest.rows.slice(1) })).toBe(false);
    // An empty plan claiming 0 % with nothing said about why.
    const empty = readinessFigure(readiness(snapshot()));
    expect(traceable({ ...empty, rows: [] })).toBe(false);
  });
});
