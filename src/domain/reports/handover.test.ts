import { describe, expect, it } from 'vitest';

import {
  activity,
  correction,
  decision,
  entry,
  finished,
  maintenanceDone,
  maintenanceTask,
  person,
  snag,
  snagClosure,
  snapshot,
  stage,
  warranty,
  worked,
} from '../__fixtures__/plan';
import type { Photo } from '../diary';
import { traceable } from '../figure';
import type {
  CareNote,
  Check,
  CheckAnswer,
  Document,
  DocumentLink,
  Stage,
  WorkSnapshot,
} from '../plan';
import {
  HANDOVER_DOCUMENT_KINDS,
  HANDOVER_GAP_KEYS,
  HANDOVER_LABEL_KEYS,
  HANDOVER_PHOTO_LIMIT,
  handover,
  handoverGaps,
  type HandoverSection,
} from './handover';

// ── Builders. Nothing in them is a real place, person or brand. ──────────────

/** A hash the work can name: the label padded to 64 characters. */
const h = (label: string) => label.padEnd(64, '0');

/** A document the work holds: an image unless `pdf`, named by `h(label)`. */
function document(
  label: string,
  kind: Document['kind'] = 'photo',
  links: DocumentLink[] = [],
  parts: Partial<Document> = {},
): Document {
  return {
    id: `doc-${label}`,
    fileHash: h(label),
    fileName: `${label}.jpg`,
    mediaType: 'image/jpeg',
    bytes: 2_048,
    width: 800,
    height: 600,
    kind,
    title: `Title ${label}`,
    addedOn: '2026-09-10',
    authorName: 'Sample author',
    createdAt: '2026-09-10T12:00:00.000Z',
    links,
    ...parts,
  };
}

const pdf = (label: string, kind: Document['kind'], links: DocumentLink[] = []) =>
  document(label, kind, links, {
    fileName: `${label}.pdf`,
    mediaType: 'application/pdf',
    width: null,
    height: null,
  });

const photo = (label: string): Photo => ({
  fileHash: h(label),
  fileName: `${label}.jpg`,
  bytes: 2_048,
  width: 800,
  height: 600,
  thumbnail: true,
});

const check = (
  id: string,
  stageId: string,
  gate: Check['gate'],
  position: number,
  needsPhoto: boolean,
): Check => ({ id, stageId, gate, position, name: `Check ${id}`, needsPhoto });

let answerId = 0;
const answer = (
  checkId: string,
  seq: number,
  given: CheckAnswer['answer'],
  photoHash: string | null = null,
  day = '2026-09-05',
): CheckAnswer => ({
  id: `answer-${(answerId += 1)}`,
  checkId,
  seq,
  answer: given,
  reason: given === 'na' ? 'Not here' : null,
  photoHash,
  authorName: 'Sample author',
  answeredAt: `${day}T15:00:00.000Z`,
});

const note = (
  id: string,
  targetKind: CareNote['targetKind'],
  targetId: string,
  position = 1,
): CareNote => ({
  id,
  targetKind,
  targetId,
  position,
  text: `Note ${id}`,
  createdAt: '2026-09-20T12:00:00.000Z',
});

const closedStage = (id: string, position: number, name: string, closedOn: string): Stage => ({
  ...stage(id, position, name),
  startedAt: '2026-09-01T08:00:00.000Z',
  closedAt: `${closedOn}T17:00:00.000Z`,
});

const keys = (section: HandoverSection) => ({
  key: section.key,
  stages: section.stages.map((each) => each.stageId),
  activities: section.activities,
});

// ── A work with rooms ────────────────────────────────────────────────────────

/**
 * Two rooms; plumbing (closed) runs through both, tiling (started) only the bathroom and has an
 * activity in no room, and the permit stage has no activity at all.
 */
