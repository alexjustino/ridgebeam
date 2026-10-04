import { describe, expect, it } from 'vitest';

import {
  activity,
  changeDecision,
  changeOrder,
  decision,
  entry,
  finished,
  link,
  person,
  snapshot,
  stage,
  takeBaseline,
  worked,
} from './__fixtures__/plan';
import { isWorkingDay } from './calendar';
import { DELAY_CAUSE_KEYS, DELAY_CAUSES, delayLedger, partyKey, type DelayLedger } from './delay';
import type { DiaryEntry } from './diary';
import { traceable, type Figure } from './figure';
import { workingCalendarOf, type WorkSnapshot } from './plan';
import { schedule } from './schedule';

// The work starts on Tuesday 1 September 2026, Monday to Friday: 1–4, 7–11, 14–18 are working days.

const ask = (plan: WorkSnapshot, entries: readonly DiaryEntry[], today: string) =>
  delayLedger(plan, schedule(plan), entries, today);

/** Each line of the ledger as `basis|cause|party` → days. */
const linesOf = (ledger: DelayLedger) =>
  Object.fromEntries(ledger.entries.map((line) => [line.key, line.days]));

const sum = (rows: readonly { days: number }[]) => rows.reduce((total, row) => total + row.days, 0);

/** One stage, two chained activities, both answered for by p1: 1–3 then 4–7 September. */
const PLAN = snapshot({
  people: [person('p1', 'Sample tiler')],
  stages: [stage('s1', 1)],
  activities: [activity('a1', 's1', 1, 3, 'p1'), activity('a2', 's1', 2, 2, 'p1')],
  dependencies: [link('l1', 'a1', 'a2')],
});
const APPROVED: WorkSnapshot = { ...PLAN, baselines: [takeBaseline(PLAN, 1)] };

const START = entry(1, '2026-09-01', { done: [worked('a1')], present: ['p1'], weather: 'sun' });

/** The scenario of the slice: a decision waited for, a rainy day, a crew that did not come. */
const SCENARIO = [
  START,
  entry(2, '2026-09-02', { lostDay: true, lostCause: 'decision', weather: 'sun' }),
  entry(3, '2026-09-03', { lostDay: true, weather: 'rain' }),
  entry(4, '2026-09-04', { weather: 'sun' }),
  entry(5, '2026-09-07', { done: [worked('a1')], present: ['p1'] }),
];

