import { describe, expect, it } from 'vitest';

import { maintenanceDone, maintenanceTask, snapshot, stage, warranty } from './__fixtures__/plan';
import {
  AFTERCARE_CALENDAR_KEYS,
  AFTERCARE_ICS_PRODID,
  AFTERCARE_LABEL_KEYS,
  AFTERCARE_MESSAGE_KEYS,
  AFTERCARE_PROBLEM_KEYS,
  AFTERCARE_TASK_STATE_KEYS,
  AFTERCARE_WARRANTY_STATE_KEYS,
  addMonths,
  aftercareCalendar,
  aftercareFigures,
  aftercareIcs,
  endsOn,
  escapeIcsText,
  foldIcsLine,
  maintenanceHolding,
  maintenanceRemovable,
  maintenanceRows,
  validateMaintenanceDone,
  validateMaintenanceDraft,
  validateMaintenanceRemoval,
  validateWarrantyDraft,
  warrantyRows,
  type AftercareIcsWords,
  type MaintenanceDraft,
  type WarrantyDraft,
} from './aftercare';
import { traceable } from './figure';
import type { Document, MaintenanceTask, Warranty, WorkSnapshot } from './plan';
import type { Figure } from './figure';

// ── Builders. Nothing in them is a real place, person or brand. ──────────────
//
// Today is Monday 5 October 2026. The work has one room ("r1", Bathroom) and one stage ("s1").

const TODAY = '2026-10-05';
const NOW = '2026-10-05T12:34:56.789Z';

const PLAN = snapshot({
  rooms: [{ id: 'r1', position: 1, name: 'Bathroom' }],
  stages: [stage('s1', 1, 'Plumbing')],
});

const withAftercare = (
  warranties: Warranty[] = [],
  maintenance: MaintenanceTask[] = [],
): WorkSnapshot => ({ ...PLAN, warranties, maintenance });

const warrantyDoc = (id: string, kind: Document['kind'] = 'warranty'): Document => ({
  id,
  fileHash: id.padEnd(64, '0'),
  fileName: `${id}.pdf`,
  mediaType: 'application/pdf',
  bytes: 1_024,
  width: null,
  height: null,
  kind,
  title: `Paper ${id}`,
  addedOn: '2026-09-01',
  authorName: 'Sample author',
  createdAt: '2026-09-01T12:00:00.000Z',
  links: [],
});

const WORDS: AftercareIcsWords = {
  calendarName: 'Sample work',
  taskSummary: (title) => `Maintenance: ${title}`,
  taskDescription: (row) => `Every ${row.everyMonths} months`,
  warrantySummary: (title) => `Warranty ends: ${title}`,
  warrantyDescription: (row) => (row.givenBy === null ? null : `Given by ${row.givenBy}`),
  warrantyAlarm: (title) => `${title} ends in 30 days`,
};

const octets = (text: string) => new TextEncoder().encode(text).length;
const unfold = (ics: string) => ics.replace(/\r\n /g, '');

// ── Calendar months ──────────────────────────────────────────────────────────

describe('adding calendar months', () => {
  it('keeps the day of the month', () => {
    expect(addMonths('2026-03-15', 12)).toBe('2027-03-15');
    expect(addMonths('2026-03-15', 1)).toBe('2026-04-15');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-03-15', 0)).toBe('2026-03-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('clamps a day the month does not have to its last day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-01-31', 3)).toBe('2026-04-30');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-08-31', 1)).toBe('2026-09-30');
  });

  it('knows the leap years: every fourth, not every hundredth, every four-hundredth', () => {
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonths('2028-02-29', 48)).toBe('2032-02-29');
    expect(addMonths('2100-01-31', 1)).toBe('2100-02-28');
    expect(addMonths('2000-01-31', 1)).toBe('2000-02-29');
  });

  it('refuses what is not a day or not a whole number of months', () => {
    expect(() => addMonths('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addMonths('soon', 1)).toThrow(RangeError);
    expect(() => addMonths('2026-03-15', 1.5)).toThrow(RangeError);
    expect(() => addMonths('9999-12-01', 1)).toThrow(RangeError);
  });

  it('ends a warranty on the same day its length later, as the paper says', () => {
    expect(endsOn('2026-03-15', 12)).toBe('2027-03-15');
    expect(endsOn('2026-01-31', 1)).toBe('2026-02-28');
    expect(endsOn('2027-01-31', 13)).toBe('2028-02-29');
    expect(endsOn('2028-02-29', 12)).toBe('2029-02-28');
    expect(endsOn('2026-10-05', 600)).toBe('2076-10-05');
  });
});

