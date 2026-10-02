import { describe, expect, it } from 'vitest';

import {
  activity,
  decision,
  entry,
  finished,
  link,
  person,
  snapshot,
  stage,
} from '../__fixtures__/plan';
import type { DiaryEntry } from '../diary';
import { traceable, type Figure, type ReportRow } from '../figure';
import { MILESTONE_LABEL_KEYS } from '../milestones';
import type {
  Check,
  CheckAnswer,
  Commitment,
  Milestone,
  MilestoneTrigger,
  Payment,
  WorkSnapshot,
} from '../plan';
import { schedule } from '../schedule';
import {
  LOOKAHEAD_DAYS,
  LOOKAHEAD_GATE_KEYS,
  LOOKAHEAD_LABEL_KEYS,
  LOOKAHEAD_MESSAGE_KEYS,
  lookahead,
  type Lookahead,
} from './lookahead';

// ── Builders ─────────────────────────────────────────────────────────────────

const milestone = (
  id: string,
  position: number,
  shareBp: number,
  trigger: MilestoneTrigger,
  activityId: string | null = null,
): Milestone => ({ id, position, label: `Milestone ${id}`, shareBp, trigger, activityId });

const commitment = (
  id: string,
  stageId: string,
  amountCents: number,
  milestones: Milestone[],
  parts: Partial<Commitment> = {},
): Commitment => ({
  id,
  stageId,
  personId: null,
  label: `Commitment ${id}`,
  amountCents,
  agreedOn: '2026-09-20',
  documentHash: null,
  milestones,
  ...parts,
});

const payment = (seq: number, commitmentId: string, amountCents: number, day: string): Payment => ({
  id: `payment-${seq}`,
  seq,
  day,
  personId: null,
  stageId: 'walls',
  commitmentId,
  amountCents,
  whatFor: `Payment ${seq}`,
  receiptHash: null,
  reversesSeq: null,
  authorName: 'Sample author',
  createdAt: `${day}T12:00:00.000Z`,
});

const check = (id: string, stageId: string, gate: 'start' | 'close', position: number): Check => ({
  id,
  stageId,
  gate,
  position,
  name: `Check ${id}`,
  needsPhoto: false,
});

const answer = (checkId: string, value: 'yes' | 'no' | 'na', seq = 1): CheckAnswer => ({
  id: `answer-${checkId}-${seq}`,
  checkId,
  seq,
  answer: value,
  reason: value === 'na' ? 'Does not apply' : null,
  photoHash: null,
  authorName: 'Sample author',
  answeredAt: '2026-09-25T12:00:00.000Z',
});

/**
 * From Monday 28 September 2026, Monday to Friday, with a holiday on Monday 12 October. Today is
 * Monday 5 October: the window is 5 – 18 October, and day 14 is Monday 19 October.
 *
 * Working days: 0 = 28 Sep … 4 = 2 Oct, 5 = 5 Oct, 6 = 6 Oct … 9 = 9 Oct, (12 Oct a holiday),
 * 10 = 13 Oct, 11 = 14 Oct, 12 = 15 Oct, 13 = 16 Oct, 14 = 19 Oct, 15 = 20 Oct … 20 = 27 Oct.
 *
 * - Walls (started): past (0–1), early (0–5, ends on day 0 of the window), cleanup (0–5, but the
 *   diary finished it on 2 October).
 * - Tiles (planned): mid (6–8, after early), span (9–11, over the holiday, after mid), longrun
 *   (9–20, after mid, beyond the window).
 * - Paint (planned): late (14–15: span, then 2 days' lag), starting on day 14.
 * - Roof (closed): roofwork (0–7), running into the window, but its stage is done.
 */
const TODAY = '2026-10-05';

