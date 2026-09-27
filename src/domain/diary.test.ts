import { describe, expect, it } from 'vitest';

import {
  activity,
  correction,
  entry,
  finished,
  snapshot,
  stage,
  worked,
} from './__fixtures__/plan';
import { parseWorkingDays, type WorkingCalendar } from './calendar';
import * as diary from './diary';
import {
  correctedBy,
  daysWithoutEntry,
  daysWithoutEntryFigure,
  doneFigure,
  effectiveEntries,
  entriesByDay,
  lostDays,
  lostDaysFigure,
  progress,
  stageProgress,
  thisWeek,
  validateDraft,
  type DiaryEntry,
  type EntryDraft,
} from './diary';
import { traceable } from './figure';

/**
 * A bathroom: Tiling (12 m², 3 d) and Grout (no quantity, 1 d); Painting with Paint. One person.
 * The work starts Tuesday 1 September 2026, Monday to Friday.
 */
const PLAN = snapshot({
  people: [{ id: 'tiler', name: 'Sample tiler' }],
  stages: [stage('bath', 1, 'Bathroom'), stage('paint', 2, 'Painting')],
  activities: [
    { ...activity('tile', 'bath', 1, 3), quantity: 12, unit: 'm²' },
    activity('grout', 'bath', 2, 1),
    activity('walls', 'paint', 1, 2),
  ],
});

const WEEKDAYS: WorkingCalendar = {
  workingDays: parseWorkingDays('1111100')!,
  hoursPerDay: 8,
  holidays: new Set(),
};

const seqs = (entries: readonly DiaryEntry[]) => entries.map((e) => e.seq);

describe('an entry is corrected, never edited', () => {
  it('has no way to change an entry: the module offers no edit, update, delete or replace', () => {
    const names = Object.keys(diary);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((name) => /edit|update|delete|remove|replace|set/i.test(name))).toEqual([]);
  });

  it('keeps every entry when none is corrected', () => {
    const entries = [entry(1, '2026-09-01'), entry(2, '2026-09-02')];
    expect(seqs(effectiveEntries(entries))).toEqual([1, 2]);
  });

  it('lets a correction speak for the day instead of the entry it corrects', () => {
    const entries = [
      entry(1, '2026-09-01'),
      entry(2, '2026-09-02'),
      correction(3, 1, '2026-09-01'),
    ];
    expect(seqs(effectiveEntries(entries))).toEqual([2, 3]);
    expect(correctedBy(entries)).toEqual(new Map([[1, 3]]));
  });

  it('lets the last of a chain of corrections win', () => {
    const entries = [
      entry(1, '2026-09-01'),
      correction(2, 1, '2026-09-01'),
      correction(3, 2, '2026-09-01'),
    ];
    expect(seqs(effectiveEntries(entries))).toEqual([3]);
    expect(correctedBy(entries)).toEqual(
      new Map([
        [1, 2],
        [2, 3],
      ]),
    );
  });

  it('lets the latest correction win when an entry was corrected twice', () => {
    const twice = [
      entry(1, '2026-09-01'),
      correction(2, 1, '2026-09-01'),
      correction(3, 1, '2026-09-01'),
    ];
    expect(seqs(effectiveEntries(twice))).toEqual([3]);
    expect(correctedBy(twice)).toEqual(new Map([[1, 3]]));
    // And across branches: the highest seq in the family speaks.
    const branched = [...twice, correction(4, 2, '2026-09-01')];
    expect(seqs(effectiveEntries(branched))).toEqual([4]);
  });

  it('keeps a correction naming an entry that is not there, rather than dropping it', () => {
    const entries = [
      entry(1, '2026-09-01'),
      correction(5, 4, '2026-09-02'),
      correction(6, 9, '2026-09-03'),
    ];
    expect(seqs(effectiveEntries(entries))).toEqual([1, 5, 6]);
    expect(correctedBy(entries).size).toBe(0);
  });

  it('reads the entries in any order, and changes nothing it was given', () => {
    const entries = [
      correction(3, 1, '2026-09-01'),
      entry(2, '2026-09-02'),
      entry(1, '2026-09-01'),
    ];
    const copy = [...entries];
    expect(seqs(effectiveEntries(entries))).toEqual([2, 3]);
    expect(entries).toEqual(copy);
  });
});

