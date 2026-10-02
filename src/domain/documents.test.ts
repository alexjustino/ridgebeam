import { describe, expect, it } from 'vitest';

import { activity, decision, entry, person, snapshot, stage } from './__fixtures__/plan';
import {
  byKind,
  describeTarget,
  detachedLinks,
  documentCounts,
  documentsFigure,
  DOCUMENTS_LABEL_KEYS,
  documentsOf,
  linksOf,
  targetKey,
  validateDocumentPatch,
  validateLink,
  type Document,
  type DocumentLink,
  type TargetKind,
} from './documents';
import { traceable } from './figure';
import type { WorkSnapshot } from './plan';
import { readiness } from './readiness';
import { schedule } from './schedule';

const on = (targetKind: TargetKind, targetId: string): DocumentLink => ({ targetKind, targetId });

const document = (
  id: string,
  kind: Document['kind'],
  addedOn: string,
  links: DocumentLink[],
): Document => ({
  id,
  fileHash: id.padEnd(64, '0'),
  fileName: `${id}.png`,
  mediaType: 'image/png',
  bytes: 1_024,
  width: 10,
  height: 10,
  kind,
  title: `Document ${id}`,
  addedOn,
  authorName: 'Sample author',
  createdAt: `${addedOn}T12:00:00.000Z`,
  links,
});

const PLAN = snapshot({
  stages: [stage('tiling', 1, 'Tiling')],
  activities: [{ ...activity('tile', 'tiling', 1, 3), name: 'Lay the floor tile' }],
  decisions: [{ ...decision('which', 'tiling', 1, 2), name: 'Which tile' }],
  commitments: [
    {
      id: 'quote',
      stageId: 'tiling',
      personId: null,
      label: 'Tiler’s quote',
      amountCents: 1,
      agreedOn: '2026-08-28',
      documentHash: null,
      milestones: [],
    },
  ],
  payments: [
    {
      id: 'p1',
      seq: 1,
      day: '2026-09-02',
      personId: null,
      stageId: 'tiling',
      commitmentId: null,
      amountCents: 1,
      whatFor: 'x',
      receiptHash: null,
      reversesSeq: null,
      authorName: 'A',
      createdAt: '2026-09-02T12:00:00.000Z',
    },
  ],
  documents: [
    document('drawing', 'drawing', '2026-09-01', [on('stage', 'tiling'), on('stage', 'tiling')]),
    document('quote-pdf', 'quote', '2026-08-28', [
      on('commitment', 'quote'),
      on('stage', 'tiling'),
    ]),
    document('photo', 'photo', '2026-09-02', [on('entry', '3'), on('activity', 'gone')]),
    document('loose', 'other', '2026-09-03', []),
  ],
});
const ENTRIES = [entry(3, '2026-09-02')];

describe('what a document is attached to', () => {
  it('collapses two attachments to the same target into one', () => {
    expect(linksOf(PLAN.documents[0]!)).toEqual([on('stage', 'tiling')]);
  });

  it('lists the documents of a target, newest first, each once', () => {
    expect(documentsOf(PLAN, on('stage', 'tiling')).map((d) => d.id)).toEqual([
      'drawing',
      'quote-pdf',
    ]);
    expect(documentsOf(PLAN, on('decision', 'which'))).toEqual([]);
  });

  it('counts the documents on each target for the paperclips, a duplicate attachment once', () => {
    expect(Object.fromEntries(documentCounts(PLAN))).toEqual({
      'stage:tiling': 2,
      'commitment:quote': 1,
      'entry:3': 1,
      'activity:gone': 1,
    });
    expect(targetKey(on('entry', '3'))).toBe('entry:3');
  });
});

describe('describing a target', () => {
  const said = (link: DocumentLink) => describeTarget(PLAN, link, ENTRIES);

  it('names a stage, an activity, a decision, a commitment and the work by their own names', () => {
    expect(said(on('stage', 'tiling'))).toEqual({
      targetKind: 'stage',
      targetId: 'tiling',
      detached: false,
      name: 'Tiling',
      seq: null,
      labelKey: 'documents.target.stage',
    });
    expect(said(on('activity', 'tile')).name).toBe('Lay the floor tile');
    expect(said(on('decision', 'which')).name).toBe('Which tile');
    expect(said(on('commitment', 'quote')).name).toBe('Tiler’s quote');
    expect(said(on('work', 'work-1')).name).toBe(PLAN.work.name);
  });

  it('gives a diary entry and a payment by their seq', () => {
    expect(said(on('entry', '3'))).toMatchObject({ detached: false, seq: 3, name: null });
    expect(said(on('payment', '1'))).toMatchObject({ detached: false, seq: 1 });
  });

  it('says a target that is gone is detached, keeping what it was', () => {
    for (const link of [
      on('stage', 'gone'),
      on('activity', 'gone'),
      on('decision', 'gone'),
      on('commitment', 'gone'),
      on('payment', '9'),
      on('payment', 'one'),
      on('entry', '9'),
      on('entry', '0'),
      on('work', 'another-work'),
      on('garage' as TargetKind, 'x'),
    ]) {
      expect(said(link)).toMatchObject({
        targetKind: link.targetKind,
        targetId: link.targetId,
        detached: true,
        labelKey: 'documents.target.detached',
      });
    }
  });

  it('takes any entry seq as there when the diary is not given', () => {
    expect(describeTarget(PLAN, on('entry', '9')).detached).toBe(false);
    expect(describeTarget(PLAN, on('entry', 'x')).detached).toBe(true);
  });

  it('lists every detached attachment, document by document, never dropping the document', () => {
    expect(detachedLinks(PLAN, ENTRIES)).toEqual([
      { documentId: 'photo', link: on('activity', 'gone') },
    ]);
    expect(PLAN.documents.map((d) => d.id)).toContain('photo');
  });
});

