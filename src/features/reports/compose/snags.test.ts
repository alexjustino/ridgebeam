import { describe, expect, it } from 'vitest';

import type { ReportBlock, ReportDocument } from '@/data/commands';
import { activity, person, snag, snagClosure, snapshot, stage } from '@/domain/__fixtures__/plan';
import type { Document, WorkSnapshot } from '@/domain/plan';
import { handover } from '@/domain/reports/handover';
import { weekly } from '@/domain/reports/weekly';
import { schedule } from '@/domain/schedule';
import { finishProbability } from '@/domain/schedule/probability';
import { LANGUAGES, type Language } from '@/i18n/index';
import { termsFor } from '@/i18n/terms';
import { build, type I18n } from '@/i18n/useI18n';

import { REPORT_LIMITS, stringsOf } from './document';
import { composeHandover, handoverGapText } from './handover';
import { composeSnapshot } from './snapshot';
import { composeWeekly } from './weekly';
import { unprintable } from './winansi';

/**
 * Snags on the owner's three documents (slice E4): the weekly report and the owner's snapshot say
 * what is still to fix and on whom — figures with the snags as rows — in the owner's words, and the
 * weekly report the snags closed in its week; the handover book counts each open snag as a gap, "Still
 * to fix: …", and prints a fixed one with the photo of the problem and the photo of the fix side by
 * side, half width. A work that never had a snag prints nothing of them. Every name is synthetic.
 */

/** Wednesday 30 September 2026: the week under report is 28 September – 4 October. */
const TODAY = '2026-09-30';
const BEFORE = 'a'.repeat(64);
const AFTER = 'b'.repeat(64);

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

const BASE = snapshot({
  work: { ...snapshot().work, name: 'Banheiro — ensaio', place: 'Rua Exemplo, 100' },
  people: [person('p1', 'Ana Azulejista')],
  stages: [stage('s1', 1, 'Acabamento')],
  activities: [{ ...activity('a1', 's1', 1, 2), name: 'Assentar azulejo' }],
});

const WITH_SNAGS: WorkSnapshot = {
  ...BASE,
  documents: [image('d1', BEFORE, 'trinca.jpg'), image('d2', AFTER, 'consertado.jpg')],
  snags: [
    snag('n1', 1, 's1', {
      title: 'Azulejo trincado',
      activityId: 'a1',
      personId: 'p1',
      photoHash: BEFORE,
      closure: snagClosure('fixed', '2026-09-29', AFTER),
    }),
    snag('n2', 2, 's1', { title: 'Porta agarrando', personId: 'p1', dueOn: '2026-09-25' }),
    snag('n3', 3, 's1', { title: 'Rodapé solto' }),
  ],
};

function i18nOf(language: Language): I18n {
  return { ...build(language, language), instant: (instant) => instant.slice(0, 16) };
}

function weeklyDocument(plan: WorkSnapshot, language: Language): ReportDocument {
  const scheduled = schedule(plan);
  const result = weekly(plan, scheduled, [], null, TODAY);
  if (!result.ok) throw new Error(result.problem.code);
  return composeWeekly(
    result.weekly,
    plan,
    scheduled,
    i18nOf(language),
    finishProbability(plan, scheduled, { entries: [] }),
  );
}

function snapshotDocument(plan: WorkSnapshot, language: Language): ReportDocument {
  const scheduled = schedule(plan);
  return composeSnapshot(
    {
      snapshot: plan,
      scheduled,
      entries: [],
      probability: finishProbability(plan, scheduled, { entries: [] }),
      today: TODAY,
    },
    i18nOf(language),
  );
}

type Figure = Extract<ReportBlock, { type: 'figure' }>;
type Image = Extract<ReportBlock, { type: 'image' }>;

function figureOf(document: ReportDocument, label: string): Figure {
  const found = document.blocks.find(
    (block): block is Figure => block.type === 'figure' && block.label === label,
  );
  if (found === undefined) throw new Error(`no figure ${label}`);
  return found;
}

const headings = (document: ReportDocument) =>
  document.blocks.flatMap((block) => (block.type === 'heading' ? [block.text] : []));

