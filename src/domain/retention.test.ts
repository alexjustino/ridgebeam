/**
 * Retention (slice E4, decision 3): the last part of a payment plan, earned when the stage is closed
 * and every snag of that stage on the commitment's person is closed — across the payment plans, the
 * cash runway and the lookahead.
 */

import { describe, expect, it } from 'vitest';

import { activity, link, person, snag, snagClosure, snapshot, stage } from './__fixtures__/plan';
import { traceable, type Figure, type ReportRow } from './figure';
import {
  MILESTONE_MESSAGE_KEYS,
  MILESTONE_PENDING_KEYS,
  MILESTONE_TRIGGER_KEYS,
  MILESTONE_TRIGGERS,
  PAYMENT_PREVIEW_KEYS,
  RETENTION_KEYS,
  RETENTION_SUGGESTED_BP,
  commitmentPlanOf,
  expectedOn,
  milestoneExpectation,
  paymentPreview,
  retentionOffer,
  scheduledFacts,
  validateMilestone,
  type CommitmentPlan,
} from './milestones';
import type { Commitment, Milestone, MilestoneTrigger, Payment, Snag, WorkSnapshot } from './plan';
import { lookahead } from './reports/lookahead';
import { RUNWAY_LABEL_KEYS, RUNWAY_NOTE_KEYS, runway, type Runway } from './runway';
import { schedule } from './schedule';

// ── Builders. Nothing in them is a real place, person or brand. ──────────────

/** Monday 28 September 2026. */
const TODAY = '2026-09-28';

const milestone = (
  id: string,
  position: number,
  shareBp: number,
  trigger: MilestoneTrigger,
): Milestone => ({ id, position, label: `Milestone ${id}`, shareBp, trigger, activityId: null });

const commitment = (milestones: Milestone[], parts: Partial<Commitment> = {}): Commitment => ({
  id: 'tiling',
  stageId: 'wet',
  personId: 'tiler',
  label: 'Tiling',
  amountCents: 1_000_00,
  agreedOn: '2026-09-01',
  documentHash: null,
  milestones,
  ...parts,
});

/** 95 % when the stage closes, 5 % held back as retention. */
const PLAN = [milestone('main', 1, 9_500, 'stage_closed'), milestone('ret', 2, 500, 'retention')];

const payment = (seq: number, amountCents: number, day: string): Payment => ({
  id: `payment-${seq}`,
  seq,
  day,
  personId: 'tiler',
  stageId: 'wet',
  commitmentId: 'tiling',
  amountCents,
  whatFor: `Payment ${seq}`,
  receiptHash: null,
  reversesSeq: null,
  authorName: 'Sample author',
  createdAt: `${day}T12:00:00.000Z`,
});

/** The wet areas, closed on 20 September unless said otherwise; a tiler and a painter. */
function work(snags: Snag[], parts: Partial<WorkSnapshot> = {}, closedAt: string | null = null) {
  return snapshot({
    stages: [
      { ...stage('wet', 1, 'Wet areas'), startedAt: '2026-09-01T08:00:00.000Z', closedAt },
      stage('paint', 2, 'Painting'),
    ],
    people: [person('tiler', 'Tiler'), person('painter', 'Painter')],
    commitments: [commitment(PLAN)],
    snags,
    ...parts,
  });
}

const CLOSED = '2026-09-20T17:00:00.000Z';

const planOf = (plan: WorkSnapshot, today = TODAY): CommitmentPlan =>
  commitmentPlanOf(plan, [], today, 'tiling')!;

const retentionOf = (plan: WorkSnapshot, today = TODAY) => planOf(plan, today).milestones[1]!;

const onTiler = (id: string, number: number, parts: Partial<Snag> = {}): Snag =>
  snag(id, number, 'wet', { personId: 'tiler', ...parts });

// ── Earned, held ─────────────────────────────────────────────────────────────

