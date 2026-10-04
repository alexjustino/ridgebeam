import { describe, expect, it } from 'vitest';

import type { ReportBlock, ReportDocument } from '@/data/commands';
import {
  activity,
  decision,
  entry,
  link,
  person,
  snapshot,
  stage,
  worked,
} from '@/domain/__fixtures__/plan';
import type { DiaryEntry, Photo } from '@/domain/diary';
import type { Document, WorkSnapshot } from '@/domain/plan';
import { readiness } from '@/domain/readiness';
import { schedule } from '@/domain/schedule';
import { finishProbability } from '@/domain/schedule/probability';
import { LANGUAGES, type Language } from '@/i18n/index';
import { capitalised, termFor } from '@/i18n/terms';
import { build, type I18n } from '@/i18n/useI18n';

import { REPORT_LIMITS, stringsOf } from './document';
import { composeSnapshot, SNAPSHOT_ENTRIES, SNAPSHOT_PHOTOS_PER_ENTRY } from './snapshot';
import { readinessSentence } from './words';

/**
 * The owner's snapshot, composed in both languages (D4, decision 3): the work today, the next two
 * weeks, the last entries with their photos and the money, in the owner's words — and nothing a
 * page meant to be sent should carry: no phone, no e-mail, no author, no document. Every name is
 * synthetic, with the accents Portuguese writes.
 */

/** A Tuesday, a week into the work. */
const TODAY = '2026-09-08';
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
  addedOn: '2026-09-07',
  authorName: 'Sample author',
  createdAt: '2026-09-07T12:00:00.000Z',
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

const PHONE = '+55 11 0000-0000';
const EMAIL = 'joao@example.com';
const NOTE = 'Os canos velhos saíram; a parede está aberta.';

const PLAN: WorkSnapshot = snapshot({
  work: { ...snapshot().work, name: 'Cozinha — retrato de ensaio', place: 'Rua Exemplo, 100' },
  people: [person('p1', 'João Encanador', { trade: 'Encanador', phone: PHONE, email: EMAIL })],
  stages: [
    { ...stage('s1', 1, 'Instalações'), startedAt: '2026-09-01T09:00:00.000Z' },
    stage('s2', 2, 'Revestimento'),
  ],
  activities: [
    // 1 to 10 September: under way on the 8th.
    { ...activity('a1', 's1', 1, 8, 'p1'), name: 'Trocar os canos' },
    // After it: 11 to 15 September, starting in the window.
    { ...activity('a2', 's2', 1, 3), name: 'Assentar azulejo' },
  ],
  dependencies: [link('l1', 'a1', 'a2')],
  decisions: [{ ...decision('d1', 's2', 1, 2), name: 'Cor do rejunte' }],
  checks: [
    {
      id: 'k1',
      stageId: 's2',
      gate: 'start',
      position: 1,
      name: 'Azulejo na obra',
      needsPhoto: false,
    },
  ],
  commitments: [
    {
      id: 'c1',
      stageId: 's2',
      personId: null,
      label: 'Orçamento do azulejista',
      amountCents: 1000_00,
      agreedOn: '2026-09-01',
      documentHash: null,
      milestones: [
        {
          id: 'm1',
          position: 1,
          label: 'Azulejo assentado',
          shareBp: 5000,
          trigger: 'activity_finished',
          activityId: 'a2',
        },
      ],
    },
  ],
  documents: [
    image('doc-b', hash('b'), 'parede.jpg'),
    image('doc-c', hash('c'), 'canos.jpg'),
    image('doc-d', hash('d'), 'piso.jpg'),
  ],
});

/** Six entries, one a day: the snapshot shows the last five, the newest with three photos. */
const ENTRIES: readonly DiaryEntry[] = [
  entry(1, '2026-09-01', { note: 'O primeiro dia.', done: [worked('a1')], present: ['p1'] }),
  entry(2, '2026-09-02', { done: [worked('a1')] }),
  entry(3, '2026-09-03', { done: [worked('a1')] }),
  entry(4, '2026-09-04', { done: [worked('a1')] }),
  entry(5, '2026-09-05', { done: [worked('a1')] }),
  entry(6, '2026-09-07', {
    note: NOTE,
    done: [worked('a1')],
    present: ['p1'],
    photos: [
      photo(hash('b'), 'parede.jpg'),
      photo(hash('c'), 'canos.jpg'),
      photo(hash('d'), 'piso.jpg'),
    ],
  }),
];

