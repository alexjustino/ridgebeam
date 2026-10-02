import { describe, expect, it } from 'vitest';

import {
  activity,
  correction,
  entry,
  finished,
  link,
  person,
  snapshot,
  stage,
  worked,
} from '../__fixtures__/plan';
import { parseWorkingDays, type WorkingCalendar } from '../calendar';
import type { Photo } from '../diary';
import { traceable } from '../figure';
import { schedule } from '../schedule';
import {
  DASHBOARD_LABEL_KEYS,
  lastEntriesFigure,
  onSiteFigure,
  peopleExpectedFigure,
  WEATHER_LOST,
  weatherLostFigure,
  WEEK_DAY_STATUS_KEYS,
  weekDays,
  weekDaysWithoutEntryFigure,
  weekEntriesFigure,
  weekOf,
  type Week,
} from './index';

const calendar = (holidays: string[] = []): WorkingCalendar => ({
  workingDays: parseWorkingDays('1111100')!,
  hoursPerDay: 8,
  holidays: new Set(holidays),
});

/** The week the work starts in: Monday 31 August to Sunday 6 September 2026. */
const FIRST: Week = weekOf('2026-09-01')!;

const photo = (hash: string): Photo => ({
  fileHash: hash,
  fileName: `${hash}.jpg`,
  bytes: 1000,
  width: 640,
  height: 480,
  thumbnail: true,
});

describe('a week is Monday to Sunday', () => {
  it('starts on the Monday before a Tuesday, across the end of a month', () => {
    expect(FIRST).toEqual({
      from: '2026-08-31',
      to: '2026-09-06',
      days: [
        '2026-08-31',
        '2026-09-01',
        '2026-09-02',
        '2026-09-03',
        '2026-09-04',
        '2026-09-05',
        '2026-09-06',
      ],
    });
  });

  it('takes a Sunday back to its Monday, across the end of a year', () => {
    const week = weekOf('2027-01-03')!;
    expect(week.from).toBe('2026-12-28');
    expect(week.to).toBe('2027-01-03');
    expect(week.days).toContain('2027-01-01');
  });

  it('keeps a Monday as its own first day', () => {
    expect(weekOf('2026-09-28')!.from).toBe('2026-09-28');
    expect(weekOf('2026-09-28')!.to).toBe('2026-10-04');
  });

  it('is not made of a day that is not a day', () => {
    expect(weekOf('2026-02-30')).toBeNull();
    expect(weekOf('')).toBeNull();
  });
});

describe('the days of a week', () => {
  it('says of each day what the diary and the calendar say, today not over', () => {
    const entries = [
      entry(1, '2026-09-01', { weather: 'rain' }),
      entry(2, '2026-09-01', { weather: 'sun', lostDay: true }),
    ];
    const days = weekDays(calendar(['2026-09-02']), FIRST, '2026-09-04', '2026-09-01', entries);
    expect(days.map((day) => [day.day, day.status])).toEqual([
      ['2026-08-31', 'before-start'],
      ['2026-09-01', 'written'],
      ['2026-09-02', 'not-working'],
      ['2026-09-03', 'missing'],
      ['2026-09-04', 'to-come'],
      ['2026-09-05', 'not-working'],
      ['2026-09-06', 'not-working'],
    ]);
    expect(days[1]).toMatchObject({ seqs: [1, 2], weather: ['sun', 'rain'], lostDay: true });
    expect(days[2]).toMatchObject({ working: false, holiday: true, seqs: [], lostDay: false });
    expect(days[3]).toMatchObject({ working: true, holiday: false });
  });

  it('calls a weekend day written when somebody wrote about it', () => {
    const days = weekDays(calendar(), FIRST, '2026-09-10', '2026-09-01', [entry(1, '2026-09-05')]);
    expect(days[5]).toMatchObject({ status: 'written', working: false });
    expect(days.filter((day) => day.status === 'missing').map((day) => day.day)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
    ]);
  });

  it('calls no day missing or not working when the calendar cannot be counted on', () => {
    const days = weekDays(null, FIRST, '2026-09-10', '2026-09-01', [entry(1, '2026-09-02')]);
    expect(days.map((day) => day.status)).toEqual([
      'before-start',
      'unknown',
      'written',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
    ]);
    expect(days.every((day) => day.working === null && !day.holiday)).toBe(true);
  });

  it('puts nothing before a start that is not a day', () => {
    const days = weekDays(calendar(), FIRST, '2026-09-10', 'soon', []);
    expect(days[0]!.status).toBe('missing');
  });

  it('reads the effective entries: a correction that moved a day out of the week takes it along', () => {
    const entries = [entry(1, '2026-09-03'), correction(2, 1, '2026-08-28')];
    const days = weekDays(calendar(), FIRST, '2026-09-10', '2026-09-01', entries);
    expect(days[3]!.status).toBe('missing');
    expect(weekEntriesFigure(entries, FIRST).rows).toEqual([]);
  });

  it('names every status with a message key', () => {
    expect(Object.keys(WEEK_DAY_STATUS_KEYS).sort()).toEqual(
      ['before-start', 'missing', 'not-working', 'to-come', 'unknown', 'written'].sort(),
    );
  });
});

