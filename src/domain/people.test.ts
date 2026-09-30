import { describe, expect, it } from 'vitest';

import { correction, entry, person, snapshot, stage } from './__fixtures__/plan';
import { traceable } from './figure';
import type { Commitment, Payment } from './money';
import { daysOnSite, lastOnSite, peopleTable, validateContact } from './people';

const TILER = person('tiler', 'A. Tiler', {
  trade: 'tiler',
  phone: '+55 11 0000-0000',
  email: 'not-an-address, and that is fine',
  availability: 'mornings only',
  stageIds: ['tiling', 'gone-stage', 'tiling'],
});
const HELPER = person('helper', 'Helper');

const commitment: Commitment = {
  id: 'quote',
  stageId: 'tiling',
  personId: 'tiler',
  label: 'Tiler’s quote',
  amountCents: 150_000,
  agreedOn: '2026-08-28',
  documentHash: null,
  milestones: [],
};
const paid: Payment = {
  id: 'p1',
  seq: 1,
  day: '2026-09-02',
  personId: 'tiler',
  stageId: 'tiling',
  commitmentId: 'quote',
  amountCents: 100_000,
  whatFor: 'First instalment',
  receiptHash: null,
  reversesSeq: null,
  authorName: 'Sample author',
  createdAt: '2026-09-02T12:00:00.000Z',
};

const PLAN = snapshot({
  people: [TILER, HELPER],
  stages: [stage('painting', 2, 'Painting'), stage('tiling', 1, 'Tiling')],
  commitments: [commitment],
  payments: [paid],
});

const ENTRIES = [
  entry(1, '2026-09-01', { present: ['tiler'] }),
  entry(2, '2026-09-02', { present: ['tiler', 'helper'] }),
  entry(3, '2026-09-02', { present: ['tiler'] }),
  entry(4, '2026-09-03', { present: ['helper'] }),
  // The correction says the tiler was not there on the 3rd after all … and on the 4th instead.
  entry(5, '2026-09-03', { present: ['tiler'] }),
  correction(6, 5, '2026-09-04', { present: ['tiler'] }),
];

describe('who was on site, from the diary', () => {
  it('lists the days an effective entry names the person, each once, oldest first', () => {
    expect(daysOnSite(TILER, ENTRIES)).toEqual(['2026-09-01', '2026-09-02', '2026-09-04']);
    expect(daysOnSite(HELPER, ENTRIES)).toEqual(['2026-09-02', '2026-09-03']);
  });

  it('gives the last of those days, or nothing for someone never on site', () => {
    expect(lastOnSite(TILER, ENTRIES)).toBe('2026-09-04');
    expect(lastOnSite(person('new'), ENTRIES)).toBeNull();
    expect(daysOnSite(TILER, [])).toEqual([]);
  });
});

describe('the People tab', () => {
  const rows = peopleTable(PLAN, ENTRIES);

  it('lists everyone by name, with what they typed kept as typed', () => {
    expect(rows.map((row) => row.name)).toEqual(['A. Tiler', 'Helper']);
    expect(rows[0]).toMatchObject({
      personId: 'tiler',
      trade: 'tiler',
      phone: '+55 11 0000-0000',
      email: 'not-an-address, and that is fine',
      availability: 'mornings only',
      note: null,
    });
  });

  it('lists their stages in plan order, and a stage that is gone apart, never dropped', () => {
    expect(rows[0]).toMatchObject({ stageIds: ['tiling'], stagesGone: ['gone-stage'] });
    expect(rows[1]).toMatchObject({ stageIds: [], stagesGone: [] });
  });

  it('carries the days on site and the last one', () => {
    expect(rows[0]).toMatchObject({
      daysOnSite: ['2026-09-01', '2026-09-02', '2026-09-04'],
      lastOnSite: '2026-09-04',
    });
    expect(peopleTable(PLAN, [])[0]).toMatchObject({ daysOnSite: [], lastOnSite: null });
  });

  it('carries what is still owed to each, a money figure that opens onto its rows', () => {
    expect(rows[0]!.owed).toMatchObject({ id: 'owed:person:tiler', unit: 'money', value: 50_000 });
    expect(rows[0]!.owed.rows.map((row) => [row.key, row.amountCents])).toEqual([
      ['commitment:quote', 150_000],
      ['payment:1', -100_000],
    ]);
    expect(traceable(rows[0]!.owed)).toBe(true);
    expect(rows[1]!.owed.value).toBe(0);
  });

  it('orders two people of the same name by id, so the order never depends on the host', () => {
    const twins = snapshot({ people: [person('b', 'Same'), person('a', 'Same')] });
    expect(peopleTable(twins, []).map((row) => row.personId)).toEqual(['a', 'b']);
  });
});

describe('checking a change to a person', () => {
  it('accepts a phone or an e-mail of any shape: they are text the person typed', () => {
    expect(validateContact({ phone: 'call after 6', email: 'ask the neighbour' }, PLAN)).toEqual(
      [],
    );
    expect(validateContact({ trade: null, phone: null, email: null }, PLAN)).toEqual([]);
    expect(validateContact({}, PLAN)).toEqual([]);
  });

  it('refuses an empty name', () => {
    expect(validateContact({ name: '   ' }, PLAN)).toEqual([{ code: 'name-empty' }]);
  });

  it('refuses each field over its length', () => {
    expect(
      validateContact(
        {
          name: 'n'.repeat(121),
          trade: 't'.repeat(61),
          phone: '1'.repeat(41),
          email: 'e'.repeat(121),
          note: 'x'.repeat(501),
          availability: 'a'.repeat(201),
        },
        PLAN,
      ),
    ).toEqual(
      ['name', 'trade', 'phone', 'email', 'note', 'availability'].map((field) => ({
        code: 'too-long',
        field,
      })),
    );
    expect(validateContact({ phone: '1'.repeat(40), note: 'x'.repeat(500) }, PLAN)).toEqual([]);
  });

  it('refuses a stage the plan does not have', () => {
    expect(validateContact({ stageIds: ['tiling', 'gone'] }, PLAN)).toEqual([
      { code: 'unknown-stage', stageId: 'gone' },
    ]);
  });
});