const WORK: WorkSnapshot = snapshot({
  work: { ...snapshot().work, startDate: '2026-09-28' },
  holidays: [{ date: '2026-10-12', name: 'Sample holiday' }],
  people: [
    person('p1', 'Sample mason'),
    person('p2', 'Sample tiler'),
    person('p4', 'Sample painter'),
    person('p5', 'Sample roofer', { stageIds: ['roof'] }),
    person('p6', 'Sample foreman', { stageIds: ['walls'] }),
  ],
  stages: [
    { ...stage('walls', 1, 'Walls'), startedAt: '2026-09-28T08:00:00.000Z' },
    stage('tiles', 2, 'Tiles'),
    stage('paint', 3, 'Paint'),
    {
      ...stage('roof', 4, 'Roof'),
      startedAt: '2026-09-28T08:00:00.000Z',
      closedAt: '2026-10-01T08:00:00.000Z',
    },
  ],
  activities: [
    activity('past', 'walls', 1, 2),
    activity('early', 'walls', 2, 6, 'p1'),
    activity('cleanup', 'walls', 3, 6, 'p1'),
    activity('mid', 'tiles', 1, 3, 'p2'),
    activity('span', 'tiles', 2, 3),
    activity('longrun', 'tiles', 3, 12, 'ghost'),
    activity('late', 'paint', 1, 2, 'p4'),
    activity('roofwork', 'roof', 1, 8, 'p5'),
  ],
  dependencies: [
    link('l1', 'early', 'mid'),
    link('l2', 'mid', 'span'),
    link('l3', 'mid', 'longrun'),
    link('l4', 'span', 'late', 2),
  ],
  decisions: [
    decision('d1', 'tiles', 1, 3),
    decision('d5', 'tiles', 2, 0),
    decision('made', 'tiles', 3, 0, '2026-09-30T12:00:00.000Z'),
    decision('d2', 'paint', 1, 2),
    decision('d3', 'paint', 2, 0),
    decision('d6', 'roof', 1, 1),
  ],
  checks: [
    check('w-start', 'walls', 'start', 1),
    check('w-close', 'walls', 'close', 1),
    check('t1', 'tiles', 'start', 1),
    check('t2', 'tiles', 'start', 2),
    check('t3', 'tiles', 'start', 3),
    check('t-close', 'tiles', 'close', 1),
    check('r-close', 'roof', 'close', 1),
  ],
  checkAnswers: [answer('w-start', 'yes'), answer('t1', 'yes'), answer('t3', 'no')],
  commitments: [
    commitment('k1', 'walls', 1_000_00, [
      milestone('m1', 1, 2_000, 'advance'),
      milestone('m2', 2, 8_000, 'stage_closed'),
    ]),
    commitment('k2', 'tiles', 1_000_00, [
      milestone('m3', 1, 3_000, 'stage_started'),
      milestone('m4', 2, 4_000, 'activity_finished', 'span'),
      milestone('m5', 3, 3_000, 'stage_closed'),
    ]),
    commitment('k3', 'paint', 500_00, [milestone('m6', 1, 10_000, 'advance')], {
      agreedOn: '2026-10-08',
      personId: 'p4',
    }),
    commitment('k4', 'roof', 300_00, [milestone('m7', 1, 10_000, 'activity_finished', 'roofwork')]),
    commitment('k5', 'walls', 50_00, []),
    commitment('k6', 'walls', 100_00, [milestone('m8', 1, 10_000, 'activity_finished', 'past')]),
  ],
  payments: [payment(1, 'k1', 200_00, '2026-09-20'), payment(2, 'k2', 500_00, '2026-09-30')],
});

const ENTRIES: DiaryEntry[] = [
  entry(1, '2026-09-29', { done: [finished('past')] }),
  entry(2, '2026-10-02', { done: [finished('cleanup')] }),
];

const look = (
  plan: WorkSnapshot = WORK,
  entries: readonly DiaryEntry[] = ENTRIES,
  today = TODAY,
  days?: number,
): Lookahead => lookahead(plan, schedule(plan), entries, today, days);

const figuresOf = (report: Lookahead): Array<Figure<ReportRow>> => [
  report.starting,
  report.running,
  report.people,
  report.decisions,
  report.gates,
  report.payments.fallingDue,
  report.payments.dueNow,
];

const ids = (figure: Figure<ReportRow>): Array<string | null> =>
  figure.rows.map((row) => row.itemId);

// ── The window ───────────────────────────────────────────────────────────────

describe('the window', () => {
  const report = look();

  it('is fourteen calendar days from today, today included', () => {
    expect(LOOKAHEAD_DAYS).toBe(14);
    expect(report.today).toBe(TODAY);
    expect(report.window.from).toBe('2026-10-05');
    expect(report.window.to).toBe('2026-10-18');
    expect(report.window.days).toHaveLength(14);
    expect(report.window.days[0]!.date).toBe('2026-10-05');
    expect(report.window.days[13]!.date).toBe('2026-10-18');
    expect(report.placed).toBe(true);
  });

  it('says of each day whether the site works it, and which is a holiday', () => {
    const byDate = new Map(report.window.days.map((day) => [day.date, day]));
    expect(byDate.get('2026-10-05')).toEqual({ date: '2026-10-05', working: true, holiday: false });
    expect(byDate.get('2026-10-10')).toEqual({
      date: '2026-10-10',
      working: false,
      holiday: false,
    });
    expect(byDate.get('2026-10-12')).toEqual({ date: '2026-10-12', working: false, holiday: true });
    expect(report.window.days.filter((day) => day.working).length).toBe(9);
  });

  it('can be shorter, down to today alone', () => {
    const one = look(WORK, ENTRIES, TODAY, 1);
    expect(one.window).toEqual({
      from: TODAY,
      to: TODAY,
      days: [{ date: TODAY, working: true, holiday: false }],
    });
    expect(ids(one.running)).toEqual(['early']);
    expect(ids(one.starting)).toEqual([]);
  });

  it('refuses a today that is not a day, and a length that is not a whole number from 1', () => {
    expect(() => look(WORK, ENTRIES, '2026-02-30')).toThrow(RangeError);
    expect(() => look(WORK, ENTRIES, TODAY, 0)).toThrow(RangeError);
    expect(() => look(WORK, ENTRIES, TODAY, 1.5)).toThrow(RangeError);
  });

  it('makes every figure say what its rows say', () => {
    for (const figure of figuresOf(report)) expect(traceable(figure)).toBe(true);
  });
});