const ROOMED: WorkSnapshot = snapshot({
  work: {
    ...snapshot().work,
    templateId: 'bathroom-renovation',
    templateVersion: 2,
    templateTitle: 'Bathroom renovation',
  },
  rooms: [
    { id: 'kitchen', position: 2, name: 'Kitchen' },
    { id: 'bath', position: 1, name: 'Bathroom' },
  ],
  stages: [
    closedStage('plumbing', 1, 'Plumbing', '2026-09-08'),
    { ...stage('tiling', 2, 'Tiling'), startedAt: '2026-09-09T08:00:00.000Z' },
    stage('permits', 3, 'Permits'),
  ],
  activities: [
    { ...activity('pipes', 'plumbing', 1, 3), name: 'Run pipes', roomIds: ['kitchen', 'bath'] },
    { ...activity('walls', 'tiling', 1, 4), name: 'Tile walls', roomIds: ['bath'] },
    { ...activity('clean', 'tiling', 2, 1), name: 'Clean up' },
  ],
  people: [
    person('p2', 'Bea', { trade: 'Plumber', phone: '000', email: 'bea@example.invalid' }),
    person('p1', 'Ana', { trade: ' Tiler ' }),
    person('p3', 'Caio', { trade: 'Plumber' }),
    person('p4', 'Dora'),
  ],
  decisions: [
    { ...decision('valve', 'plumbing', 1, 2, '2026-09-02T10:00:00.000Z'), answer: 'Brass' },
    decision('grout', 'tiling', 1, 3),
    { ...decision('tile', 'tiling', 2, 5, '2026-09-03T10:00:00.000Z'), answer: 'White, matt' },
  ],
  checks: [
    check('closed-ok', 'plumbing', 'close', 2, true),
    check('start-photo', 'plumbing', 'start', 1, true),
    check('ordinary', 'plumbing', 'close', 1, false),
  ],
  checkAnswers: [
    answer('closed-ok', 1, 'no', h('defect'), '2026-09-06'),
    answer('closed-ok', 2, 'yes', h('sealed'), '2026-09-07'),
    answer('start-photo', 1, 'yes', h('before')),
    answer('ordinary', 1, 'yes', h('ordinary')),
  ],
  documents: [
    document('defect'),
    document('sealed'),
    document('before'),
    document('ordinary'),
    document('d-pipes'),
    document('d-walls'),
    pdf('permit-a', 'permit', [{ targetKind: 'stage', targetId: 'permits' }]),
    pdf('warranty-a', 'warranty', [
      { targetKind: 'work', targetId: 'work-1' },
      { targetKind: 'work', targetId: 'work-1' },
      { targetKind: 'entry', targetId: '9' },
    ]),
    pdf('quote-a', 'quote'),
  ],
  careNotes: [
    note('n-stage', 'stage', 'plumbing'),
    note('n-bath-2', 'room', 'bath', 2),
    note('n-bath-1', 'room', 'bath', 1),
    note('n-work', 'work', 'work-1'),
    note('n-gone', 'room', 'demolished'),
    note('n-gone-stage', 'stage', 'gone-stage', 2),
  ],
});

const ROOMED_DIARY = [
  entry(1, '2026-09-02', { done: [worked('pipes')], present: ['p2'], photos: [photo('d-pipes')] }),
  entry(2, '2026-09-04', { done: [finished('pipes')], present: ['p2', 'p3'] }),
  entry(3, '2026-09-10', {
    done: [finished('walls')],
    present: ['p1'],
    photos: [photo('d-walls')],
  }),
  entry(4, '2026-09-11', { present: ['p4'] }),
];