// ── Warranties ───────────────────────────────────────────────────────────────

describe('a warranty as of a day', () => {
  // Each warranty lasts 12 months; its end is written in the name.
  const plan = withAftercare([
    warranty('w-91', 1, '2026-01-04', 12),
    warranty('w-90', 2, '2026-01-03', 12),
    warranty('w-today', 3, '2025-10-05', 12),
    warranty('w-ended', 4, '2025-10-04', 12),
  ]);
  const rows = warrantyRows(plan, TODAY);
  const of = (id: string) => rows.find((row) => row.warrantyId === id)!;

  it('is ending soon within 90 days, its last day included, and active beyond', () => {
    expect(of('w-91')).toMatchObject({ endsOn: '2027-01-04', daysLeft: 91, state: 'active' });
    expect(of('w-90')).toMatchObject({ endsOn: '2027-01-03', daysLeft: 90, state: 'ending-soon' });
    expect(of('w-today')).toMatchObject({ endsOn: TODAY, daysLeft: 0, state: 'ending-soon' });
  });

  it('has ended once its last day has passed', () => {
    expect(of('w-ended')).toMatchObject({ endsOn: '2026-10-04', daysLeft: -1, state: 'ended' });
  });

  it('is filed under its end day, by position', () => {
    expect(rows.map((row) => [row.key, row.day])).toEqual([
      ['warranty:w-91', '2027-01-04'],
      ['warranty:w-90', '2027-01-03'],
      ['warranty:w-today', TODAY],
      ['warranty:w-ended', '2026-10-04'],
    ]);
  });

  it('says what it covers and gives its document', () => {
    const plan2: WorkSnapshot = {
      ...withAftercare([
        warranty('w1', 1, '2026-09-01', 24, { documentId: 'doc-1', givenBy: 'The installer' }),
        warranty('w2', 2, '2026-09-01', 24, { targetKind: 'room', targetId: 'r1' }),
        warranty('w3', 3, '2026-09-01', 24, { targetKind: 'stage', targetId: 's1' }),
        warranty('w4', 4, '2026-09-01', 24, { targetKind: 'stage', targetId: 'gone' }),
      ]),
      documents: [warrantyDoc('doc-1')],
    };
    const described = warrantyRows(plan2, TODAY).map((row) => ({
      targetName: row.targetName,
      detached: row.detached,
      document: row.document?.title ?? null,
      givenBy: row.givenBy,
    }));
    expect(described).toEqual([
      {
        targetName: 'Sample work',
        detached: false,
        document: 'Paper doc-1',
        givenBy: 'The installer',
      },
      { targetName: 'Bathroom', detached: false, document: null, givenBy: null },
      { targetName: 'Plumbing', detached: false, document: null, givenBy: null },
      { targetName: null, detached: true, document: null, givenBy: null },
    ]);
  });

  it('reads as active with nothing counted when today or its end cannot be read', () => {
    const odd = withAftercare([warranty('w1', 1, '2026-02-30', 12), warranty('w2', 2, TODAY, 12)]);
    expect(warrantyRows(odd, TODAY)[0]).toMatchObject({
      endsOn: null,
      state: 'active',
      daysLeft: null,
    });
    expect(warrantyRows(odd, 'someday')[1]).toMatchObject({ state: 'active', daysLeft: null });
  });
});