describe('retention, earned', () => {
  it('is one of the triggers, with its words', () => {
    expect(MILESTONE_TRIGGERS).toContain('retention');
    expect(Object.keys(MILESTONE_TRIGGER_KEYS)).toEqual([...MILESTONE_TRIGGERS]);
    expect(Object.keys(MILESTONE_PENDING_KEYS)).toEqual([...MILESTONE_TRIGGERS]);
    for (const key of Object.values(RETENTION_KEYS)) expect(MILESTONE_MESSAGE_KEYS).toContain(key);
  });

  it('waits for the stage to close, held by nothing', () => {
    const status = retentionOf(work([]));
    expect(status).toMatchObject({ earned: false, earnedOn: null, held: false, openSnagIds: [] });
    expect(status.target).toEqual({ kind: 'stage', id: 'wet', name: 'Wet areas' });
    expect(planOf(work([])).next).toMatchObject({
      milestoneId: 'main',
      pendingKey: MILESTONE_PENDING_KEYS.stage_closed,
    });
    const afterMain = planOf(
      work([], { commitments: [commitment([milestone('ret', 1, 500, 'retention')])] }),
    );
    expect(afterMain.next).toMatchObject({
      milestoneId: 'ret',
      pendingKey: MILESTONE_PENDING_KEYS.retention,
      openSnags: 0,
    });
  });

  it('is earned the day the stage closes when no snag is on the person', () => {
    const plan = planOf(work([], {}, CLOSED));
    expect(plan.milestones[1]).toMatchObject({ earned: true, earnedOn: '2026-09-20', held: false });
    expect(plan.earned.value).toBe(1_000_00);
    expect(plan.next).toBeNull();
  });

  it('is held while a snag of the stage on the person is open, whatever the close', () => {
    const plan = planOf(work([onTiler('b', 2), onTiler('a', 1)], {}, CLOSED));
    expect(plan.milestones[1]).toMatchObject({
      earned: false,
      earnedOn: null,
      held: true,
      openSnagIds: ['a', 'b'],
    });
    expect(plan.next).toMatchObject({
      milestoneId: 'ret',
      pendingKey: RETENTION_KEYS.held,
      openSnags: 2,
    });
    expect(plan.earned.value).toBe(950_00);
    // Held before the stage closes too: the snags say so, not the stage.
    expect(retentionOf(work([onTiler('a', 1)]))).toMatchObject({ held: true, earned: false });
  });

  it('stays held with one of two fixed, and is earned the day the last one is closed', () => {
    const fixedOne = [
      onTiler('a', 1, { closure: snagClosure('fixed', '2026-09-24') }),
      onTiler('b', 2),
    ];
    expect(retentionOf(work(fixedOne, {}, CLOSED))).toMatchObject({
      held: true,
      openSnagIds: ['b'],
    });
    const both = [
      fixedOne[0]!,
      onTiler('b', 2, { closure: snagClosure('withdrawn', '2026-09-26') }),
    ];
    expect(retentionOf(work(both, {}, CLOSED))).toMatchObject({
      held: false,
      earned: true,
      earnedOn: '2026-09-26',
    });
  });

  it('is earned on the close when every snag was closed before it', () => {
    const early = [
      onTiler('a', 1, { raisedOn: '2026-09-10', closure: snagClosure('fixed', '2026-09-15') }),
    ];
    expect(retentionOf(work(early, {}, CLOSED))).toMatchObject({
      earned: true,
      earnedOn: '2026-09-20',
    });
  });

  it('is not held by a snag on another person, in another stage, or on nobody', () => {
    const others = [
      snag('painter', 1, 'wet', { personId: 'painter' }),
      snag('elsewhere', 2, 'paint', { personId: 'tiler' }),
      snag('nobody', 3, 'wet'),
    ];
    expect(retentionOf(work(others, {}, CLOSED))).toMatchObject({
      held: false,
      earned: true,
      earnedOn: '2026-09-20',
    });
  });

  it('is earned at the close for a commitment on nobody, whatever snags there are', () => {
    const plan = work(
      [onTiler('a', 1)],
      { commitments: [commitment(PLAN, { personId: null })] },
      CLOSED,
    );
    expect(retentionOf(plan)).toMatchObject({ held: false, earned: true, earnedOn: '2026-09-20' });
  });

  it('is not earned by a closure dated after today, nor held by it', () => {
    const later = [onTiler('a', 1, { closure: snagClosure('fixed', '2026-10-02') })];
    expect(retentionOf(work(later, {}, CLOSED))).toMatchObject({ earned: false, held: false });
    expect(retentionOf(work(later, {}, CLOSED), '2026-10-02')).toMatchObject({
      earned: true,
      earnedOn: '2026-10-02',
    });
  });

  it('is held again by a snag raised after it was earned, as a reopened stage un-earns', () => {
    const plan = work([onTiler('late', 1, { raisedOn: '2026-09-27' })], {}, CLOSED);
    expect(retentionOf(plan)).toMatchObject({ earned: false, held: true });
  });

  it('is un-earned when the stage is reopened', () => {
    expect(retentionOf(work([], {}, null))).toMatchObject({ earned: false, held: false });
  });

  it('keeps every figure traceable, its row on the day it was earned', () => {
    const plan = planOf(work([], { payments: [payment(1, 900_00, '2026-09-21')] }, CLOSED));
    for (const figure of [plan.earned, plan.paid, plan.due, plan.ahead]) {
      expect(traceable(figure as Figure<ReportRow>), figure.id).toBe(true);
    }
    expect(plan.earned.rows.map((row) => [row.milestoneId, row.trigger, row.day])).toEqual([
      ['main', 'stage_closed', '2026-09-20'],
      ['ret', 'retention', '2026-09-20'],
    ]);
    expect(plan.due.value).toBe(100_00);
  });
});