describe('the handover book, by room', () => {
  const book = handover(ROOMED, ROOMED_DIARY);

  it('is divided by room in room order, then the rest of the work', () => {
    expect(book.by).toBe('room');
    expect(book.sections.map(keys)).toEqual([
      { key: 'room:bath', stages: ['plumbing', 'tiling'], activities: 2 },
      { key: 'room:kitchen', stages: ['plumbing'], activities: 1 },
      { key: 'other', stages: ['tiling', 'permits'], activities: 1 },
    ]);
    expect(book.sections[0]).toMatchObject({ kind: 'room', id: 'bath', name: 'Bathroom' });
    expect(book.sections[2]).toMatchObject({ kind: 'other', id: null, name: null });
    expect(HANDOVER_LABEL_KEYS.other).toBe('reports.handover.section.other');
  });

  it('says what was done and when, from the diary, in plan order', () => {
    expect(book.sections[0]!.done).toEqual([
      {
        activityId: 'pipes',
        name: 'Run pipes',
        number: '1.1',
        stageId: 'plumbing',
        stageName: 'Plumbing',
        finishedOn: '2026-09-04',
      },
      {
        activityId: 'walls',
        name: 'Tile walls',
        number: '2.1',
        stageId: 'tiling',
        stageName: 'Tiling',
        finishedOn: '2026-09-10',
      },
    ]);
    expect(book.sections[2]!.done).toEqual([]);
    expect(book.sections[0]!.stages).toEqual([
      {
        stageId: 'plumbing',
        name: 'Plumbing',
        state: 'closed',
        startedOn: '2026-09-01',
        closedOn: '2026-09-08',
      },
      {
        stageId: 'tiling',
        name: 'Tiling',
        state: 'started',
        startedOn: '2026-09-09',
        closedOn: null,
      },
    ]);
  });

  it('lists the decisions made of the stages, with the answer and the day; open ones are not', () => {
    expect(book.sections[0]!.decisions).toEqual([
      {
        decisionId: 'valve',
        name: 'Decision valve',
        answer: 'Brass',
        madeOn: '2026-09-02',
        stageId: 'plumbing',
        stageName: 'Plumbing',
      },
      {
        decisionId: 'tile',
        name: 'Decision tile',
        answer: 'White, matt',
        madeOn: '2026-09-03',
        stageId: 'tiling',
        stageName: 'Tiling',
      },
    ]);
    expect(book.sections[1]!.decisions.map((each) => each.decisionId)).toEqual(['valve']);
  });

  it('shows every hidden-work photo of its stages, in check order, each answer by seq', () => {
    expect(book.sections[0]!.hiddenWork).toEqual([
      {
        photoHash: h('before'),
        fileName: 'before.jpg',
        checkId: 'start-photo',
        checkName: 'Check start-photo',
        gate: 'start',
        stageId: 'plumbing',
        stageName: 'Plumbing',
        answer: 'yes',
        seq: 1,
        day: '2026-09-05',
      },
      expect.objectContaining({ photoHash: h('defect'), answer: 'no', seq: 1, day: '2026-09-06' }),
      expect.objectContaining({ photoHash: h('sealed'), answer: 'yes', seq: 2, day: '2026-09-07' }),
    ]);
    // A photo on a check that does not need one is not hidden work.
    const all = book.sections.flatMap((each) => each.hiddenWork.map((p) => p.photoHash));
    expect(all).not.toContain(h('ordinary'));
    // The other section's stages carry no hidden-work check.
    expect(book.sections[2]!.hiddenWork).toEqual([]);
  });

  it('shows the diary photos of the entries naming its activities', () => {
    expect(book.sections[0]!.photos.map((each) => [each.photoHash, each.activityId])).toEqual([
      [h('d-pipes'), 'pipes'],
      [h('d-walls'), 'walls'],
    ]);
    expect(book.sections[1]!.photos).toEqual([
      {
        photoHash: h('d-pipes'),
        fileName: 'd-pipes.jpg',
        day: '2026-09-02',
        entrySeq: 1,
        activityId: 'pipes',
        activityName: 'Run pipes',
      },
    ]);
    expect(book.sections[0]!.photosNotShown).toBe(0);
  });

  it("gives a room's notes, then its stages', each by position", () => {
    expect(book.sections[0]!.careNotes.map((each) => [each.noteId, each.targetName])).toEqual([
      ['n-bath-1', 'Bathroom'],
      ['n-bath-2', 'Bathroom'],
      ['n-stage', 'Plumbing'],
    ]);
    expect(book.sections[1]!.careNotes.map((each) => each.noteId)).toEqual(['n-stage']);
  });

  it('gives the notes of the whole work, then the ones whose room or stage is gone', () => {
    expect(book.careNotes).toEqual([
      {
        noteId: 'n-work',
        targetKind: 'work',
        targetId: 'work-1',
        targetName: 'Sample work',
        text: 'Note n-work',
        detached: false,
      },
      {
        noteId: 'n-gone',
        targetKind: 'room',
        targetId: 'demolished',
        targetName: null,
        text: 'Note n-gone',
        detached: true,
      },
      expect.objectContaining({ noteId: 'n-gone-stage', detached: true }),
    ]);
  });

  it('lists the documents by kind in a fixed order, with what each is attached to', () => {
    expect(book.documents.map((group) => [group.kind, group.labelKey])).toEqual([
      ['permit', 'documents.figure.permit'],
      ['warranty', 'documents.figure.warranty'],
      ['manual', 'documents.figure.manual'],
      ['contract', 'documents.figure.contract'],
      ['receipt', 'documents.figure.receipt'],
    ]);
    expect(HANDOVER_DOCUMENT_KINDS).toEqual([
      'permit',
      'warranty',
      'manual',
      'contract',
      'receipt',
    ]);
    const warranty = book.documents[1]!.documents;
    expect(warranty).toHaveLength(1);
    expect(warranty[0]).toMatchObject({
      documentId: 'doc-warranty-a',
      title: 'Title warranty-a',
      fileName: 'warranty-a.pdf',
      addedOn: '2026-09-10',
    });
    // Each target once; an entry the diary does not have is detached, never dropped.
    expect(
      warranty[0]!.attachedTo.map((each) => [each.targetKind, each.name, each.detached]),
    ).toEqual([
      ['work', 'Sample work', false],
      ['entry', null, true],
    ]);
    expect(book.documents[0]!.documents[0]!.attachedTo[0]).toMatchObject({ name: 'Permits' });
    // A quote is not what an owner keeps: it is not listed.
    expect(
      book.documents.flatMap((group) => group.documents.map((d) => d.documentId)),
    ).not.toContain('doc-quote-a');
  });

  it('says who did what: trade, contacts, the stages they worked, their days on site', () => {
    expect(book.people).toEqual([
      {
        personId: 'p1',
        name: 'Ana',
        trade: ' Tiler ',
        phone: null,
        email: null,
        stages: [{ stageId: 'tiling', name: 'Tiling' }],
        daysOnSite: 1,
        firstOnSite: '2026-09-10',
        lastOnSite: '2026-09-10',
      },
      {
        personId: 'p2',
        name: 'Bea',
        trade: 'Plumber',
        phone: '000',
        email: 'bea@example.invalid',
        stages: [{ stageId: 'plumbing', name: 'Plumbing' }],
        daysOnSite: 2,
        firstOnSite: '2026-09-02',
        lastOnSite: '2026-09-04',
      },
      expect.objectContaining({ personId: 'p3', daysOnSite: 1 }),
      // On site on a day the entry names no activity: no stage, but the day counts.
      expect.objectContaining({ personId: 'p4', stages: [], daysOnSite: 1 }),
    ]);
  });

  it('has a cover: the work, in progress while a stage is open, the people by trade', () => {
    expect(book.cover).toEqual({
      workName: 'Sample work',
      place: 'Sample street',
      startDate: '2026-09-01',
      finishedOn: null,
      inProgress: true,
      trades: [
        {
          trade: 'Plumber',
          people: [
            { personId: 'p2', name: 'Bea' },
            { personId: 'p3', name: 'Caio' },
          ],
        },
        { trade: 'Tiler', people: [{ personId: 'p1', name: 'Ana' }] },
        { trade: null, people: [{ personId: 'p4', name: 'Dora' }] },
      ],
      template: { id: 'bathroom-renovation', version: 2, title: 'Bathroom renovation' },
    });
  });

  it('keeps the record: how many entries, and the first and last day', () => {
    const corrected = [...ROOMED_DIARY, correction(5, 4, '2026-09-11')];
    expect(handover(ROOMED, corrected).record).toEqual({
      written: 5,
      corrections: 1,
      firstDay: '2026-09-02',
      lastDay: '2026-09-11',
    });
  });
});