describe('the order of aftercare', () => {
  it('is by target as care notes are, then by position inside a target, never position alone', () => {
    const plan: WorkSnapshot = {
      ...PLAN,
      rooms: [
        { id: 'r2', position: 2, name: 'Kitchen' },
        { id: 'r1', position: 1, name: 'Bathroom' },
      ],
      warranties: [
        warranty('on-gone', 1, TODAY, 12, { targetKind: 'room', targetId: 'gone' }),
        warranty('on-stage', 1, TODAY, 12, { targetKind: 'stage', targetId: 's1' }),
        warranty('on-r2', 1, TODAY, 12, { targetKind: 'room', targetId: 'r2' }),
        warranty('on-r1-b', 2, TODAY, 12, { targetKind: 'room', targetId: 'r1' }),
        warranty('on-r1-a', 1, TODAY, 12, { targetKind: 'room', targetId: 'r1' }),
        warranty('on-work', 3, TODAY, 12),
      ],
      maintenance: [
        maintenanceTask('t-stage', 1, 12, TODAY, { targetKind: 'stage', targetId: 's1' }),
        maintenanceTask('t-work', 2, 12, TODAY),
      ],
    };
    expect(warrantyRows(plan, TODAY).map((row) => row.warrantyId)).toEqual([
      'on-work',
      'on-r1-a',
      'on-r1-b',
      'on-r2',
      'on-stage',
      'on-gone',
    ]);
    expect(maintenanceRows(plan, TODAY).map((row) => row.taskId)).toEqual(['t-work', 't-stage']);
    // The same order breaks a tie on a day, in the figures and in the calendar.
    expect(aftercareFigures(plan, TODAY).active.rows.map((row) => row.warrantyId)).toEqual([
      'on-work',
      'on-r1-a',
      'on-r1-b',
      'on-r2',
      'on-stage',
      'on-gone',
    ]);
    expect(aftercareCalendar(plan, TODAY, 1)[0]!.items.map((item) => item.id)).toEqual([
      't-work',
      't-stage',
    ]);
  });
});

// ── Maintenance ──────────────────────────────────────────────────────────────

describe('a maintenance task as of a day', () => {
  it('is due on its first due day while nothing is done', () => {
    const [row] = maintenanceRows(
      withAftercare([], [maintenanceTask('t1', 1, 12, '2026-12-01')]),
      TODAY,
    );
    expect(row).toMatchObject({
      nextDueOn: '2026-12-01',
      lastDoneOn: null,
      timesDone: 0,
      overdue: false,
      dueSoon: false,
      state: 'scheduled',
      daysUntilDue: 57,
    });
  });

  it('is overdue once its due day has passed, with no record done', () => {
    const [row] = maintenanceRows(
      withAftercare([], [maintenanceTask('t1', 1, 12, '2025-09-05')]),
      TODAY,
    );
    expect(row).toMatchObject({
      nextDueOn: '2025-09-05',
      overdue: true,
      daysOverdue: 395,
      daysUntilDue: null,
      state: 'overdue',
    });
  });

  it('is due again months after it was last done, and overdue when that has passed too', () => {
    const recent = maintenanceTask('t1', 1, 12, '2025-09-01', {
      done: [maintenanceDone(1, '2025-10-01'), maintenanceDone(2, '2026-09-01')],
    });
    const late = maintenanceTask('t2', 2, 12, '2024-08-01', {
      done: [maintenanceDone(1, '2025-08-01')],
    });
    const [first, second] = maintenanceRows(withAftercare([], [recent, late]), TODAY);
    expect(first).toMatchObject({
      lastDoneOn: '2026-09-01',
      nextDueOn: '2027-09-01',
      timesDone: 2,
      overdue: false,
    });
    expect(second).toMatchObject({
      lastDoneOn: '2025-08-01',
      nextDueOn: '2026-08-01',
      overdue: true,
      daysOverdue: 65,
    });
  });

  it('is due soon within 30 days, today included; overdue from the day after', () => {
    const rows = maintenanceRows(
      withAftercare(
        [],
        [
          maintenanceTask('t-31', 1, 6, '2026-11-05'),
          maintenanceTask('t-30', 2, 6, '2026-11-04'),
          maintenanceTask('t-0', 3, 6, TODAY),
          maintenanceTask('t-late', 4, 6, '2026-10-04'),
        ],
      ),
      TODAY,
    );
    expect(rows.map((row) => [row.taskId, row.state, row.daysUntilDue, row.daysOverdue])).toEqual([
      ['t-31', 'scheduled', 31, null],
      ['t-30', 'due-soon', 30, null],
      ['t-0', 'due-soon', 0, null],
      ['t-late', 'overdue', null, 1],
    ]);
  });

  it('moves from a month end, clamped', () => {
    const task = maintenanceTask('t1', 1, 1, '2026-01-31', {
      done: [maintenanceDone(1, '2027-01-31')],
    });
    expect(maintenanceRows(withAftercare([], [task]), TODAY)[0]!.nextDueOn).toBe('2027-02-28');
  });

  it('can be removed only while nothing is done; one with a history holds its room or stage', () => {
    const plan = withAftercare(
      [],
      [
        maintenanceTask('t1', 1, 12, TODAY, { targetKind: 'room', targetId: 'r1' }),
        maintenanceTask('t2', 2, 12, TODAY, {
          targetKind: 'room',
          targetId: 'r1',
          done: [maintenanceDone(1, '2026-09-01')],
        }),
      ],
    );
    expect(maintenanceRemovable(plan, 't1')).toBe(true);
    expect(maintenanceRemovable(plan, 't2')).toBe(false);
    expect(maintenanceRemovable(plan, 'nope')).toBe(false);
    expect(validateMaintenanceRemoval(plan, 't2').map((each) => each.code)).toEqual([
      'task-has-history',
    ]);
    expect(validateMaintenanceRemoval(plan, 't1')).toEqual([]);
    expect(maintenanceHolding(plan, 'room', 'r1').map((task) => task.id)).toEqual(['t2']);
    expect(maintenanceHolding(plan, 'stage', 's1')).toEqual([]);
  });
});

