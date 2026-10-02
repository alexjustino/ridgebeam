import { describe, expect, it } from 'vitest';

import {
  activitiesInOrder,
  careNotesOf,
  compareText,
  durationRangeOf,
  hasDuration,
  isPriced,
  isLocked,
  latestBaseline,
  roomsInOrder,
  stagesInOrder,
  workingCalendarOf,
  type Activity,
  type Baseline,
  type Stage,
  type WorkSnapshot,
} from './plan';
import { schedule } from './schedule';

/** A synthetic work. Nothing in it is a real place, person or price. */
function snapshot(parts: Partial<WorkSnapshot> = {}): WorkSnapshot {
  return {
    work: {
      workId: 'work-1',
      name: 'Sample bathroom',
      place: 'Sample street',
      startDate: '2026-09-01', // a Tuesday
      currency: 'BRL',
      createdAt: '2026-08-20T12:00:00.000Z',
      approvedAt: null,
      templateId: null,
      templateVersion: null,
      templateTitle: null,
    },
    calendar: { workingDays: '1111100', hoursPerDay: 8 },
    holidays: [],
    people: [],
    rooms: [],
    stages: [],
    activities: [],
    dependencies: [],
    baselines: [],
    replanning: null,
    decisions: [],
    checks: [],
    checkAnswers: [],
    costLines: [],
    commitments: [],
    payments: [],
    documents: [],
    careNotes: [],
    changeOrders: [],
    funding: [],
    fundingReceipts: [],
    ...parts,
  };
}

const stage = (id: string, position: number): Stage => ({
  id,
  position,
  name: `Stage ${id}`,
  startedAt: null,
  closedAt: null,
});

const activity = (
  id: string,
  stageId: string,
  position: number,
  durationDays: number | null,
  responsibleId: string | null = null,
): Activity => ({
  id,
  stageId,
  position,
  name: `Activity ${id}`,
  durationDays,
  durationMinDays: null,
  durationMaxDays: null,
  responsibleId,
  roomIds: [],
  quantity: null,
  unit: null,
});

