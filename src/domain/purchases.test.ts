import { describe, expect, it } from 'vitest';

import {
  activity,
  entry,
  finished,
  link,
  purchase,
  purchaseEvent,
  snapshot,
  stage,
  worked,
} from './__fixtures__/plan';
import type { DiaryEntry } from './diary';
import { traceable } from './figure';
import type { Purchase, WorkSnapshot } from './plan';
import {
  PURCHASE_EVENT_KEYS,
  PURCHASE_EVENT_KINDS,
  PURCHASE_FLAG_KEYS,
  PURCHASE_LABEL_KEYS,
  PURCHASE_LIMITS,
  PURCHASE_MESSAGE_KEYS,
  PURCHASE_PROBLEM_KEYS,
  PURCHASE_STATE_KEYS,
  PURCHASE_STATES,
  purchaseFigures,
  purchaseFiguresOf,
  purchaseFlags,
  purchaseRemovable,
  purchaseRows,
  purchasesInOrder,
  purchaseStory,
  validatePurchaseDraft,
  validatePurchaseEvent,
  type PurchaseDraft,
  type PurchaseEventDraft,
  type PurchaseProblem,
  type PurchaseRow,
} from './purchases';
import { schedule } from './schedule';
import { forecast } from './schedule/forecast';

// ── Builders. Nothing in them is a real place, person or brand. ──────────────
//
// The work starts on Tuesday 1 September 2026, Monday to Friday. Scheduled: a1 1–7 September, a2
// 8–10, b1 11–16, b2 17–18 (stage s2 starts on the 11th). Today is Tuesday 1 September, the work's
// first day, so with the diary empty the forecast is the plan; the week runs Monday 31 August to
// Sunday 6 September.

const TODAY = '2026-09-01';

const PLAN = snapshot({
  stages: [stage('s1', 1, 'Kitchen'), stage('s2', 2, 'Finishes')],
  activities: [
    activity('a1', 's1', 1, 5),
    activity('a2', 's1', 2, 3),
    activity('b1', 's2', 1, 4),
    activity('b2', 's2', 2, 2),
  ],
  dependencies: [link('l1', 'a1', 'a2'), link('l2', 'a2', 'b1'), link('l3', 'b1', 'b2')],
});

const withPurchases = (...purchases: Purchase[]): WorkSnapshot => ({ ...PLAN, purchases });

const rowsOf = (
  plan: WorkSnapshot,
  today = TODAY,
  entries: readonly DiaryEntry[] = [],
): PurchaseRow[] => purchaseRows(plan, schedule(plan), entries, today);

const one = (
  bought: Purchase,
  today = TODAY,
  entries: readonly DiaryEntry[] = [],
  plan: WorkSnapshot = PLAN,
): PurchaseRow => rowsOf({ ...plan, purchases: [bought] }, today, entries)[0]!;

const flagsOf = (row: PurchaseRow) => purchaseFlags(row);

// ── The rule ─────────────────────────────────────────────────────────────────