describe('this week on site', () => {
  const entries = [
    entry(1, '2026-09-02', {
      note: 'Tiles delivered',
      weather: 'cloud',
      done: [worked('tile')],
      present: ['p1', 'p2'],
      photos: [photo('a')],
    }),
    entry(2, '2026-09-01', { note: 'First day' }),
    correction(3, 1, '2026-09-02', { note: 'Tiles delivered, and laid', done: [finished('tile')] }),
    entry(4, '2026-09-08'),
  ];

  it('counts the effective entries of the week, by day, a correction in place of what it corrects', () => {
    const figure = weekEntriesFigure(entries, FIRST);
    expect(figure.label).toBe(DASHBOARD_LABEL_KEYS.weekEntries);
    expect(figure.value).toBe(2);
    expect(figure.rows.map((row) => [row.seq, row.day, row.kind, row.correctsSeq])).toEqual([
      [2, '2026-09-01', 'entry', null],
      [3, '2026-09-02', 'correction', 1],
    ]);
    expect(figure.rows[1]).toMatchObject({
      key: 'entry:3',
      itemId: '3',
      title: 'Tiles delivered, and laid',
      correctedBySeq: null,
      doneCount: 1,
      presentCount: 0,
      photos: [],
    });
    expect(figure.rows[0]!.title).toBe('First day');
    expect(traceable(figure)).toBe(true);
  });

  it('gives an entry with no note an empty title, never an invented one', () => {
    const figure = weekEntriesFigure([entry(1, '2026-09-01')], FIRST);
    expect(figure.rows[0]!.title).toBe('');
  });

  it('lists the working days of the week that are over with nothing written', () => {
    const days = weekDays(calendar(), FIRST, '2026-09-04', '2026-09-01', entries);
    const figure = weekDaysWithoutEntryFigure(days);
    expect(figure.label).toBe(DASHBOARD_LABEL_KEYS.weekDaysWithoutEntry);
    expect(figure.rows.map((row) => row.day)).toEqual(['2026-09-03']);
    expect(figure.rows[0]).toEqual({
      key: 'day:2026-09-03',
      itemId: null,
      title: '2026-09-03',
      day: '2026-09-03',
      minutes: 0,
    });
    expect(traceable(figure)).toBe(true);
  });

  it('lists every working day that is over in a week with no entry', () => {
    const days = weekDays(calendar(), weekOf('2026-09-14')!, '2026-09-30', '2026-09-01', entries);
    expect(weekDaysWithoutEntryFigure(days).value).toBe(5);
  });
});