// ── A work without rooms ─────────────────────────────────────────────────────

describe('the handover book, by stage', () => {
  const plan = snapshot({
    stages: [closedStage('b', 2, 'Roof', '2026-09-20'), closedStage('a', 1, 'Walls', '2026-09-12')],
    activities: [
      { ...activity('a2', 'a', 2, 2), name: 'Plaster' },
      { ...activity('a1', 'a', 1, 2), name: 'Lay blocks' },
      { ...activity('b1', 'b', 1, 2), name: 'Tiles' },
      { ...activity('orphan', 'gone', 1, 2), name: 'Orphan' },
    ],
    careNotes: [note('roof-note', 'stage', 'b'), note('room-note', 'room', 'nowhere')],
  });
  const book = handover(plan, [
    entry(1, '2026-09-05', { done: [finished('a1'), finished('orphan')] }),
    entry(2, '2026-09-15', { done: [worked('b1')] }),
  ]);

  it('is divided by stage in stage order when the work has no rooms', () => {
    expect(book.by).toBe('stage');
    expect(book.sections.map(keys)).toEqual([
      { key: 'stage:a', stages: ['a'], activities: 2 },
      { key: 'stage:b', stages: ['b'], activities: 1 },
    ]);
    expect(book.sections[0]!.done.map((each) => each.activityId)).toEqual(['a1']);
    expect(book.sections[1]!.careNotes.map((each) => each.noteId)).toEqual(['roof-note']);
    // A room note with no room: listed with the work's, never dropped.
    expect(book.careNotes.map((each) => [each.noteId, each.detached])).toEqual([
      ['room-note', true],
    ]);
  });

  it('closes the cover on the day the last stage closed', () => {
    expect(book.cover).toMatchObject({
      finishedOn: '2026-09-20',
      inProgress: false,
      template: null,
    });
  });

  it('calls a work with no stage in progress, not finished', () => {
    expect(handover(snapshot(), []).cover).toMatchObject({ finishedOn: null, inProgress: true });
    expect(handover(snapshot(), []).sections).toEqual([]);
  });
});

// ── Picking the photos ───────────────────────────────────────────────────────