describe('the day to order by', () => {
  it('is the day the activity starts, less the lead time in calendar days', () => {
    const row = one(purchase('worktop', 1, 's1', 21, { activityId: 'a2' }));
    expect(row).toMatchObject({
      neededActivityId: 'a2',
      neededActivityName: 'Activity a2',
      neededOn: '2026-09-08',
      neededFrom: 'forecast',
      // Calendar days, weekends included: 21 days before Tuesday 8 September.
      orderBy: '2026-08-18',
      state: 'to-order',
      expectedOn: null,
    });
  });

  it('is the start itself with no lead time', () => {
    expect(one(purchase('p', 1, 's1', 0, { activityId: 'a2' })).orderBy).toBe('2026-09-08');
  });

  it('on a stage, is its first activity’s: the earliest start, whatever the positions', () => {
    // c1 is first on the list but waits for c2; c2 starts first.
    const plan = snapshot({
      stages: [stage('s3', 1)],
      activities: [activity('c1', 's3', 1, 2), activity('c2', 's3', 2, 3)],
      dependencies: [link('l', 'c2', 'c1')],
    });
    const row = one(purchase('p', 1, 's3', 1), TODAY, [], plan);
    expect(row).toMatchObject({ activityId: null, neededActivityId: 'c2', neededOn: '2026-09-01' });
  });

  it('on a stage whose activities start together, is the first on the plan', () => {
    const plan = snapshot({
      stages: [stage('s3', 1)],
      activities: [activity('c2', 's3', 2, 3), activity('c1', 's3', 1, 2)],
    });
    expect(one(purchase('p', 1, 's3', 1), TODAY, [], plan).neededActivityId).toBe('c1');
  });

  it('falls back to the stage’s first activity when the one named is no longer in the plan', () => {
    const row = one(purchase('p', 1, 's2', 7, { activityId: 'gone' }));
    expect(row).toMatchObject({
      activityId: 'gone',
      neededActivityId: 'b1',
      orderBy: '2026-09-04',
    });
  });

  it('is not known for an activity the schedule cannot place, nor for a stage with none placed', () => {
    const plan = snapshot({
      stages: [stage('s1', 1), stage('empty', 2)],
      activities: [activity('x', 's1', 1, null)],
    });
    const rows = rowsOf({
      ...plan,
      purchases: [
        purchase('named', 1, 's1', 5, { activityId: 'x' }),
        purchase('stage', 2, 'empty', 5),
      ],
    });
    for (const row of rows) {
      expect(row).toMatchObject({ neededOn: null, neededFrom: null, orderBy: null });
      expect(flagsOf(row)).toEqual([]);
    }
    expect(rows[0]!.neededActivityId).toBe('x');
    expect(rows[1]!.neededActivityId).toBeNull();
  });
});

describe('as things stand', () => {
  const worktop = purchase('worktop', 1, 's1', 21, { activityId: 'a2' });

  it('moves the day to order by later when the work slips', () => {
    // a1 was worked on its first day and is not finished on the 9th: a2 starts on the 10th.
    const entries = [entry(1, '2026-09-01', { done: [worked('a1')] })];
    const today = '2026-09-09';
    const plan = withPurchases(worktop);
    const ahead = forecast(plan, schedule(plan), entries, today);
    expect(schedule(plan).dates.get('a2')!.start).toBe('2026-09-08');
    expect(ahead.dates.get('a2')!.start).toBe('2026-09-10');
    expect(one(worktop, today, entries)).toMatchObject({
      neededOn: '2026-09-10',
      neededFrom: 'forecast',
      orderBy: '2026-08-20',
    });
  });

  it('moves it earlier when the work gets ahead', () => {
    // a1 finished on its second day: a2 can start on the 3rd.
    const entries = [
      entry(1, '2026-09-01', { done: [worked('a1')] }),
      entry(2, '2026-09-02', { done: [finished('a1')] }),
    ];
    expect(one(worktop, '2026-09-02', entries)).toMatchObject({
      neededOn: '2026-09-03',
      orderBy: '2026-08-13',
    });
  });

  it('reads the plan when there is no forecast, and flags nothing on a today that is not a day', () => {
    const row = one(worktop, 'not a day');
    expect(row).toMatchObject({
      neededOn: '2026-09-08',
      neededFrom: 'plan',
      orderBy: '2026-08-18',
    });
    expect(flagsOf(row)).toEqual([]);
    expect(row.daysLate).toBeNull();
  });

  it('says nothing is needed when the plan cannot be scheduled', () => {
    const plan = { ...PLAN, calendar: { workingDays: '0000000', hoursPerDay: 8 } };
    const row = one(worktop, TODAY, [], plan);
    expect(row).toMatchObject({ neededOn: null, orderBy: null, neededFrom: null });
    expect(flagsOf(row)).toEqual([]);
  });
});