// ── Starting and running ─────────────────────────────────────────────────────

describe('what starts and what runs', () => {
  const report = look();

  it('lists what starts in the window, by start, then in breakdown order', () => {
    expect(report.starting.label).toBe(LOOKAHEAD_LABEL_KEYS.starting);
    expect(ids(report.starting)).toEqual(['mid', 'span', 'longrun']);
    expect(report.starting.value).toBe(3);
    expect(report.starting.rows[0]).toEqual({
      key: 'activity:mid',
      itemId: 'mid',
      title: 'Activity mid',
      day: '2026-10-06',
      minutes: 0,
      activityId: 'mid',
      stageId: 'tiles',
      stageName: 'Tiles',
      number: '2.1',
      start: '2026-10-06',
      finish: '2026-10-08',
      responsibleId: 'p2',
      responsibleName: 'Sample tiler',
      critical: true,
    });
  });

  it('says who answers for each, and nobody when nobody does or the person is gone', () => {
    const [, span, longrun] = report.starting.rows;
    expect(span!.responsibleId).toBeNull();
    expect(span!.responsibleName).toBeNull();
    expect(longrun!.responsibleId).toBe('ghost');
    expect(longrun!.responsibleName).toBeNull();
    expect(span!.critical).toBe(false);
    expect(span!.finish).toBe('2026-10-14');
  });

  it('counts an activity ending on day 0 as running, and one starting on day 14 as outside', () => {
    expect(report.running.label).toBe(LOOKAHEAD_LABEL_KEYS.running);
    expect(ids(report.running)).toEqual(['early']);
    expect(report.running.rows[0]!.finish).toBe(TODAY);
    expect(schedule(WORK).dates.get('late')!.start).toBe('2026-10-19');
    expect([...ids(report.starting), ...ids(report.running)]).not.toContain('late');
  });

  it('leaves out what the diary finished, and everything of a closed stage', () => {
    const scheduled = schedule(WORK);
    expect(scheduled.dates.get('cleanup')!.finish).toBe(TODAY);
    expect(scheduled.dates.get('roofwork')!.finish).toBe('2026-10-07');
    const listed = [...ids(report.starting), ...ids(report.running)];
    expect(listed).not.toContain('cleanup');
    expect(listed).not.toContain('roofwork');
    expect(listed).not.toContain('past');
  });

  it('still lists an activity whose finish the diary dates after today', () => {
    const later = look(WORK, [...ENTRIES, entry(3, '2026-10-09', { done: [finished('mid')] })]);
    expect(ids(later.starting)).toContain('mid');
  });
});

// ── The bars ─────────────────────────────────────────────────────────────────

describe('the Gantt of the window', () => {
  it('draws what starts or runs, in breakdown order, cut at the window and over the holiday', () => {
    const { bars } = look();
    expect(bars.map((bar) => bar.activityId)).toEqual(['early', 'mid', 'span', 'longrun']);
    expect(bars[0]).toEqual({
      activityId: 'early',
      number: '1.2',
      name: 'Activity early',
      stageId: 'walls',
      stageName: 'Walls',
      start: 0,
      length: 1,
      critical: true,
      startsBefore: true,
      endsAfter: false,
    });
    expect(bars[1]).toMatchObject({ start: 1, length: 3, startsBefore: false, endsAfter: false });
    // 9 October to 14 October: across the weekend and the holiday, every calendar day a column.
    expect(bars[2]).toMatchObject({ start: 4, length: 6, critical: false });
    expect(bars[3]).toMatchObject({ start: 4, length: 10, critical: true, endsAfter: true });
  });
});

// ── People ───────────────────────────────────────────────────────────────────