describe('picking the photos of a section', () => {
  const plan = snapshot({
    stages: [stage('s', 1, 'Finishes')],
    activities: [
      { ...activity('x', 's', 1, 2), name: 'Paint' },
      { ...activity('y', 's', 2, 2), name: 'Floor' },
      { ...activity('z', 's', 3, 2), name: 'Doors' },
    ],
    checks: [check('hidden', 's', 'close', 1, true)],
    checkAnswers: [answer('hidden', 1, 'yes', h('shared'))],
    documents: [
      ...['p1', 'p2', 'p3', 'q1', 'q2', 'q3', 'q4', 'shared', 'old'].map((label) =>
        document(label),
      ),
      pdf('a-pdf', 'photo'),
    ],
  });
  const entries = [
    entry(1, '2026-09-01', { done: [worked('x')], photos: [photo('p1')] }),
    entry(2, '2026-09-02', { done: [worked('y')], photos: [photo('q1')] }),
    entry(3, '2026-09-03', { done: [worked('x')], photos: [photo('p2'), photo('p3')] }),
    entry(4, '2026-09-04', { done: [worked('y')], photos: [photo('q2')] }),
    // Newest for y, with the hidden-work photo again, a file the work does not hold, and a PDF.
    entry(5, '2026-09-05', {
      done: [worked('y')],
      photos: [photo('q3'), photo('shared'), photo('missing'), photo('a-pdf'), photo('q4')],
    }),
    // Corrected away: its photo is not the day's any more.
    entry(6, '2026-09-06', { done: [worked('z')], photos: [photo('old')] }),
    correction(7, 6, '2026-09-06', { done: [worked('z')] }),
  ];
  const book = handover(plan, entries);
  const only = book.sections[0]!;

  it('takes the hidden-work photos first, and never shows one twice', () => {
    expect(only.hiddenWork.map((each) => each.photoHash)).toEqual([h('shared')]);
    expect(only.photos.map((each) => each.photoHash)).not.toContain(h('shared'));
  });

  it('takes the latest per activity first, round by round, up to the limit', () => {
    expect(HANDOVER_PHOTO_LIMIT).toBe(6);
    expect(only.photos.map((each) => [each.activityId, each.photoHash.slice(0, 2)])).toEqual([
      ['x', 'p2'],
      ['y', 'q3'],
      ['x', 'p3'],
      ['y', 'q4'],
      ['x', 'p1'],
      ['y', 'q2'],
    ]);
    expect(only.photosNotShown).toBe(1); // q1
  });

  it('picks only images the work holds, and only from entries that speak for their day', () => {
    const hashes = only.photos.map((each) => each.photoHash);
    expect(hashes).not.toContain(h('missing'));
    expect(hashes).not.toContain(h('a-pdf'));
    expect(hashes).not.toContain(h('old'));
  });

  it('shows a photo once, for the first activity that takes it', () => {
    const both = snapshot({
      stages: [stage('s', 1, 'Finishes')],
      activities: [activity('x', 's', 1, 2), activity('y', 's', 2, 2)],
      documents: [document('one')],
    });
    const picked = handover(both, [
      entry(1, '2026-09-01', { done: [worked('x'), worked('y')], photos: [photo('one')] }),
      entry(2, '2026-09-02', { done: [worked('x')], photos: [photo('one')] }),
    ]).sections[0]!;
    expect(picked.photos.map((each) => [each.activityId, each.day])).toEqual([['x', '2026-09-02']]);
    expect(picked.photosNotShown).toBe(0);
  });
});

// ── What the book still lacks ────────────────────────────────────────────────

describe('what the book still lacks', () => {
  it('counts every kind, in order, with its rows', () => {
    const plan = snapshot({
      rooms: [
        { id: 'bath', position: 1, name: 'Bathroom' },
        { id: 'hall', position: 2, name: 'Hall' },
      ],
      stages: [stage('s', 1, 'Plumbing'), closedStage('t', 2, 'Tiling', '2026-09-10')],
      activities: [
        { ...activity('a', 's', 1, 2), roomIds: ['bath'] },
        { ...activity('b', 't', 1, 2), roomIds: ['hall'] },
      ],
      checks: [
        check('unanswered', 's', 'close', 3, true),
        check('without', 's', 'close', 2, true),
        check('said-no', 's', 'close', 4, true),
        check('na', 's', 'start', 1, true),
        check('fine', 't', 'close', 1, true),
        check('missing-file', 't', 'close', 2, true),
        check('ordinary', 's', 'close', 1, false),
      ],
      checkAnswers: [
        answer('without', 1, 'yes'),
        answer('said-no', 1, 'no'),
        answer('na', 1, 'na'),
        answer('fine', 1, 'yes', h('fine')),
        answer('missing-file', 1, 'yes', h('not-held')),
      ],
      documents: [document('fine')],
    });
    const gaps = handoverGaps(plan, []);
    expect(gaps).toMatchObject({ id: 'handover-gaps', label: 'reports.handover.figure.gaps' });
    expect(gaps.rows.map((row) => [row.kind, row.itemId, row.title])).toEqual([
      ['hidden-without-photo', 'without', 'Check without'],
      ['hidden-without-photo', 'missing-file', 'Check missing-file'],
      ['hidden-unanswered', 'unanswered', 'Check unanswered'],
      ['stage-open', 's', 'Plumbing'],
      ['room-without-photo', 'bath', 'Bathroom'],
      ['no-warranty-or-manual', null, 'Sample work'],
      ['no-care-note', null, 'Sample work'],
    ]);
    expect(gaps.value).toBe(7);
    expect(gaps.rows[2]!.messageKey).toBe('reports.handover.gap.hiddenUnanswered');
    expect(traceable(gaps)).toBe(true);
    expect(Object.keys(HANDOVER_GAP_KEYS)).toHaveLength(7);
    // The same figure the book carries.
    expect(handover(plan, []).gaps).toEqual(gaps);
  });

  it('is nothing for a work the book can say everything of', () => {
    const plan = snapshot({
      rooms: [{ id: 'bath', position: 1, name: 'Bathroom' }],
      stages: [closedStage('s', 1, 'Plumbing', '2026-09-10')],
      activities: [{ ...activity('a', 's', 1, 2), roomIds: ['bath'] }],
      checks: [check('hidden', 's', 'close', 1, true)],
      // An older answer had the photo; the latest yes did not: the book still shows it.
      checkAnswers: [answer('hidden', 1, 'no', h('pipes')), answer('hidden', 2, 'yes')],
      documents: [document('pipes'), pdf('manual', 'manual')],
      careNotes: [note('n', 'work', 'work-1')],
    });
    expect(handoverGaps(plan, []).rows).toEqual([]);
  });

  it('counts a room without a photo only when the work is divided by room', () => {
    const plan = snapshot({
      stages: [stage('s', 1, 'Plumbing')],
      documents: [pdf('w', 'warranty')],
      careNotes: [note('n', 'stage', 's')],
    });
    expect(handoverGaps(plan, []).rows.map((row) => row.kind)).toEqual(['stage-open']);
  });

  it('takes a photo in the diary as the room having one', () => {
    const plan = snapshot({
      rooms: [{ id: 'bath', position: 1, name: 'Bathroom' }],
      stages: [closedStage('s', 1, 'Plumbing', '2026-09-10')],
      activities: [{ ...activity('a', 's', 1, 2), roomIds: ['bath'] }],
      documents: [document('day'), pdf('w', 'warranty')],
      careNotes: [note('n', 'room', 'bath')],
    });
    const diary = [entry(1, '2026-09-02', { done: [worked('a')], photos: [photo('day')] })];
    expect(handoverGaps(plan, diary).rows).toEqual([]);
    expect(handoverGaps(plan, []).rows.map((row) => row.kind)).toEqual(['room-without-photo']);
  });
});

