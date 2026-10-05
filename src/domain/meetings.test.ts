import { describe, expect, it } from 'vitest';

import {
  actionClosure,
  activity,
  changeOrder,
  decision,
  entry,
  link,
  meeting,
  meetingAction,
  person,
  snag,
  snagClosure,
  snapshot,
  stage,
  takeBaseline,
  worked,
} from './__fixtures__/plan';
import { changeOrderRows, waitsTooLong } from './changes';
import { DELAY_CAUSE_KEYS, delayLedger } from './delay';
import type { DiaryEntry } from './diary';
import { traceable } from './figure';
import {
  AGENDA_DELAY_CAUSES,
  AGENDA_ITEM_KEYS,
  AGENDA_SECTION_KEYS,
  AGENDA_SECTION_KINDS,
  AGENDA_SECTIONS,
  MEETING_AGENDA_KEYS,
  MEETING_ITEM_KIND_KEYS,
  MEETING_ITEM_KINDS,
  MEETING_LABEL_KEYS,
  MEETING_LIMITS,
  MEETING_MESSAGE_KEYS,
  MEETING_PROBLEM_KEYS,
  lastMeeting,
  meetingAgenda,
  meetingSummary,
  meetingsInOrder,
  nextMeetingNumber,
  openActions,
  validateActionClosure,
  validateMinutes,
  whoOf,
  type Agenda,
  type AgendaItem,
  type AgendaSectionId,
  type MinutesDraft,
} from './meetings';
import type { Check, Commitment, MeetingItem, WorkSnapshot } from './plan';
import { LOOKAHEAD_GATE_KEYS, lookahead } from './reports/lookahead';
import { runway } from './runway';
import { schedule } from './schedule';
import { snagRows } from './snags';

// ── Builders. Nothing in them is a real place, person or brand. ──────────────
//
// The work starts on Tuesday 1 September 2026, Monday to Friday. Scheduled: a1 1–7 September, a2
// 8–10, b1 11–16 (stage s2 starts on the 11th). Today is Wednesday 9 September; the window of the
// next two weeks runs to Tuesday 22.

const TODAY = '2026-09-09';

const ask = (plan: WorkSnapshot, today = TODAY, entries: readonly DiaryEntry[] = []): Agenda =>
  meetingAgenda(plan, schedule(plan), entries, today);

const item = (kind: MeetingItem['kind'], refId: string | null, position = 1): MeetingItem => ({
  position,
  kind,
  refId,
  title: `Item ${refId ?? kind}`,
  note: null,
  outcome: null,
});

const section = (agenda: Agenda, id: AgendaSectionId): readonly AgendaItem[] =>
  agenda.sections.find((each) => each.id === id)?.items ?? [];

const refs = (agenda: Agenda, id: AgendaSectionId) => section(agenda, id).map((each) => each.refId);

const startCheck: Check = {
  id: 'check-s2-start',
  stageId: 's2',
  gate: 'start',
  position: 1,
  name: 'Sample check',
  needsPhoto: false,
};

/** 1 000.00 on s1 with the tiler: an advance earned, a2's finish falling due, a retention held. */
const contract: Commitment = {
  id: 'k1',
  stageId: 's1',
  personId: 'p1',
  label: 'Sample contract',
  amountCents: 1_000_00,
  agreedOn: '2026-08-25',
  documentHash: null,
  milestones: [
    {
      id: 'm-adv',
      position: 1,
      label: 'Advance',
      shareBp: 3_000,
      trigger: 'advance',
      activityId: null,
    },
    {
      id: 'm-a2',
      position: 2,
      label: 'Walls finished',
      shareBp: 4_000,
      trigger: 'activity_finished',
      activityId: 'a2',
    },
    {
      id: 'm-ret',
      position: 3,
      label: 'Retention',
      shareBp: 3_000,
      trigger: 'retention',
      activityId: null,
    },
  ],
};

const PLAN = snapshot({
  people: [person('p1', 'Sample tiler'), person('p2', 'Sample painter')],
  stages: [
    { ...stage('s1', 1, 'Walls'), startedAt: '2026-09-01T08:00:00.000Z' },
    stage('s2', 2, 'Painting'),
  ],
  activities: [
    activity('a1', 's1', 1, 5, 'p1'),
    activity('a2', 's1', 2, 3, 'p1'),
    activity('b1', 's2', 1, 4, 'p2'),
  ],
  dependencies: [link('l1', 'a1', 'a2'), link('l2', 'a2', 'b1')],
  checks: [startCheck],
});

