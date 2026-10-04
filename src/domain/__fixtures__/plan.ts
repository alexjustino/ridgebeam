/**
 * Builders for synthetic plans, shared by the domain's tests. Nothing in them is a real place,
 * person or price (CONTRIBUTING.md, public repository hygiene).
 *
 * Test support only: no production module imports this file.
 */

import type { DiaryEntry, DoneLine } from '../diary';
import type {
  Activity,
  Baseline,
  ChangeOrder,
  ChangeOrderDecision,
  Decision,
  Dependency,
  Endpoint,
  Person,
  Stage,
  WorkSnapshot,
} from '../plan';
import { baselineDraft, schedule } from '../schedule';

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

export function stage(id: string, position: number, name = `Stage ${id}`): Stage {
  return { id, position, name, startedAt: null, closedAt: null };
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
    durationMinDays: null,
    durationMaxDays: null,
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
    leadMinDays: null,
    leadMaxDays: null,
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
    lostCause: null,
    lostPartyPersonId: null,
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

/**
 * The plan with what the stage rules ask of every stage: one check at each gate, and one cost line.
 * For tests about the other rules; the stage rules then add one known and one must-know each, per
 * stage. The cost lines are money planned, so the work's funding rule (slice E2) asks too, and is
 * given one funding row: it adds one known and one must-know to the whole plan, once.
 */
export function withStageRules(plan: WorkSnapshot): WorkSnapshot {
  return {
    ...plan,
    checks: plan.stages.flatMap((each) => [
      {
        id: `${each.id}-start`,
        stageId: each.id,
        gate: 'start' as const,
        position: 1,
        name: 'S',
        needsPhoto: false,
      },
      {
        id: `${each.id}-close`,
        stageId: each.id,
        gate: 'close' as const,
        position: 1,
        name: 'C',
        needsPhoto: false,
      },
    ]),
    costLines: plan.stages.map((each) => ({
      id: `${each.id}-cost`,
      stageId: each.id,
      activityId: null,
      label: 'Sample cost',
      amountCents: 100_00,
    })),
    funding:
      plan.stages.length === 0 || plan.funding.length > 0
        ? plan.funding
        : [
            {
              id: 'funding-rules',
              position: 1,
              label: 'Sample savings',
              source: null,
              amountCents: 100_00,
              expectedOn: '2026-09-01',
              note: null,
            },
          ],
  };
}

/** A person with a name and nothing else said yet. */
export function person(id: string, name = `Person ${id}`, parts: Partial<Person> = {}): Person {
  return {
    id,
    name,
    trade: null,
    phone: null,
    email: null,
    note: null,
    availability: null,
    stageIds: [],
    ...parts,
  };
}

/**
 * A baseline of the plan as it is scheduled now, the way the host takes one: the draft's rows with
 * the names and the money read from the plan (a cost line counts on its activity when it has one,
 * and always on its stage and the work). `parts` overrides anything, e.g. `plannedCents: null` for a
 * baseline taken before money was recorded.
 */
export function takeBaseline(
  plan: WorkSnapshot,
  number: number,
  parts: Partial<Baseline> = {},
): Baseline {
  const draft = baselineDraft(plan, schedule(plan));
  const sum = (keep: (line: WorkSnapshot['costLines'][number]) => boolean) =>
    plan.costLines.filter(keep).reduce((total, line) => total + (line.amountCents ?? 0), 0);
  return {
    id: `baseline-${number}`,
    number,
    takenAt: '2026-08-31T12:00:00.000Z',
    reason: number === 1 ? null : `Reason ${number}`,
    finishDate: draft.finishDate,
    plannedCents: sum(() => true),
    stages: plan.stages.map((each) => ({
      stageId: each.id,
      position: each.position,
      name: each.name,
      plannedCents: sum((line) => line.stageId === each.id),
    })),
    rows: draft.rows.map((row) => ({
      ...row,
      plannedCents: sum((line) => line.activityId === row.activityId),
    })),
    ...parts,
  };
}

/**
 * A change order waiting for its decision: the owner asked, on `raisedOn`, in stage `stageId`, with
 * no price and no effects unless `parts` say otherwise.
 */
export function changeOrder(
  id: string,
  number: number,
  stageId: string,
  raisedOn: string,
  parts: Partial<ChangeOrder> = {},
): ChangeOrder {
  return {
    id,
    number,
    raisedOn,
    title: `Change ${id}`,
    description: null,
    askedBy: 'owner',
    askedByPersonId: null,
    askedByName: null,
    stageId,
    costCents: null,
    effects: [],
    authorName: 'Sample author',
    createdAt: `${raisedOn}T12:00:00.000Z`,
    decision: null,
    ...parts,
  };
}

/** A change order's decision on `decidedOn`, recorded that day at noon, nothing frozen unless said. */
export function changeDecision(
  outcome: ChangeOrderDecision['outcome'],
  decidedOn: string,
  parts: Partial<ChangeOrderDecision> = {},
): ChangeOrderDecision {
  return {
    outcome,
    decidedOn,
    note: null,
    finishBefore: null,
    finishAfter: null,
    daysDelta: null,
    costCents: null,
    replanningId: outcome === 'approved' ? 'replanning-1' : null,
    authorName: 'Sample author',
    createdAt: `${decidedOn}T12:00:00.000Z`,
    ...parts,
  };
}
