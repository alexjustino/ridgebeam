import { describe, expect, it } from 'vitest';

import type { ReportBlock, ReportDocument } from '@/data/commands';
import {
  activity,
  decision,
  entry,
  finished,
  maintenanceDone,
  maintenanceTask,
  person,
  snag,
  snapshot,
  stage,
  warranty,
  worked,
} from '@/domain/__fixtures__/plan';
import type { DiaryEntry, Photo } from '@/domain/diary';
import type { CareNote, Check, CheckAnswer, Document, WorkSnapshot } from '@/domain/plan';
import { handover } from '@/domain/reports/handover';
import { LANGUAGES, type Language } from '@/i18n/index';
import { termFor } from '@/i18n/terms';
import { build, type I18n } from '@/i18n/useI18n';

import { REPORT_LIMITS, stringsOf } from './document';
import { composeHandover } from './handover';
import { unprintable } from './winansi';

/**
 * The handover book, composed in both languages (D3): the owner's record of the work — room by room
 * what was done, the decisions with their answers, the photos of hidden work as images, the
 * documents by name, who did what, the care notes — in the owner's words whatever lens is on
 * screen, and every string one the host's faces print. Every name is synthetic, with the accents
 * Portuguese writes so the encoder meets them.
 */

const TODAY = '2026-10-01';
const hash = (letter: string) => letter.repeat(64);

const image = (id: string, fileHash: string, fileName: string): Document => ({
  id,
  fileHash,
  fileName,
  mediaType: 'image/jpeg',
  bytes: 2048,
  width: 800,
  height: 600,
  kind: 'photo',
  title: fileName,
  addedOn: '2026-09-10',
  authorName: 'Sample author',
  createdAt: '2026-09-10T12:00:00.000Z',
  links: [],
});

const photo = (fileHash: string, fileName: string): Photo => ({
  fileHash,
  fileName,
  bytes: 2048,
  width: 800,
  height: 600,
  thumbnail: true,
});

const hiddenCheck: Check = {
  id: 'k1',
  stageId: 's1',
  gate: 'close',
  position: 1,
  name: 'Canos fotografados antes de fechar a parede',
  needsPhoto: true,
};

const answer: CheckAnswer = {
  id: 'ans1',
  checkId: 'k1',
  seq: 1,
  answer: 'yes',
  reason: null,
  photoHash: hash('a'),
  authorName: 'Sample author',
  answeredAt: '2026-09-12T15:00:00.000Z',
};

const note = (
  id: string,
  targetKind: CareNote['targetKind'],
  targetId: string,
  text: string,
): CareNote => ({
  id,
  targetKind,
  targetId,
  position: 1,
  text,
  createdAt: '2026-09-20T10:00:00.000Z',
});

const WARRANTY: Document = {
  ...image('doc-w', hash('c'), 'garantia-misturador.pdf'),
  mediaType: 'application/pdf',
  width: null,
  height: null,
  kind: 'warranty',
  title: 'Garantia do misturador',
  links: [{ targetKind: 'work', targetId: 'w1' }],
};

const ROOMED: WorkSnapshot = snapshot({
  work: {
    ...snapshot().work,
    workId: 'w1',
    name: 'Banheiro — ensaio de entrega',
    place: 'Rua Exemplo, 100',
    templateId: 'bathroom-renovation',
    templateVersion: 2,
    templateTitle: 'Reforma de banheiro',
  },
  people: [
    person('p1', 'João Encanador', { trade: 'Encanador', phone: '+55 11 0000-0000' }),
    person('p2', 'Maria Azulejista', { trade: 'Azulejista', email: 'maria@example.com' }),
  ],
  rooms: [{ id: 'r1', position: 1, name: 'Banheiro social' }],
  stages: [
    { ...stage('s1', 1, 'Instalações'), startedAt: '2026-09-01T09:00:00.000Z' },
    stage('s2', 2, 'Revestimento'),
  ],
  activities: [
    { ...activity('a1', 's1', 1, 2, 'p1'), name: 'Trocar os canos', roomIds: ['r1'] },
    { ...activity('a2', 's2', 1, 3, 'p2'), name: 'Assentar azulejo', roomIds: ['r1'] },
    { ...activity('a3', 's2', 2, 1), name: 'Limpar a obra' },
  ],
  decisions: [
    {
      ...decision('d1', 's2', 1, 5, '2026-09-05T12:00:00.000Z'),
      name: 'Cor do rejunte',
      answer: 'Cinza-claro, “platina”',
    },
  ],
  checks: [hiddenCheck],
  checkAnswers: [answer],
  documents: [
    image('doc-a', hash('a'), 'canos.jpg'),
    image('doc-b', hash('b'), 'piso.jpg'),
    WARRANTY,
  ],
  careNotes: [
    note('n1', 'work', 'w1', 'O registro geral fica embaixo da pia.'),
    note('n2', 'room', 'r1', 'Refazer o rejunte do box uma vez por ano.'),
    note('n3', 'stage', 's1', 'Não furar a parede atrás do vaso: há canos.'),
  ],
});

