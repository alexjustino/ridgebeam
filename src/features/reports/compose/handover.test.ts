import { describe, expect, it } from 'vitest';

import type { ReportBlock, ReportDocument } from '@/data/commands';
import {
  activity,
  decision,
  entry,
  finished,
  person,
  snapshot,
  stage,
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

  it('prints the diary’s photos half width, captioned with the activity and the day', () => {
    const diary = images(document).filter((block) => block.size === 'half');
    expect(diary).toEqual([
      {
        type: 'image',
        hash: hash('b'),
        caption: 'Trocar os canos, September 11, 2026',
        size: 'half',
      },
    ]);
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
    expect(text(crowded)).toContain(
      'The book prints at most 400 photos: 5 more photos are in the work’s folder.',
    );
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
