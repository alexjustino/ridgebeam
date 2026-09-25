import { describe, expect, it } from 'vitest';

import {
  activitiesInOrder,
  finishDate,
  hasDuration,
  isPlaced,
  placeActivities,
  roomsInOrder,
  stagesInOrder,
  workingCalendarOf,
  type Activity,
  type Stage,
  type WorkSnapshot,
} from './plan';

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
    },
    calendar: { workingDays: '1111100', hoursPerDay: 8 },
    holidays: [],
    people: [],
    rooms: [],
    stages: [],
    activities: [],
    ...parts,
  };
}

const stage = (id: string, position: number): Stage => ({ id, position, name: `Stage ${id}` });

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

describe('placing activities, F0 sequential placement', () => {
  it('places one stage with one activity on the working calendar', () => {
    const plan = snapshot({
      stages: [stage('bathroom', 1)],
      activities: [activity('tiling', 'bathroom', 1, 3)],
    });
    // Tuesday 1, Wednesday 2, Thursday 3 September.
    expect(placeActivities(plan)).toEqual([
      { activityId: 'tiling', start: '2026-09-01', finish: '2026-09-03' },
    ]);
    expect(finishDate(placeActivities(plan))).toBe('2026-09-03');
  });

  it('starts each activity on the working day after the previous one finishes', () => {
    const plan = snapshot({
      stages: [stage('s', 1)],
      activities: [activity('a', 's', 1, 3), activity('b', 's', 2, 2)],
    });
    // a: Tue 1 to Thu 3. b: Fri 4 and, over the weekend, Mon 7.
    expect(placeActivities(plan)).toEqual([
      { activityId: 'a', start: '2026-09-01', finish: '2026-09-03' },
      { activityId: 'b', start: '2026-09-04', finish: '2026-09-07' },
    ]);
  });

  it('moves a start date on a Saturday to the Monday', () => {
    const plan = snapshot({
      work: { ...snapshot().work, startDate: '2026-09-05' },
      stages: [stage('s', 1)],
      activities: [activity('a', 's', 1, 1)],
    });
    expect(placeActivities(plan)).toEqual([
      { activityId: 'a', start: '2026-09-07', finish: '2026-09-07' },
    ]);
  });

  it('extends the finish of an activity with a holiday inside it', () => {
    const without = snapshot({
      stages: [stage('s', 1)],
      activities: [activity('a', 's', 1, 5)],
    });
    const withHoliday = snapshot({
      ...without,
      holidays: [{ date: '2026-09-03', name: 'A holiday' }],
    });
    // Five working days from Tuesday 1: Tue, Wed, Thu, Fri, Mon 7.
    expect(finishDate(placeActivities(without))).toBe('2026-09-07');
    // Thursday 3 is a holiday: Tue, Wed, Fri, Mon, Tue 8.
    expect(finishDate(placeActivities(withHoliday))).toBe('2026-09-08');
  });

  it('respects stage order over the order the activities were added', () => {
    const plan = snapshot({
      stages: [stage('tiling', 2), stage('demolition', 1)],
      activities: [activity('tile', 'tiling', 1, 1), activity('demolish', 'demolition', 1, 1)],
    });
    expect(placeActivities(plan)).toEqual([
      { activityId: 'demolish', start: '2026-09-01', finish: '2026-09-01' },
      { activityId: 'tile', start: '2026-09-02', finish: '2026-09-02' },
    ]);
  });

  it('leaves an activity with no duration unplaced, and still places the ones after it', () => {
    const plan = snapshot({
      stages: [stage('s', 1)],
      activities: [
        activity('a', 's', 1, 2),
        activity('unknown', 's', 2, null),
        activity('zero', 's', 3, 0),
        activity('b', 's', 4, 1),
      ],
    });
    expect(placeActivities(plan)).toEqual([
      { activityId: 'a', start: '2026-09-01', finish: '2026-09-02' },
      { activityId: 'unknown', unplaced: 'no-duration' },
      { activityId: 'zero', unplaced: 'no-duration' },
      { activityId: 'b', start: '2026-09-03', finish: '2026-09-03' },
    ]);
  });

  it('starts the first placed activity on the start date even when earlier ones have no duration', () => {
    const plan = snapshot({
      stages: [stage('s', 1)],
      activities: [activity('unknown', 's', 1, null), activity('a', 's', 2, 1)],
    });
    expect(placeActivities(plan)[1]).toEqual({
      activityId: 'a',
      start: '2026-09-01',
      finish: '2026-09-01',
    });
  });

  it('says an activity whose stage is not in the plan has no place', () => {
    const plan = snapshot({
      stages: [stage('s', 1)],
      activities: [activity('ghost', 'gone', 1, 2), activity('a', 's', 1, 1)],
    });
    expect(placeActivities(plan)).toEqual([
      { activityId: 'a', start: '2026-09-01', finish: '2026-09-01' },
      { activityId: 'ghost', unplaced: 'no-stage' },
    ]);
  });

  it('places nothing on a calendar with no working day, and says why, without throwing', () => {
    const plan = snapshot({
      calendar: { workingDays: '0000000', hoursPerDay: 8 },
      stages: [stage('s', 1)],
      activities: [activity('a', 's', 1, 2)],
    });
    expect(() => placeActivities(plan)).not.toThrow();
    expect(placeActivities(plan)).toEqual([{ activityId: 'a', unplaced: 'invalid-calendar' }]);
    expect(finishDate(placeActivities(plan))).toBeNull();
  });

  it('places nothing from a start date that is not a day, and says why', () => {
    const plan = snapshot({
      work: { ...snapshot().work, startDate: '2026-02-30' },
      stages: [stage('s', 1)],
      activities: [activity('a', 's', 1, 2)],
    });
    expect(placeActivities(plan)).toEqual([{ activityId: 'a', unplaced: 'invalid-start' }]);
  });

  it('has no finish date for an empty plan', () => {
    expect(placeActivities(snapshot())).toEqual([]);
    expect(finishDate(placeActivities(snapshot()))).toBeNull();
  });

  it('has no finish date when no activity has a duration', () => {
    const plan = snapshot({
      stages: [stage('s', 1)],
      activities: [activity('a', 's', 1, null)],
    });
    expect(finishDate(placeActivities(plan))).toBeNull();
  });

  it('gives a stage with nothing in it no days', () => {
    const plan = snapshot({
      stages: [stage('empty', 1), stage('s', 2)],
      activities: [activity('a', 's', 1, 1)],
    });
    expect(placeActivities(plan)).toEqual([
      { activityId: 'a', start: '2026-09-01', finish: '2026-09-01' },
    ]);
  });
});

describe('the finish date', () => {
  it('is the latest finish, whatever order the rows come in', () => {
    expect(
      finishDate([
        { activityId: 'b', start: '2026-09-08', finish: '2026-09-10' },
        { activityId: 'x', unplaced: 'no-duration' },
        { activityId: 'a', start: '2026-09-01', finish: '2026-09-02' },
      ]),
    ).toBe('2026-09-10');
  });

  it('tells a placed row from an unplaced one', () => {
    expect(isPlaced({ activityId: 'a', start: '2026-09-01', finish: '2026-09-01' })).toBe(true);
    expect(isPlaced({ activityId: 'a', unplaced: 'no-duration' })).toBe(false);
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

  it('do not change where an activity is placed, and neither does its quantity', () => {
    const plain = snapshot({ stages: [stage('s', 1)], activities: [activity('a', 's', 1, 2)] });
    const withRooms = snapshot({
      ...plain,
      rooms: [{ id: 'r', position: 1, name: 'Room' }],
      activities: [{ ...activity('a', 's', 1, 2), roomIds: ['r'], quantity: 12, unit: 'm²' }],
    });
    expect(placeActivities(withRooms)).toEqual(placeActivities(plain));
  });
});