describe('who was on site', () => {
  const plan = snapshot({
    people: [person('p1', 'Zé', { trade: 'Tiler' }), person('p2', 'Ana'), person('p3', 'Bia')],
  });

  it('names everyone the effective entries of the week name, by name, gone ids last', () => {
    const entries = [
      entry(1, '2026-09-01', { present: ['p1', 'p3'] }),
      correction(2, 1, '2026-09-01', { present: ['p1'] }),
      entry(3, '2026-09-03', { present: ['p1', 'p2', 'gone', 'also-gone'] }),
      entry(4, '2026-09-02', { present: ['p1'] }),
      entry(5, '2026-09-09', { present: ['p3'] }),
    ];
    const figure = onSiteFigure(plan, entries, FIRST);
    expect(figure.label).toBe(DASHBOARD_LABEL_KEYS.onSite);
    expect(figure.rows.map((row) => [row.personId, row.title, row.known, row.days])).toEqual([
      ['p2', 'Ana', true, ['2026-09-03']],
      ['p1', 'Zé', true, ['2026-09-01', '2026-09-02', '2026-09-03']],
      ['also-gone', 'also-gone', false, ['2026-09-03']],
      ['gone', 'gone', false, ['2026-09-03']],
    ]);
    expect(figure.rows[1]).toMatchObject({ trade: 'Tiler', day: '2026-09-03', itemId: 'p1' });
    expect(figure.rows[2]).toMatchObject({ trade: null, itemId: null });
    expect(traceable(figure)).toBe(true);
  });

  it('is empty in a week nobody was recorded', () => {
    expect(onSiteFigure(plan, [entry(1, '2026-09-01')], FIRST).value).toBe(0);
  });

  it('orders two people of one name by id', () => {
    const twins = snapshot({ people: [person('b', 'Same'), person('a', 'Same')] });
    const figure = onSiteFigure(twins, [entry(1, '2026-09-01', { present: ['b', 'a'] })], FIRST);
    expect(figure.rows.map((row) => row.personId)).toEqual(['a', 'b']);
  });
});

describe('the people expected', () => {
  // Tiling from Tue 1 September for 3 days, then Grout for 1, then Painting from Mon 7 September.
  const base = snapshot({
    people: [
      person('tiler', 'Tiler person'),
      person('painter', 'Painter person', { stageIds: ['paint'] }),
      person('both', 'Both person', { stageIds: ['paint', 'bath', 'paint', 'gone'] }),
      person('idle', 'Idle person', { stageIds: ['done'] }),
      person('twin', 'Tiler person'),
    ],
    stages: [
      stage('bath', 1, 'Bathroom'),
      stage('paint', 2, 'Painting'),
      {
        ...stage('done', 3, 'Done'),
        startedAt: '2026-08-01T00:00:00.000Z',
        closedAt: '2026-08-02T00:00:00.000Z',
      },
    ],
    activities: [
      activity('tile', 'bath', 1, 3, 'tiler'),
      activity('grout', 'bath', 2, 1, 'both'),
      activity('walls', 'paint', 1, 2, 'painter'),
      activity('late', 'paint', 2, 1, 'twin'),
      activity('nobody', 'bath', 3, 1, 'someone-gone'),
      activity('unplaced', 'bath', 4, null, 'painter'),
    ],
    dependencies: [
      link('l1', 'tile', 'grout'),
      link('l2', 'grout', 'walls'),
      link('l3', 'walls', 'late'),
    ],
  });

  it('names who answers for an activity placed in the week, and who is on a running stage', () => {
    const plan = {
      ...base,
      stages: base.stages.map((each) =>
        each.id === 'bath' ? { ...each, startedAt: '2026-09-01T08:00:00.000Z' } : each,
      ),
    };
    const figure = peopleExpectedFigure(plan, schedule(plan), FIRST);
    expect(figure.label).toBe(DASHBOARD_LABEL_KEYS.peopleExpected);
    expect(figure.rows.map((row) => [row.personId, row.activityIds, row.stageIds])).toEqual([
      ['both', ['grout'], ['bath']],
      ['tiler', ['tile'], []],
    ]);
    expect(figure.rows[0]).toMatchObject({
      key: 'person:both',
      itemId: 'both',
      title: 'Both person',
      day: null,
      trade: null,
    });
    expect(traceable(figure)).toBe(true);
  });

  it('takes an activity that overlaps the week at either end, and a running stage in plan order', () => {
    const plan = {
      ...base,
      stages: base.stages.map((each) =>
        each.id === 'done' ? each : { ...each, startedAt: '2026-09-01T08:00:00.000Z' },
      ),
    };
    const next = weekOf('2026-09-07')!;
    const figure = peopleExpectedFigure(plan, schedule(plan), next);
    // Painting runs Mon 7 – Tue 8; Late on Wed 9; the idle person's stage is closed.
    expect(figure.rows.map((row) => [row.personId, row.activityIds, row.stageIds])).toEqual([
      ['both', [], ['bath', 'paint']],
      ['painter', ['walls'], ['paint']],
      ['twin', ['late'], []],
    ]);
  });

  it('orders two people of one name by id', () => {
    const plan = snapshot({
      people: [person('b', 'Same'), person('a', 'Same')],
      stages: [stage('s', 1)],
      activities: [activity('x', 's', 1, 1, 'b'), activity('y', 's', 2, 1, 'a')],
    });
    const figure = peopleExpectedFigure(plan, schedule(plan), FIRST);
    expect(figure.rows.map((row) => row.personId)).toEqual(['a', 'b']);
  });

  it('is empty when nobody is placed in the week and no stage runs', () => {
    const figure = peopleExpectedFigure(base, schedule(base), weekOf('2026-10-12')!);
    expect(figure.rows).toEqual([]);
    expect(traceable(figure)).toBe(true);
  });
});