describe('the day view', () => {
  it('groups entries by day, newest day first, a second entry on a day kept and ordered after the first', () => {
    const entries = [
      entry(3, '2026-09-02'),
      entry(1, '2026-09-01'),
      entry(2, '2026-09-02'),
      correction(4, 1, '2026-09-01'),
    ];
    expect(entriesByDay(entries).map(({ day, entries: list }) => [day, seqs(list)])).toEqual([
      ['2026-09-02', [2, 3]],
      ['2026-09-01', [1, 4]],
    ]);
  });

  it('is empty with no entries', () => {
    expect(entriesByDay([])).toEqual([]);
  });
});

describe('progress, derived from the diary', () => {
  const of = (entries: DiaryEntry[], id: string) => progress(PLAN, entries).get(id)!;

  it('is not started, for every activity, with an empty diary', () => {
    const states = progress(PLAN, []);
    expect([...states.keys()]).toEqual(['tile', 'grout', 'walls']);
    expect(states.get('tile')).toEqual({
      activityId: 'tile',
      state: 'not-started',
      startedOn: null,
      finishedOn: null,
      lastOn: null,
      quantityDone: null,
      share: null,
    });
  });

  it('is started from the first day the diary says it was worked on', () => {
    const entries = [
      entry(1, '2026-09-02', { done: [worked('tile')] }),
      entry(2, '2026-09-03', { done: [worked('tile')] }),
    ];
    expect(of(entries, 'tile')).toMatchObject({
      state: 'started',
      startedOn: '2026-09-02',
      finishedOn: null,
      lastOn: '2026-09-03',
    });
  });

  it('is finished from the first day the diary says so', () => {
    const entries = [
      entry(1, '2026-09-01', { done: [worked('tile')] }),
      entry(2, '2026-09-03', { done: [finished('tile')] }),
    ];
    expect(of(entries, 'tile')).toMatchObject({
      state: 'finished',
      startedOn: '2026-09-01',
      finishedOn: '2026-09-03',
    });
  });

  it('takes the earliest entry of a day first when two are about the same day', () => {
    const entries = [
      entry(3, '2026-09-02', { done: [finished('tile')] }),
      entry(1, '2026-09-02', { done: [worked('tile', 2)] }),
      entry(2, '2026-09-01', { done: [worked('tile', 1)] }),
    ];
    expect(of(entries, 'tile')).toMatchObject({
      startedOn: '2026-09-01',
      finishedOn: '2026-09-02',
      lastOn: '2026-09-02',
      quantityDone: 3,
    });
  });

  it('reads the days, not the order entries were written in', () => {
    // Entry 2 is written later about an earlier day: it is the start.
    const entries = [
      entry(1, '2026-09-04', { done: [worked('tile')] }),
      entry(2, '2026-09-02', { done: [worked('tile')] }),
    ];
    expect(of(entries, 'tile')).toMatchObject({ startedOn: '2026-09-02', lastOn: '2026-09-04' });
  });

  it('gives a share from quantities, and never above 99 before the diary says finished', () => {
    const five = [entry(1, '2026-09-01', { done: [worked('tile', 5)] })];
    expect(of(five, 'tile')).toMatchObject({ quantityDone: 5, share: 42 });
    // 13 m² of 12 laid, and nobody said finished: the plan does not say 100 for them.
    const over = [...five, entry(2, '2026-09-02', { done: [worked('tile', 8)] })];
    expect(of(over, 'tile')).toMatchObject({ state: 'started', quantityDone: 13, share: 99 });
    const done = [...over, entry(3, '2026-09-03', { done: [finished('tile')] })];
    expect(of(done, 'tile')).toMatchObject({ state: 'finished', share: 100 });
  });

  it('invents no number: no share without the activity’s quantity or the quantities done', () => {
    const noneDone = [entry(1, '2026-09-01', { done: [worked('tile')] })];
    expect(of(noneDone, 'tile')).toMatchObject({
      state: 'started',
      quantityDone: null,
      share: null,
    });
    // Grout has no quantity: finished is a state, and the share stays null.
    const grout = [entry(1, '2026-09-01', { done: [finished('grout', 3)] })];
    expect(of(grout, 'grout')).toMatchObject({ state: 'finished', quantityDone: 3, share: null });
    const zero = snapshot({
      ...PLAN,
      activities: [{ ...activity('tile', 'bath', 1, 3), quantity: 0 }],
    });
    expect(
      progress(zero, [entry(1, '2026-09-01', { done: [worked('tile', 2)] })]).get('tile')!.share,
    ).toBeNull();
  });

  it('counts only what the effective entries say: a corrected line is gone', () => {
    // Entry 1 said the tiling was finished; the correction says it was only worked on, 4 m².
    const entries = [
      entry(1, '2026-09-01', { done: [finished('tile', 12)] }),
      correction(2, 1, '2026-09-01', { done: [worked('tile', 4)] }),
    ];
    expect(of(entries, 'tile')).toMatchObject({ state: 'started', quantityDone: 4, share: 33 });
  });

  it('ignores a line about an activity that is not in the plan', () => {
    const entries = [entry(1, '2026-09-01', { done: [worked('gone'), worked('tile')] })];
    expect(progress(PLAN, entries).has('gone')).toBe(false);
    expect(of(entries, 'tile').state).toBe('started');
  });

  it('counts states stage by stage', () => {
    const entries = [entry(1, '2026-09-01', { done: [finished('tile'), worked('grout')] })];
    expect(stageProgress(PLAN, progress(PLAN, entries))).toEqual([
      { stageId: 'bath', notStarted: 0, started: 1, finished: 1, total: 2 },
      { stageId: 'paint', notStarted: 1, started: 0, finished: 0, total: 1 },
    ]);
    expect(stageProgress(PLAN, new Map())[0]).toMatchObject({ notStarted: 2, total: 2 });
  });
});