// ── The figures ──────────────────────────────────────────────────────────────

describe('the aftercare figures', () => {
  const plan = withAftercare(
    [
      warranty('w-far', 1, '2026-06-01', 24),
      warranty('w-soon', 2, '2025-11-01', 12),
      warranty('w-sooner', 3, '2025-10-20', 12),
      warranty('w-ended', 4, '2024-01-01', 12),
    ],
    [
      maintenanceTask('t-little', 1, 12, '2026-10-01'),
      maintenanceTask('t-much', 2, 12, '2026-01-01'),
      maintenanceTask('t-soon', 3, 6, '2026-10-20'),
      maintenanceTask('t-later', 4, 6, '2027-03-01'),
    ],
  );
  const figures = aftercareFigures(plan, TODAY);

  it('counts what it lists, each figure traceable', () => {
    const all: Figure[] = [figures.overdue, figures.dueSoon, figures.endingSoon, figures.active];
    for (const figure of all) {
      expect(traceable(figure)).toBe(true);
      expect(figure.value).toBe(figure.rows.length);
    }
    expect([figures.warranties, figures.tasks]).toEqual([4, 4]);
  });

  it('puts the most days overdue first, and the soonest first everywhere else', () => {
    expect(figures.overdue.rows.map((row) => row.taskId)).toEqual(['t-much', 't-little']);
    expect(figures.dueSoon.rows.map((row) => row.taskId)).toEqual(['t-soon']);
    expect(figures.endingSoon.rows.map((row) => row.warrantyId)).toEqual(['w-sooner', 'w-soon']);
    expect(figures.active.rows.map((row) => row.warrantyId)).toEqual([
      'w-sooner',
      'w-soon',
      'w-far',
    ]);
  });

  it('names each figure by its key', () => {
    expect(figures.overdue.label).toBe(AFTERCARE_LABEL_KEYS.overdue);
    expect(figures.dueSoon.label).toBe(AFTERCARE_LABEL_KEYS.dueSoon);
    expect(figures.endingSoon.label).toBe(AFTERCARE_LABEL_KEYS.endingSoon);
    expect(figures.active.label).toBe(AFTERCARE_LABEL_KEYS.active);
  });

  it('is nothing for a work with no aftercare', () => {
    const none = aftercareFigures(PLAN, TODAY);
    expect([none.warranties, none.tasks, none.overdue.value, none.active.value]).toEqual([
      0, 0, 0, 0,
    ]);
  });
});