describe('who is expected', () => {
  it('is whoever answers for what starts or runs, and whoever is on a started stage', () => {
    const report = look();
    expect(report.people.label).toBe(LOOKAHEAD_LABEL_KEYS.people);
    expect(report.people.id).toBe('lookahead-people');
    expect(report.people.rows.map((row) => [row.personId, row.activityIds, row.stageIds])).toEqual([
      ['p6', [], ['walls']],
      ['p1', ['early'], []],
      ['p2', ['mid'], []],
    ]);
    // The painter starts on day 14; the roofer's stage is closed; cleanup is finished.
    expect(report.people.rows.map((row) => row.personId)).not.toContain('p4');
    expect(report.people.rows.map((row) => row.personId)).not.toContain('p5');
  });
});

// ── Decisions ────────────────────────────────────────────────────────────────

describe('what to decide', () => {
  const report = look();

  it('lists the overdue and those due in the window, most urgent first, with the lead time', () => {
    expect(report.decisions.label).toBe(LOOKAHEAD_LABEL_KEYS.decisions);
    expect(ids(report.decisions)).toEqual(['d1', 'd5', 'd2']);
    expect(report.decisions.rows[0]).toEqual({
      key: 'decision:d1',
      itemId: 'd1',
      title: 'Decision d1',
      day: '2026-10-01',
      minutes: 0,
      decisionId: 'd1',
      status: 'overdue',
      deadline: '2026-10-01',
      daysLeft: -2,
      stageId: 'tiles',
      stageName: 'Tiles',
      leadTimeDays: 3,
      neededBy: '2026-10-06',
    });
    expect(report.decisions.rows[1]).toMatchObject({
      status: 'due',
      deadline: '2026-10-06',
      leadTimeDays: 0,
      neededBy: '2026-10-06',
    });
    expect(report.decisions.rows[2]).toMatchObject({
      status: 'due',
      deadline: '2026-10-15',
      leadTimeDays: 2,
      neededBy: '2026-10-19',
      stageName: 'Paint',
    });
  });

  it('leaves out a made decision, one due after the window and one of a closed stage', () => {
    // d3's deadline is 19 October, day 14; d6's stage is closed, though it would be overdue.
    expect(ids(report.decisions)).not.toContain('made');
    expect(ids(report.decisions)).not.toContain('d3');
    expect(ids(report.decisions)).not.toContain('d6');
  });
});

// ── Gates ────────────────────────────────────────────────────────────────────

describe('the gates coming up', () => {
  const report = look();

  it('lists a close gate of a stage ending in the window, and a start gate of one starting', () => {
    expect(report.gates.label).toBe(LOOKAHEAD_LABEL_KEYS.gates);
    expect(report.gates.rows.map((row) => row.key)).toEqual([
      'gate:walls:close',
      'gate:tiles:start',
    ]);
    const [close, start] = report.gates.rows;
    expect(close).toMatchObject({
      itemId: 'walls',
      title: 'Walls',
      day: '2026-10-05',
      stageId: 'walls',
      gate: 'close',
      passed: false,
      checks: 1,
      messageKey: LOOKAHEAD_GATE_KEYS.close,
    });
    expect(close!.holding.map((item) => item.check.id)).toEqual(['w-close']);
    expect(start).toMatchObject({
      day: '2026-10-06',
      gate: 'start',
      passed: false,
      checks: 3,
      messageKey: LOOKAHEAD_GATE_KEYS.start,
    });
    // The unanswered item, and the one answered no, in position order.
    expect(start!.holding.map((item) => [item.check.id, item.latest?.answer ?? null])).toEqual([
      ['t2', null],
      ['t3', 'no'],
    ]);
  });

  it('leaves out a started stage’s start gate, gates outside the window, and a closed stage', () => {
    const keys = report.gates.rows.map((row) => row.key);
    expect(keys).not.toContain('gate:walls:start');
    expect(keys).not.toContain('gate:tiles:close');
    expect(keys).not.toContain('gate:paint:start');
    expect(keys).not.toContain('gate:roof:close');
  });

  it('lists a gate already passed with nothing holding it, and start before close on one day', () => {
    const plan = snapshot({
      work: { ...snapshot().work, startDate: TODAY },
      stages: [stage('one', 1, 'One')],
      activities: [activity('a', 'one', 1, 1)],
      checks: [check('c', 'one', 'start', 1)],
      checkAnswers: [answer('c', 'yes')],
    });
    const gates = look(plan, []).gates.rows;
    expect(gates.map((row) => [row.gate, row.day, row.passed, row.checks])).toEqual([
      ['start', TODAY, true, 1],
      ['close', TODAY, true, 0],
    ]);
    expect(gates.every((row) => row.holding.length === 0)).toBe(true);
  });
});