describe('days without an entry', () => {
  it('are the working days from the start up to yesterday that no entry is about', () => {
    const entries = [entry(1, '2026-09-01'), entry(2, '2026-09-03')];
    // Today is Monday 7: Wed 2 and Fri 4 have nothing; the weekend is not a working day; today is
    // not over.
    expect(daysWithoutEntry(WEEKDAYS, '2026-09-07', '2026-09-01', entries)).toEqual([
      '2026-09-02',
      '2026-09-04',
    ]);
  });

  it('start at the first entry when it is later than the start', () => {
    const entries = [entry(1, '2026-09-03')];
    expect(daysWithoutEntry(WEEKDAYS, '2026-09-07', '2026-09-01', entries)).toEqual(['2026-09-04']);
  });

  it('start at the work’s start with an empty diary', () => {
    expect(daysWithoutEntry(WEEKDAYS, '2026-09-04', '2026-09-01', [])).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
  });

  it('leave out a holiday, and follow a correction that moved an entry to another day', () => {
    const holiday = { ...WEEKDAYS, holidays: new Set(['2026-09-02']) };
    const entries = [
      entry(1, '2026-09-01'),
      entry(2, '2026-09-03'),
      correction(3, 2, '2026-09-04'),
    ];
    expect(daysWithoutEntry(holiday, '2026-09-07', '2026-09-01', entries)).toEqual(['2026-09-03']);
  });

  it('are none when today is not a day, rather than a guess', () => {
    expect(daysWithoutEntry(WEEKDAYS, 'today', '2026-09-01', [])).toEqual([]);
    expect(daysWithoutEntry(WEEKDAYS, '2026-09-07', 'start', [])).toEqual([]);
  });

  it('make a traceable figure that opens onto the days', () => {
    const figure = daysWithoutEntryFigure(['2026-09-02', '2026-09-04']);
    expect(figure).toMatchObject({ id: 'days-without-entry', unit: 'count', value: 2 });
    expect(figure.rows.map((row) => row.day)).toEqual(['2026-09-02', '2026-09-04']);
    expect(traceable(figure)).toBe(true);
  });
});

