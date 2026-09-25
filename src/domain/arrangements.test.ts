import { describe, expect, it } from 'vitest';

import {
  breakdown,
  byRoom,
  checklist,
  roomsOf,
  unknownRoomReferences,
  type BreakdownActivityRow,
} from './arrangements';
import type { Activity, Dependency, WorkSnapshot } from './plan';
import { schedule } from './schedule';

/** A synthetic work. Nothing in it is a real place, person or price. */
function snapshot(parts: Partial<WorkSnapshot> = {}): WorkSnapshot {
  return {
    work: {
      workId: 'work-1',
      name: 'Sample refit',
      place: 'Sample street',
      startDate: '2026-09-01', // a Tuesday
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

const activity = (
  id: string,
  stageId: string,
  position: number,
  durationDays: number | null,
  responsibleId: string | null,
  roomIds: string[] = [],
  quantity: number | null = null,
  unit: string | null = null,
): Activity => ({
  id,
  stageId,
  position,
  name: `Activity ${id}`,
  durationDays,
  responsibleId,
  roomIds,
  quantity,
  unit,
});

/**
 * One plan with everything the arrangements must survive: an activity in two rooms, one in a room
 * that is gone, one in no room, one whose stage is gone, one with no duration, an empty stage and
 * an empty room — added out of order.
 */
const PLAN = snapshot({
  people: [{ id: 'tiler', name: 'Sample tiler' }],
  rooms: [
    { id: 'hall', position: 3, name: 'Hall' },
    { id: 'kitchen', position: 2, name: 'Kitchen' },
    { id: 'bathroom', position: 1, name: 'Bathroom' },
    { id: 'attic', position: 4, name: 'Attic' },
  ],
  stages: [
    { id: 'painting', position: 3, name: 'Painting' },
    { id: 'tiling', position: 2, name: 'Tiling' },
    { id: 'demolition', position: 1, name: 'Demolition' },
  ],
  activities: [
    activity('skirting', 'tiling', 3, 1, 'tiler'),
    activity('grout', 'tiling', 2, 1, 'tiler', ['gone']),
    activity('floor', 'tiling', 1, 3, null, ['bathroom'], 12, 'm²'),
    activity('ghost', 'missing-stage', 1, 1, 'tiler', ['hall']),
    activity('remove-sink', 'demolition', 2, null, null, ['kitchen']),
    activity('strip', 'demolition', 1, 2, 'tiler', ['kitchen', 'bathroom']),
  ],
  // strip → floor → grout → skirting, one after another; remove-sink and ghost are linked to nothing.
  dependencies: [
    link('l1', 'strip', 'floor'),
    link('l2', 'floor', 'grout'),
    link('l3', 'grout', 'skirting'),
  ],
});

const ids = (activities: readonly { id: string }[]) => activities.map((a) => a.id);

function link(id: string, blockerId: string, blockedId: string): Dependency {
  return {
    id,
    blocker: { kind: 'activity', id: blockerId },
    blocked: { kind: 'activity', id: blockedId },
    lagDays: 0,
  };
}

describe('the breakdown', () => {
  const rows = breakdown(PLAN);

  it('numbers stages 1, 2, 3 and their activities under them, in plan order', () => {
    expect(rows.map((row) => `${row.number ?? '—'} ${row.id}`)).toEqual([
      '1 demolition',
      '1.1 strip',
      '1.2 remove-sink',
      '2 tiling',
      '2.1 floor',
      '2.2 grout',
      '2.3 skirting',
      '3 painting',
      '— ghost',
    ]);
  });

  it('still numbers a stage with no activities', () => {
    expect(rows.find((row) => row.id === 'painting')).toEqual({
      kind: 'stage',
      id: 'painting',
      number: '3',
      name: 'Painting',
    });
  });

  it('carries what the table edits: duration, responsible, rooms, quantity and unit', () => {
    expect(rows.find((row) => row.id === 'floor')).toEqual({
      kind: 'activity',
      id: 'floor',
      stageId: 'tiling',
      number: '2.1',
      name: 'Activity floor',
      durationDays: 3,
      responsibleId: null,
      roomIds: ['bathroom'],
      quantity: 12,
      unit: 'm²',
    });
  });

  it('keeps an activity whose stage is gone, last and unnumbered, rather than losing it', () => {
    const last = rows.at(-1) as BreakdownActivityRow;
    expect(last).toMatchObject({ kind: 'activity', id: 'ghost', number: null });
  });

  it('follows a move: the numbering is the order, not the stored position', () => {
    const swapped = snapshot({
      ...PLAN,
      stages: [
        { id: 'demolition', position: 2, name: 'Demolition' },
        { id: 'tiling', position: 1, name: 'Tiling' },
      ],
    });
    expect(
      breakdown(swapped)
        .filter((row) => row.kind === 'stage' || row.stageId === 'tiling')
        .map((row) => `${row.number} ${row.id}`),
    ).toEqual(['1 tiling', '1.1 floor', '1.2 grout', '1.3 skirting', '2 demolition']);
  });

  it('is empty for an empty plan', () => {
    expect(breakdown(snapshot())).toEqual([]);
  });
});

describe('the plan by room', () => {
  const groups = byRoom(PLAN);

  it('lists every room in order, even an empty one, then the activities in no room', () => {
    expect(groups.map((group) => [group.roomId, ids(group.activities)])).toEqual([
      ['bathroom', ['strip', 'floor']],
      ['kitchen', ['strip', 'remove-sink']],
      ['hall', ['ghost']],
      ['attic', []],
      [null, ['grout', 'skirting']],
    ]);
    expect(groups.at(-1)).toMatchObject({ roomId: null, name: null });
  });

  it('shows an activity in two rooms under each, and says which rooms it is in', () => {
    const under = groups.filter((group) => ids(group.activities).includes('strip'));
    expect(under.map((group) => group.name)).toEqual(['Bathroom', 'Kitchen']);
    const strip = PLAN.activities.find((a) => a.id === 'strip')!;
    expect(roomsOf(PLAN, strip).map((room) => room.name)).toEqual(['Bathroom', 'Kitchen']);
  });

  it('lists an activity naming a room that is not in the plan under no room, and reports it', () => {
    const noRoom = groups.find((group) => group.roomId === null)!;
    expect(ids(noRoom.activities)).toContain('grout');
    expect(unknownRoomReferences(PLAN)).toEqual([{ activityId: 'grout', roomId: 'gone' }]);
  });

  it('keeps an activity with one known and one unknown room under the known one, and reports the other', () => {
    const mixed = snapshot({
      ...PLAN,
      activities: [activity('a', 'tiling', 1, 1, null, ['gone', 'kitchen', 'gone'])],
    });
    expect(byRoom(mixed).map((group) => [group.roomId, ids(group.activities)])).toEqual([
      ['bathroom', []],
      ['kitchen', ['a']],
      ['hall', []],
      ['attic', []],
    ]);
    expect(unknownRoomReferences(mixed)).toEqual([{ activityId: 'a', roomId: 'gone' }]);
  });

  it('has no "no room" group when every activity is in a room', () => {
    const allRoomed = snapshot({
      ...PLAN,
      activities: [activity('a', 'tiling', 1, 1, null, ['hall'])],
    });
    expect(byRoom(allRoomed).some((group) => group.roomId === null)).toBe(false);
  });

  it('lists an activity once under a room it names twice', () => {
    const twice = snapshot({
      ...PLAN,
      activities: [activity('a', 'tiling', 1, 1, null, ['hall', 'hall'])],
    });
    expect(byRoom(twice).find((group) => group.roomId === 'hall')!.activities).toHaveLength(1);
  });

  it('is one "no room" group when the plan has activities and no rooms', () => {
    const roomless = snapshot({ ...PLAN, rooms: [] });
    expect(byRoom(roomless)).toEqual([
      { roomId: null, name: null, activities: expect.any(Array) as unknown },
    ]);
    expect(byRoom(roomless)[0]!.activities).toHaveLength(6);
  });

  it('reports nothing for a healthy plan', () => {
    expect(unknownRoomReferences(snapshot({ ...PLAN, activities: [] }))).toEqual([]);
  });

  it('is empty for an empty plan', () => {
    expect(byRoom(snapshot())).toEqual([]);
  });
});

describe('the checklist', () => {
  const lines = checklist(PLAN, schedule(PLAN));

  it('follows the schedule, by start, with the unplaced last in plan order', () => {
    expect(lines.map((line) => [line.order, line.activityId, line.start, line.finish])).toEqual([
      [1, 'strip', '2026-09-01', '2026-09-02'],
      [2, 'floor', '2026-09-03', '2026-09-07'],
      [3, 'grout', '2026-09-08', '2026-09-08'],
      [4, 'skirting', '2026-09-09', '2026-09-09'],
      [5, 'remove-sink', null, null],
      [6, 'ghost', null, null],
    ]);
  });

  it('keeps breakdown order between activities that start on the same day', () => {
    const parallel = snapshot({ ...PLAN, dependencies: [] });
    expect(checklist(parallel, schedule(parallel)).map((line) => line.activityId)).toEqual([
      'strip',
      'floor',
      'grout',
      'skirting',
      'remove-sink',
      'ghost',
    ]);
  });

  it('says on each line what the plan lacks for it, by the readiness rules', () => {
    expect(Object.fromEntries(lines.map((line) => [line.activityId, line.missing]))).toEqual({
      strip: [],
      floor: ['responsible'],
      grout: [],
      skirting: [],
      'remove-sink': ['duration', 'responsible', 'linked'],
      ghost: ['linked'],
    });
  });

  it('carries each line’s stage', () => {
    expect(lines.find((line) => line.activityId === 'floor')!.stageId).toBe('tiling');
  });

  it('lists everything, in plan order, when nothing can be placed', () => {
    const noWorkingDay = snapshot({
      ...PLAN,
      calendar: { workingDays: '0000000', hoursPerDay: 8 },
    });
    const all = checklist(noWorkingDay, schedule(noWorkingDay));
    expect(all.map((line) => line.activityId)).toEqual([
      'strip',
      'remove-sink',
      'floor',
      'grout',
      'skirting',
      'ghost',
    ]);
    expect(all.every((line) => line.start === null && line.finish === null)).toBe(true);
    expect(all.map((line) => line.order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('is built from the plan: a schedule of another plan neither drops nor invents a line', () => {
    const other = snapshot({
      stages: [{ id: 'tiling', position: 1, name: 'Tiling' }],
      activities: [
        activity('floor', 'tiling', 1, 1, null),
        activity('gone-activity', 'tiling', 2, 1, null),
      ],
      work: { ...PLAN.work, startDate: '2026-08-28' },
    });
    const result = checklist(PLAN, schedule(other));
    expect(result.map((line) => line.activityId)).toEqual([
      'floor',
      'strip',
      'remove-sink',
      'grout',
      'skirting',
      'ghost',
    ]);
    expect(result[0]).toMatchObject({ start: '2026-08-28', finish: '2026-08-28' });
  });

  it('is empty for an empty plan', () => {
    expect(checklist(snapshot(), schedule(snapshot()))).toEqual([]);
  });
});

// ── The invariant: the same rows, three arrangements ─────────────────────────

function arrangedIds(plan: WorkSnapshot) {
  return {
    breakdown: breakdown(plan)
      .filter((row) => row.kind === 'activity')
      .map((row) => row.id),
    byRoom: byRoom(plan).flatMap((group) => ids(group.activities)),
    checklist: checklist(plan, schedule(plan)).map((line) => line.activityId),
  };
}

function expectSameRows(plan: WorkSnapshot) {
  const expected = [...plan.activities.map((a) => a.id)].sort();
  const arranged = arrangedIds(plan);
  // The breakdown and the checklist hold every activity exactly once.
  expect([...arranged.breakdown].sort()).toEqual(expected);
  expect([...arranged.checklist].sort()).toEqual(expected);
  // By room holds every activity at least once; more only for one in several rooms.
  expect([...new Set(arranged.byRoom)].sort()).toEqual(expected);
}

/** A small seeded generator, so a failing plan can be rebuilt from its seed. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (below: number) => Math.floor(next() * below);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)]!;
  return { int, pick };
}

function randomPlan(seed: number): WorkSnapshot {
  const { int, pick } = random(seed);
  const stages = Array.from({ length: int(5) }, (_, i) => ({
    id: `s${i}`,
    position: int(4),
    name: `Stage ${i}`,
  }));
  const rooms = Array.from({ length: int(4) }, (_, i) => ({
    id: `r${i}`,
    position: int(3),
    name: `Room ${i}`,
  }));
  const stageIds = [...stages.map((s) => s.id), 'gone-stage'];
  const roomIds = [...rooms.map((r) => r.id), 'gone-room'];
  const activities = Array.from({ length: int(12) }, (_, i) =>
    activity(
      `a${i}`,
      pick(stageIds),
      int(5),
      pick([null, 0, -1, 1, 2, 5, 2.5]),
      pick([null, 'p0', 'nobody']),
      Array.from({ length: int(4) }, () => pick(roomIds)),
      pick([null, 0, 3.5]),
      pick([null, 'm²']),
    ),
  );
  const endpoints = [
    ...activities.map((a) => ({ kind: 'activity' as const, id: a.id })),
    ...stageIds.map((id) => ({ kind: 'stage' as const, id })),
    { kind: 'activity' as const, id: 'gone-activity' },
  ];
  const dependencies: Dependency[] = Array.from({ length: int(8) }, (_, i) => ({
    id: `d${i}`,
    blocker: pick(endpoints),
    blocked: pick(endpoints),
    lagDays: pick([0, 0, 1, 3, -1]),
  }));
  return snapshot({
    calendar: { workingDays: pick(['1111100', '0000001', '0000000']), hoursPerDay: 8 },
    dependencies,
    holidays: pick([[], [{ date: '2026-09-03', name: 'A holiday' }]]),
    people: [{ id: 'p0', name: 'Person 0' }],
    rooms,
    stages,
    activities,
  });
}

describe('the three arrangements hold exactly the same activities', () => {
  it('for the plan with everything wrong in it', () => {
    expectSameRows(PLAN);
  });

  it('for an empty plan', () => {
    expectSameRows(snapshot());
  });

  it.each(Array.from({ length: 300 }, (_, seed) => seed))('for generated plan %i', (seed) => {
    expectSameRows(randomPlan(seed));
  });

  it('where the generated plans really contain the hard cases, or the check proves little', () => {
    const plans = Array.from({ length: 300 }, (_, seed) => randomPlan(seed));
    const stageless = plans.filter((plan) =>
      plan.activities.some((a) => !plan.stages.some((s) => s.id === a.stageId)),
    );
    const unknownRoom = plans.filter((plan) => unknownRoomReferences(plan).length > 0);
    const multiRoom = plans.filter((plan) =>
      plan.activities.some((a) => roomsOf(plan, a).length > 1),
    );
    const mixed = plans.filter((plan) => {
      const scheduled = schedule(plan);
      return scheduled.dates.size > 0 && scheduled.unplaced.length > 0;
    });
    const cyclic = plans.filter((plan) => schedule(plan).cyclic);
    const inert = plans.filter((plan) => schedule(plan).inert.length > 0);
    for (const found of [stageless, unknownRoom, multiRoom, mixed, cyclic, inert]) {
      expect(found.length).toBeGreaterThan(20);
    }
  });

  it('and the check itself catches an arrangement that drops a row', () => {
    const plan = snapshot({
      ...PLAN,
      activities: PLAN.activities.filter((a) => a.id !== 'ghost'),
    });
    // The arrangements of a plan without `ghost`, checked against the plan with it, must fail.
    const arranged = arrangedIds(plan);
    const expected = [...PLAN.activities.map((a) => a.id)].sort();
    expect([...arranged.breakdown].sort()).not.toEqual(expected);
    expect([...arranged.checklist].sort()).not.toEqual(expected);
  });
});