function i18nOf(language: Language): I18n {
  return build(language, language);
}

function compose(
  plan: WorkSnapshot,
  language: Language,
  entries: readonly DiaryEntry[] = ENTRIES,
): ReportDocument {
  const scheduled = schedule(plan);
  return composeSnapshot(
    {
      snapshot: plan,
      scheduled,
      entries,
      probability: finishProbability(plan, scheduled, { entries }),
      today: TODAY,
    },
    i18nOf(language),
  );
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
const figureOf = (document: ReportDocument, label: string) =>
  document.blocks.find(
    (block): block is Extract<ReportBlock, { type: 'figure' }> =>
      block.type === 'figure' && block.label === label,
  );
const text = (document: ReportDocument) => stringsOf(document).join('\n');

describe.each(LANGUAGES)('the owner’s snapshot, in %s', (language) => {
  const i18n = i18nOf(language);
  const { t } = i18n;
  const document = compose(PLAN, language);

  it('is the snapshot, named by the glossary’s term, of this work on this day', () => {
    expect(document.kind).toBe('snapshot');
    expect(document.language).toBe(language);
    expect(document.title).toBe(capitalised(language, termFor(language, 'owner', 'snapshot')));
    expect(document.subtitle).toContain(PLAN.work.name);
    expect(document.subtitle).toContain(i18n.day(TODAY));
  });

  it('holds five sections, in order, and the closing line last', () => {
    expect(headings(document, 1)).toEqual([
      t('reports.snapshot.today'),
      // E3: why it is late — before approval, the sentence that it needs an approved plan.
      t('delay.title'),
      t('reports.snapshot.next.title'),
      t('reports.snapshot.lately.title'),
      t('nav.money'),
    ]);
    expect(document.blocks.at(-1)).toEqual({
      type: 'paragraph',
      tone: 'muted',
      text: t('reports.snapshot.closing', { day: i18n.day(TODAY) }),
    });
  });

  it('says readiness as the dashboard says it, beside the figure in the owner’s words', () => {
    const measure = readiness(PLAN, { schedule: schedule(PLAN), today: TODAY });
    expect(text(document)).toContain(readinessSentence(i18n, measure.missing));
    expect(
      figureOf(document, capitalised(language, termFor(language, 'owner', 'readiness'))),
    ).toBeDefined();
  });

  it('opens the next two weeks onto what starts, what runs, who, what to decide, the gate, the money', () => {
    const starting = figureOf(document, t('reports.lookahead.figure.starting'));
    expect(starting?.value).toBe('1');
    expect(starting?.rows.join('\n')).toContain('Assentar azulejo');
    const running = figureOf(document, t('reports.lookahead.figure.running'));
    expect(running?.rows.join('\n')).toContain('Trocar os canos');
    expect(running?.rows.join('\n')).toContain('João Encanador');
    expect(figureOf(document, t('reports.lookahead.figure.people'))?.rows[0]).toContain(
      'João Encanador',
    );
    expect(figureOf(document, t('reports.lookahead.figure.decisions'))?.rows[0]).toContain(
      'Cor do rejunte',
    );
    const gates = figureOf(document, t('reports.lookahead.figure.gates'));
    expect(gates?.rows.join('\n')).toContain('Azulejo na obra');
    const falling = figureOf(document, t('reports.lookahead.figure.fallingDue'));
    expect(falling?.value).toBe(i18n.money(500_00, 'BRL'));
    expect(falling?.rows[0]).toContain('Orçamento do azulejista');
  });

  it('draws the window as a Gantt of fourteen days, one bar an activity', () => {
    const gantt = document.blocks.find((block) => block.type === 'gantt');
    expect(gantt).toMatchObject({ type: 'gantt', days: 14 });
    expect(gantt?.type === 'gantt' && gantt.dayLabels).toHaveLength(14);
    expect(gantt?.type === 'gantt' && gantt.rows.map((row) => row.label)).toEqual([
      '1.1 Trocar os canos',
      '2.1 Assentar azulejo',
    ]);
  });

  it(`shows the last ${SNAPSHOT_ENTRIES} entries, newest first, with the note whole and who was there`, () => {
    const lately = document.blocks.findIndex(
      (block) => block.type === 'heading' && block.text === t('reports.snapshot.lately.title'),
    );
    const money = document.blocks.findIndex(
      (block) => block.type === 'heading' && block.text === t('nav.money'),
    );
    const section = document.blocks.slice(lately, money);
    const days = section.filter((block) => block.type === 'heading' && block.level === 2);
    expect(days).toHaveLength(SNAPSHOT_ENTRIES);
    expect(days[0]?.type === 'heading' && days[0].text).toContain('7');
    const all = text(document);
    expect(all).toContain(NOTE);
    expect(all).not.toContain('O primeiro dia.');
    expect(all).toContain('João Encanador');
  });

  it(`embeds at most ${SNAPSHOT_PHOTOS_PER_ENTRY} photos of an entry, half width, and counts the rest`, () => {
    const shown = images(document);
    expect(shown).toHaveLength(SNAPSHOT_PHOTOS_PER_ENTRY);
    for (const block of shown) {
      expect(block.size).toBe('half');
      expect(PLAN.documents.map((each) => each.fileHash)).toContain(block.hash);
    }
    expect(shown[0]?.caption).toContain('parede.jpg');
    expect(text(document)).toContain(i18n.tp('reports.snapshot.lately.morePhotos', 1));
  });

  it('carries no contact, no author and no document — it is made to be sent', () => {
    const all = text(document);
    expect(all).not.toContain(PHONE);
    expect(all).not.toContain(EMAIL);
    expect(all).not.toContain('Sample author');
  });

  it('keeps inside the host’s limits', () => {
    expect(document.blocks.length).toBeLessThanOrEqual(REPORT_LIMITS.blocks);
    for (const each of stringsOf(document)) {
      expect([...each].length).toBeLessThanOrEqual(REPORT_LIMITS.text);
    }
  });
});

describe('the words', () => {
  it('names the two weeks as the e2e reads them, in both languages', () => {
    expect(text(compose(PLAN, 'en'))).toMatch(/next two weeks/i);
    expect(text(compose(PLAN, 'pt-BR'))).toMatch(/próximas duas semanas/i);
    expect(text(compose(PLAN, 'en'))).toMatch(/does not change/);
    expect(text(compose(PLAN, 'pt-BR'))).toMatch(/não muda/);
  });

  it('never doubles a full stop after a day that ends in an abbreviation', () => {
    // Seen on the written page: "a quinta-feira, 15 de out..".
    expect(text(compose(PLAN, 'pt-BR'))).not.toMatch(/[^.]\.\.(?!\.)/);
    expect(text(compose(PLAN, 'en'))).not.toMatch(/[^.]\.\.(?!\.)/);
  });

  it('is HTML, not WinAnsi: a character the PDF would fold is kept as it is', () => {
    const plan = { ...PLAN, work: { ...PLAN.work, name: 'Obra → 2º andar ≥ 3 m² ✓' } };
    expect(compose(plan, 'en').subtitle).toContain('Obra → 2º andar ≥ 3 m² ✓');
  });

  it('carries a note longer than a string on as many paragraphs, never cut', () => {
    const long = 'Uma palavra '.repeat(400).trim();
    const entries = [entry(1, '2026-09-07', { note: long })];
    const document = compose(PLAN, 'en', entries);
    const joined = document.blocks
      .map((block) => (block.type === 'paragraph' ? block.text : ''))
      .join(' ');
    expect(joined).toContain(long);
    expect(
      document.blocks.filter((block) => block.type === 'paragraph' && block.text.includes('Uma')),
    ).toHaveLength(3);
  });
});

describe('a quiet work', () => {
  it('says the diary has no entry rather than leaving the section blank', () => {
    const document = compose(PLAN, 'en', []);
    expect(text(document)).toContain('The diary has no entry yet.');
    expect(images(document)).toEqual([]);
  });

  it('says an empty fortnight is a plan with no dates, and draws no chart', () => {
    const plan: WorkSnapshot = {
      ...PLAN,
      activities: PLAN.activities.map((each) => ({ ...each, durationDays: null })),
    };
    const document = compose(plan, 'pt-BR');
    const i18n = i18nOf('pt-BR');
    expect(text(document)).toContain(i18n.t('reports.snapshot.next.nothingPlaced'));
    expect(document.blocks.some((block) => block.type === 'gantt')).toBe(false);
    expect(figureOf(document, i18n.t('reports.lookahead.figure.starting'))?.value).toBe('0');
  });
});