describe('days lost', () => {
  it('are the days an effective entry says no work was possible, each once', () => {
    const entries = [
      entry(1, '2026-09-03', { lostDay: true, weather: 'rain' }),
      entry(2, '2026-09-03', { lostDay: true }),
      entry(3, '2026-09-01', { lostDay: true }),
      correction(4, 3, '2026-09-01', { lostDay: false }),
      entry(5, '2026-09-02'),
    ];
    expect(lostDays(entries)).toEqual(['2026-09-03']);
    expect(traceable(lostDaysFigure(lostDays(entries)))).toBe(true);
    expect(lostDaysFigure(lostDays(entries))).toMatchObject({ id: 'lost-days', value: 1 });
  });
});

describe('this week on site', () => {
  it('holds the effective entries of the seven days ending today, the days and the people', () => {
    const entries = [
      entry(1, '2026-08-31', { present: ['tiler'] }), // eight days before: out
      entry(2, '2026-09-02', { present: ['tiler', 'helper'] }),
      entry(3, '2026-09-08', { present: ['helper'] }),
      entry(4, '2026-09-08'),
      correction(5, 4, '2026-09-08', { present: ['visitor'] }),
    ];
    const week = thisWeek(entries, '2026-09-08');
    expect(week).toMatchObject({
      from: '2026-09-02',
      to: '2026-09-08',
      days: ['2026-09-02', '2026-09-08'],
      people: ['tiler', 'helper', 'visitor'],
    });
    expect(seqs(week.entries)).toEqual([2, 3, 5]);
  });

  it('is empty against a today that is not a day', () => {
    expect(thisWeek([entry(1, '2026-09-01')], 'today').entries).toEqual([]);
  });
});