const ENTRIES: readonly DiaryEntry[] = [
  entry(1, '2026-09-08', { done: [worked('a1')], present: ['p1'] }),
  entry(2, '2026-09-11', {
    done: [finished('a1')],
    present: ['p1'],
    photos: [photo(hash('b'), 'piso.jpg')],
  }),
];

function i18nOf(language: Language): I18n {
  return { ...build(language, language), instant: (instant) => instant.slice(0, 16) };
}

function compose(plan: WorkSnapshot, language: Language, entries = ENTRIES): ReportDocument {
  return composeHandover(handover(plan, entries), plan, i18nOf(language), TODAY);
}

const images = (document: ReportDocument) =>
  document.blocks.filter(
    (block): block is Extract<ReportBlock, { type: 'image' }> => block.type === 'image',
  );
const headings = (document: ReportDocument, level: 1 | 2) =>
  document.blocks
    .filter(
      (block): block is Extract<ReportBlock, { type: 'heading' }> =>
        block.type === 'heading' && block.level === level,
    )
    .map((block) => block.text);
const text = (document: ReportDocument) => stringsOf(document).join('\n');

describe.each(LANGUAGES)('the handover book, in %s', (language) => {
  const document = compose(ROOMED, language);

  it('is the handover book, named in the owner’s words, of this work', () => {
    expect(document.kind).toBe('handover');
    expect(document.title.toLowerCase()).toBe(termFor(language, 'owner', 'handoverBook'));
    expect(document.subtitle).toBe(ROOMED.work.name);
    expect(document.language).toBe(language);
  });

  it('prints every string as itself, or with one of the three stand-ins', () => {
    for (const each of stringsOf(document)) {
      expect(unprintable(each), each).toEqual([]);
    }
  });

  it('says first, strongly, that it was written while the work was in progress', () => {
    const first = document.blocks[0];
    expect(first).toMatchObject({ type: 'paragraph', tone: 'strong' });
    expect(first?.type === 'paragraph' && first.text).toBe(
      i18nOf(language).t('reports.handover.inProgress'),
    );
  });

  it('holds the room, what was done, the decision’s answer, the care notes and the warranty', () => {
    const all = text(document);
    expect(headings(document, 1)).toContain('Banheiro social');
    expect(all).toContain('Trocar os canos');
    expect(all).toContain('Cinza-claro, “platina”');
    expect(all).toContain('Refazer o rejunte do box uma vez por ano.');
    expect(all).toContain('O registro geral fica embaixo da pia.');
    expect(all).toContain('Garantia do misturador');
    expect(all).toContain('garantia-misturador.pdf');
    expect(all).toContain('João Encanador');
    expect(all).toContain('+55 11 0000-0000');
  });
});