// ── Payments ─────────────────────────────────────────────────────────────────

describe('the payments', () => {
  const report = look();

  it('lists what falls due by a fact the schedule expects in the window, by day', () => {
    const { fallingDue } = report.payments;
    expect(fallingDue.label).toBe(LOOKAHEAD_LABEL_KEYS.fallingDue);
    expect(fallingDue.unit).toBe('money');
    expect(
      fallingDue.rows.map((row) => [
        row.milestoneId,
        row.trigger,
        row.day,
        row.milestoneCents,
        row.coveredCents,
        row.amountCents,
      ]),
    ).toEqual([
      // The walls close when their last activity finishes, on day 0.
      ['m2', 'stage_closed', '2026-10-05', 800_00, 0, 800_00],
      // The tiles start on 6 October; paid ahead, R$ 500 covers this and part of the next.
      ['m3', 'stage_started', '2026-10-06', 300_00, 300_00, 0],
      // An advance agreed for a day in the window.
      ['m6', 'advance', '2026-10-08', 500_00, 0, 500_00],
      ['m4', 'activity_finished', '2026-10-14', 400_00, 200_00, 200_00],
    ]);
    expect(fallingDue.value).toBe(1_500_00);
    expect(fallingDue.rows[2]).toMatchObject({
      key: 'milestone:m6',
      itemId: 'm6',
      title: 'Milestone m6',
      commitmentId: 'k3',
      commitmentLabel: 'Commitment k3',
      stageId: 'paint',
      personId: 'p4',
      shareBp: 10_000,
      target: { kind: 'commitment', id: 'k3', name: 'Commitment k3' },
    });
    expect(fallingDue.rows[3]!.target).toEqual({
      kind: 'activity',
      id: 'span',
      name: 'Activity span',
    });
  });

  it('leaves out what is earned, what falls outside the window, and a closed stage', () => {
    const milestones = report.payments.fallingDue.rows.map((row) => row.milestoneId);
    // m1 and m8 are earned; m5 waits for 27 October; m7's stage is closed; k5 has no plan.
    for (const id of ['m1', 'm8', 'm5', 'm7']) expect(milestones).not.toContain(id);
  });

  it('says what is earned and not paid now', () => {
    const { dueNow } = report.payments;
    expect(dueNow.label).toBe(MILESTONE_LABEL_KEYS.dueNow);
    expect(dueNow.rows.map((row) => [row.commitmentId, row.amountCents])).toEqual([['k6', 100_00]]);
    expect(dueNow.value).toBe(100_00);
  });
});

// ── Nothing placed ───────────────────────────────────────────────────────────

describe('a schedule that places nothing', () => {
  it('says so, and has nothing of the schedule to show; what is due now is still said', () => {
    const plan: WorkSnapshot = {
      ...WORK,
      calendar: { workingDays: '0000000', hoursPerDay: 8 },
      commitments: [
        commitment('k1', 'tiles', 1_000_00, [
          milestone('a', 1, 2_000, 'advance'),
          milestone('b', 2, 2_000, 'stage_started'),
          milestone('c', 3, 3_000, 'activity_finished', 'mid'),
          milestone('d', 4, 3_000, 'stage_closed'),
        ]),
      ],
      payments: [],
    };
    const report = look(plan);
    expect(report.placed).toBe(false);
    expect(report.window.days[0]).toEqual({ date: TODAY, working: null, holiday: false });
    expect(report.bars).toEqual([]);
    for (const figure of [
      report.starting,
      report.running,
      report.decisions,
      report.gates,
      report.payments.fallingDue,
    ]) {
      expect(figure.rows).toEqual([]);
    }
    // The foreman is still put on a started stage.
    expect(report.people.rows.map((row) => row.personId)).toEqual(['p6']);
    expect(report.payments.dueNow.value).toBe(200_00);
    for (const figure of figuresOf(report)) expect(traceable(figure)).toBe(true);
  });
});

// ── Message keys ─────────────────────────────────────────────────────────────

describe('message keys', () => {
  it('are each once, all under reports.lookahead', () => {
    expect(new Set(LOOKAHEAD_MESSAGE_KEYS).size).toBe(LOOKAHEAD_MESSAGE_KEYS.length);
    expect(LOOKAHEAD_MESSAGE_KEYS).toHaveLength(8);
    for (const key of LOOKAHEAD_MESSAGE_KEYS)
      expect(key.startsWith('reports.lookahead.')).toBe(true);
  });
});