describe('weather days lost', () => {
  it('counts a day of rain or storm on which nothing was done, storm the worse', () => {
    const entries = [
      entry(1, '2026-09-01', { weather: 'rain' }),
      entry(2, '2026-09-02', { weather: 'rain' }),
      entry(3, '2026-09-02', { weather: 'storm', lostDay: true }),
      entry(4, '2026-09-03', { weather: 'rain' }),
      entry(5, '2026-09-03', { weather: 'sun', done: [worked('tile')] }),
      entry(6, '2026-09-04', { weather: 'sun', lostDay: true }),
      entry(7, '2026-09-08', { weather: 'storm' }),
      entry(8, '2026-09-09', { weather: null }),
    ];
    const figure = weatherLostFigure(entries);
    expect(figure.label).toBe(DASHBOARD_LABEL_KEYS.weatherLost);
    expect(figure.rows.map((row) => [row.day, row.weather, row.lostDay, row.seqs])).toEqual([
      ['2026-09-01', 'rain', false, [1]],
      ['2026-09-02', 'storm', true, [2, 3]],
      ['2026-09-08', 'storm', false, [7]],
    ]);
    expect(figure.rows[0]).toMatchObject({
      key: 'day:2026-09-01',
      itemId: null,
      title: '2026-09-01',
    });
    expect(traceable(figure)).toBe(true);
    expect(weatherLostFigure(entries, FIRST).rows.map((row) => row.day)).toEqual([
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('reads the correction, not what it corrects', () => {
    const entries = [
      entry(1, '2026-09-01', { weather: 'rain' }),
      correction(2, 1, '2026-09-01', { weather: 'sun' }),
    ];
    expect(weatherLostFigure(entries).value).toBe(0);
    const back = [
      entry(1, '2026-09-01', { weather: 'sun' }),
      correction(2, 1, '2026-09-01', { weather: 'rain' }),
    ];
    expect(weatherLostFigure(back).rows.map((row) => row.seqs)).toEqual([[2]]);
  });

  it('is rain and storm only', () => {
    expect(WEATHER_LOST).toEqual(['rain', 'storm']);
  });
});

describe('the last entries', () => {
  const entries = [
    entry(1, '2026-09-01', { photos: [photo('a'), photo('b')] }),
    entry(2, '2026-09-02'),
    correction(3, 1, '2026-09-01'),
    entry(4, '2026-09-03', { weather: 'rain', lostDay: true, present: ['p'] }),
  ];

  it('are the last three written, newest first, corrections included and said', () => {
    const figure = lastEntriesFigure([...entries].reverse());
    expect(figure.label).toBe(DASHBOARD_LABEL_KEYS.lastEntries);
    expect(figure.rows.map((row) => [row.seq, row.correctsSeq, row.correctedBySeq])).toEqual([
      [4, null, null],
      [3, 1, null],
      [2, null, null],
    ]);
    expect(figure.rows[0]).toMatchObject({ weather: 'rain', lostDay: true, presentCount: 1 });
    expect(traceable(figure)).toBe(true);
  });

  it('say which entry corrected an older one, and carry its photos', () => {
    const figure = lastEntriesFigure(entries, 4);
    expect(figure.rows[3]).toMatchObject({ seq: 1, correctedBySeq: 3 });
    expect(figure.rows[3]!.photos.map((each) => each.fileHash)).toEqual(['a', 'b']);
  });

  it('are none in an empty diary, or when none are asked for', () => {
    expect(lastEntriesFigure([]).value).toBe(0);
    expect(lastEntriesFigure(entries, 0).value).toBe(0);
    expect(lastEntriesFigure(entries, -2).value).toBe(0);
  });
});