// ── Ties, and rows the plan no longer explains ───────────────────────────────

describe('the handover book, on ties and odd rows', () => {
  it('breaks every tie by id, the same on every machine', () => {
    const plan = snapshot({
      stages: [
        closedStage('a', 1, 'Walls', '2026-09-12'),
        closedStage('b', 2, 'Roof', '2026-09-20'),
      ],
      activities: [activity('y', 'a', 1, 2), activity('x', 'a', 1, 2)],
      people: [
        person('q', 'Same'),
        person('p', 'Same', { trade: 'Mason' }),
        person('o', 'Same', { trade: 'Mason' }),
      ],
      checks: [check('k2', 'a', 'close', 1, true), check('k1', 'a', 'close', 1, true)],
      checkAnswers: [answer('k2', 1, 'yes', h('k2')), answer('k1', 1, 'yes', h('k1'))],
      documents: [document('k1'), document('k2'), document('e1'), document('e2')],
      careNotes: [note('w2', 'work', 'work-1', 1), note('w1', 'work', 'work-1', 1)],
    });
    const book = handover(plan, [
      entry(1, '2026-09-03', { done: [worked('x')], photos: [photo('e1')] }),
      entry(2, '2026-09-03', { done: [worked('x')], photos: [photo('e2')] }),
    ]);
    const only = book.sections[0]!;
    expect(book.sections.map((each) => each.key)).toEqual(['stage:a', 'stage:b']);
    expect(only.hiddenWork.map((each) => each.checkId)).toEqual(['k1', 'k2']);
    // The same day: the entry written later is the newer.
    expect(only.photos.map((each) => each.entrySeq)).toEqual([2, 1]);
    expect(book.cover.finishedOn).toBe('2026-09-20');
    expect(book.cover.trades).toEqual([
      {
        trade: 'Mason',
        people: [
          { personId: 'o', name: 'Same' },
          { personId: 'p', name: 'Same' },
        ],
      },
      { trade: null, people: [{ personId: 'q', name: 'Same' }] },
    ]);
    expect(book.people.map((each) => each.personId)).toEqual(['o', 'p', 'q']);
    expect(book.careNotes.map((each) => each.noteId)).toEqual(['w1', 'w2']);
  });

  it('keeps a finished activity whose stage is gone, with no number and no stage name', () => {
    const plan = snapshot({
      rooms: [{ id: 'bath', position: 1, name: 'Bathroom' }],
      stages: [stage('s', 1, 'Plumbing')],
      activities: [{ ...activity('lost', 'gone', 1, 2), name: 'Lost', roomIds: ['bath'] }],
      people: [person('p', 'Pat')],
    });
    const book = handover(plan, [
      entry(1, '2026-09-03', { done: [finished('lost'), worked('not-in-plan')], present: ['p'] }),
    ]);
    expect(book.sections[0]!.done).toEqual([
      {
        activityId: 'lost',
        name: 'Lost',
        number: null,
        stageId: 'gone',
        stageName: null,
        finishedOn: '2026-09-03',
      },
    ]);
    expect(book.sections[0]!.stages).toEqual([]);
    // Present, but the entry names no stage the plan has: no stage worked.
    expect(book.people[0]!.stages).toEqual([]);
  });
});

