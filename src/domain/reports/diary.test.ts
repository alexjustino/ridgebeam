import { describe, expect, it } from 'vitest';

import {
  activity,
  correction,
  entry,
  finished,
  person,
  snapshot,
  stage,
  worked,
} from '../__fixtures__/plan';
import { effectiveEntries } from '../diary';
import { DIARY_ROW_STATUS_KEYS, diaryReport } from './diary';

const PLAN = snapshot({
  people: [person('p1', 'Sample tiler')],
  stages: [stage('bath', 1, 'Bathroom')],
  activities: [
    { ...activity('tile', 'bath', 1, 3), quantity: 12, unit: 'm²' },
    activity('grout', 'bath', 2, 1),
    activity('orphan', 'gone', 1, 1),
  ],
});

/**
 * 1 is corrected by 2, and again by 3 (so 3 speaks for the day, and 2 is corrected though nobody
 * names it); 4 stands alone; 5 names a seq the diary does not have, and so is its own original.
 */
const ENTRIES = [
  entry(4, '2026-09-03', {
    done: [worked('grout', 2), finished('orphan'), worked('gone-activity')],
    present: ['p1', 'gone-person'],
    photos: [
      { fileHash: 'aa', fileName: 'a.jpg', bytes: 1, width: 1, height: 1, thumbnail: true },
      { fileHash: 'bb', fileName: 'b.jpg', bytes: 1, width: 1, height: 1, thumbnail: false },
    ],
  }),
  entry(1, '2026-09-01', {
    note: 'Tiling started',
    weather: 'sun',
    hours: 8,
    deliveries: 'Tiles',
    incidents: 'None',
    visitors: 'Architect',
    done: [{ activityId: 'tile', state: 'worked', quantity: 4, note: 'Half the floor' }],
  }),
  correction(2, 1, '2026-09-01', { note: 'Wrong quantity' }),
  correction(3, 1, '2026-09-01', { note: 'Wrong again', lostDay: true }),
  correction(5, 99, '2026-08-31'),
];

describe('the diary as a document', () => {
  const report = diaryReport(PLAN, ENTRIES);
  const row = (seq: number) => report.rows.find((each) => each.seq === seq)!;

  it('prints every entry once, in the order it was written', () => {
    expect(report.rows.map((each) => each.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('says which entries speak for their day, and which were corrected and by what', () => {
    expect(
      report.rows.map((each) => [
        each.seq,
        each.kind,
        each.correctsSeq,
        each.status,
        each.correctedBySeq,
        each.supersededBySeq,
      ]),
    ).toEqual([
      [1, 'entry', null, 'corrected', 3, 3],
      [2, 'correction', 1, 'corrected', null, 3],
      [3, 'correction', 1, 'effective', null, null],
      [4, 'entry', null, 'effective', null, null],
      [5, 'correction', 99, 'effective', null, null],
    ]);
  });

  it('has exactly the effective entries of the diary as its effective rows', () => {
    expect(
      report.rows.filter((each) => each.status === 'effective').map((each) => each.seq),
    ).toEqual(effectiveEntries(ENTRIES).map((each) => each.seq));
  });

  it('carries every field of an entry as it was written', () => {
    expect(row(1)).toMatchObject({
      day: '2026-09-01',
      authorName: 'Sample author',
      createdAt: '2026-09-01T18:00:00.000Z',
      weather: 'sun',
      lostDay: false,
      hours: 8,
      note: 'Tiling started',
      deliveries: 'Tiles',
      incidents: 'None',
      visitors: 'Architect',
      photoCount: 0,
      photoHashes: [],
      hash: '1'.padStart(64, '0'),
      prevHash: '',
    });
    expect(row(1).done).toEqual([
      {
        activityId: 'tile',
        name: 'Activity tile',
        number: '1.1',
        state: 'worked',
        quantity: 4,
        unit: 'm²',
        note: 'Half the floor',
      },
    ]);
    expect(row(3).lostDay).toBe(true);
  });

  it('names what the plan has now, and keeps the ids it no longer has without a name', () => {
    expect(row(4).done.map((line) => [line.activityId, line.name, line.number, line.unit])).toEqual(
      [
        ['grout', 'Activity grout', '1.2', null],
        ['orphan', 'Activity orphan', null, null],
        ['gone-activity', null, null, null],
      ],
    );
    expect(row(4).present).toEqual([
      { personId: 'p1', name: 'Sample tiler' },
      { personId: 'gone-person', name: null },
    ]);
    expect(row(4)).toMatchObject({ photoCount: 2, photoHashes: ['aa', 'bb'] });
  });

  it('says why a lost day was lost and who it is put down to, by name while they are in the plan', () => {
    const lost = [
      entry(1, '2026-09-01', { lostDay: true, lostCause: 'absence', lostPartyPersonId: 'p1' }),
      entry(2, '2026-09-02', { lostDay: true, lostCause: 'material', lostPartyPersonId: 'gone' }),
      entry(3, '2026-09-03', { lostDay: true }),
    ];
    const rows = diaryReport(PLAN, lost).rows;
    expect(rows.map((each) => [each.lostCause, each.lostParty])).toEqual([
      ['absence', { personId: 'p1', name: 'Sample tiler' }],
      ['material', { personId: 'gone', name: null }],
      [null, null],
    ]);
  });

  it('sums the diary up: written, corrections, effective, first and last day, the head of the chain', () => {
    expect(report).toMatchObject({
      written: 5,
      corrections: 3,
      effective: 3,
      firstDay: '2026-08-31',
      lastDay: '2026-09-03',
      headHash: '5'.padStart(64, '0'),
    });
  });

  it('is an empty document for an empty diary, and says so', () => {
    expect(diaryReport(PLAN, [])).toEqual({
      rows: [],
      written: 0,
      corrections: 0,
      effective: 0,
      firstDay: null,
      lastDay: null,
      headHash: null,
    });
  });

  it('names both statuses with a message key', () => {
    expect(DIARY_ROW_STATUS_KEYS).toEqual({
      effective: 'reports.diary.status.effective',
      corrected: 'reports.diary.status.corrected',
    });
  });
});
