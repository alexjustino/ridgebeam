/**
 * A large work, generated: the size slice F11's benchmark measures the domain at (decision 8f) —
 * 2 000 activities in 40 stages with 3 000 links, 2 000 payments with reversals, and a diary of
 * 3 000 entries with corrections, people on site and photos. Seeded, so every run builds the same
 * work, byte for byte. Nothing in it is a real place, person or price.
 *
 * Test support only: no production module imports this file.
 */

import { addCalendarDays } from '../calendar';
import type { DiaryEntry, Weather } from '../diary';
import type {
  Activity,
  Check,
  CheckAnswer,
  Commitment,
  CostLine,
  Decision,
  Dependency,
  Milestone,
  Payment,
  Person,
  Stage,
  WorkSnapshot,
} from '../plan';
import { snapshot } from './plan';

/** How large. */
export const LARGE = {
  stages: 40,
  activities: 2_000,
  links: 3_000,
  people: 30,
  decisions: 200,
  commitments: 200,
  payments: 2_000,
  entries: 3_000,
} as const;

/** The day the large work is measured on: after every entry and payment in it. */
export const LARGE_TODAY = '2030-06-03';

const START = '2026-09-01';
const TRADES = ['tiler', 'electrician', 'plumber', 'painter', 'mason', 'carpenter'];
const WEATHERS: readonly Weather[] = ['sun', 'cloud', 'rain', 'storm', 'wind', 'other'];