describe('the flags of what is to order', () => {
  it('is late to order once the order-by day has passed, and this week’s business too', () => {
    const row = one(purchase('worktop', 1, 's1', 21, { activityId: 'a2' }));
    expect(row).toMatchObject({ lateToOrder: true, orderThisWeek: true, daysLate: 14 });
    expect(flagsOf(row)).toEqual(['lateToOrder']);
    expect(row.day).toBe('2026-08-18');
  });

  it('is not late on the order-by day itself', () => {
    const row = one(purchase('p', 1, 's1', 7, { activityId: 'a2' }));
    expect(row).toMatchObject({ orderBy: TODAY, lateToOrder: false, orderThisWeek: true });
    expect(row.daysLate).toBeNull();
  });

  it('counts the week Monday to Sunday: Sunday in, the Monday after out', () => {
    // a2 starts on Tuesday 8 September: 2 days before is Sunday 6, 1 day before is Monday 7.
    expect(one(purchase('sun', 1, 's1', 2, { activityId: 'a2' }))).toMatchObject({
      orderBy: '2026-09-06',
      orderThisWeek: true,
      lateToOrder: false,
    });
    expect(one(purchase('mon', 1, 's1', 1, { activityId: 'a2' }))).toMatchObject({
      orderBy: '2026-09-07',
      orderThisWeek: false,
    });
  });

  it('counts the Monday already gone by as this week, and late', () => {
    // Asked on Wednesday 2 September (a1 slips a day): the Monday of the week is 31 August.
    const row = one(purchase('p', 1, 's1', 9, { activityId: 'a2' }), '2026-09-02');
    expect(row).toMatchObject({ orderBy: '2026-08-31', lateToOrder: true, orderThisWeek: true });
  });

  it('on a Sunday, still asks the week that ends that day', () => {
    // Sunday 6 September: a1 starts on Monday the 7th, a2 on Monday the 14th.
    const sunday = '2026-09-06';
    expect(one(purchase('p', 1, 's1', 8, { activityId: 'a2' }), sunday)).toMatchObject({
      orderBy: '2026-09-06',
      orderThisWeek: true,
      lateToOrder: false,
    });
    expect(one(purchase('p', 1, 's1', 7, { activityId: 'a2' }), sunday)).toMatchObject({
      orderBy: '2026-09-07',
      orderThisWeek: false,
    });
  });

  it('is neither when it is ordered after this week', () => {
    const row = one(purchase('paint', 1, 's2', 7, { activityId: 'b2' }));
    expect(row.orderBy).toBe('2026-09-10');
    expect(flagsOf(row)).toEqual([]);
  });
});

describe('the story of a purchase', () => {
  it('is to order with no event', () => {
    expect(purchaseStory(purchase('p', 1, 's1', 1))).toEqual({
      state: 'to-order',
      orderedOn: null,
      deliveredOn: null,
      fellThrough: 0,
      lastFellThroughOn: null,
      last: null,
    });
  });

  it('reads its events in seq order, whatever the order on the record', () => {
    const story = purchaseStory(
      purchase('p', 1, 's1', 1, {
        events: [
          purchaseEvent(2, 'delivered', '2026-08-25'),
          purchaseEvent(1, 'ordered', '2026-08-20'),
        ],
      }),
    );
    expect(story).toMatchObject({
      state: 'delivered',
      orderedOn: '2026-08-20',
      deliveredOn: '2026-08-25',
    });
    expect(story.last?.seq).toBe(2);
  });

  it('is to order again when the order falls through, and ordered again after', () => {
    const events = [
      purchaseEvent(1, 'ordered', '2026-08-10'),
      purchaseEvent(2, 'cancelled', '2026-08-12', 'Out of stock'),
    ];
    expect(purchaseStory(purchase('p', 1, 's1', 1, { events }))).toMatchObject({
      state: 'to-order',
      orderedOn: null,
      fellThrough: 1,
      lastFellThroughOn: '2026-08-12',
    });
    const again = [...events, purchaseEvent(3, 'ordered', '2026-08-14')];
    expect(purchaseStory(purchase('p', 1, 's1', 1, { events: again }))).toMatchObject({
      state: 'ordered',
      orderedOn: '2026-08-14',
      fellThrough: 1,
    });
  });

  it('passes over what could not have happened', () => {
    const story = purchaseStory(
      purchase('p', 1, 's1', 1, {
        events: [
          purchaseEvent(1, 'delivered', '2026-08-01'),
          purchaseEvent(2, 'cancelled', '2026-08-02'),
          purchaseEvent(3, 'ordered', '2026-08-03'),
          purchaseEvent(4, 'ordered', '2026-08-04'),
          purchaseEvent(5, 'delivered', '2026-08-05'),
          purchaseEvent(6, 'cancelled', '2026-08-06'),
        ],
      }),
    );
    expect(story).toMatchObject({
      state: 'delivered',
      orderedOn: '2026-08-03',
      deliveredOn: '2026-08-05',
      fellThrough: 0,
    });
    expect(story.last?.seq).toBe(5);
  });
});