describe('why it is late, day by day', () => {
  it('puts each day down to its cause, and says what the record does not explain', () => {
    const ledger = ask(APPROVED, SCENARIO, '2026-09-09');
    expect(ledger.status).toBe('late');
    // a1 runs until today (9th), a2 follows: 10–11 September, against the baseline's 7th.
    expect(ledger.forecast.finishDate).toBe('2026-09-11');
    expect(ledger.total).toBe(4);
    expect(linesOf(ledger)).toEqual({
      'stated|decision|owner': 1,
      'weather|weather|none': 1,
      'absence|absence|person:p1': 1,
    });
    expect(ledger.attributed).toBe(3);
    expect(ledger.unexplainedDays).toBe(1);
    expect(ledger.madeUpDays).toBe(0);
    const absence = ledger.entries.find((line) => line.basis === 'absence')!;
    expect(absence.party).toEqual({ kind: 'person', personId: 'p1', name: 'Sample tiler' });
    expect(absence.rows[0]).toMatchObject({ day: '2026-09-04', activityIds: ['a1'], seqs: [4] });
  });

  it('counts an approved change for the days its decision froze, on account of who asked', () => {
    // The approval applied the change: a2 now takes four days.
    const changed: WorkSnapshot = {
      ...APPROVED,
      activities: [activity('a1', 's1', 1, 3, 'p1'), activity('a2', 's1', 2, 4, 'p1')],
      changeOrders: [
        changeOrder('c1', 1, 's1', '2026-09-07', {
          decision: changeDecision('approved', '2026-09-08', { daysDelta: 2 }),
        }),
      ],
    };
    const ledger = ask(changed, SCENARIO, '2026-09-09');
    expect(ledger.total).toBe(6);
    expect(linesOf(ledger)).toEqual({
      'change|change|owner': 2,
      'stated|decision|owner': 1,
      'weather|weather|none': 1,
      'absence|absence|person:p1': 1,
    });
    expect(ledger.unexplainedDays).toBe(1);

    const { total, byCause, byParty } = ledger.figures!;
    expect(byCause.rows.map((row) => [row.key, row.days])).toEqual([
      ['cause:change', 2],
      ['cause:decision', 1],
      ['cause:weather', 1],
      ['cause:absence', 1],
      ['unexplained', 1],
    ]);
    expect(byParty.rows.map((row) => [row.key, row.days])).toEqual([
      ['party:owner', 3],
      ['party:person:p1', 1],
      ['party:none', 1],
      ['unexplained', 1],
    ]);
    for (const figure of [total, byCause, byParty] as Figure[]) {
      expect(traceable(figure)).toBe(true);
      expect(figure.value).toBe(6);
    }
    expect(sum(byCause.rows)).toBe(6);
    expect(sum(byParty.rows)).toBe(6);
    // Every row opens onto what it counted, each day or change once.
    const traced = byCause.rows.flatMap((row) => row.trace);
    expect(new Set(traced.map((row) => row.key)).size).toBe(traced.length);
    expect(sum(traced)).toBe(ledger.attributed);
    expect(byCause.rows[0]!.trace[0]).toMatchObject({ changeOrderId: 'c1', days: 2 });
  });

  it('does not count a change already in the baseline, declined, waiting, or not counted', () => {
    const changes = [
      changeOrder('before', 1, 's1', '2026-08-28', {
        decision: changeDecision('approved', '2026-08-30', { daysDelta: 3 }),
      }),
      changeOrder('declined', 2, 's1', '2026-09-02', {
        decision: changeDecision('declined', '2026-09-03', { daysDelta: 3 }),
      }),
      changeOrder('waiting', 3, 's1', '2026-09-02'),
      changeOrder('uncounted', 4, 's1', '2026-09-02', {
        decision: changeDecision('approved', '2026-09-03', { daysDelta: null }),
      }),
    ];
    const ledger = ask({ ...APPROVED, changeOrders: changes }, SCENARIO, '2026-09-09');
    expect(ledger.entries.some((line) => line.basis === 'change')).toBe(false);
  });

  it('puts a change down to the person or the other party who asked', () => {
    const changes = [
      changeOrder('c1', 1, 's1', '2026-09-02', {
        askedBy: 'person',
        askedByPersonId: 'p1',
        decision: changeDecision('approved', '2026-09-03', { daysDelta: 1 }),
      }),
      changeOrder('c2', 2, 's1', '2026-09-02', {
        askedBy: 'other',
        askedByName: ' Sample neighbour ',
        decision: changeDecision('approved', '2026-09-03', { daysDelta: 1 }),
      }),
    ];
    const ledger = ask({ ...APPROVED, changeOrders: changes }, [START], '2026-09-09');
    expect(ledger.entries.map((line) => line.party)).toEqual([
      { kind: 'person', personId: 'p1', name: 'Sample tiler' },
      { kind: 'other', name: 'Sample neighbour' },
    ]);
  });
});