/** Everything the agenda reads, and one meeting held on Friday 4 September. */
const FULL: WorkSnapshot = {
  ...PLAN,
  baselines: [takeBaseline(PLAN, 1)],
  decisions: [decision('d1', 's2', 1, 5), decision('d2', 's2', 2, 1), decision('d3', 's2', 3, 0)],
  changeOrders: [
    changeOrder('c1', 1, 's2', '2026-09-01'),
    changeOrder('c2', 2, 's2', '2026-09-08'),
  ],
  snags: [
    snag('n1', 1, 's1', { raisedOn: '2026-09-02', dueOn: '2026-09-05', personId: 'p1' }),
    snag('n2', 2, 's2', { raisedOn: '2026-09-08' }),
    snag('n3', 3, 's2', { raisedOn: '2026-09-03', dueOn: '2026-09-08' }),
    snag('n4', 4, 's2', {
      raisedOn: '2026-09-03',
      closure: snagClosure('withdrawn', '2026-09-04'),
    }),
  ],
  commitments: [contract],
  meetings: [
    meeting('mt1', 1, '2026-09-04', {
      attendees: [{ position: 1, personId: 'p1', name: null }],
      items: [
        item('decision', 'd1', 1),
        item('change', 'c1', 2),
        item('snag', 'n1', 3),
        item('payment', 'k1', 4),
        item('delay', null, 5),
        item('gate', 's2:start', 6),
      ],
      actions: [
        meetingAction('x1', 'mt1', 1, { personId: 'p1', dueOn: '2026-09-08' }),
        meetingAction('x2', 'mt1', 2, {
          name: 'Sample architect',
          closure: actionClosure('done', '2026-09-07'),
        }),
        meetingAction('x3', 'mt1', 3),
      ],
    }),
  ],
};

/** a1 worked on the first day, then two days lost: the work is late against baseline 1. */
const LATE: DiaryEntry[] = [
  entry(1, '2026-09-01', { done: [worked('a1')], present: ['p1'], weather: 'sun' }),
  entry(2, '2026-09-02', { lostDay: true, lostCause: 'decision', weather: 'sun' }),
  entry(3, '2026-09-03', { lostDay: true, weather: 'rain' }),
];

// ── The record, read ─────────────────────────────────────────────────────────

describe('the meetings on the record', () => {
  it('are read by number, the last is the highest, and the next takes one more', () => {
    const plan = snapshot({
      meetings: [meeting('b', 2, '2026-09-11'), meeting('a', 1, '2026-09-04')],
    });
    expect(meetingsInOrder(plan).map((each) => each.id)).toEqual(['a', 'b']);
    expect(lastMeeting(plan)?.id).toBe('b');
    expect(nextMeetingNumber(plan)).toBe(3);
    expect(lastMeeting(snapshot())).toBeNull();
    expect(nextMeetingNumber(snapshot())).toBe(1);
  });

  it('names who: the person of the plan, the name typed, or nobody', () => {
    expect(whoOf(FULL, 'p1', null)).toBe('Sample tiler');
    expect(whoOf(FULL, null, 'Sample architect')).toBe('Sample architect');
    expect(whoOf(FULL, null, null)).toBeNull();
    expect(whoOf(FULL, 'gone', null)).toBeNull();
  });
});

describe('the open actions', () => {
  it('are the actions with no closure, oldest first, the overdue ones marked', () => {
    const rows = openActions(FULL, TODAY);
    expect(rows.map((row) => row.actionId)).toEqual(['x1', 'x3']);
    expect(rows[0]).toMatchObject({
      meetingId: 'mt1',
      meetingNumber: 1,
      raisedOn: '2026-09-04',
      who: 'Sample tiler',
      dueOn: '2026-09-08',
      overdue: true,
      overdueDays: 1,
    });
    expect(rows[1]).toMatchObject({ who: null, dueOn: null, overdue: false, overdueDays: null });
  });

  it('is not overdue on its own day, and nothing is overdue on a today that is not a day', () => {
    expect(openActions(FULL, '2026-09-08')[0]!.overdue).toBe(false);
    expect(openActions(FULL, 'not a day').every((row) => !row.overdue)).toBe(true);
  });

  it('lists an older meeting’s actions before a later one’s, whatever the order on the record', () => {
    const plan = snapshot({
      meetings: [
        meeting('late', 2, '2026-09-11', { actions: [meetingAction('y1', 'late', 1)] }),
        meeting('early', 1, '2026-09-04', {
          actions: [meetingAction('x2', 'early', 2), meetingAction('x1', 'early', 1)],
        }),
      ],
    });
    expect(openActions(plan, TODAY).map((row) => row.actionId)).toEqual(['x1', 'x2', 'y1']);
  });
});