describe('the flags of what is ordered', () => {
  it('expects it on the order’s day plus the lead time, and says when it arrives after it is needed', () => {
    const row = one(
      purchase('worktop', 1, 's1', 21, {
        activityId: 'a2',
        events: [purchaseEvent(1, 'ordered', TODAY)],
      }),
    );
    expect(row).toMatchObject({
      state: 'ordered',
      orderedOn: TODAY,
      expectedOn: '2026-09-22',
      neededOn: '2026-09-08',
      lateToOrder: false,
      orderThisWeek: false,
      lateToArrive: false,
      arrivesAfterNeeded: true,
      daysAfterNeeded: 14,
      daysLate: null,
      day: '2026-09-22',
    });
    expect(flagsOf(row)).toEqual(['arrivesAfterNeeded']);
  });

  it('is late to arrive once the expected day has passed', () => {
    const row = one(
      purchase('handles', 1, 's2', 3, {
        activityId: 'b2',
        events: [purchaseEvent(1, 'ordered', '2026-08-25')],
      }),
    );
    expect(row).toMatchObject({
      expectedOn: '2026-08-28',
      lateToArrive: true,
      arrivesAfterNeeded: false,
      daysLate: 4,
    });
  });

  it('is in time on the expected day itself, and when it arrives the day it is needed', () => {
    const row = one(
      purchase('p', 1, 's1', 7, {
        activityId: 'a2',
        events: [purchaseEvent(1, 'ordered', TODAY)],
      }),
    );
    expect(row).toMatchObject({ expectedOn: '2026-09-08', neededOn: '2026-09-08' });
    expect(flagsOf(row)).toEqual([]);
    const today = one(
      purchase('p', 1, 's2', 0, { activityId: 'b2', events: [purchaseEvent(1, 'ordered', TODAY)] }),
    );
    expect(today.lateToArrive).toBe(false);
  });

  it('says nothing once delivered', () => {
    const row = one(
      purchase('p', 1, 's1', 30, {
        activityId: 'a2',
        events: [purchaseEvent(1, 'ordered', '2026-08-01'), purchaseEvent(2, 'delivered', TODAY)],
      }),
    );
    expect(row).toMatchObject({ state: 'delivered', deliveredOn: TODAY, day: TODAY });
    expect(row.expectedOn).toBe('2026-08-31');
    expect(flagsOf(row)).toEqual([]);
  });

  it('is to order again, and flagged so, when the order fell through', () => {
    const row = one(
      purchase('p', 1, 's1', 21, {
        activityId: 'a2',
        events: [
          purchaseEvent(1, 'ordered', '2026-08-10'),
          purchaseEvent(2, 'cancelled', TODAY, 'The supplier closed'),
        ],
      }),
    );
    expect(row).toMatchObject({
      state: 'to-order',
      orderedOn: null,
      expectedOn: null,
      fellThrough: 1,
      lastFellThroughOn: TODAY,
      lateToOrder: true,
      orderThisWeek: true,
    });
  });
});