/** A seeded generator (mulberry32), as the schedule benchmark uses. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The large work and its diary. */
export function largeWork(seed = 20260928): { plan: WorkSnapshot; entries: DiaryEntry[] } {
  const next = random(seed);
  const int = (below: number) => Math.floor(next() * below);
  const perStage = LARGE.activities / LARGE.stages;

  const people: Person[] = Array.from({ length: LARGE.people }, (_, i) => ({
    id: `p${i}`,
    name: `Person ${i + 1}`,
    trade: TRADES[i % TRADES.length]!,
    phone: null,
    email: null,
    note: null,
    availability: null,
    stageIds: [`s${i % LARGE.stages}`],
  }));

  const stages: Stage[] = Array.from({ length: LARGE.stages }, (_, i) => ({
    id: `s${i}`,
    position: i + 1,
    name: `Stage ${i + 1}`,
    startedAt: i < 10 ? '2026-09-01T08:00:00.000Z' : null,
    closedAt: null,
  }));

  // One in five activities came from a template with a range; one in seven has nobody yet.
  const activities: Activity[] = Array.from({ length: LARGE.activities }, (_, i) => {
    const days = 1 + int(10);
    const ranged = i % 5 === 0;
    return {
      id: `a${i}`,
      stageId: `s${Math.floor(i / perStage)}`,
      position: (i % perStage) + 1,
      name: `Activity ${i + 1}`,
      durationDays: days,
      durationMinDays: ranged ? days : null,
      durationMaxDays: ranged ? days + 2 : null,
      responsibleId: i % 7 === 0 ? null : `p${i % LARGE.people}`,
      roomIds: [],
      quantity: i % 3 === 0 ? 10 : null,
      unit: i % 3 === 0 ? 'm²' : null,
    };
  });

  // Earlier to later, mostly near each other, some long jumps: real plans, and no cycle.
  const seen = new Set<string>();
  const dependencies: Dependency[] = [];
  while (dependencies.length < LARGE.links) {
    const from = int(LARGE.activities - 1);
    const reach = next() < 0.9 ? 1 + int(60) : 1 + int(LARGE.activities);
    const to = Math.min(LARGE.activities - 1, from + reach);
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dependencies.push({
      id: `l${dependencies.length}`,
      blocker: { kind: 'activity', id: `a${from}` },
      blocked: { kind: 'activity', id: `a${to}` },
      lagDays: int(4),
    });
  }

  const decisions: Decision[] = Array.from({ length: LARGE.decisions }, (_, i) => ({
    id: `d${i}`,
    stageId: `s${i % LARGE.stages}`,
    position: Math.floor(i / LARGE.stages) + 1,
    name: `Decision ${i + 1}`,
    leadTimeDays: int(15),
    leadMinDays: null,
    leadMaxDays: null,
    madeAt: i % 3 === 0 ? '2026-08-25T10:00:00.000Z' : null,
    answer: i % 3 === 0 ? 'Decided' : null,
  }));

  const checks: Check[] = stages.flatMap((each) => [
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
  ]);
  const checkAnswers: CheckAnswer[] = stages.slice(0, 10).map((each, i) => ({
    id: `ans${i}`,
    checkId: `${each.id}-start`,
    seq: 1,
    answer: 'yes',
    reason: null,
    photoHash: null,
    authorName: 'Sample author',
    answeredAt: '2026-09-01T08:00:00.000Z',
  }));

  // A line on every activity (one in eleven not priced yet), and one on every stage.
  const costLines: CostLine[] = [
    ...activities.map((each, i) => ({
      id: `c${i}`,
      stageId: each.stageId,
      activityId: each.id,
      label: `Cost ${i + 1}`,
      amountCents: i % 11 === 0 ? null : 100_00 + int(900_00),
    })),
    ...stages.map((each, i) => ({
      id: `cs${i}`,
      stageId: each.id,
      activityId: null,
      label: `Stage cost ${i + 1}`,
      amountCents: 500_00,
    })),
  ];

  // Payment plans (slice D2), without drawing from the generator so the rest of the work is the same
  // as before them: the usual plan, an advance and an activity, the stage's two gates, or none.
  const milestonesOf = (i: number): Milestone[] => {
    const stageIndex = i % LARGE.stages;
    const last = `a${stageIndex * perStage + perStage - 1}`;
    const middle = `a${stageIndex * perStage + perStage / 2}`;
    const step = (
      n: number,
      shareBp: number,
      trigger: Milestone['trigger'],
      activityId: string | null = null,
    ): Milestone => ({
      id: `k${i}-m${n}`,
      position: n,
      label: `Milestone ${n}`,
      shareBp,
      trigger,
      activityId,
    });
    switch (i % 4) {
      case 0:
        return [
          step(1, 3_000, 'stage_started'),
          step(2, 4_000, 'activity_finished', last),
          step(3, 3_000, 'stage_closed'),
        ];
      case 1:
        return [step(1, 3_000, 'advance'), step(2, 7_000, 'activity_finished', middle)];
      case 2:
        return [];
      default:
        return [step(1, 5_000, 'stage_started'), step(2, 4_000, 'stage_closed')];
    }
  };

  const commitments: Commitment[] = Array.from({ length: LARGE.commitments }, (_, i) => ({
    id: `k${i}`,
    stageId: `s${i % LARGE.stages}`,
    personId: `p${i % LARGE.people}`,
    label: `Contract ${i + 1}`,
    amountCents: 10_000_00 + int(50_000_00),
    agreedOn: START,
    documentHash: null,
    milestones: milestonesOf(i),
  }));

  // Every fiftieth payment reverses the one before it; the rest pay a commitment or a stage.
  const payments: Payment[] = [];
  for (let i = 0; i < LARGE.payments; i += 1) {
    const seq = i + 1;
    const day = addCalendarDays(START, Math.floor(i * 0.6));
    if (i % 50 === 49) {
      const original = payments[i - 1]!;
      payments.push({
        ...original,
        id: `pay${seq}`,
        seq,
        day,
        amountCents: -original.amountCents,
        whatFor: 'Paid twice by mistake',
        reversesSeq: original.seq,
        createdAt: `${day}T12:00:00.000Z`,
      });
      continue;
    }
    const commitment = i % 2 === 0 ? commitments[i % LARGE.commitments]! : null;
    payments.push({
      id: `pay${seq}`,
      seq,
      day,
      personId: commitment === null ? `p${i % LARGE.people}` : null,
      stageId: commitment?.stageId ?? `s${i % LARGE.stages}`,
      commitmentId: commitment?.id ?? null,
      amountCents: 1_000_00 + int(9_000_00),
      whatFor: `Payment ${seq}`,
      receiptHash: null,
      reversesSeq: null,
      authorName: 'Sample author',
      createdAt: `${day}T12:00:00.000Z`,
    });
  }

  // Three thousand entries, about two a day; one in ten corrects an earlier one of its day.
  const entries: DiaryEntry[] = [];
  for (let i = 0; i < LARGE.entries; i += 1) {
    const seq = i + 1;
    const corrects = i % 10 === 9 ? entries[i - 1]! : null;
    const day = corrects?.day ?? addCalendarDays(START, Math.floor(i * 0.45));
    const at = int(LARGE.activities - 3);
    entries.push({
      seq,
      day,
      kind: corrects === null ? 'entry' : 'correction',
      correctsSeq: corrects?.seq ?? null,
      note: `Note ${seq}`,
      weather: WEATHERS[int(WEATHERS.length)]!,
      lostDay: i % 40 === 0,
      lostCause: i % 80 === 0 ? 'material' : null,
      lostPartyPersonId: null,
      hours: 8,
      deliveries: null,
      incidents: null,
      visitors: null,
      authorName: 'Sample author',
      createdAt: `${day}T18:00:00.000Z`,
      prevHash: seq === 1 ? '' : String(seq - 1).padStart(64, '0'),
      hash: String(seq).padStart(64, '0'),
      done: [
        { activityId: `a${at}`, state: 'worked', quantity: 2, note: null },
        { activityId: `a${at + 1}`, state: 'finished', quantity: null, note: null },
        { activityId: `a${at + 2}`, state: 'worked', quantity: null, note: null },
      ],
      present: [
        `p${i % LARGE.people}`,
        `p${(i + 7) % LARGE.people}`,
        `p${(i + 13) % LARGE.people}`,
      ],
      photos:
        i % 4 === 0
          ? [
              {
                fileHash: String(seq).padStart(64, 'f'),
                fileName: `photo-${seq}.jpg`,
                bytes: 2_000_000,
                width: 4000,
                height: 3000,
                thumbnail: true,
              },
            ]
          : [],
    });
  }

  const plan = snapshot({
    holidays: [
      { date: '2026-11-02', name: 'A holiday' },
      { date: '2026-12-25', name: 'Another holiday' },
    ],
    people,
    stages,
    activities,
    dependencies,
    decisions,
    checks,
    checkAnswers,
    costLines,
    commitments,
    payments,
  });
  return { plan, entries };
}