// ── Snags (slice E4) ─────────────────────────────────────────────────────────

describe('snags in the book', () => {
  const closedAt = '2026-09-20T17:00:00.000Z';
  const fixed = (closedOn: string, label: string) => snagClosure('fixed', closedOn, h(label));
  const SNAGGY = snapshot({
    stages: [
      { ...stage('s', 1, 'Wet areas'), startedAt: '2026-09-01T08:00:00.000Z', closedAt },
      { ...stage('t', 2, 'Painting'), startedAt: '2026-09-01T08:00:00.000Z', closedAt },
    ],
    activities: [{ ...activity('a', 's', 1, 2), name: 'Lay the tiles' }, activity('b', 't', 1, 2)],
    people: [person('tiler', 'Tiler')],
    documents: [
      document('before'),
      document('after'),
      document('wall-after'),
      pdf('a-pdf', 'other'),
    ],
    snags: [
      snag('open-2', 4, 's', { personId: 'tiler', dueOn: '2026-09-30' }),
      snag('fix-a', 1, 's', {
        activityId: 'a',
        personId: 'tiler',
        photoHash: h('before'),
        closure: fixed('2026-09-24', 'after'),
      }),
      snag('out', 2, 's', { closure: snagClosure('withdrawn', '2026-09-22') }),
      snag('open-1', 3, 't'),
      snag('fix-t', 5, 't', { closure: fixed('2026-09-25', 'wall-after') }),
      snag('fix-pdf', 6, 't', { photoHash: h('a-pdf'), closure: fixed('2026-09-25', 'gone') }),
    ],
  });

  it('lists every open snag as still to fix, by number, after the stages', () => {
    const gaps = handoverGaps(SNAGGY, []);
    const snagGaps = gaps.rows.filter((row) => row.kind === 'snag-open');
    expect(snagGaps.map((row) => [row.key, row.itemId, row.title, row.day])).toEqual([
      ['snag-open:open-1', 'open-1', 'Snag open-1', null],
      ['snag-open:open-2', 'open-2', 'Snag open-2', '2026-09-30'],
    ]);
    expect(snagGaps[0]!.messageKey).toBe(HANDOVER_GAP_KEYS['snag-open']);
    expect(HANDOVER_GAP_KEYS['snag-open']).toBe('reports.handover.gap.snagOpen');
    expect(traceable(gaps)).toBe(true);
    expect(handover(SNAGGY, []).gaps).toEqual(gaps);
  });

  it('has no snag gap once every snag is closed', () => {
    const closed = { ...SNAGGY, snags: SNAGGY.snags.filter((each) => each.closure !== null) };
    expect(handoverGaps(closed, []).rows.some((row) => row.kind === 'snag-open')).toBe(false);
  });

  it('prints each fixed snag in its stage’s section with both photos, never a withdrawn one', () => {
    const book = handover(SNAGGY, []);
    const [wet, paint] = book.sections;
    expect(wet!.snagsFixed).toEqual([
      {
        snagId: 'fix-a',
        number: 1,
        title: 'Snag fix-a',
        description: null,
        stageId: 's',
        stageName: 'Wet areas',
        activityId: 'a',
        activityName: 'Lay the tiles',
        personId: 'tiler',
        personName: 'Tiler',
        raisedOn: '2026-09-21',
        closedOn: '2026-09-24',
        before: { photoHash: h('before'), fileName: 'before.jpg' },
        after: { photoHash: h('after'), fileName: 'after.jpg' },
        note: null,
      },
    ]);
    // No photo of the problem; one the work does not hold as an image is left out, never asked for.
    expect(paint!.snagsFixed.map((row) => [row.snagId, row.before, row.after])).toEqual([
      ['fix-t', null, { photoHash: h('wall-after'), fileName: 'wall-after.jpg' }],
      ['fix-pdf', null, null],
    ]);
  });

  it('does not show a snag’s photos again among the diary photos', () => {
    const entries = [
      entry(1, '2026-09-24', { done: [finished('a')], photos: [photo('after'), photo('kept')] }),
    ];
    const plan = { ...SNAGGY, documents: [...SNAGGY.documents, document('kept')] };
    const wet = handover(plan, entries).sections[0]!;
    expect(wet.photos.map((each) => each.photoHash)).toEqual([h('kept')]);
  });

  it('puts a snag with an activity where the activity is, one without in every section of its stage', () => {
    const roomed: WorkSnapshot = {
      ...SNAGGY,
      rooms: [
        { id: 'bath', position: 1, name: 'Bathroom' },
        { id: 'hall', position: 2, name: 'Hall' },
      ],
      activities: [
        { ...activity('a', 's', 1, 2), roomIds: ['bath'] },
        { ...activity('a2', 's', 2, 2), roomIds: ['hall'] },
        activity('b', 't', 1, 2),
      ],
      snags: [
        snag('on-a', 1, 's', { activityId: 'a', closure: fixed('2026-09-24', 'after') }),
        snag('on-stage', 2, 's', { closure: fixed('2026-09-24', 'wall-after') }),
      ],
    };
    const book = handover(roomed, []);
    expect(book.by).toBe('room');
    expect(
      book.sections.map((each) => [each.key, each.snagsFixed.map((row) => row.snagId)]),
    ).toEqual([
      ['room:bath', ['on-a', 'on-stage']],
      ['room:hall', ['on-stage']],
      ['other', []],
    ]);
  });
});