describe('one cause per day, in priority order', () => {
  const late = (day2: Partial<DiaryEntry>, day3: Partial<DiaryEntry> | null = null) =>
    ask(
      APPROVED,
      [
        START,
        entry(2, '2026-09-02', day2),
        ...(day3 === null ? [] : [entry(3, '2026-09-03', day3)]),
      ],
      '2026-09-09',
    );

  it('takes a stated cause before the weather, with the person the entry names', () => {
    const ledger = late({
      lostDay: true,
      lostCause: 'material',
      lostPartyPersonId: 'p1',
      weather: 'storm',
    });
    expect(linesOf(ledger)).toEqual({ 'stated|material|person:p1': 1 });
  });

  it('shares one row between a stated and an inferred cause of the same name', () => {
    const ledger = late(
      { lostDay: true, lostCause: 'weather', weather: 'sun' },
      { weather: 'rain' },
    );
    expect(linesOf(ledger)).toEqual({ 'stated|weather|none': 1, 'weather|weather|none': 1 });
    const row = ledger.figures!.byCause.rows.find((each) => each.cause === 'weather')!;
    expect(row).toMatchObject({ days: 2, statedDays: 1, inferredDays: 1 });
    expect(row.bases).toEqual(['stated', 'weather']);
    expect(row.trace.map((each) => [each.day, each.stated])).toEqual([
      ['2026-09-02', true],
      ['2026-09-03', false],
    ]);
  });

  it('takes the weather before an absence on the same day', () => {
    expect(linesOf(late({ weather: 'rain' }))).toEqual({ 'weather|weather|none': 1 });
  });

  it('counts rain as weather when the day was marked lost, even with something done', () => {
    expect(linesOf(late({ weather: 'rain', lostDay: true, done: [worked('a1')] }))).toEqual({
      'weather|weather|none': 1,
    });
  });

  it('does not count rain on a day that was worked and not marked lost', () => {
    expect(linesOf(late({ weather: 'rain', done: [worked('a1')], present: ['p1'] }))).toEqual({});
  });

  it('puts a lost day with no cause and no bad weather down to no cause said, not weather', () => {
    const ledger = late({ lostDay: true, weather: 'sun' });
    expect(linesOf(ledger)).toEqual({ 'unstated|unstated|none': 1 });
    expect(ledger.entries[0]!.party).toBeNull();
    expect(DELAY_CAUSE_KEYS.unstated).toBe('delay.cause.unstated');
  });

  it('names the owner for a decision or an owner’s request, and nobody for no access', () => {
    expect(linesOf(late({ lostDay: true, lostCause: 'owner' }))).toEqual({
      'stated|owner|owner': 1,
    });
    expect(linesOf(late({ lostDay: true, lostCause: 'access' }))).toEqual({
      'stated|access|none': 1,
    });
    const gone = late({ lostDay: true, lostCause: 'other', lostPartyPersonId: 'gone' });
    expect(gone.entries[0]!.party).toEqual({ kind: 'person', personId: 'gone', name: null });
  });
});

describe('absence, and what is not absence', () => {
  const day2 = (parts: Partial<DiaryEntry> | null) =>
    linesOf(
      ask(
        APPROVED,
        [START, ...(parts === null ? [] : [entry(2, '2026-09-02', parts)])],
        '2026-09-09',
      ),
    );

  it('counts a day the responsible was away and nothing was done on the running activity', () => {
    expect(day2({ present: ['someone-else'] })).toEqual({ 'absence|absence|person:p1': 1 });
  });

  it('does not count a day nobody wrote about: unknown is not absent', () => {
    expect(day2(null)).toEqual({});
  });

  it('does not count a day the responsible was there, or the work was done', () => {
    expect(day2({ present: ['p1'] })).toEqual({});
    expect(day2({ done: [worked('a1')] })).toEqual({});
  });

  it('does not count an activity nobody answers for', () => {
    const nobody: WorkSnapshot = {
      ...APPROVED,
      activities: [activity('a1', 's1', 1, 3), activity('a2', 's1', 2, 2)],
    };
    expect(linesOf(ask(nobody, [START, entry(2, '2026-09-02', {})], '2026-09-09'))).toEqual({});
  });
});