// ── Paying it early, and checking it ─────────────────────────────────────────

describe('paying a held retention', () => {
  it('is warned as paying ahead of the work, naming the retention and its snags', () => {
    const plan = work([onTiler('a', 1)], { payments: [payment(1, 950_00, '2026-09-21')] }, CLOSED);
    const preview = paymentPreview(plan, [], TODAY, {
      day: TODAY,
      personId: 'tiler',
      stageId: 'wet',
      commitmentId: 'tiling',
      amountCents: 50_00,
      whatFor: 'Retention',
      reversesSeq: null,
    });
    expect(preview).toMatchObject({
      kind: 'plan',
      warn: true,
      aheadAfterCents: 50_00,
      messageKey: PAYMENT_PREVIEW_KEYS.ahead,
      next: { milestoneId: 'ret', pendingKey: RETENTION_KEYS.held, openSnags: 1 },
    });
  });
});

describe('checking a retention milestone', () => {
  it('names no activity, as a stage close does not', () => {
    const plan = work([], {
      commitments: [commitment([milestone('main', 1, 9_500, 'stage_closed')])],
    });
    const draft = {
      label: 'Retention',
      shareBp: 500,
      trigger: 'retention' as const,
      activityId: null,
    };
    expect(validateMilestone(plan, 'tiling', draft)).toEqual([]);
    expect(
      validateMilestone(plan, 'tiling', { ...draft, activityId: 'any' }).map((each) => each.code),
    ).toEqual(['activity-not-allowed']);
  });
});

describe('the retention offer', () => {
  const base = (milestones: Milestone[], parts: Partial<WorkSnapshot> = {}) =>
    work([], { commitments: [commitment(milestones)], ...parts });

  it('suggests 5 %, a usual practice, in cents of the commitment', () => {
    const offer = retentionOffer(base([milestone('main', 1, 9_500, 'stage_closed')]), 'tiling');
    expect(RETENTION_SUGGESTED_BP).toBe(500);
    expect(offer).toEqual({
      ok: true,
      labelKey: RETENTION_KEYS.label,
      noteKey: RETENTION_KEYS.note,
      shareBp: 500,
      cents: 50_00,
      trigger: 'retention',
      activityId: null,
      availableBp: 500,
      holdsOnPerson: true,
    });
  });

  it('suggests what is left when that is less, and says a commitment on nobody holds nothing', () => {
    const offer = retentionOffer(
      work([], {
        commitments: [
          commitment([milestone('main', 1, 9_700, 'stage_closed')], { personId: null }),
        ],
      }),
      'tiling',
    );
    expect(offer).toMatchObject({ ok: true, shareBp: 300, availableBp: 300, holdsOnPerson: false });
    expect(retentionOffer(base([]), 'tiling')).toMatchObject({ shareBp: 500, availableBp: 10_000 });
  });

  it('is not offered on a full plan, a plan that has one, a plan money moved on, or nothing', () => {
    expect(retentionOffer(base([milestone('all', 1, 10_000, 'stage_closed')]), 'tiling')).toEqual({
      ok: false,
      code: 'full',
    });
    expect(retentionOffer(base(PLAN), 'tiling')).toEqual({ ok: false, code: 'has-retention' });
    const paid = base([milestone('main', 1, 9_500, 'stage_closed')], {
      payments: [payment(1, 10_00, '2026-09-02')],
    });
    expect(retentionOffer(paid, 'tiling')).toEqual({ ok: false, code: 'locked' });
    expect(retentionOffer(base([]), 'missing')).toEqual({ ok: false, code: 'unknown-commitment' });
  });
});

// ── When it is expected: the runway and the lookahead ────────────────────────

/** Wednesday 2 September 2026: the work starts on Monday 7 September. */
const EARLY = '2026-09-02';