describe('aftercare in the book', () => {
  const AFTER: WorkSnapshot = {
    ...ROOMED,
    warranties: [
      warranty('w-gone', 3, '2026-09-01', 12, { targetKind: 'stage', targetId: 'demolished' }),
      warranty('w-valve', 1, '2026-01-31', 13, {
        title: 'Shower valve',
        targetKind: 'room',
        targetId: 'bath',
        givenBy: 'The installer',
        documentId: 'doc-warranty-a',
        note: 'Register it within 30 days',
      }),
      warranty('w-old', 2, '2020-01-01', 12, { title: 'Ended long ago' }),
    ],
    maintenance: [
      maintenanceTask('t-gutters', 2, 6, '2027-03-01', { title: 'Clean the gutters' }),
      maintenanceTask('t-reseal', 1, 12, '2026-09-15', {
        title: 'Reseal the shower',
        targetKind: 'stage',
        targetId: 'tiling',
        // Recorded out of seq order on purpose: the book reads them by seq.
        done: [
          maintenanceDone(2, '2027-09-20', 'Silicone renewed'),
          maintenanceDone(1, '2026-09-20'),
        ],
      }),
    ],
  };
  const book = handover(AFTER, ROOMED_DIARY);

  it('lists every warranty by target, then position: what, what it covers, who gives it, from, to, its paper', () => {
    // As care notes: the work's, then the rooms', then the stages', then those whose target is gone.
    expect(book.warranties.map((row) => row.warrantyId)).toEqual(['w-old', 'w-valve', 'w-gone']);
    expect(book.warranties[1]).toEqual({
      targetKind: 'room',
      targetId: 'bath',
      targetName: 'Bathroom',
      detached: false,
      warrantyId: 'w-valve',
      title: 'Shower valve',
      givenBy: 'The installer',
      startsOn: '2026-01-31',
      months: 13,
      endsOn: '2027-02-28',
      document: {
        documentId: 'doc-warranty-a',
        title: 'Title warranty-a',
        fileName: 'warranty-a.pdf',
      },
      note: 'Register it within 30 days',
    });
  });

  it('keeps an ended warranty, and says when what it covers is gone', () => {
    expect(book.warranties[0]).toMatchObject({
      targetName: 'Sample work',
      endsOn: '2021-01-01',
      document: null,
    });
    expect(book.warranties[2]).toMatchObject({ targetName: null, detached: true });
  });

  it('lists every task by target, then position: how often, the next due day, and the record by seq', () => {
    expect(book.maintenance.map((row) => row.taskId)).toEqual(['t-gutters', 't-reseal']);
    expect(book.maintenance[1]).toEqual({
      targetKind: 'stage',
      targetId: 'tiling',
      targetName: 'Tiling',
      detached: false,
      taskId: 't-reseal',
      title: 'Reseal the shower',
      everyMonths: 12,
      firstDueOn: '2026-09-15',
      nextDueOn: '2028-09-20',
      note: null,
      done: [
        { seq: 1, doneOn: '2026-09-20', note: null, authorName: 'Sample author' },
        { seq: 2, doneOn: '2027-09-20', note: 'Silicone renewed', authorName: 'Sample author' },
      ],
    });
    expect(book.maintenance[0]).toMatchObject({ nextDueOn: '2027-03-01', done: [] });
  });

  it('adds no gap and changes nothing else in the book', () => {
    const before = handover(ROOMED, ROOMED_DIARY);
    expect(handoverGaps(AFTER, ROOMED_DIARY)).toEqual(handoverGaps(ROOMED, ROOMED_DIARY));
    expect({ ...book, warranties: [], maintenance: [] }).toEqual(before);
    expect([before.warranties, before.maintenance]).toEqual([[], []]);
  });
});