describe('the critical chain', () => {
  // a1 1–2 September, three working days of lag, a2 8–9 September.
  const plan = snapshot({
    stages: [stage('s1', 1)],
    activities: [activity('a1', 's1', 1, 2), activity('a2', 's1', 2, 2)],
    dependencies: [link('l1', 'a1', 'a2', 3)],
  });
  const approved = { ...plan, baselines: [takeBaseline(plan, 1)] };

  it('counts a lost day only while a critical activity was running or due to start', () => {
    const entries = [
      entry(1, '2026-09-01', { done: [worked('a1')] }),
      entry(2, '2026-09-02', { done: [finished('a1')] }),
      // During the lag nothing critical runs, and nothing was due: the finish lost nothing.
      entry(3, '2026-09-03', { lostDay: true, lostCause: 'access' }),
      // a2 was due on the 8th and could not start: that day cost the finish.
      entry(4, '2026-09-08', { weather: 'rain' }),
      entry(5, '2026-09-09', { done: [worked('a2')] }),
    ];
    const ledger = ask(approved, entries, '2026-09-09');
    expect(ledger.total).toBe(1);
    expect(linesOf(ledger)).toEqual({ 'weather|weather|none': 1 });
    expect(ledger.entries[0]!.rows[0]).toMatchObject({ day: '2026-09-08', activityIds: ['a2'] });
    expect(ledger.unexplainedDays).toBe(0);
  });
});

describe('a decision made late', () => {
  // s1: a1 1–2 September; s2: b1 3–4 September. A decision of s2 with a lead of two working days:
  // its baseline deadline is the 1st.
  const plan = snapshot({
    stages: [stage('s1', 1), stage('s2', 2)],
    activities: [activity('a1', 's1', 1, 2), activity('b1', 's2', 1, 2)],
    dependencies: [link('l1', 'a1', 'b1')],
  });
  const withDecision = (madeAt: string) => ({
    ...plan,
    baselines: [takeBaseline(plan, 1)],
    decisions: [decision('d1', 's2', 1, 2, madeAt)],
  });
  const before = [
    entry(1, '2026-09-01', { done: [worked('a1')] }),
    entry(2, '2026-09-02', { done: [finished('a1')] }),
  ];

  it('costs the days from its deadline, capped at the days its stage started late', () => {
    // Made on the 4th: three working days late. The stage started on the 7th: two days late.
    const entries = [...before, entry(3, '2026-09-07', { done: [worked('b1')] })];
    const ledger = ask(withDecision('2026-09-04T10:00:00.000Z'), entries, '2026-09-07');
    expect(ledger.total).toBe(2);
    expect(linesOf(ledger)).toEqual({ 'decision|decision|owner': 2 });
    expect(ledger.entries[0]!.rows.map((row) => [row.day, row.decisionId])).toEqual([
      ['2026-09-02', 'd1'],
      ['2026-09-03', 'd1'],
    ]);
    expect(ledger.unexplainedDays).toBe(0);
  });

  it('costs nothing when its stage started on time', () => {
    // b1 started on the 3rd as planned, and is simply taking longer.
    const entries = [...before, entry(3, '2026-09-03', { done: [worked('b1')] })];
    const ledger = ask(withDecision('2026-09-04T10:00:00.000Z'), entries, '2026-09-08');
    expect(ledger.total).toBe(2);
    expect(linesOf(ledger)).toEqual({});
    expect(ledger.unexplainedDays).toBe(2);
  });

  it('costs nothing when it was made by its deadline', () => {
    const entries = [...before, entry(3, '2026-09-07', { done: [worked('b1')] })];
    const ledger = ask(withDecision('2026-09-01T10:00:00.000Z'), entries, '2026-09-07');
    expect(linesOf(ledger)).toEqual({});
    expect(ledger.unexplainedDays).toBe(2);
  });

  it('gives way to a stated cause on the same day, and says what was made up', () => {
    const entries = [
      ...before,
      entry(3, '2026-09-03', { lostDay: true, lostCause: 'material' }),
      entry(4, '2026-09-07', { done: [worked('b1')] }),
    ];
    const ledger = ask(withDecision('2026-09-04T10:00:00.000Z'), entries, '2026-09-07');
    expect(linesOf(ledger)).toEqual({ 'stated|material|none': 1, 'decision|decision|owner': 2 });
    expect(ledger.entries[1]!.rows.map((row) => row.day)).toEqual(['2026-09-02', '2026-09-04']);
    // Three days named, two lost: one was made up, and the figures still add up.
    expect(ledger).toMatchObject({ total: 2, attributed: 3, unexplainedDays: 0, madeUpDays: 1 });
    const { byCause, byParty } = ledger.figures!;
    expect(byCause.rows.at(-1)).toMatchObject({ key: 'made-up', cause: 'made-up', days: -1 });
    expect(byParty.rows.at(-1)).toMatchObject({ key: 'made-up', residual: 'made-up', days: -1 });
    expect(sum(byCause.rows)).toBe(2);
    expect(sum(byParty.rows)).toBe(2);
    expect(traceable(byCause)).toBe(true);
    expect(traceable(byParty)).toBe(true);
  });
});