describe('filing by kind', () => {
  it('has every kind, empty when there is nothing of it, newest first inside each', () => {
    const groups = byKind(PLAN.documents);
    expect(Object.keys(groups)).toEqual([
      'photo',
      'quote',
      'drawing',
      'permit',
      'receipt',
      'contract',
      'warranty',
      'manual',
      'other',
    ]);
    expect(groups.warranty).toEqual([]);
    expect(groups.drawing.map((d) => d.id)).toEqual(['drawing']);
    expect(groups.permit).toEqual([]);
  });

  it('orders documents added the same day by when they were recorded, then by id', () => {
    const same = [
      { ...document('b', 'photo', '2026-09-01', []), createdAt: '2026-09-01T10:00:00.000Z' },
      { ...document('a', 'photo', '2026-09-01', []), createdAt: '2026-09-01T10:00:00.000Z' },
      { ...document('c', 'photo', '2026-09-01', []), createdAt: '2026-09-01T11:00:00.000Z' },
    ];
    expect(byKind(same).photo.map((d) => d.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('the documents figures', () => {
  it('count all the documents, and those of one kind, opening onto them', () => {
    const all = documentsFigure(PLAN);
    expect(all).toMatchObject({ id: 'documents:all', label: 'documents.figure.all', value: 4 });
    expect(all.rows.map((row) => row.documentId)).toEqual([
      'loose',
      'photo',
      'drawing',
      'quote-pdf',
    ]);
    const quotes = documentsFigure(PLAN, 'quote');
    expect(quotes).toMatchObject({ value: 1, label: 'documents.figure.quote' });
    expect(quotes.rows[0]).toMatchObject({
      key: 'document:quote-pdf',
      title: 'Document quote-pdf',
      day: '2026-08-28',
      kind: 'quote',
    });
    expect(documentsFigure(PLAN, 'permit').value).toBe(0);
    for (const figure of [all, quotes]) expect(traceable(figure)).toBe(true);
  });
});

describe('checking changes before the host is asked', () => {
  it('accepts a title and a kind', () => {
    expect(validateDocumentPatch({ title: 'Floor plan, ground', kind: 'drawing' })).toEqual([]);
    expect(validateDocumentPatch({})).toEqual([]);
  });

  it('knows the two kinds the owner keeps for later: a warranty and a manual', () => {
    expect(validateDocumentPatch({ kind: 'warranty' })).toEqual([]);
    expect(validateDocumentPatch({ kind: 'manual' })).toEqual([]);
    expect(documentsFigure(PLAN, 'warranty')).toMatchObject({
      label: 'documents.figure.warranty',
      value: 0,
    });
    expect(DOCUMENTS_LABEL_KEYS.manual).toBe('documents.figure.manual');
  });

  it('refuses an empty title, one over 200 characters, and a kind it does not know', () => {
    expect(validateDocumentPatch({ title: '  ' })).toEqual([{ code: 'title-empty' }]);
    expect(validateDocumentPatch({ title: 'x'.repeat(201), kind: 'spreadsheet' })).toEqual([
      { code: 'title-too-long' },
      { code: 'invalid-kind' },
    ]);
  });

  it('refuses an attachment to a target that is not there, or of a kind it does not know', () => {
    expect(validateLink(PLAN, on('stage', 'tiling'))).toEqual([]);
    expect(validateLink(PLAN, on('entry', '9'), ENTRIES)).toEqual([{ code: 'unknown-target' }]);
    expect(validateLink(PLAN, on('garage' as TargetKind, 'x'))).toEqual([
      { code: 'invalid-target-kind' },
    ]);
  });
});

describe('readiness', () => {
  it('is unchanged by documents and contact details: the spec names no rule for them', () => {
    const bare: WorkSnapshot = { ...PLAN, documents: [] };
    const measure = (plan: WorkSnapshot) =>
      readiness(plan, { schedule: schedule(plan), today: '2026-09-01' });
    const withContacts: WorkSnapshot = {
      ...PLAN,
      people: [
        {
          id: 'p',
          name: 'P',
          trade: 'tiler',
          phone: '1',
          email: 'e',
          note: 'n',
          availability: 'a',
          stageIds: ['tiling'],
        },
      ],
    };
    expect(measure(PLAN)).toEqual(measure(bare));
    // The same person with nothing said but the name, responsible for the activity both times.
    const plain: WorkSnapshot = { ...withContacts, people: [person('p', 'P')] };
    const responsible = (plan: WorkSnapshot): WorkSnapshot => ({
      ...plan,
      activities: plan.activities.map((a) => ({ ...a, responsibleId: 'p' })),
    });
    expect(measure(responsible(withContacts))).toEqual(measure(responsible(plain)));
    expect(measure(responsible(plain)).missing.map((row) => row.ruleId)).not.toContain(
      'activity.responsible',
    );
  });
});