describe('what is done', () => {
  it('flags nothing for an activity the diary says is finished', () => {
    const entries = [entry(1, '2026-09-01', { done: [finished('a2')] })];
    const rows = rowsOf(
      withPurchases(
        purchase('to-order', 1, 's1', 30, { activityId: 'a2' }),
        purchase('ordered', 2, 's1', 30, {
          activityId: 'a2',
          events: [purchaseEvent(1, 'ordered', '2026-08-01')],
        }),
      ),
      '2026-09-03',
      entries,
    );
    for (const row of rows) {
      expect(row.done).toBe(true);
      expect(flagsOf(row)).toEqual([]);
      expect(row.daysLate).toBeNull();
    }
  });

  it('still flags an activity that has started and is not finished', () => {
    const entries = [entry(1, '2026-09-01', { done: [worked('a1')] })];
    const row = one(purchase('p', 1, 's1', 30, { activityId: 'a1' }), '2026-09-02', entries);
    expect(row).toMatchObject({ done: false, neededOn: '2026-09-01', lateToOrder: true });
  });

  it('flags nothing on a closed stage', () => {
    const plan: WorkSnapshot = {
      ...PLAN,
      stages: [
        {
          ...stage('s1', 1, 'Kitchen'),
          startedAt: '2026-09-01T08:00:00.000Z',
          closedAt: '2026-09-01T17:00:00.000Z',
        },
        stage('s2', 2, 'Finishes'),
      ],
    };
    const row = one(purchase('p', 1, 's1', 30, { activityId: 'a2' }), TODAY, [], plan);
    expect(row.done).toBe(true);
    expect(flagsOf(row)).toEqual([]);
  });

  it('on a stage, is done when its first activity is', () => {
    const entries = [entry(1, '2026-09-01', { done: [finished('b1')] })];
    const row = one(purchase('p', 1, 's2', 30), '2026-09-02', entries);
    expect(row).toMatchObject({ neededActivityId: 'b1', done: true, lateToOrder: false });
  });
});

describe('the rows', () => {
  it('are by position, each with its own key, and nothing for a work with no purchase', () => {
    const plan = withPurchases(purchase('b', 2, 's1', 1), purchase('a', 1, 's2', 1));
    expect(rowsOf(plan).map((row) => [row.key, row.itemId, row.title])).toEqual([
      ['purchase:a', 'a', 'Purchase a'],
      ['purchase:b', 'b', 'Purchase b'],
    ]);
    expect(purchasesInOrder(plan).map((each) => each.id)).toEqual(['a', 'b']);
    expect(rowsOf(PLAN)).toEqual([]);
  });

  it('carry what the purchase says, as written', () => {
    const row = one(
      purchase('p', 1, 's1', 5, {
        quantity: '12 m²',
        supplier: 'Sample supplier',
        note: 'Ask for the matt finish',
      }),
    );
    expect(row).toMatchObject({
      stageName: 'Kitchen',
      quantity: '12 m²',
      supplier: 'Sample supplier',
      leadDays: 5,
      note: 'Ask for the matt finish',
      minutes: 0,
    });
  });

  it('say no stage name for a stage no longer in the plan', () => {
    const row = one(purchase('p', 1, 'gone', 5));
    expect(row).toMatchObject({ stageName: null, neededActivityId: null, neededOn: null });
  });
});

// ── The figures ──────────────────────────────────────────────────────────────