describe('a duration', () => {
  it('is a whole number of working days above zero', () => {
    expect(hasDuration(activity('a', 's', 1, 3))).toBe(true);
    expect(hasDuration(activity('a', 's', 1, 1))).toBe(true);
  });

  it.each([[null], [0], [-2], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'is not %o',
    (days) => {
      expect(hasDuration(activity('a', 's', 1, days))).toBe(false);
    },
  );
});

describe('the order of the plan', () => {
  it('takes stages by position, not by the order they were added', () => {
    const plan = snapshot({ stages: [stage('tiling', 2), stage('demolition', 1)] });
    expect(stagesInOrder(plan).map((s) => s.id)).toEqual(['demolition', 'tiling']);
  });

  it('breaks a tie in position by id, so the order never depends on the host', () => {
    const plan = snapshot({ stages: [stage('b', 1), stage('a', 1)] });
    expect(stagesInOrder(plan).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('takes activities stage by stage, by position inside each, orphans last', () => {
    const plan = snapshot({
      stages: [stage('late', 2), stage('early', 1)],
      activities: [
        activity('ghost', 'gone', 1, 1),
        activity('l1', 'late', 1, 1),
        activity('e2', 'early', 2, 1),
        activity('e1', 'early', 1, 1),
        activity('e1b', 'early', 1, 1),
      ],
    });
    expect(activitiesInOrder(plan).map((a) => a.id)).toEqual(['e1', 'e1b', 'e2', 'l1', 'ghost']);
  });
});

describe('the calendar of a work', () => {
  it('is its mask, its hours and its holidays', () => {
    const calendar = workingCalendarOf(
      snapshot({ holidays: [{ date: '2026-09-07', name: 'A holiday' }] }),
    );
    expect(calendar?.workingDays).toEqual([true, true, true, true, true, false, false]);
    expect(calendar?.holidays.has('2026-09-07')).toBe(true);
  });

  it('is nothing when it cannot be counted on', () => {
    expect(
      workingCalendarOf(snapshot({ calendar: { workingDays: '0000000', hoursPerDay: 8 } })),
    ).toBeNull();
  });
});

describe('rooms', () => {
  it('are taken by position, then by id when positions tie, not by the order they were added', () => {
    const plan = snapshot({
      rooms: [
        { id: 'kitchen', position: 2, name: 'Kitchen' },
        { id: 'bath-b', position: 1, name: 'Bathroom' },
        { id: 'bath-a', position: 1, name: 'Bathroom' },
      ],
    });
    expect(roomsInOrder(plan).map((room) => room.id)).toEqual(['bath-a', 'bath-b', 'kitchen']);
  });

  it('are none in a plan that has none', () => {
    expect(roomsInOrder(snapshot())).toEqual([]);
  });

  it('do not change where an activity is scheduled, and neither does its quantity', () => {
    const plain = snapshot({ stages: [stage('s', 1)], activities: [activity('a', 's', 1, 2)] });
    const withRooms = snapshot({
      ...plain,
      rooms: [{ id: 'r', position: 1, name: 'Room' }],
      activities: [{ ...activity('a', 's', 1, 2), roomIds: ['r'], quantity: 12, unit: 'm²' }],
    });
    expect(schedule(withRooms).dates).toEqual(schedule(plain).dates);
  });
});

describe('care notes', () => {
  const note = (
    id: string,
    targetKind: 'work' | 'room' | 'stage',
    targetId: string,
    position: number,
  ) => ({
    id,
    targetKind,
    targetId,
    position,
    text: `Note ${id}`,
    createdAt: '2026-09-20T12:00:00.000Z',
  });

  it('are taken for one target only, by position, then by id when positions tie', () => {
    const plan = snapshot({
      careNotes: [
        note('c', 'room', 'bath', 2),
        note('b', 'room', 'bath', 1),
        note('a', 'room', 'bath', 1),
        note('d', 'stage', 'bath', 1),
        note('e', 'room', 'hall', 1),
        note('f', 'work', 'work-1', 1),
      ],
    });
    expect(careNotesOf(plan, 'room', 'bath').map((each) => each.id)).toEqual(['a', 'b', 'c']);
    expect(careNotesOf(plan, 'work', 'work-1').map((each) => each.id)).toEqual(['f']);
    expect(careNotesOf(plan, 'stage', 'nowhere')).toEqual([]);
  });
});

describe('baselines', () => {
  const baseline = (id: string, number: number): Baseline => ({
    id,
    number,
    takenAt: '2026-09-01T12:00:00.000Z',
    reason: null,
    finishDate: null,
    plannedCents: null,
    stages: [],
    rows: [],
  });

  it('are none before the plan is approved', () => {
    expect(latestBaseline(snapshot())).toBeNull();
  });

  it('are read latest by number, whatever order the host lists them in', () => {
    const plan = snapshot({ baselines: [baseline('b2', 2), baseline('b3', 3), baseline('b1', 1)] });
    expect(latestBaseline(plan)?.id).toBe('b3');
  });
});

describe('a locked plan', () => {
  const approved = snapshot({
    work: { ...snapshot().work, approvedAt: '2026-08-31T12:00:00.000Z' },
  });

  it('is not locked before it is approved', () => {
    expect(isLocked(snapshot())).toBe(false);
  });

  it('is locked once approved, until somebody says why it changes', () => {
    expect(isLocked(approved)).toBe(true);
  });

  it('is open to edits while a replanning is open', () => {
    const replanning = {
      id: 'r1',
      reason: 'Tiles arrive two weeks late',
      openedAt: '2026-09-10T12:00:00.000Z',
      authorName: 'Sample author',
    };
    expect(isLocked({ ...approved, replanning })).toBe(false);
  });
});

describe('text order', () => {
  it('is by code point, the same on every machine', () => {
    expect(['b', 'a', 'B', 'a'].sort(compareText)).toEqual(['B', 'a', 'a', 'b']);
    expect(compareText('a', 'a')).toBe(0);
  });
});

describe('a range from a template', () => {
  const ranged = (min: number | null, max: number | null): Activity => ({
    ...activity('a', 's', 1, null),
    durationMinDays: min,
    durationMaxDays: max,
  });

  it('is the two ends, when both are whole days from 1 and in order', () => {
    expect(durationRangeOf(ranged(3, 5))).toEqual({ min: 3, max: 5 });
    expect(durationRangeOf(ranged(2, 2))).toEqual({ min: 2, max: 2 });
  });

  it('is nothing when it came from no template, or is not a range the host would keep', () => {
    expect(durationRangeOf(ranged(null, null))).toBeNull();
    expect(durationRangeOf(ranged(3, null))).toBeNull();
    expect(durationRangeOf(ranged(null, 5))).toBeNull();
    expect(durationRangeOf(ranged(0, 5))).toBeNull();
    expect(durationRangeOf(ranged(5, 3))).toBeNull();
    expect(durationRangeOf(ranged(1.5, 3))).toBeNull();
    expect(durationRangeOf(ranged(1, 3.5))).toBeNull();
  });
});

describe('a priced cost line', () => {
  const line = (amountCents: number | null) => ({
    id: 'l',
    stageId: 's',
    activityId: null,
    label: 'Line',
    amountCents,
  });

  it('has an amount, zero included; one from a template has none yet', () => {
    expect(isPriced(line(12_00))).toBe(true);
    expect(isPriced(line(0))).toBe(true);
    expect(isPriced(line(null))).toBe(false);
  });
});