describe('the meeting summary', () => {
  it('says the last meeting’s day, the actions open and on whom, each a figure with its rows', () => {
    const summary = meetingSummary(FULL, TODAY);
    expect(summary.held).toBe(1);
    expect(summary.last).toEqual({
      meetingId: 'mt1',
      number: 1,
      heldOn: '2026-09-04',
      attendees: 1,
      actions: 3,
    });
    expect(summary.open).toMatchObject({ value: 2, label: MEETING_LABEL_KEYS.open });
    expect(summary.overdue.rows.map((row) => row.actionId)).toEqual(['x1']);
    expect(summary.byPerson.map((group) => [group.key, group.name, group.open.value])).toEqual([
      ['person:p1', 'Sample tiler', 1],
      ['nobody', null, 1],
    ]);
    expect(summary.byPerson[1]!.open.label).toBe(MEETING_LABEL_KEYS.nobody);
    const figures = [
      summary.open,
      summary.overdue,
      ...summary.byPerson.flatMap((g) => [g.open, g.overdue]),
    ];
    for (const figure of figures) expect(traceable(figure)).toBe(true);
    // The groups together are exactly the open rows.
    const grouped = summary.byPerson.flatMap((group) => group.open.rows.map((row) => row.key));
    expect(grouped.sort()).toEqual(summary.open.rows.map((row) => row.key).sort());
  });

  it('orders the groups: people of the plan by name, people removed, names typed, nobody', () => {
    const plan = snapshot({
      people: [person('pz', 'Zeta'), person('pa', 'Alpha')],
      meetings: [
        meeting('m', 1, '2026-09-04', {
          actions: [
            meetingAction('a1', 'm', 1),
            meetingAction('a2', 'm', 2, { name: 'Named' }),
            meetingAction('a3', 'm', 3, { personId: 'gone' }),
            meetingAction('a4', 'm', 4, { personId: 'pz' }),
            meetingAction('a5', 'm', 5, { personId: 'pa' }),
            meetingAction('a6', 'm', 6, { personId: 'pa' }),
          ],
        }),
      ],
    });
    const summary = meetingSummary(plan, TODAY);
    expect(summary.byPerson.map((group) => [group.key, group.open.value])).toEqual([
      ['person:pa', 2],
      ['person:pz', 1],
      ['person:gone', 1],
      ['name:Named', 1],
      ['nobody', 1],
    ]);
    expect(summary.byPerson[2]!.name).toBeNull();
  });

  it('before the first meeting: nothing held, nothing open', () => {
    const summary = meetingSummary(snapshot(), TODAY);
    expect(summary).toMatchObject({ held: 0, last: null, byPerson: [] });
    expect(summary.open.value).toBe(0);
  });
});

// ── The agenda ───────────────────────────────────────────────────────────────