describe('checking a draft before the host is asked', () => {
  const draft = (parts: Partial<EntryDraft> = {}): EntryDraft => ({
    day: '2026-09-02',
    kind: 'entry',
    correctsSeq: null,
    note: null,
    weather: 'sun',
    lostDay: false,
    hours: 8,
    deliveries: null,
    incidents: null,
    visitors: null,
    done: [worked('tile', 4)],
    present: ['tiler'],
    photoPaths: [],
    photoHashes: [],
    ...parts,
  });
  const existing = [entry(1, '2026-09-01'), entry(2, '2026-09-02')];
  const check = (parts: Partial<EntryDraft> = {}) =>
    validateDraft(draft(parts), '2026-09-02', PLAN, existing).map((problem) => problem.code);

  it('accepts a plain entry, and a second entry on a day that already has one', () => {
    expect(check()).toEqual([]);
  });

  it('refuses a day in the future, and a day that is not a day', () => {
    expect(check({ day: '2026-09-03' })).toEqual(['future-day']);
    expect(check({ day: '2026-02-30' })).toEqual(['invalid-day']);
  });

  it('refuses an activity or a person that is not in the plan', () => {
    expect(
      validateDraft(
        draft({ done: [worked('gone')], present: ['nobody'] }),
        '2026-09-02',
        PLAN,
        existing,
      ),
    ).toEqual([
      { code: 'unknown-activity', activityId: 'gone' },
      { code: 'unknown-person', personId: 'nobody' },
    ]);
  });

  it('refuses a correction of an entry the diary does not have', () => {
    expect(
      validateDraft(
        draft({ kind: 'correction', correctsSeq: 9, note: 'Wrong day' }),
        '2026-09-02',
        PLAN,
        existing,
      ),
    ).toEqual([{ code: 'corrects-unknown', seq: 9 }]);
  });

  it('refuses a correction with no note saying what was wrong, or naming nothing', () => {
    expect(check({ kind: 'correction', correctsSeq: 1, note: '   ' })).toEqual([
      'correction-note-empty',
    ]);
    expect(check({ kind: 'correction', correctsSeq: null, note: 'x' })).toEqual([
      'correction-without-seq',
    ]);
    expect(check({ kind: 'correction', correctsSeq: 1, note: null })).toEqual([
      'correction-note-empty',
    ]);
    expect(check({ kind: 'correction', correctsSeq: 1, note: 'Wrong quantity' })).toEqual([]);
  });

  it('refuses an entry that names a seq, as only a correction does', () => {
    expect(check({ correctsSeq: 1 })).toEqual(['entry-with-corrects']);
  });

  it('refuses a negative quantity', () => {
    expect(check({ done: [worked('tile', -1)] })).toEqual(['negative-quantity']);
    expect(check({ done: [worked('tile', Number.NaN)] })).toEqual(['negative-quantity']);
    expect(check({ done: [worked('tile', 0)] })).toEqual([]);
  });

  it('refuses worked and finished for the same activity in one entry, and the same line twice', () => {
    expect(check({ done: [worked('tile'), finished('tile')] })).toEqual(['worked-and-finished']);
    expect(check({ done: [worked('tile'), worked('tile')] })).toEqual(['duplicate-activity']);
  });

  it('refuses a weather it does not know, hours outside a day, and text over its limit', () => {
    expect(check({ weather: 'hail' as never })).toEqual(['invalid-weather']);
    expect(check({ hours: 25 })).toEqual(['invalid-hours']);
    expect(check({ hours: -1 })).toEqual(['invalid-hours']);
    expect(check({ note: 'x'.repeat(4001) })).toEqual(['too-long']);
    expect(check({ visitors: 'x'.repeat(2001) })).toEqual(['too-long']);
    expect(check({ done: [{ ...worked('tile'), note: 'x'.repeat(501) }] })).toEqual(['too-long']);
    expect(check({ note: 'x'.repeat(4000), weather: null, hours: null })).toEqual([]);
  });

  it('reports every problem at once, never throwing', () => {
    expect(() => check({ day: 'soon', hours: 99, done: [worked('gone', -2)] })).not.toThrow();
    expect(check({ day: 'soon', hours: 99, done: [worked('gone', -2)] })).toEqual([
      'invalid-day',
      'unknown-activity',
      'negative-quantity',
      'invalid-hours',
    ]);
  });
});

describe('the done figures', () => {
  const entries = [entry(1, '2026-09-01', { done: [finished('tile'), worked('grout')] })];
  const states = progress(PLAN, entries);

  it('count the finished activities by default, and open onto them', () => {
    const figure = doneFigure(PLAN, states);
    expect(figure).toMatchObject({ id: 'done:finished', label: 'diary.figure.finished', value: 1 });
    expect(figure.rows).toEqual([
      {
        key: 'activity:tile',
        itemId: 'tile',
        title: 'Activity tile',
        day: '2026-09-01',
        minutes: 0,
        activityId: 'tile',
        state: 'finished',
        startedOn: '2026-09-01',
        finishedOn: '2026-09-01',
      },
    ]);
    expect(traceable(figure)).toBe(true);
  });

  it('together hold every activity once, and each is traceable', () => {
    const all = (['finished', 'started', 'not-started'] as const).map((state) =>
      doneFigure(PLAN, states, state),
    );
    expect(all.map((figure) => figure.value)).toEqual([1, 1, 1]);
    expect(all.flatMap((figure) => figure.rows.map((row) => row.activityId)).sort()).toEqual([
      'grout',
      'tile',
      'walls',
    ]);
    for (const figure of all) expect(traceable(figure)).toBe(true);
    expect(all[2]!.rows[0]).toMatchObject({ activityId: 'walls', day: null, startedOn: null });
  });

  it('count an activity missing from the progress as not started', () => {
    expect(doneFigure(PLAN, new Map(), 'not-started').value).toBe(3);
  });
});