describe('the figures', () => {
  const plan = withPurchases(
    // Late to order: by 18 August, and by 25 August.
    purchase('worktop', 1, 's1', 21, { activityId: 'a2' }),
    purchase('sink', 2, 's1', 14, { activityId: 'a2' }),
    // This week, not late: by 4 September.
    purchase('tiles', 3, 's2', 7),
    // Not this week: by 10 September.
    purchase('paint', 4, 's2', 7, { activityId: 'b2' }),
    // Ordered, late to arrive (28 August), and ordered, arriving after it is needed (22 September).
    purchase('handles', 5, 's2', 3, {
      activityId: 'b2',
      events: [purchaseEvent(1, 'ordered', '2026-08-25')],
    }),
    purchase('window', 6, 's1', 21, {
      activityId: 'a2',
      events: [purchaseEvent(1, 'ordered', TODAY)],
    }),
    // Delivered: nothing to say.
    purchase('door', 7, 's1', 5, {
      events: [purchaseEvent(1, 'ordered', '2026-08-01'), purchaseEvent(2, 'delivered', TODAY)],
    }),
  );
  const figures = purchaseFigures(plan, schedule(plan), [], TODAY);
  const ids = (rows: readonly PurchaseRow[]) => rows.map((row) => row.purchaseId);

  it('say what to order this week, the late first, by the day to order by', () => {
    expect(figures.total).toBe(7);
    expect(ids(figures.toOrderThisWeek.rows)).toEqual(['worktop', 'sink', 'tiles']);
    expect(figures.toOrderThisWeek).toMatchObject({
      value: 3,
      unit: 'count',
      label: PURCHASE_LABEL_KEYS.toOrderThisWeek,
    });
  });

  it('say what is late to order, and what is ordered and late to arrive', () => {
    expect(ids(figures.lateToOrder.rows)).toEqual(['worktop', 'sink']);
    expect(figures.lateToOrder.label).toBe(PURCHASE_LABEL_KEYS.lateToOrder);
    expect(ids(figures.lateToArrive.rows)).toEqual(['handles']);
    expect(figures.lateToArrive.label).toBe(PURCHASE_LABEL_KEYS.lateToArrive);
    expect(ids(figures.arrivesAfterNeeded.rows)).toEqual(['window']);
    expect(figures.arrivesAfterNeeded.label).toBe(PURCHASE_LABEL_KEYS.arrivesAfterNeeded);
  });

  it('are traceable: each figure’s rows are exactly what it counts', () => {
    for (const figure of [
      figures.toOrderThisWeek,
      figures.lateToOrder,
      figures.lateToArrive,
      figures.arrivesAfterNeeded,
    ]) {
      expect(traceable(figure)).toBe(true);
      expect(figure.value).toBe(figure.rows.length);
    }
    const rows = rowsOf(plan);
    expect(figures).toEqual(purchaseFiguresOf(rows));
    expect(figures.lateToOrder.rows.every((row) => row.lateToOrder)).toBe(true);
    expect(rows.filter((row) => row.lateToOrder)).toHaveLength(figures.lateToOrder.value);
    expect(rows.filter((row) => row.orderThisWeek)).toHaveLength(figures.toOrderThisWeek.value);
    expect(rows.filter((row) => row.lateToArrive)).toHaveLength(figures.lateToArrive.value);
  });

  it('are nothing for a work with no purchase', () => {
    const none = purchaseFigures(PLAN, schedule(PLAN), [], TODAY);
    expect(none.total).toBe(0);
    expect(none.toOrderThisWeek.rows).toEqual([]);
    expect(traceable(none.toOrderThisWeek)).toBe(true);
  });
});

// ── Removal ──────────────────────────────────────────────────────────────────

describe('removing a purchase', () => {
  it('is possible only while nothing has happened to it', () => {
    const plan = withPurchases(
      purchase('fresh', 1, 's1', 1),
      purchase('ordered', 2, 's1', 1, { events: [purchaseEvent(1, 'ordered', TODAY)] }),
    );
    expect(purchaseRemovable(plan, 'fresh')).toBe(true);
    expect(purchaseRemovable(plan, 'ordered')).toBe(false);
    expect(purchaseRemovable(plan, 'gone')).toBe(false);
  });
});

// ── Checking before the host is asked ────────────────────────────────────────

const codes = (problems: PurchaseProblem[]) => problems.map((each) => each.code);