// ── The calendar ─────────────────────────────────────────────────────────────

describe('the aftercare calendar', () => {
  const plan = withAftercare(
    [
      warranty('w-jan', 1, '2026-01-03', 12),
      warranty('w-ended', 2, '2025-10-01', 12),
      warranty('w-beyond', 3, '2026-01-01', 24),
    ],
    [
      maintenanceTask('t-quarter', 1, 3, '2026-11-15'),
      maintenanceTask('t-overdue', 2, 12, '2025-09-05'),
    ],
  );
  const calendar = aftercareCalendar(plan, TODAY);
  const month = (key: string) => calendar.find((each) => each.month === key)!;
  const items = (key: string) => month(key).items.map((item) => [item.key, item.overdue]);

  it('is the next twelve months from today’s month', () => {
    expect(calendar.map((each) => each.month)).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
      '2027-07',
      '2027-08',
      '2027-09',
    ]);
    expect(calendar[0]!.firstDay).toBe('2026-10-01');
  });

  it('steps a task every N months inside the window', () => {
    for (const key of ['2026-11', '2027-02', '2027-05', '2027-08']) {
      expect(month(key).items.some((item) => item.id === 't-quarter')).toBe(true);
    }
    expect(month('2026-11').items[0]).toMatchObject({
      kind: 'task-due',
      day: '2026-11-15',
      messageKey: AFTERCARE_CALENDAR_KEYS['task-due'],
      everyMonths: 3,
    });
  });

  it('tells an overdue task in the current month, once, and its next step when it comes', () => {
    expect(items('2026-10')).toEqual([['task:t-overdue:2025-09-05', true]]);
    expect(month('2026-10').items[0]).toMatchObject({ day: '2025-09-05', daysOverdue: 395 });
    expect(items('2027-09')).toEqual([['task:t-overdue:2027-09-05', false]]);
    const all = calendar.flatMap((each) => each.items.map((item) => item.key));
    expect(all).not.toContain('task:t-overdue:2026-09-05');
  });

  it('gives a warranty’s end day, never an ended one or one beyond the window', () => {
    expect(items('2027-01')).toEqual([['warranty:w-jan', false]]);
    const ids = calendar.flatMap((each) => each.items.map((item) => item.id));
    expect(ids).not.toContain('w-ended');
    expect(ids).not.toContain('w-beyond');
  });

  it('says a month with nothing in it is empty', () => {
    expect(month('2026-12')).toMatchObject({ items: [], empty: true });
    expect(month('2026-11').empty).toBe(false);
  });

  it('keeps a month in day order, a task before a warranty on the same day', () => {
    const busy = aftercareCalendar(
      withAftercare(
        [warranty('w1', 1, '2026-01-20', 12)],
        [
          maintenanceTask('t-late', 1, 12, '2027-01-25'),
          maintenanceTask('t-same', 2, 12, '2027-01-20'),
        ],
      ),
      TODAY,
    );
    expect(busy[3]!.items.map((item) => item.key)).toEqual([
      'task:t-same:2027-01-20',
      'warranty:w1',
      'task:t-late:2027-01-25',
    ]);
  });

  it('brings a 31st back as the 31st whenever the month has one', () => {
    const plan2 = withAftercare([], [maintenanceTask('t1', 1, 1, '2026-10-31')]);
    const days = aftercareCalendar(plan2, TODAY, 5).flatMap((each) => each.items.map((i) => i.day));
    expect(days).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  });

  it('is nothing when today or the number of months cannot be read', () => {
    expect(aftercareCalendar(plan, 'someday')).toEqual([]);
    expect(aftercareCalendar(plan, TODAY, 0)).toEqual([]);
    expect(aftercareCalendar(plan, TODAY, 2.5)).toEqual([]);
  });
});