describe('the photos in the book', () => {
  const document = compose(ROOMED, 'en');

  it('prints the hidden work full width, captioned with the check and the day', () => {
    const [hidden] = images(document);
    expect(hidden).toMatchObject({ type: 'image', hash: hash('a'), size: 'full' });
    expect(hidden?.caption).toContain(hiddenCheck.name);
    expect(hidden?.caption).toContain('Instalações');
    expect(hidden?.caption).toContain('September 12, 2026');
  });

  it('prints the rest of the room’s story as thirds, captioned with the day and what it shows', () => {
    // G6: the hidden-work photo is told above, so the story's rest is the diary's one photo.
    expect(images(document).filter((block) => block.size === 'third')).toEqual([
      {
        type: 'image',
        hash: hash('b'),
        caption: 'Sep 11, 2026 — Trocar os canos',
        size: 'third',
      },
    ]);
    expect(images(document).some((block) => block.size === 'half')).toBe(false);
    expect(text(document)).toContain('On September 11, 2026: 1 photo.');
  });

  it('names only hashes the work holds, never a path', () => {
    const held = new Set(ROOMED.documents.map((each) => each.fileHash));
    for (const block of images(document)) {
      expect(held.has(block.hash), block.hash).toBe(true);
      expect(block.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('never asks the host for more images than it prints, and says how many it left out', () => {
    const many = Array.from({ length: REPORT_LIMITS.images + 3 }, (_, index) => ({
      ...answer,
      id: `many-${index}`,
      seq: index + 2,
      photoHash: index.toString(16).padStart(64, '0'),
    }));
    const plan: WorkSnapshot = {
      ...ROOMED,
      checkAnswers: [answer, ...many],
      documents: [
        ...ROOMED.documents,
        ...many.map((each) => image(`img-${each.id}`, each.photoHash!, `${each.id}.jpg`)),
      ],
    };
    const crowded = compose(plan, 'en');
    expect(images(crowded)).toHaveLength(REPORT_LIMITS.images);
    // G6: hidden work is never cut, and the story takes only what it leaves of the cap — here
    // nothing, so its one photo is counted by the room and the host's cut is the hidden work's.
    expect(text(crowded)).toContain(
      'The book prints at most 400 photos: 4 more photos are in the work’s folder.',
    );
    expect(text(crowded)).toContain('1 more photo is not shown.');
  });
});

/**
 * G6: each section's photos told first to last — the room's story less what its hidden work and its
 * snags fixed already show — as thirds, under its span, a month's name where the month changes,
 * each captioned with its day and what it shows; how many the pick left out; and the last section
 * titled for what it holds.
 */
describe.each(LANGUAGES)('in photos, first to last (G6), in %s', (language) => {
  const i18n = i18nOf(language);
  const plan: WorkSnapshot = {
    ...ROOMED,
    // Open: its problem photo is part of the room's story.
    snags: [
      snag('n1', 1, 's2', {
        title: 'Azulejo trincado',
        activityId: 'a2',
        raisedOn: '2026-09-25',
        photoHash: hash('d'),
      }),
    ],
    documents: [
      ...ROOMED.documents,
      image('doc-d', hash('d'), 'trinca.jpg'),
      image('doc-e', hash('e'), 'azulejo.jpg'),
      image('doc-f', hash('f'), 'rejunte.jpg'),
      image('doc-9', hash('9'), 'fachada.jpg'),
    ],
  };
  const entries: readonly DiaryEntry[] = [
    ...ENTRIES,
    // Written out of day order: the story is told by day all the same.
    entry(3, '2026-10-02', { done: [worked('a2')], photos: [photo(hash('f'), 'rejunte.jpg')] }),
    entry(4, '2026-09-20', { done: [worked('a2')], photos: [photo(hash('e'), 'azulejo.jpg')] }),
    // Naming no activity: told in what touches no room.
    entry(5, '2026-10-03', { photos: [photo(hash('9'), 'fachada.jpg')] }),
  ];
  const document = compose(plan, language, entries);
  const all = text(document);
  /** The blocks of the section titled `name`, up to the next page break. */
  const sectionOf = (name: string) => {
    const start = document.blocks.findIndex(
      (block) => block.type === 'heading' && block.level === 1 && block.text === name,
    );
    expect(start, name).toBeGreaterThan(-1);
    const end = document.blocks.findIndex(
      (block, index) => index > start && block.type === 'pageBreak',
    );
    return document.blocks.slice(start, end === -1 ? undefined : end);
  };
  const room = sectionOf('Banheiro social');
  const thirds = room.filter(
    (block): block is Extract<ReportBlock, { type: 'image' }> =>
      block.type === 'image' && block.size === 'third',
  );

  it('runs the room’s photos first to last, as thirds, the hidden work told above left out', () => {
    expect(thirds.map((block) => block.hash)).toEqual([hash('b'), hash('e'), hash('d'), hash('f')]);
  });

  it('says the span first: from the first day to the last, and how many', () => {
    expect(all).toContain(
      language === 'en'
        ? 'From September 11, 2026 to October 2, 2026: 4 photos.'
        : 'De 11 de setembro de 2026 a 2 de outubro de 2026: 4 fotos.',
    );
  });

  it('names the month above each month’s photos, where they span more than one', () => {
    const months = room
      .filter((block) => block.type === 'paragraph' && block.tone === 'strong')
      .map((block) => (block.type === 'paragraph' ? block.text : ''));
    expect(months).toEqual(
      language === 'en'
        ? ['September 2026', 'October 2026']
        : ['Setembro de 2026', 'Outubro de 2026'],
    );
    // Each month comes right before its photos: September's three, then October's one.
    const october = room.findIndex(
      (block) => block.type === 'paragraph' && block.text === months[1],
    );
    expect(room[october + 1]).toMatchObject({ type: 'image', hash: hash('f') });
  });

  it('captions each photo with its day and what it shows', () => {
    const caption = (day: string, what: string) =>
      i18n.t('story.caption', { day: i18n.dayShort(day), what });
    expect(thirds.map((block) => block.caption)).toEqual([
      caption('2026-09-11', 'Trocar os canos'),
      caption('2026-09-20', 'Assentar azulejo'),
      caption(
        '2026-09-25',
        language === 'en' ? 'Snag #1 — the problem' : 'Pendência nº 1 — o problema',
      ),
      caption('2026-10-02', 'Assentar azulejo'),
    ]);
  });

  it('tells what touches no room in its own last section, from the diary', () => {
    const other = sectionOf(i18n.t('reports.handover.section.other'));
    expect(other.find((block) => block.type === 'image' && block.hash === hash('9'))).toEqual({
      type: 'image',
      hash: hash('9'),
      caption: i18n.t('story.caption', {
        day: i18n.dayShort('2026-10-03'),
        what: i18n.t('story.kind.diary'),
      }),
      size: 'third',
    });
    expect(all).toContain(
      i18n.tp('reports.handover.photos.on', 1, { first: i18n.day('2026-10-03') }),
    );
  });

  it('prints every string as itself, or with one of the three stand-ins', () => {
    for (const each of stringsOf(document)) expect(unprintable(each), each).toEqual([]);
  });
});

describe('a room with more photos than the book holds for it', () => {
  const many = Array.from({ length: 20 }, (_, index) => index);
  const hashOf = (index: number) => (index + 0x100).toString(16).padStart(64, '0');
  const plan: WorkSnapshot = {
    ...ROOMED,
    documents: [
      ...ROOMED.documents,
      ...many.map((index) => image(`many-${index}`, hashOf(index), `obra-${index}.jpg`)),
    ],
  };
  const entries: readonly DiaryEntry[] = many.map((index) =>
    entry(index + 1, `2026-09-${String(index + 1).padStart(2, '0')}`, {
      done: [worked('a1')],
      photos: [photo(hashOf(index), `obra-${index}.jpg`)],
    }),
  );
  const document = compose(plan, 'en', entries);
  const thirds = images(document).filter((block) => block.size === 'third');

  it('prints twelve, the first and the last always, and says how many it left out', () => {
    expect(thirds).toHaveLength(12);
    expect(thirds[0]?.hash).toBe(hashOf(0));
    expect(thirds.at(-1)?.hash).toBe(hashOf(19));
    expect(text(document)).toContain('From September 1, 2026 to September 20, 2026: 20 photos.');
    expect(text(document)).toContain('8 more photos are not shown.');
  });

  it('keeps them in the story’s order', () => {
    const order = thirds.map((block) => many.findIndex((index) => hashOf(index) === block.hash));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('a work with no rooms, and a photo no stage takes', () => {
  const plan: WorkSnapshot = {
    ...ROOMED,
    rooms: [],
    activities: ROOMED.activities.map((each) => ({ ...each, roomIds: [] })),
    careNotes: ROOMED.careNotes.filter((each) => each.targetKind !== 'room'),
    documents: [...ROOMED.documents, image('doc-9', hash('9'), 'fachada.jpg')],
  };
  const entries: readonly DiaryEntry[] = [
    ...ENTRIES,
    entry(3, '2026-10-03', { photos: [photo(hash('9'), 'fachada.jpg')] }),
  ];

  it.each(LANGUAGES)('ends with the whole work, titled as such, in %s', (language) => {
    const i18n = i18nOf(language);
    const titles = headings(compose(plan, language, entries), 1);
    const work = titles.indexOf(i18n.t('story.section.work'));
    expect(work).toBeGreaterThan(-1);
    expect(titles.slice(0, work)).toEqual(['Instalações', 'Revestimento']);
    expect(titles).not.toContain(i18n.t('reports.handover.section.other'));
    expect(i18n.t('story.section.work')).toBe(language === 'en' ? 'The whole work' : 'A obra toda');
  });
});

describe('what the book lacks, on its first page', () => {
  it('is a figure with its rows, before the sections', () => {
    const document = compose(ROOMED, 'en');
    const gaps = document.blocks.findIndex(
      (block) => block.type === 'figure' && block.label === 'What the book still lacks',
    );
    const firstSection = document.blocks.findIndex((block) => block.type === 'pageBreak');
    expect(gaps).toBeGreaterThan(-1);
    expect(gaps).toBeLessThan(firstSection);
    const figure = document.blocks[gaps];
    expect(figure?.type === 'figure' && figure.rows).toContain('Revestimento: stage still open.');
  });

  it('is printed with its zero when nothing is missing, and the book says it is finished', () => {
    const done: WorkSnapshot = {
      ...ROOMED,
      stages: ROOMED.stages.map((each) => ({
        ...each,
        startedAt: '2026-09-01T09:00:00.000Z',
        closedAt: '2026-09-25T17:00:00.000Z',
      })),
    };
    const document = compose(done, 'en');
    const figure = document.blocks.find(
      (block) => block.type === 'figure' && block.label === 'What the book still lacks',
    );
    expect(figure).toMatchObject({ value: 'Nothing missing', rows: [] });
    expect(text(document)).not.toContain('in progress');
    expect(text(document)).toContain('Finished on September 25, 2026.');
  });
});

describe('a work with no rooms', () => {
  it('is told stage by stage, in stage order', () => {
    const plan: WorkSnapshot = {
      ...ROOMED,
      rooms: [],
      activities: ROOMED.activities.map((each) => ({ ...each, roomIds: [] })),
      careNotes: ROOMED.careNotes.filter((each) => each.targetKind !== 'room'),
    };
    const document = compose(plan, 'pt-BR');
    expect(headings(document, 1).slice(0, 2)).toEqual(['Instalações', 'Revestimento']);
    expect(document.title).toBe('Manual de entrega');
    // The stage's own note needs no name: its heading gave it.
    expect(text(document)).toContain('Não furar a parede atrás do vaso: há canos.');
    expect(text(document)).not.toContain('Instalações: Não furar');
  });
});

describe('in a room, a stage’s note says which stage', () => {
  it('prefixes the stage’s name, and not the room’s own', () => {
    const all = text(compose(ROOMED, 'en'));
    expect(all).toContain('Instalações: Não furar a parede atrás do vaso: há canos.');
    expect(all).not.toContain('Banheiro social: Refazer');
  });
});

describe.each(LANGUAGES)('after the handover, in the book (G4), in %s', (language) => {
  const plan: WorkSnapshot = {
    ...ROOMED,
    warranties: [
      warranty('w-valve', 1, '2026-03-15', 24, {
        title: 'Válvula do chuveiro',
        targetKind: 'room',
        targetId: 'r1',
        givenBy: 'Instalador Exemplo',
        documentId: 'doc-w',
        note: 'Vale com a revisão anual.',
      }),
    ],
    maintenance: [
      maintenanceTask('t-seal', 1, 12, '2026-09-01', {
        title: 'Refazer a vedação do box',
        targetKind: 'room',
        targetId: 'r1',
        done: [maintenanceDone(1, '2026-09-20', 'Silicone novo')],
      }),
      maintenanceTask('t-gutter', 2, 6, '2027-01-10', { title: 'Limpar as calhas' }),
    ],
  };
  const document = compose(plan, language);
  const all = text(document);
  const i18n = i18nOf(language);

  it('prints the warranties: what, what it covers, who gives it, from–to and its paper', () => {
    expect(headings(document, 1)).toContain(i18n.t('reports.handover.warranties.title'));
    const line = stringsOf(document).find((each) => each.startsWith('Válvula do chuveiro'));
    expect(line).toBeDefined();
    expect(line).toContain('Banheiro social');
    expect(line).toContain('Instalador Exemplo');
    expect(line).toContain(i18n.day('2026-03-15'));
    expect(line).toContain(i18n.day('2028-03-15'));
    expect(line).toContain('Garantia do misturador');
    expect(all).toContain('Vale com a revisão anual.');
  });

  it('prints the maintenance: what, how often, next due, and each time it was done', () => {
    expect(headings(document, 1)).toContain(i18n.t('reports.handover.maintenance.title'));
    const seal = stringsOf(document).find((each) => each.startsWith('Refazer a vedação do box'));
    expect(seal).toContain(i18n.tp('aftercare.every', 12));
    expect(seal).toContain(i18n.t('aftercare.task.next', { day: i18n.day('2027-09-20') }));
    const gutter = stringsOf(document).find((each) => each.startsWith('Limpar as calhas'));
    expect(gutter).toContain(i18n.t('aftercare.task.first', { day: i18n.day('2027-01-10') }));
    expect(all).toContain(
      i18n.t('aftercare.task.record', { day: i18n.day('2026-09-20'), author: 'Sample author' }),
    );
    expect(all).toContain('Silicone novo');
    expect(all).toContain(i18n.t('aftercare.task.neverDone'));
  });

  it('prints every string as itself, or with one of the three stand-ins', () => {
    for (const each of stringsOf(document)) expect(unprintable(each), each).toEqual([]);
  });

  it('says so when the work has neither', () => {
    const none = text(compose(ROOMED, language));
    expect(none).toContain(i18n.t('reports.handover.warranties.none'));
    expect(none).toContain(i18n.t('reports.handover.maintenance.none'));
  });
});