describe('a purchase, checked', () => {
  const draft: PurchaseDraft = {
    stageId: 's1',
    activityId: 'a2',
    name: 'Worktop',
    quantity: '3 m',
    supplier: 'Sample supplier',
    leadDays: 21,
    note: null,
  };

  it('passes when it fits', () => {
    expect(validatePurchaseDraft(PLAN, draft)).toEqual([]);
    expect(validatePurchaseDraft(PLAN, { ...draft, activityId: null, quantity: null })).toEqual([]);
    expect(validatePurchaseDraft(PLAN, { ...draft, leadDays: 0 })).toEqual([]);
    expect(validatePurchaseDraft(PLAN, { ...draft, leadDays: 365 })).toEqual([]);
    // Blank is none, as the host keeps it.
    expect(validatePurchaseDraft(PLAN, { ...draft, quantity: '  ', supplier: '' })).toEqual([]);
  });

  it('says every problem, in order, each with its key', () => {
    const problems = validatePurchaseDraft(PLAN, {
      id: 'gone',
      stageId: 'nowhere',
      activityId: 'missing',
      name: '   ',
      quantity: 'q'.repeat(61),
      supplier: 's'.repeat(121),
      leadDays: 366,
      note: 'n'.repeat(2_001),
    });
    expect(codes(problems)).toEqual([
      'unknown-purchase',
      'name-empty',
      'quantity-too-long',
      'supplier-too-long',
      'invalid-lead-days',
      'note-too-long',
      'unknown-stage',
      'unknown-activity',
    ]);
    for (const each of problems) expect(each.messageKey).toBe(PURCHASE_PROBLEM_KEYS[each.code]);
  });

  it('counts characters as the host does: trimmed, code points', () => {
    expect(validatePurchaseDraft(PLAN, { ...draft, name: `  ${'é'.repeat(200)}  ` })).toEqual([]);
    expect(codes(validatePurchaseDraft(PLAN, { ...draft, name: '🪵'.repeat(201) }))).toEqual([
      'name-too-long',
    ]);
    expect(
      validatePurchaseDraft(PLAN, { ...draft, quantity: '🪵'.repeat(60), note: 'n'.repeat(2_000) }),
    ).toEqual([]);
  });

  it('keeps a name, a quantity and a supplier to one line; a note may have several', () => {
    expect(
      codes(
        validatePurchaseDraft(PLAN, {
          ...draft,
          name: 'Two\nlines',
          quantity: 'a\tb',
          supplier: 'x\ny',
          note: 'One\nTwo',
        }),
      ),
    ).toEqual(['name-not-one-line', 'quantity-not-one-line', 'supplier-not-one-line']);
  });

  it('refuses a lead time that is not a whole number of days from 0 to 365', () => {
    for (const leadDays of [-1, 1.5, 366, Number.NaN]) {
      expect(codes(validatePurchaseDraft(PLAN, { ...draft, leadDays }))).toEqual([
        'invalid-lead-days',
      ]);
    }
  });

  it('refuses an activity of another stage, and knows the purchase it writes whole', () => {
    expect(codes(validatePurchaseDraft(PLAN, { ...draft, activityId: 'b1' }))).toEqual([
      'activity-of-another-stage',
    ]);
    const plan = withPurchases(purchase('p', 1, 's1', 1));
    expect(validatePurchaseDraft(plan, { ...draft, id: 'p' })).toEqual([]);
    expect(validatePurchaseDraft(plan, { ...draft, id: null })).toEqual([]);
  });

  it('keeps its lead time, stage and activity once anything has happened to it', () => {
    const terms = { stageId: 's1', activityId: 'a2', leadDays: 21 } as const;
    const ordered = purchase('ordered', 1, 's1', 21, {
      activityId: 'a2',
      events: [purchaseEvent(1, 'ordered', '2026-08-28')],
    });
    // An order that fell through is still something that happened.
    const fell = purchase('fell', 2, 's1', 21, {
      activityId: 'a2',
      events: [
        purchaseEvent(1, 'ordered', '2026-08-20'),
        purchaseEvent(2, 'cancelled', '2026-08-22'),
      ],
    });
    const fresh = purchase('fresh', 3, 's1', 21, { activityId: 'a2' });
    const plan = withPurchases(ordered, fell, fresh);
    const write = (id: string, change: Partial<PurchaseDraft>) =>
      validatePurchaseDraft(plan, { ...draft, ...terms, id, ...change });

    for (const id of ['ordered', 'fell']) {
      for (const change of [
        { leadDays: 30 },
        { stageId: 's2', activityId: null },
        { activityId: 'a1' },
        { activityId: null },
      ]) {
        const problems = write(id, change);
        expect(codes(problems)).toEqual(['frozen-after-order']);
        expect(problems[0]!.messageKey).toBe('purchases.problem.frozenAfterOrder');
      }
      // The name, the quantity, the supplier and the note stay editable.
      expect(
        write(id, { name: 'Oak worktop', quantity: '4 m', supplier: null, note: 'Matt' }),
      ).toEqual([]);
    }
    // With nothing happened yet, everything may change.
    expect(write('fresh', { leadDays: 30, stageId: 's2', activityId: 'b1' })).toEqual([]);
    expect(PURCHASE_MESSAGE_KEYS).toContain(PURCHASE_PROBLEM_KEYS['frozen-after-order']);
  });
});