// ── The .ics file ────────────────────────────────────────────────────────────

describe('the aftercare .ics file', () => {
  const plan = withAftercare(
    [
      warranty('w-valve', 1, '2024-11-05', 24, { title: 'Shower valve', givenBy: 'The installer' }),
      warranty('w-ended', 2, '2024-01-01', 12, { title: 'Old boiler' }),
    ],
    [maintenanceTask('t-reseal', 1, 12, '2026-11-15', { title: 'Reseal the shower' })],
  );
  const ics = aftercareIcs(plan, WORDS, NOW, TODAY);
  const lines = ics.split('\r\n');

  it('is a VCALENDAR with CRLF line ends and nothing else', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain(`PRODID:${AFTERCARE_ICS_PRODID}`);
    expect(AFTERCARE_ICS_PRODID).toBe('-//Ridgebeam//Aftercare//EN');
    expect(lines).toContain('X-WR-CALNAME:Sample work');
  });

  it('writes a task as an all-day event on its next due day, repeating every N months', () => {
    const event = unfold(ics);
    expect(event).toContain(
      [
        'BEGIN:VEVENT',
        'UID:t-reseal@ridgebeam',
        'DTSTAMP:20261005T123456Z',
        'DTSTART;VALUE=DATE:20261115',
        'DTEND;VALUE=DATE:20261116',
        'RRULE:FREQ=MONTHLY;INTERVAL=12',
        'SUMMARY:Maintenance: Reseal the shower',
        'DESCRIPTION:Every 12 months',
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      ].join('\r\n'),
    );
  });

  it('writes a warranty not ended on its end day, with an alarm 30 days before', () => {
    expect(unfold(ics)).toContain(
      [
        'BEGIN:VEVENT',
        'UID:w-valve@ridgebeam',
        'DTSTAMP:20261005T123456Z',
        'DTSTART;VALUE=DATE:20261105',
        'DTEND;VALUE=DATE:20261106',
        'SUMMARY:Warranty ends: Shower valve',
        'DESCRIPTION:Given by The installer',
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Shower valve ends in 30 days',
        'TRIGGER:-P30D',
        'END:VALARM',
        'END:VEVENT',
      ].join('\r\n'),
    );
  });

  it('leaves an ended warranty out', () => {
    expect(ics).not.toContain('w-ended');
    expect(ics).not.toContain('Old boiler');
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(2);
  });

  it('keeps the UIDs when written again: only the stamp moves', () => {
    const again = aftercareIcs(plan, WORDS, '2027-01-02T08:00:00Z', TODAY);
    const uids = (text: string) => text.split('\r\n').filter((line) => line.startsWith('UID:'));
    expect(uids(again)).toEqual(uids(ics));
    expect(uids(ics)).toEqual(['UID:t-reseal@ridgebeam', 'UID:w-valve@ridgebeam']);
    expect(again.replace(/DTSTAMP:\S+/g, '')).toBe(ics.replace(/DTSTAMP:\S+/g, ''));
  });

  it('escapes backslash, semicolon, comma and line breaks in the words', () => {
    expect(escapeIcsText('a\\b;c,d\r\ne\nf\rg')).toBe('a\\\\b\\;c\\,d\\ne\\nf\\ng');
    expect(escapeIcsText('tab\there\u0007')).toBe('tab\there');
    const odd = aftercareIcs(
      withAftercare(
        [],
        [maintenanceTask('t1', 1, 6, '2026-11-01', { title: 'Grout; seal, wipe' })],
      ),
      { ...WORDS, taskDescription: () => 'Line one\nLine two' },
      NOW,
      TODAY,
    );
    const unfolded = unfold(odd).split('\r\n');
    expect(unfolded).toContain('SUMMARY:Maintenance: Grout\\; seal\\, wipe');
    expect(unfolded).toContain('DESCRIPTION:Line one\\nLine two');
  });

  it('folds a long multibyte title at 75 octets, never inside a character', () => {
    const title =
      'Revisão anual da impermeabilização do box, rejunte e silicone — banheiro da suíte, ' +
      'conforme orientação do instalador, açúcar à vontade 🛁 até o fim';
    const long = aftercareIcs(
      withAftercare([], [maintenanceTask('t1', 1, 12, '2026-11-01', { title })]),
      WORDS,
      NOW,
      TODAY,
    );
    const physical = long.split('\r\n').filter((line) => line !== '');
    for (const line of physical) expect(octets(line)).toBeLessThanOrEqual(75);
    const summary = physical.findIndex((line) => line.startsWith('SUMMARY:'));
    expect(physical[summary + 1]!.startsWith(' ')).toBe(true);
    expect(unfold(long).split('\r\n')).toContain(
      `SUMMARY:${escapeIcsText(`Maintenance: ${title}`)}`,
    );
    // Each physical line is whole UTF-8: no lone half of a character on either side of a fold.
    for (const line of physical) expect(line).not.toMatch(/[\uD800-\uDFFF]/u);
  });

  it('folds a plain line exactly at 75 octets, the continuation’s space counted', () => {
    const line = 'X'.repeat(200);
    const folded = foldIcsLine(line).split('\r\n');
    expect(folded.map((each) => each.length)).toEqual([75, 75, 52]);
    expect(folded.slice(1).every((each) => each.startsWith(' '))).toBe(true);
    expect(foldIcsLine('short')).toBe('short');
    // A 3-octet character that would cross the limit moves whole to the next line.
    const crossing = foldIcsLine(`${'a'.repeat(74)}€b`).split('\r\n');
    expect(crossing).toEqual(['a'.repeat(74), ' €b']);
  });

  it('makes a month without the day fall on its last day, as the plan does', () => {
    const end = aftercareIcs(
      withAftercare([], [maintenanceTask('t1', 1, 1, '2026-10-31')]),
      WORDS,
      NOW,
      TODAY,
    );
    expect(end.split('\r\n')).toContain(
      'RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28,29,30,31;BYSETPOS=-1',
    );
    const thirtieth = aftercareIcs(
      withAftercare([], [maintenanceTask('t1', 1, 6, '2026-11-30')]),
      WORDS,
      NOW,
      TODAY,
    );
    expect(thirtieth.split('\r\n')).toContain(
      'RRULE:FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=28,29,30;BYSETPOS=-1',
    );
  });

  it('leaves out a blank description and a blank calendar name', () => {
    const bare = aftercareIcs(
      withAftercare([], [maintenanceTask('t1', 1, 6, '2026-11-01')]),
      { ...WORDS, calendarName: ' ', taskDescription: () => null },
      NOW,
      TODAY,
    );
    expect(bare).not.toContain('X-WR-CALNAME');
    expect(bare.split('\r\n').filter((line) => line.startsWith('DESCRIPTION'))).toEqual([]);
  });

  it('is an empty calendar for a work with no aftercare, and refuses a now that is not UTC', () => {
    const empty = aftercareIcs(PLAN, WORDS, NOW);
    expect(empty).not.toContain('BEGIN:VEVENT');
    expect(empty.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(() => aftercareIcs(PLAN, WORDS, '2026-10-05 12:00')).toThrow(RangeError);
  });
});