const WORDS = {
  en: {
    heading: 'Still to fix',
    open: 'Snags still to fix',
    overdue: 'Snags past their day',
    closed: 'Snags closed this week',
    sentence: '2 snags are still to fix. 1 of them is past its day.',
    person: 'On Ana Azulejista',
    gap: 'Still to fix: Porta agarrando.',
    fixedHeading: 'Snags fixed',
  },
  'pt-BR': {
    heading: 'Falta resolver',
    open: 'Pendências por resolver',
    overdue: 'Pendências vencidas',
    closed: 'Pendências fechadas nesta semana',
    sentence: '2 pendências faltam resolver. 1 delas está vencida.',
    person: 'Com Ana Azulejista',
    gap: 'Falta resolver: Porta agarrando.',
    fixedHeading: 'Pendências resolvidas',
  },
} as const;

describe.each(LANGUAGES)('the weekly report’s Still to fix, in %s', (language) => {
  const words = WORDS[language];
  const document = weeklyDocument(WITH_SNAGS, language);

  it('says what is open and on whom, each a figure with its snags, and what closed this week', () => {
    expect(headings(document)).toContain(words.heading);
    const sentence = document.blocks.find(
      (block) => block.type === 'paragraph' && block.text.startsWith(words.sentence),
    );
    expect(sentence).toBeDefined();
    const open = figureOf(document, words.open);
    expect(open.value).toBe('2');
    expect(open.rows[0]).toContain('Porta agarrando');
    expect(open.rows[0]).toContain('Ana Azulejista');
    const overdue = figureOf(document, words.overdue);
    expect(overdue.value).toBe('1');
    expect(figureOf(document, words.person).value).toBe('1');
    const closed = figureOf(document, words.closed);
    expect(closed.value).toBe('1');
    expect(closed.rows[0]).toContain('Azulejo trincado');
  });

  it('prints every string within the host’s limits, and in WinAnsi', () => {
    for (const each of stringsOf(document)) {
      expect([...each].length).toBeLessThanOrEqual(REPORT_LIMITS.text);
      expect(unprintable(each), each).toEqual([]);
    }
  });

  it('says nothing of snags on a work that never had one', () => {
    expect(headings(weeklyDocument(BASE, language))).not.toContain(words.heading);
  });
});

describe.each(LANGUAGES)('the owner’s snapshot, in %s', (language) => {
  const words = WORDS[language];

  it('says what is still to fix and on whom', () => {
    const document = snapshotDocument(WITH_SNAGS, language);
    expect(headings(document)).toContain(words.heading);
    expect(figureOf(document, words.open).value).toBe('2');
    expect(figureOf(document, words.overdue).rows[0]).toContain('Porta agarrando');
    expect(
      document.blocks.some((block) => block.type === 'figure' && block.label === words.closed),
    ).toBe(false);
  });

  it('says nothing of snags on a work that never had one', () => {
    expect(headings(snapshotDocument(BASE, language))).not.toContain(words.heading);
  });
});

describe.each(LANGUAGES)('the handover book, in %s', (language) => {
  const words = WORDS[language];
  const i18n = i18nOf(language);
  const book = handover(WITH_SNAGS, []);
  const document = composeHandover(book, WITH_SNAGS, i18n, TODAY);

  it('counts each open snag as a gap, "Still to fix", on its first page', () => {
    const term = termsFor(language, 'owner');
    const gaps = book.gaps.rows.filter((gap) => gap.kind === 'snag-open');
    expect(gaps.map((gap) => handoverGapText(i18n, term, gap))).toContain(words.gap);
    const figure = document.blocks.find(
      (block): block is Figure => block.type === 'figure' && block.rows.includes(words.gap),
    );
    expect(figure).toBeDefined();
  });

  it('prints a fixed snag with the photo of the problem and of the fix, side by side', () => {
    expect(headings(document)).toContain(words.fixedHeading);
    const images = document.blocks.filter(
      (block): block is Image =>
        block.type === 'image' && (block.hash === BEFORE || block.hash === AFTER),
    );
    expect(images.map((each) => each.hash)).toEqual([BEFORE, AFTER]);
    expect(images.every((each) => each.size === 'half')).toBe(true);
    expect(images.every((each) => each.caption.includes('Azulejo trincado'))).toBe(true);
  });

  it('prints every string within the host’s limits, and in WinAnsi', () => {
    for (const each of stringsOf(document)) {
      expect([...each].length).toBeLessThanOrEqual(REPORT_LIMITS.text);
      expect(unprintable(each), each).toEqual([]);
    }
  });

  it('prints no snag heading for a work that never had one', () => {
    const plain = composeHandover(handover(BASE, []), BASE, i18n, TODAY);
    expect(headings(plain)).not.toContain(words.fixedHeading);
  });
});
