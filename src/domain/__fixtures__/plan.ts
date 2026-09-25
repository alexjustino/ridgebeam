/**
 * Builders for synthetic plans, shared by the domain's tests. Nothing in them is a real place,
 * person or price (CONTRIBUTING.md, public repository hygiene).
 *
 * Test support only: no production module imports this file.
 */

import type { Activity, Dependency, Endpoint, Stage, WorkSnapshot } from '../plan';

/** A work starting on Tuesday 1 September 2026, Monday to Friday, with nothing in it. */
export function snapshot(parts: Partial<WorkSnapshot> = {}): WorkSnapshot {
  return {
    work: {
      workId: 'work-1',
      name: 'Sample work',
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
    ...parts,
  };
}

export function stage(id: string, position: number, name = `Stage ${id}`): Stage {
  return { id, position, name };
}

export function activity(
  id: string,
  stageId: string,
  position: number,
  durationDays: number | null,
  responsibleId: string | null = null,
): Activity {
  return {
    id,
    stageId,
    position,
    name: `Activity ${id}`,
    durationDays,
    responsibleId,
    roomIds: [],
    quantity: null,
    unit: null,
  };
}

export const onActivity = (id: string): Endpoint => ({ kind: 'activity', id });
export const onStage = (id: string): Endpoint => ({ kind: 'stage', id });

/** A dependency between two endpoints, `blocker` first; plain ids are activities. */
export function link(
  id: string,
  blocker: string | Endpoint,
  blocked: string | Endpoint,
  lagDays = 0,
): Dependency {
  return {
    id,
    blocker: typeof blocker === 'string' ? onActivity(blocker) : blocker,
    blocked: typeof blocked === 'string' ? onActivity(blocked) : blocked,
    lagDays,
  };
}