// ── Checking before the host is asked ────────────────────────────────────────

describe('checking aftercare before the host is asked', () => {
  const plan: WorkSnapshot = {
    ...withAftercare(
      [warranty('w1', 1, '2026-01-01', 12)],
      [maintenanceTask('t1', 1, 12, '2026-01-01', { done: [maintenanceDone(1, '2026-09-10')] })],
    ),
    documents: [warrantyDoc('doc-w'), warrantyDoc('doc-photo', 'photo')],
  };
  const good: WarrantyDraft = {
    title: 'Shower valve',
    targetKind: 'room',
    targetId: 'r1',
    givenBy: 'The installer',
    startsOn: '2026-09-01',
    months: 24,
    documentId: 'doc-w',
    note: null,
  };
  const codes = (problems: ReadonlyArray<{ code: string }>) => problems.map((each) => each.code);

  it('accepts a good warranty and says every problem of a bad one, in order', () => {
    expect(validateWarrantyDraft(plan, good)).toEqual([]);
    expect(
      codes(
        validateWarrantyDraft(plan, {
          id: 'nope',
          title: ' ',
          targetKind: 'stage',
          targetId: 'gone',
          givenBy: 'x'.repeat(121),
          startsOn: '2026-13-01',
          months: 601,
          documentId: 'doc-photo',
          note: 'n'.repeat(1_001),
        }),
      ),
    ).toEqual([
      'unknown-warranty',
      'title-empty',
      'unknown-target',
      'given-by-too-long',
      'invalid-starts-on',
      'invalid-months',
      'document-not-warranty',
      'note-too-long',
    ]);
    expect(codes(validateWarrantyDraft(plan, { ...good, documentId: 'missing' }))).toEqual([
      'unknown-document',
    ]);
    expect(codes(validateWarrantyDraft(plan, { ...good, title: 'Two\nlines', months: 0 }))).toEqual(
      ['title-not-one-line', 'invalid-months'],
    );
    expect(
      codes(validateWarrantyDraft(plan, { ...good, targetKind: 'activity' as never })),
    ).toEqual(['invalid-target-kind']);
  });

  it('accepts a good task and says every problem of a bad one', () => {
    const task: MaintenanceDraft = {
      id: 't1',
      title: 'Reseal the shower',
      targetKind: 'work',
      targetId: 'work-1',
      everyMonths: 12,
      firstDueOn: '2026-11-01',
      note: null,
    };
    expect(validateMaintenanceDraft(plan, task)).toEqual([]);
    expect(
      codes(
        validateMaintenanceDraft(plan, {
          ...task,
          id: 'nope',
          title: 't'.repeat(201),
          targetId: 'another-work',
          everyMonths: 121,
          firstDueOn: 'soon',
        }),
      ),
    ).toEqual([
      'unknown-task',
      'title-too-long',
      'unknown-target',
      'invalid-every-months',
      'invalid-first-due-on',
    ]);
  });

  it('records a task done only on a day not after today and not before the last record', () => {
    const done = (doneOn: string, note: string | null = null) =>
      codes(validateMaintenanceDone(plan, { taskId: 't1', doneOn, note }, TODAY));
    expect(done(TODAY)).toEqual([]);
    expect(done('2026-09-10')).toEqual([]);
    expect(done('2026-09-09')).toEqual(['done-out-of-order']);
    expect(done('2026-10-06')).toEqual(['done-in-future']);
    expect(done('2026-02-30')).toEqual(['invalid-done-on']);
    expect(done(TODAY, 'n'.repeat(501))).toEqual(['done-note-too-long']);
    expect(
      codes(validateMaintenanceDone(plan, { taskId: 'nope', doneOn: TODAY, note: null }, TODAY)),
    ).toEqual(['unknown-task']);
  });
});

// ── Words ────────────────────────────────────────────────────────────────────

describe('the aftercare words', () => {
  it('are keys under aftercare., each once, and the list holds them all', () => {
    const all = [
      ...Object.values(AFTERCARE_WARRANTY_STATE_KEYS),
      ...Object.values(AFTERCARE_TASK_STATE_KEYS),
      ...Object.values(AFTERCARE_LABEL_KEYS),
      ...Object.values(AFTERCARE_CALENDAR_KEYS),
      ...Object.values(AFTERCARE_PROBLEM_KEYS),
    ];
    expect([...AFTERCARE_MESSAGE_KEYS].sort()).toEqual([...all].sort());
    expect(new Set(AFTERCARE_MESSAGE_KEYS).size).toBe(AFTERCARE_MESSAGE_KEYS.length);
    for (const key of AFTERCARE_MESSAGE_KEYS) expect(key).toMatch(/^aftercare\.[a-zA-Z.]+$/);
  });
});