describe('the agenda, section by section', () => {
  const agenda = ask(FULL, TODAY, LATE);
  const scheduled = schedule(FULL);
  const ahead = lookahead(FULL, scheduled, LATE, TODAY);

  it('lists the sections in order, each item of its section’s kind, every key once', () => {
    expect(agenda.sections.map((each) => each.id)).toEqual([...AGENDA_SECTIONS]);
    for (const each of agenda.sections) {
      expect(each.labelKey).toBe(AGENDA_SECTION_KEYS[each.id]);
      expect(each.kind).toBe(AGENDA_SECTION_KINDS[each.id]);
      expect(each.items.length).toBeGreaterThan(0);
      for (const one of each.items)
        expect(one).toMatchObject({ section: each.id, kind: each.kind });
    }
    const keys = agenda.sections.flatMap((each) => each.items.map((one) => one.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(agenda).toMatchObject({
      today: TODAY,
      since: '2026-09-04',
      lastMeeting: { meetingId: 'mt1', number: 1 },
      number: 2,
      empty: false,
      messageKey: null,
      placed: true,
    });
  });

  it('starts with the actions still open from the last meeting, overdue marked', () => {
    const actions = section(agenda, 'actions');
    expect(actions.map((each) => each.refId)).toEqual(['x1', 'x3']);
    expect(actions[0]).toMatchObject({
      title: 'Action x1',
      due: '2026-09-08',
      overdue: true,
      messageKey: AGENDA_ITEM_KEYS.action,
      detail: { type: 'action', meetingNumber: 1, who: 'Sample tiler', overdueDays: 1 },
    });
    expect(actions[1]!.overdue).toBe(false);
  });

  it('lists the decisions overdue or due within 14 days — the lookahead’s rule — overdue first', () => {
    // d1: 11 Sep less 5 working days = 4 Sep, overdue; d2: the 10th; d3: the 11th itself.
    expect(refs(agenda, 'decisions')).toEqual(['d1', 'd2', 'd3']);
    expect(refs(agenda, 'decisions')).toEqual(ahead.decisions.rows.map((row) => row.decisionId));
    expect(section(agenda, 'decisions')[0]).toMatchObject({
      due: '2026-09-04',
      overdue: true,
      detail: { type: 'decision', stageName: 'Painting', leadTimeDays: 5, neededBy: '2026-09-11' },
    });
    expect(section(agenda, 'decisions')[1]).toMatchObject({
      due: '2026-09-10',
      overdue: false,
      detail: { daysLeft: 1 },
    });
  });

  it('leaves out a decision made, and one whose deadline is beyond the 14 days', () => {
    const plan: WorkSnapshot = {
      ...FULL,
      decisions: [
        decision('made', 's2', 1, 5, '2026-09-03T12:00:00.000Z'),
        decision('far', 's2', 2, 0),
      ],
    };
    // Today 26 August, before the work starts: the 11 September deadline is 16 days away.
    expect(refs(ask(plan, '2026-08-26'), 'decisions')).toEqual([]);
  });

  it('lists the change orders waiting, by number, with how long they waited', () => {
    const changes = section(agenda, 'changes');
    expect(changes.map((each) => each.refId)).toEqual(['c1', 'c2']);
    const rows = changeOrderRows(FULL, TODAY);
    expect(changes.map((each) => each.overdue)).toEqual(rows.map(waitsTooLong));
    expect(changes[0]).toMatchObject({
      overdue: true,
      messageKey: AGENDA_ITEM_KEYS.change,
      detail: { type: 'change', number: 1, waitedDays: 8, raisedOn: '2026-09-01' },
    });
    expect(changes[1]).toMatchObject({ overdue: false, detail: { waitedDays: 1 } });
  });

  it('leaves out a change order once decided', () => {
    const plan: WorkSnapshot = {
      ...FULL,
      changeOrders: [
        changeOrder('c1', 1, 's2', '2026-09-01', {
          decision: {
            outcome: 'declined',
            decidedOn: '2026-09-02',
            note: null,
            finishBefore: null,
            finishAfter: null,
            daysDelta: null,
            costCents: null,
            replanningId: null,
            authorName: 'Sample author',
            createdAt: '2026-09-02T12:00:00.000Z',
          },
        }),
      ],
    };
    expect(refs(ask(plan), 'changes')).toEqual([]);
  });

  it('lists the snags still open, overdue first (most days past first), then by number', () => {
    const snags = section(agenda, 'snags');
    expect(snags.map((each) => each.refId)).toEqual(['n1', 'n3', 'n2']);
    const rows = new Map(snagRows(FULL, TODAY).map((row) => [row.snagId, row]));
    for (const one of snags) {
      expect(one.overdue).toBe(rows.get(one.refId!)!.overdue);
      expect(one.detail).toMatchObject({ overdueDays: rows.get(one.refId!)!.overdueDays });
    }
    expect(snags[0]).toMatchObject({
      due: '2026-09-05',
      detail: { type: 'snag', number: 1, personName: 'Sample tiler', overdueDays: 4 },
    });
  });

  it('lists the money: due now, falling due in the window, held back as retention', () => {
    const money = section(agenda, 'money');
    expect(money.map((each) => [each.detail.type, each.refId])).toEqual([
      ['due-now', 'k1'],
      ['falling-due', 'm-a2'],
      ['held', 'm-ret'],
    ]);
    const dueNow = ahead.payments.dueNow.rows[0]!;
    const falling = ahead.payments.fallingDue.rows[0]!;
    const held = runway(FULL, scheduled, LATE, TODAY).held[0]!;
    expect(money[0]).toMatchObject({
      due: TODAY,
      detail: { type: 'due-now', amountCents: dueNow.amountCents },
    });
    expect(dueNow.amountCents).toBe(300_00);
    expect(money[1]).toMatchObject({
      title: 'Walls finished',
      due: '2026-09-10',
      detail: {
        type: 'falling-due',
        commitmentLabel: 'Sample contract',
        amountCents: falling.amountCents,
        trigger: 'activity_finished',
      },
    });
    expect(falling.amountCents).toBe(400_00);
    expect(money[2]).toMatchObject({
      due: null,
      messageKey: AGENDA_ITEM_KEYS.held,
      detail: { type: 'held', amountCents: held.amountCents, openSnags: 1 },
    });
    expect(held.amountCents).toBe(300_00);
  });

  it('says why it is late in one item: the ledger’s total and its largest causes', () => {
    const ledger = delayLedger(FULL, scheduled, LATE, TODAY);
    expect(ledger.status).toBe('late');
    const [one, ...rest] = section(agenda, 'delay');
    expect(rest).toEqual([]);
    expect(one).toMatchObject({ kind: 'delay', refId: null, messageKey: AGENDA_ITEM_KEYS.delay });
    if (one?.detail.type !== 'delay') throw new Error('not the delay');
    expect(one.detail.totalDays).toBe(ledger.total);
    expect(one.detail.baselineNumber).toBe(1);
    expect(one.detail.unexplainedDays).toBe(ledger.unexplainedDays);
    // Every cause named is a row of the ledger's by-cause figure, with its days, the most first.
    const byCause = new Map(ledger.figures!.byCause.rows.map((row) => [row.cause, row.days]));
    expect(one.detail.causes.length).toBeGreaterThan(0);
    expect(one.detail.causes.length).toBeLessThanOrEqual(AGENDA_DELAY_CAUSES);
    for (const cause of one.detail.causes) {
      expect(cause.days).toBe(byCause.get(cause.cause));
      expect(cause.messageKey).toBe(DELAY_CAUSE_KEYS[cause.cause]);
    }
    const days = one.detail.causes.map((cause) => cause.days);
    expect(days).toEqual([...days].sort((a, b) => b - a));
  });

  it('says nothing of a delay while the work is on time', () => {
    // The day before the work starts, the forecast is the plan.
    const before = '2026-08-31';
    expect(delayLedger(FULL, scheduled, [], before).status).toBe('on-time');
    expect(ask(FULL, before).sections.map((each) => each.id)).not.toContain('delay');
  });

  it('names what starts in the next two weeks, then who must be there', () => {
    const next = section(agenda, 'lookahead');
    expect(next.map((each) => [each.detail.type, each.refId])).toEqual([
      ['starting', 'b1'],
      ...ahead.people.rows.map((row) => ['person', row.personId]),
    ]);
    expect(ahead.people.rows.map((row) => row.personId)).toEqual(['p2', 'p1']);
    expect(next[0]).toMatchObject({
      due: '2026-09-11',
      detail: { type: 'starting', stageName: 'Painting', responsibleName: 'Sample painter' },
    });
  });

  it('lists the gates coming up, with the lookahead’s sentence', () => {
    const gates = section(agenda, 'gates');
    expect(gates.map((each) => each.refId)).toEqual(['s2:start']);
    expect(gates[0]).toMatchObject({
      title: 'Painting',
      due: '2026-09-11',
      messageKey: LOOKAHEAD_GATE_KEYS.start,
      detail: { type: 'gate', gate: 'start', passed: false, checks: 1, holding: 1 },
    });
  });
});

describe('new since the last meeting', () => {
  const agenda = ask(FULL, TODAY, LATE);
  const marks = Object.fromEntries(
    agenda.sections.flatMap((each) =>
      each.items.map((one) => [`${one.detail.type}:${one.refId ?? ''}`, one.newSinceLastMeeting]),
    ),
  );

  it('marks what the record dates after the last meeting’s day', () => {
    // c1 raised before the meeting, c2 after; n1, n3 before, n2 after; actions raised at it.
    expect(marks).toMatchObject({
      'change:c1': false,
      'change:c2': true,
      'snag:n1': false,
      'snag:n3': false,
      'snag:n2': true,
      'action:x1': false,
      'action:x3': false,
    });
  });

  it('marks what the record does not date by whether the last minutes had it', () => {
    expect(marks).toMatchObject({
      'decision:d1': false,
      'decision:d2': true,
      'decision:d3': true,
      'due-now:k1': false,
      'falling-due:m-a2': true,
      'held:m-ret': true,
      'delay:': false,
      'starting:b1': true,
      'gate:s2:start': false,
    });
  });

  it('marks nothing before the first meeting', () => {
    const first = ask({ ...FULL, meetings: [] }, TODAY, LATE);
    expect(first.since).toBeNull();
    expect(first.lastMeeting).toBeNull();
    expect(first.number).toBe(1);
    const all = first.sections.flatMap((each) => each.items);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((one) => !one.newSinceLastMeeting)).toBe(true);
    expect(first.sections.map((each) => each.id)).not.toContain('actions');
  });
});

describe('actions across meetings', () => {
  /** Meeting 2 carried x1, closed x3 as done, raised y1 for the painter. x2 closed in between. */
  const second: WorkSnapshot = {
    ...FULL,
    meetings: [
      FULL.meetings[0]!,
      meeting('mt2', 2, '2026-09-11', {
        items: [item('action-carried', 'x1', 1), item('action-carried', 'x3', 2)],
        actions: [meetingAction('y1', 'mt2', 1, { personId: 'p2', dueOn: '2026-09-18' })],
      }),
    ].map((each) =>
      each.id === 'mt1'
        ? {
            ...each,
            actions: each.actions.map((action) =>
              action.id === 'x3'
                ? { ...action, closure: actionClosure('done', '2026-09-11', 'mt2') }
                : action,
            ),
          }
        : each,
    ),
  };

  it('carries the open ones forward, oldest first; a closed one, at a meeting or between, is gone', () => {
    const agenda = ask(second, '2026-09-14');
    expect(refs(agenda, 'actions')).toEqual(['x1', 'y1']);
    expect(section(agenda, 'actions').map((one) => one.detail)).toMatchObject([
      { meetingNumber: 1 },
      { meetingNumber: 2 },
    ]);
    expect(section(agenda, 'actions').every((one) => !one.newSinceLastMeeting)).toBe(true);
    expect(agenda).toMatchObject({ since: '2026-09-11', number: 3 });
  });

  it('drops an action closed between meetings from the next agenda', () => {
    const closed: WorkSnapshot = {
      ...FULL,
      meetings: [
        {
          ...FULL.meetings[0]!,
          actions: FULL.meetings[0]!.actions.map((action) =>
            action.id === 'x1'
              ? { ...action, closure: actionClosure('dropped', '2026-09-08') }
              : action,
          ),
        },
      ],
    };
    expect(refs(ask(closed), 'actions')).toEqual(['x3']);
    expect(meetingSummary(closed, TODAY).overdue.value).toBe(0);
  });
});

describe('an agenda with nothing on it', () => {
  it('says so', () => {
    const agenda = ask(snapshot());
    expect(agenda).toMatchObject({
      sections: [],
      empty: true,
      messageKey: MEETING_AGENDA_KEYS.empty,
      placed: false,
      since: null,
      number: 1,
    });
  });

  it('leaves out the empty sections only', () => {
    const plan: WorkSnapshot = { ...PLAN, snags: [snag('n1', 1, 's1')] };
    // Before the window reaches the schedule: nothing starting, no gate, nothing due.
    const agenda = ask(plan, '2026-06-01');
    expect(agenda.sections.map((each) => each.id)).toEqual(['snags']);
    expect(agenda.empty).toBe(false);
  });

  it('throws on a today that is not a day, as the lookahead does', () => {
    expect(() => ask(FULL, '2026-13-01')).toThrow(RangeError);
  });
});

// ── Checking the minutes ─────────────────────────────────────────────────────

const DRAFT: MinutesDraft = {
  heldOn: TODAY,
  notes: 'Sample notes',
  attendees: [
    { personId: 'p1', name: null },
    { personId: null, name: 'Sample architect' },
  ],
  items: [{ kind: 'decision', refId: 'd1', title: 'Decision d1', note: 'Said', outcome: 'Made' }],
  actions: [{ text: 'Order the paint', personId: 'p2', name: null, dueOn: '2026-09-11' }],
  closures: [{ actionId: 'x1', outcome: 'done', note: null }],
};

const codes = (problems: readonly { code: string; index: number | null }[]) =>
  problems.map((each) => `${each.code}@${each.index ?? '-'}`);

describe('the minutes, checked before they are written', () => {
  it('pass when everything holds', () => {
    expect(validateMinutes(FULL, DRAFT, TODAY)).toEqual([]);
    expect(
      validateMinutes(
        FULL,
        { ...DRAFT, attendees: [], items: [], actions: [], closures: [], notes: null },
        TODAY,
      ),
    ).toEqual([]);
  });

  it('refuse a day that is not one, or after today, and notes too long', () => {
    expect(codes(validateMinutes(FULL, { ...DRAFT, heldOn: 'soon' }, TODAY))).toEqual([
      'invalid-held-on@-',
    ]);
    const late = validateMinutes(
      FULL,
      { ...DRAFT, heldOn: '2026-09-10', notes: 'x'.repeat(MEETING_LIMITS.notes + 1) },
      TODAY,
    );
    expect(codes(late)).toEqual(['held-in-future@-', 'notes-too-long@-']);
    expect(late[0]).toMatchObject({
      part: 'meeting',
      messageKey: MEETING_PROBLEM_KEYS['held-in-future'],
    });
  });

  it('refuse an attendee who is neither or both, unknown, unnamed, too long, or there twice', () => {
    const problems = validateMinutes(
      FULL,
      {
        ...DRAFT,
        attendees: [
          { personId: null, name: null },
          { personId: 'p1', name: 'Also a name' },
          { personId: 'gone', name: null },
          { personId: null, name: '  ' },
          { personId: null, name: 'y'.repeat(MEETING_LIMITS.name + 1) },
          { personId: 'p1', name: null },
          { personId: 'p1', name: null },
          { personId: null, name: 'Sample guest' },
          { personId: null, name: ' sample GUEST ' },
        ],
      },
      TODAY,
    );
    expect(codes(problems)).toEqual([
      'attendee-none@0',
      'attendee-both@1',
      'attendee-unknown-person@2',
      'attendee-name-empty@3',
      'attendee-name-too-long@4',
      'attendee-duplicate@6',
      'attendee-duplicate@8',
    ]);
    expect(problems.every((each) => each.part === 'attendee')).toBe(true);
  });

  it('refuse an item of no known kind, with no title, or words too long', () => {
    const problems = validateMinutes(
      FULL,
      {
        ...DRAFT,
        items: [
          { kind: 'nonsense' as never, refId: null, title: ' ', note: null, outcome: null },
          {
            kind: 'other',
            refId: null,
            title: 't'.repeat(MEETING_LIMITS.itemTitle + 1),
            note: 'n'.repeat(MEETING_LIMITS.itemNote + 1),
            outcome: 'o'.repeat(MEETING_LIMITS.itemOutcome + 1),
          },
          {
            kind: 'other',
            refId: null,
            title: 't'.repeat(MEETING_LIMITS.itemTitle),
            note: 'n'.repeat(MEETING_LIMITS.itemNote),
            outcome: 'o'.repeat(MEETING_LIMITS.itemOutcome),
          },
        ],
      },
      TODAY,
    );
    expect(codes(problems)).toEqual([
      'item-invalid-kind@0',
      'item-title-empty@0',
      'item-title-too-long@1',
      'item-note-too-long@1',
      'item-outcome-too-long@1',
    ]);
  });

  it('refuse an action with no text, two whos, an unknown person, a bad name or day', () => {
    const problems = validateMinutes(
      FULL,
      {
        ...DRAFT,
        actions: [
          { text: '', personId: 'p1', name: 'Also', dueOn: null },
          {
            text: 'a'.repeat(MEETING_LIMITS.actionText + 1),
            personId: 'gone',
            name: null,
            dueOn: 'soon',
          },
          { text: 'Fine', personId: null, name: ' ', dueOn: '2026-09-08' },
          { text: 'Fine', personId: null, name: 'n'.repeat(MEETING_LIMITS.name + 1), dueOn: TODAY },
          { text: 'On nobody', personId: null, name: null, dueOn: null },
        ],
      },
      TODAY,
    );
    expect(codes(problems)).toEqual([
      'action-text-empty@0',
      'action-both@0',
      'action-text-too-long@1',
      'action-unknown-person@1',
      'action-invalid-due-on@1',
      'action-name-empty@2',
      'action-due-before-held@2',
      'action-name-too-long@3',
    ]);
  });

  it('refuse a closure of no action, of one closed, twice, before it was raised, or too long', () => {
    const problems = validateMinutes(
      FULL,
      {
        ...DRAFT,
        heldOn: '2026-09-03',
        closures: [
          { actionId: 'nope', outcome: 'done', note: null },
          { actionId: 'x2', outcome: 'done', note: null },
          {
            actionId: 'x1',
            outcome: 'maybe' as never,
            note: 'z'.repeat(MEETING_LIMITS.closureNote + 1),
          },
          { actionId: 'x1', outcome: 'done', note: null },
        ],
      },
      TODAY,
    );
    expect(codes(problems)).toEqual([
      'closure-unknown-action@0',
      'closure-already-closed@1',
      'closure-before-raised@1',
      'closure-invalid-outcome@2',
      'closure-before-raised@2',
      'closure-note-too-long@2',
      'closure-duplicate@3',
    ]);
  });
});

describe('an action closed between meetings, checked', () => {
  const closure = { actionId: 'x1', outcome: 'done' as const, closedOn: TODAY, note: null };

  it('passes when it holds', () => {
    expect(validateActionClosure(FULL, closure, TODAY)).toEqual([]);
    expect(
      validateActionClosure(
        FULL,
        { ...closure, outcome: 'dropped', closedOn: '2026-09-04' },
        TODAY,
      ),
    ).toEqual([]);
  });

  it('refuses an unknown action, one closed already, a bad outcome, day or note', () => {
    expect(codes(validateActionClosure(FULL, { ...closure, actionId: 'nope' }, TODAY))).toEqual([
      'closure-unknown-action@-',
    ]);
    expect(codes(validateActionClosure(FULL, { ...closure, actionId: 'x2' }, TODAY))).toEqual([
      'closure-already-closed@-',
    ]);
    expect(
      codes(
        validateActionClosure(
          FULL,
          { ...closure, outcome: 'maybe' as never, closedOn: 'soon', note: 'z'.repeat(501) },
          TODAY,
        ),
      ),
    ).toEqual([
      'closure-invalid-outcome@-',
      'closure-invalid-closed-on@-',
      'closure-note-too-long@-',
    ]);
    expect(
      codes(validateActionClosure(FULL, { ...closure, closedOn: '2026-09-10' }, TODAY)),
    ).toEqual(['closure-in-future@-']);
    expect(
      codes(validateActionClosure(FULL, { ...closure, closedOn: '2026-09-03' }, TODAY)),
    ).toEqual(['closure-before-raised@-']);
  });
});

describe('the words', () => {
  it('has a key for every section, kind and problem, each once', () => {
    expect(Object.keys(AGENDA_SECTION_KEYS)).toEqual([...AGENDA_SECTIONS]);
    expect(Object.keys(AGENDA_SECTION_KINDS)).toEqual([...AGENDA_SECTIONS]);
    expect(Object.keys(MEETING_ITEM_KIND_KEYS)).toEqual([...MEETING_ITEM_KINDS]);
    expect(new Set(MEETING_MESSAGE_KEYS).size).toBe(MEETING_MESSAGE_KEYS.length);
    for (const key of Object.values(MEETING_PROBLEM_KEYS))
      expect(MEETING_MESSAGE_KEYS).toContain(key);
    expect(MEETING_MESSAGE_KEYS.every((key) => key.startsWith('meetings.'))).toBe(true);
  });
});