describe('when there is nothing to put down to a cause', () => {
  it('says the work is ahead instead of inventing causes', () => {
    const plan = snapshot({
      stages: [stage('s1', 1)],
      activities: [activity('a', 's1', 1, 5), activity('b', 's1', 2, 2)],
      dependencies: [link('l1', 'a', 'b')],
    });
    const entries = [
      entry(1, '2026-09-01', { done: [worked('a')], lostDay: false }),
      entry(2, '2026-09-02', { done: [finished('a')] }),
      entry(3, '2026-09-03', { lostDay: true, lostCause: 'material' }),
    ];
    const ledger = ask({ ...plan, baselines: [takeBaseline(plan, 1)] }, entries, '2026-09-03');
    expect(ledger).toMatchObject({ status: 'ahead', total: -3, entries: [], unexplainedDays: 0 });
    const { total, byCause, byParty } = ledger.figures!;
    expect(total.value).toBe(-3);
    expect(traceable(total)).toBe(true);
    expect(byCause).toMatchObject({ value: 0, rows: [] });
    expect(byParty).toMatchObject({ value: 0, rows: [] });
  });

  it('says the work is on time', () => {
    const ledger = ask(APPROVED, [START], '2026-09-02');
    expect(ledger).toMatchObject({ status: 'on-time', total: 0, entries: [] });
  });

  it('needs an approved plan', () => {
    const ledger = ask(PLAN, SCENARIO, '2026-09-09');
    expect(ledger).toMatchObject({
      status: 'needs-approval',
      total: null,
      baselineNumber: null,
      figures: null,
    });
  });

  it('needs a forecast', () => {
    expect(ask(APPROVED, SCENARIO, 'today')).toMatchObject({
      status: 'no-forecast',
      figures: null,
    });
  });
});

describe('what every figure can show', () => {
  it('opens every row onto working days and changes only, each once', () => {
    const ledger = ask(APPROVED, SCENARIO, '2026-09-09');
    const calendar = workingCalendarOf(APPROVED)!;
    const days = ledger.entries.flatMap((line) => line.rows);
    expect(days.every((row) => row.day !== null && isWorkingDay(calendar, row.day))).toBe(true);
    expect(new Set(days.map((row) => row.day)).size).toBe(days.length);
    expect(traceable(ledger.figures!.total)).toBe(true);
    expect(sum(ledger.figures!.byCause.rows)).toBe(ledger.total);
  });

  it('lists every cause it knows, with a key for each and for what is left', () => {
    for (const cause of DELAY_CAUSES) expect(DELAY_CAUSE_KEYS[cause]).toMatch(/^delay\.cause\./);
    expect(partyKey(null)).toBe('none');
    expect(partyKey({ kind: 'owner' })).toBe('owner');
  });
});