/** Wet areas: a (7–11 Sep) then b (14–18 Sep); Painting: c (21–25 Sep). */
function scheduled(snags: Snag[], payments: Payment[] = []): WorkSnapshot {
  return snapshot({
    work: { ...snapshot().work, startDate: '2026-09-07' },
    stages: [stage('wet', 1, 'Wet areas'), stage('paint', 2, 'Painting')],
    activities: [
      activity('a', 'wet', 1, 5),
      activity('b', 'wet', 2, 5),
      activity('c', 'paint', 1, 5),
    ],
    dependencies: [link('ab', 'a', 'b'), link('bc', 'b', 'c')],
    people: [person('tiler', 'Tiler')],
    commitments: [commitment(PLAN)],
    payments,
    snags: snags.map((each) => ({ ...each, raisedOn: '2026-09-01' })),
  });
}

const run = (plan: WorkSnapshot): Runway => runway(plan, schedule(plan), [], EARLY);

const flows = (result: Runway) =>
  result.weeks.flatMap((week) =>
    week.rows.map((row) => [week.from, `${row.source}:${row.sourceId}`, row.amountCents]),
  );

describe('when a retention is expected', () => {
  it('is the stage’s expected close, as a stage close is, unless snags hold it', () => {
    const plan = scheduled([]);
    const facts = scheduledFacts(schedule(plan));
    const ret = PLAN[1]!;
    expect(expectedOn(facts, commitment(PLAN), ret)).toBe('2026-09-18');
    const free = commitmentPlanOf(plan, [], EARLY, 'tiling')!.milestones[1]!;
    expect(milestoneExpectation(facts, commitment(PLAN), free)).toEqual({
      held: false,
      day: '2026-09-18',
    });
    const held = commitmentPlanOf(scheduled([onTiler('x', 1)]), [], EARLY, 'tiling')!
      .milestones[1]!;
    expect(milestoneExpectation(facts, commitment(PLAN), held)).toEqual({
      held: true,
      openSnags: 1,
    });
  });
});

describe('the runway and a retention', () => {
  it('projects a retention nothing holds on the stage’s expected close', () => {
    const result = run(scheduled([]));
    expect(flows(result)).toEqual([
      ['2026-09-14', 'milestone:main', -950_00],
      ['2026-09-14', 'milestone:ret', -50_00],
    ]);
    expect(result.held).toEqual([]);
    expect(result.figures.held.value).toBe(0);
  });

  it('lists a held retention apart, never in a week, and says so', () => {
    const result = run(scheduled([onTiler('x', 1), onTiler('y', 2)]));
    expect(flows(result)).toEqual([['2026-09-14', 'milestone:main', -950_00]]);
    expect(result.held.map((row) => [row.source, row.sourceId, row.amountCents, row.when])).toEqual(
      [['retention', 'ret', 50_00, 'held']],
    );
    expect(result.held[0]).toMatchObject({ openSnags: 2, day: null, commitmentId: 'tiling' });
    expect(result.figures.held).toMatchObject({ label: RUNWAY_LABEL_KEYS.held, value: 50_00 });
    expect(traceable(result.figures.held)).toBe(true);
    expect(result.notes).toContainEqual({
      key: RUNWAY_NOTE_KEYS.held,
      params: { count: 1, amount: 50_00, snags: 2 },
    });
    // Money at the end does not count it: the owner is holding it.
    expect(result.spare).toBe(-950_00);
  });

  it('lets money paid ahead cover what comes first, and only the rest of it what is held', () => {
    const result = run(scheduled([onTiler('x', 1)], [payment(1, 980_00, '2026-09-01')]));
    expect(flows(result)).toEqual([]);
    expect(result.held[0]).toMatchObject({ amountCents: 20_00, coveredCents: 30_00 });
  });

  it('lists nothing held when paid ahead covers it whole', () => {
    const result = run(scheduled([onTiler('x', 1)], [payment(1, 1_000_00, '2026-09-01')]));
    expect(result.held).toEqual([]);
    expect(result.notes.some((note) => note.key === RUNWAY_NOTE_KEYS.held)).toBe(false);
  });
});

describe('the lookahead and a retention', () => {
  it('lists a retention nothing holds as falling due, and never a held one', () => {
    const free = scheduled([]);
    const ahead = (plan: WorkSnapshot) =>
      lookahead(plan, schedule(plan), [], EARLY, 21).payments.fallingDue.rows.map(
        (row) => row.milestoneId,
      );
    expect(ahead(free)).toEqual(['main', 'ret']);
    expect(ahead(scheduled([onTiler('x', 1)]))).toEqual(['main']);
  });
});
