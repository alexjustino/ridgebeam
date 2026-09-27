/**
 * Builders for synthetic plans, shared by the domain's tests. Nothing in them is a real place,
 * person or price (CONTRIBUTING.md, public repository hygiene).
 *
 * Test support only: no production module imports this file.
 */

import type { DiaryEntry, DoneLine } from '../diary';
import type { Activity, Decision, Dependency, Endpoint, Stage, WorkSnapshot } from '../plan';

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
    decisions: [],
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

/** An open decision of a stage, `lead` working days between deciding and having. */
export function decision(
  id: string,
  stageId: string,
  position: number,
  leadTimeDays: number,
  madeAt: string | null = null,
): Decision {
  return {
    id,
    stageId,
    position,
    name: `Decision ${id}`,
    leadTimeDays,
    madeAt,
    answer: null,
  };
}

/**
 * A diary entry about `day`, with nothing in it but what is passed. The hashes are placeholders:
 * the domain carries them and never checks them.
 */
export function entry(seq: number, day: string, parts: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    seq,
    day,
    kind: 'entry',
    correctsSeq: null,
    note: null,
    weather: null,
    lostDay: false,
    hours: null,
    deliveries: null,
    incidents: null,
    visitors: null,
    authorName: 'Sample author',
    createdAt: `${day}T18:00:00.000Z`,
    prevHash: seq === 1 ? '' : 'h'.repeat(64),
    hash: String(seq).padStart(64, '0'),
    done: [],
    present: [],
    photos: [],
    ...parts,
  };
}

/** A correction of `correctsSeq`, restating `day`. */
export function correction(
  seq: number,
  correctsSeq: number,
  day: string,
  parts: Partial<DiaryEntry> = {},
): DiaryEntry {
  return entry(seq, day, { kind: 'correction', correctsSeq, note: 'What was wrong', ...parts });
}

export const worked = (activityId: string, quantity: number | null = null): DoneLine => ({
  activityId,
  state: 'worked',
  quantity,
  note: null,
});

export const finished = (activityId: string, quantity: number | null = null): DoneLine => ({
  activityId,
  state: 'finished',
  quantity,
  note: null,
});