describe('an event, checked', () => {
  const fresh = purchase('fresh', 1, 's1', 5);
  const open = purchase('open', 2, 's1', 5, {
    events: [purchaseEvent(1, 'ordered', '2026-08-28')],
  });
  const done = purchase('done', 3, 's1', 5, {
    events: [
      purchaseEvent(1, 'ordered', '2026-08-20'),
      purchaseEvent(2, 'delivered', '2026-08-25'),
    ],
  });
  const fell = purchase('fell', 4, 's1', 5, {
    events: [
      purchaseEvent(1, 'ordered', '2026-08-20'),
      purchaseEvent(2, 'cancelled', '2026-08-22'),
    ],
  });
  const plan = withPurchases(fresh, open, done, fell);
  const ask = (draft: Partial<PurchaseEventDraft>, today = TODAY) =>
    codes(
      validatePurchaseEvent(
        plan,
        { purchaseId: 'fresh', kind: 'ordered', day: TODAY, note: null, ...draft },
        today,
      ),
    );

  it('lets things happen in their order', () => {
    expect(ask({})).toEqual([]);
    expect(ask({ purchaseId: 'open', kind: 'delivered' })).toEqual([]);
    expect(ask({ purchaseId: 'open', kind: 'cancelled', note: 'Out of stock' })).toEqual([]);
    // An order that fell through is ordered again.
    expect(ask({ purchaseId: 'fell', kind: 'ordered' })).toEqual([]);
  });

  it('refuses what cannot happen next', () => {
    expect(ask({ purchaseId: 'open', kind: 'ordered' })).toEqual(['already-ordered']);
    expect(ask({ kind: 'delivered' })).toEqual(['not-ordered']);
    expect(ask({ kind: 'cancelled' })).toEqual(['not-ordered']);
    expect(ask({ purchaseId: 'fell', kind: 'delivered' })).toEqual(['not-ordered']);
    for (const kind of PURCHASE_EVENT_KINDS) {
      expect(ask({ purchaseId: 'done', kind })).toEqual(['already-delivered']);
    }
    expect(ask({ kind: 'returned' as never })).toEqual(['invalid-kind']);
  });

  it('refuses a day that is not a day, is still to come, or comes before the last event', () => {
    expect(ask({ day: '2026-02-30' })).toEqual(['invalid-day']);
    expect(ask({ day: '2026-09-02' })).toEqual(['day-in-future']);
    expect(ask({ purchaseId: 'open', kind: 'delivered', day: '2026-08-27' })).toEqual([
      'day-before-last-event',
    ]);
    // The same day as the last event is in order.
    expect(ask({ purchaseId: 'open', kind: 'delivered', day: '2026-08-28' })).toEqual([]);
  });

  it('refuses a note too long, and a purchase that is not on the record', () => {
    expect(ask({ note: 'n'.repeat(501) })).toEqual(['event-note-too-long']);
    expect(ask({ note: 'n'.repeat(500) })).toEqual([]);
    expect(ask({ purchaseId: 'gone' })).toEqual(['unknown-purchase']);
  });
});

// ── The words ────────────────────────────────────────────────────────────────

describe('the words', () => {
  it('has a key for every state, event, flag, figure and problem, each once, under purchases', () => {
    expect(Object.keys(PURCHASE_STATE_KEYS)).toEqual([...PURCHASE_STATES]);
    expect(Object.keys(PURCHASE_EVENT_KEYS)).toEqual([...PURCHASE_EVENT_KINDS]);
    expect(Object.keys(PURCHASE_FLAG_KEYS)).toEqual([
      'lateToOrder',
      'orderThisWeek',
      'lateToArrive',
      'arrivesAfterNeeded',
    ]);
    expect(new Set(PURCHASE_MESSAGE_KEYS).size).toBe(PURCHASE_MESSAGE_KEYS.length);
    expect(PURCHASE_MESSAGE_KEYS.every((key) => key.startsWith('purchases.'))).toBe(true);
    for (const key of Object.values(PURCHASE_PROBLEM_KEYS)) {
      expect(PURCHASE_MESSAGE_KEYS).toContain(key);
    }
  });

  it('keeps the host’s limits', () => {
    expect(PURCHASE_LIMITS).toEqual({
      name: 200,
      quantity: 60,
      supplier: 120,
      note: 2_000,
      eventNote: 500,
      leadDays: 365,
    });
  });
});
