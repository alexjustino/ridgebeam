import { describe, expect, it } from 'vitest';

import type { ReportBlock, ReportDocument } from '@/data/commands';
import {
  activity,
  correction,
  decision,
  entry,
  finished,
  link,
  person,
  snapshot,
  stage,
  takeBaseline,
  worked,
} from '@/domain/__fixtures__/plan';
import type { DiaryEntry } from '@/domain/diary';
import type { WorkSnapshot } from '@/domain/plan';
import { diaryReport } from '@/domain/reports/diary';
import { scheduleReport } from '@/domain/reports/schedule';
import { weekly, type Weekly } from '@/domain/reports/weekly';
import { LENSES } from '@/domain/settings';
import { schedule } from '@/domain/schedule';
import { DICTIONARIES, LANGUAGES, type Language } from '@/i18n/index';
import { TERM_KEYS, termsFor } from '@/i18n/terms';
import { build, type I18n } from '@/i18n/useI18n';

import { composeDiary } from './diary';
import { pieces, REPORT_LIMITS, stringsOf } from './document';
import { composeSchedule } from './schedule';
import { composeWeekly } from './weekly';
import { printable, SUBSTITUTES, unprintable } from './winansi';

/**
 * The composers, in both languages: each report holds what its decision says, in the words the
 * screen uses — the weekly report in the owner's whatever lens is on screen — and every string a
 * composed document can hold is one the host's WinAnsi faces print as itself, or one of the three
 * documented stand-ins (→ ≥ ≤). Nothing prints as "?".
 *
 * Every name below is synthetic (CONTRIBUTING.md, public repository hygiene), with the accents
 * Portuguese writes so the encoder meets them.
 */

/** Monday 28 September 2026: the week under report is 28 September – 4 October. */
const TODAY = '2026-09-30';

const BASE = snapshot({
  work: {
    ...snapshot().work,
    name: 'Reforma da cozinha — ensaio',
    place: 'Rua Exemplo, 100',
  },
  people: [
    person('p1', 'João Azulejista', { trade: 'Azulejista', stageIds: ['s2'] }),
    person('p2', 'Maria Pedreira'),
  ],
  stages: [
    { ...stage('s1', 1, 'Demolição'), startedAt: '2026-09-01T09:00:00.000Z' },
    stage('s2', 2, 'Acabamento'),
  ],
  activities: [
    { ...activity('a1', 's1', 1, 20, 'p2'), name: 'Quebrar o piso' },
    { ...activity('a2', 's2', 1, 3, 'p1'), name: 'Assentar azulejo', quantity: 12, unit: 'm²' },
    { ...activity('a3', 's2', 2, null), name: 'Rejunte' },
  ],
  dependencies: [link('l1', 'a1', 'a2')],
  decisions: [{ ...decision('d1', 's2', 1, 30), name: 'Cor do azulejo' }],
  costLines: [
    { id: 'c1', stageId: 's1', activityId: 'a1', label: 'Caçamba', amountCents: 450_00 },
    { id: 'c2', stageId: 's2', activityId: null, label: 'Azulejo', amountCents: null },
  ],
  payments: [
    {
      id: 'pay1',
      seq: 1,
      day: '2026-09-29',
      stageId: 's1',
      personId: 'p2',
      commitmentId: null,
      amountCents: 200_00,
      whatFor: 'Sinal da caçamba',
      receiptHash: null,
      reversesSeq: null,
      authorName: 'Sample author',
      createdAt: '2026-09-29T12:00:00.000Z',
    },
  ],
});

/** Approved once, so the finish is read against a baseline and the slip is printed. */
const PLAN: WorkSnapshot = { ...BASE, baselines: [takeBaseline(BASE, 1)] };

const LONG_NOTE = `${'Parede norte descascada. '.repeat(120)}Fim.`;

const ENTRIES: readonly DiaryEntry[] = [
  entry(1, '2026-09-28', {
    note: 'Piso quebrado na metade — “sem surpresas”.',
    weather: 'sun',
    done: [worked('a1')],
    present: ['p2'],
    photos: [
      {
        fileHash: 'f'.repeat(64),
        fileName: 'piso.jpg',
        bytes: 1000,
        width: 800,
        height: 600,
        thumbnail: true,
      },
    ],
  }),
  entry(2, '2026-09-29', { weather: 'rain', note: 'Chuva o dia todo.' }),
  correction(3, 1, '2026-09-28', {
    note: LONG_NOTE,
    weather: 'sun',
    done: [finished('a1', 12)],
    present: ['p2', 'gone-person'],
  }),
];

function i18nOf(language: Language): I18n {
  // The clock's zone would move an entry's time between machines; the rest is the real table.
  return { ...build(language, language), instant: (instant) => instant.slice(0, 16) };
}

function weeklyOf(plan: WorkSnapshot, entries: readonly DiaryEntry[], day: string | null): Weekly {
  const result = weekly(plan, schedule(plan), entries, day, TODAY);
  if (!result.ok) throw new Error(result.problem.code);
  return result.weekly;
}

function composeAll(language: Language): Record<'weekly' | 'diary' | 'schedule', ReportDocument> {
  const i18n = i18nOf(language);
  const scheduled = schedule(PLAN);
  const screenTerms = termsFor(language, 'engineer');
  return {
    weekly: composeWeekly(weeklyOf(PLAN, ENTRIES, null), PLAN, scheduled, i18n),
    diary: composeDiary(diaryReport(PLAN, ENTRIES), PLAN, i18n, screenTerms),
    schedule: composeSchedule(scheduleReport(PLAN, scheduled), PLAN, i18n, screenTerms),
  };
}

/**
 * What the host would refuse the document for, as `report::model::check` reads it — the limits
 * and the shapes — or `null`. A mirror, so a composer that drifts past the host fails here first.
 */
function refusal(document: ReportDocument): string | null {
  const long = (value: string) => [...value].length > REPORT_LIMITS.text;
  if (document.title.trim() === '' || long(document.title) || long(document.subtitle))
    return 'title';
  if (document.blocks.length > REPORT_LIMITS.blocks) return 'blocks';
  let rows = 0;
  for (const [index, block] of document.blocks.entries()) {
    const at = `block ${index + 1}`;
    switch (block.type) {
      case 'heading':
        if (block.level !== 1 && block.level !== 2) return `${at}: level`;
        break;
      case 'figure':
        rows += block.rows.length;
        break;
      case 'table':
        if (block.columns.length === 0 || block.columns.length > 16) return `${at}: columns`;
        if (block.columns.some((column) => !(column.width > 0 && column.width <= 1))) {
          return `${at}: width`;
        }
        if (block.rows.some((row) => row.length !== block.columns.length)) return `${at}: cells`;
        rows += block.rows.length;
        break;
      case 'gantt':
        if (block.days < 1 || block.days > 3660) return `${at}: days`;
        if (block.dayLabels.length !== 0 && block.dayLabels.length !== block.days) {
          return `${at}: labels`;
        }
        for (const bar of block.rows) {
          if (bar.start < 0 || bar.length < 0 || bar.start + bar.length > block.days) {
            return `${at}: bar ${bar.label}`;
          }
          if ((bar.baselineStart === null) !== (bar.baselineLength === null)) {
            return `${at}: baseline ${bar.label}`;
          }
        }
        rows += block.rows.length;
        break;
      default:
        break;
    }
    if (rows > REPORT_LIMITS.tableRows) return 'rows';
  }
  return stringsOf(document).some(long) ? 'text' : null;
}

const text = (document: ReportDocument) => stringsOf(document).join('\n');

function figureLabelled(document: ReportDocument, label: string) {
  const found = document.blocks.find(
    (block): block is Extract<ReportBlock, { type: 'figure' }> =>
      block.type === 'figure' && block.label === label,
  );
  expect(found, `no figure labelled "${label}"`).toBeDefined();
  return found!;
}

describe.each(LANGUAGES)('the documents, in %s', (language) => {
  const documents = composeAll(language);

  it.each(['weekly', 'diary', 'schedule'] as const)(
    'composes the %s document the same way every time',
    (kind) => {
      expect(documents[kind]).toMatchSnapshot();
    },
  );

  it.each(['weekly', 'diary', 'schedule'] as const)(
    'keeps the %s inside the host’s limits, in the language on screen',
    (kind) => {
      const document = documents[kind];
      expect(document.kind).toBe(kind);
      expect(document.language).toBe(language);
      expect(refusal(document)).toBeNull();
      for (const block of document.blocks) {
        if (block.type !== 'table') continue;
        const widths = block.columns.reduce((sum, column) => sum + column.width, 0);
        expect(widths).toBeCloseTo(1, 6);
      }
    },
  );

  it.each(['weekly', 'diary', 'schedule'] as const)(
    'writes nothing in the %s that the page would print as "?"',
    (kind) => {
      for (const each of stringsOf(documents[kind])) {
        expect(unprintable(each), each).toEqual([]);
      }
    },
  );
});

describe('the weekly report', () => {
  it('is in the owner’s words whatever lens is on screen', () => {
    const { weekly: en } = composeAll('en');
    const { weekly: pt } = composeAll('pt-BR');
    // The host prints the title at the top of every report; the blocks never repeat it.
    expect(en.title).toBe('Weekly report');
    expect(pt.title).toBe('Relatório semanal');
    for (const each of [en, pt]) {
      expect(each.blocks.filter((block) => block.type === 'heading' && block.level === 1)).toEqual(
        [],
      );
    }
    // The owner's words for readiness and the finish date, never the engineer's on screen.
    figureLabelled(en, termsFor('en', 'owner')('readiness', { capital: true }));
    figureLabelled(en, termsFor('en', 'owner')('finishDate', { capital: true }));
    figureLabelled(pt, termsFor('pt-BR', 'owner')('readiness', { capital: true }));
    expect(text(en)).toContain('How ready the plan is');
    expect(text(pt)).toContain('Quanto o plano está pronto');
    expect(text(en)).not.toMatch(/\bReadiness\b/);
    expect(text(en)).toMatch(/week/i);
    expect(text(pt)).toMatch(/semana/i);
  });

  it('names the work, what was done, who was there, a decision due and the money', () => {
    const { weekly: document } = composeAll('en');
    const all = text(document);
    expect(all).toContain('Reforma da cozinha — ensaio');
    expect(all).toContain('Quebrar o piso');
    expect(all).toContain('Maria Pedreira');
    expect(all).toContain('Cor do azulejo');
    expect(all).toContain('not priced yet');
    // Finished this week, from the correction that now speaks for Monday.
    const done = figureLabelled(document, 'Finished this week');
    expect(done.value).toBe('1');
    expect(done.rows[0]).toContain('Quebrar o piso');
    // Rain with nothing done is a weather day lost.
    expect(figureLabelled(document, 'Weather days lost').value).toBe('1');
    // The first three things readiness lacks, then how many more.
    const readiness = figureLabelled(document, 'How ready the plan is');
    expect(readiness.value).toMatch(/%$/);
    expect(readiness.rows.length).toBeLessThanOrEqual(4);
    // A slip is printed against the baseline.
    figureLabelled(document, 'Slip');
    // The decisions window is the report's own, and says so.
    figureLabelled(document, 'Decisions overdue or due in the next 14 calendar days');
  });

  it('says a week with no entry on its first line, strongly, and still prints the rest', () => {
    const document = composeWeekly(
      weeklyOf(PLAN, ENTRIES, '2026-09-16'),
      PLAN,
      schedule(PLAN),
      i18nOf('en'),
    );
    expect(document.blocks[0]).toEqual({
      type: 'paragraph',
      tone: 'strong',
      text: 'No diary entry this week: 5 working days are over with nothing written. The rest of this report is still printed.',
    });
    expect(text(document)).toContain('Cor do azulejo');
    expect(figureLabelled(document, 'Working days without an entry this week').rows).toHaveLength(
      5,
    );

    const pt = composeWeekly(
      weeklyOf(PLAN, ENTRIES, '2026-09-16'),
      PLAN,
      schedule(PLAN),
      i18nOf('pt-BR'),
    );
    expect(pt.blocks[0]).toMatchObject({ type: 'paragraph', tone: 'strong' });
    expect((pt.blocks[0] as { text: string }).text).toMatch(/^Nenhuma entrada no diário/);
  });

  it('says a week that has only begun has nothing written yet, not that days were missed', () => {
    const document = composeWeekly(
      weeklyOf(PLAN, [], '2026-09-28'),
      PLAN,
      schedule(PLAN),
      i18nOf('en'),
    );
    const first = document.blocks[0] as { text: string; tone: string };
    expect(first.tone).toBe('strong');
    // Monday and Tuesday are over, so two days are said missing; a Monday-morning report would say "yet".
    expect(first.text).toMatch(/^No diary entry this week/);
  });
});

describe('the diary document', () => {
  const { diary: document } = composeAll('en');
  const entries = document.blocks.filter(
    (block): block is Extract<ReportBlock, { type: 'figure' }> => block.type === 'figure',
  );

  it('prints every entry once, in the order written, correction and corrected both', () => {
    expect(entries.map((each) => each.label)).toEqual([
      'Entry #1 · September 28, 2026',
      'Entry #2 · September 29, 2026',
      'Entry #3 · September 28, 2026',
    ]);
    expect(entries[0]!.value).toBe('Corrected by #3 · no longer counts');
    expect(entries[2]!.value).toBe('Correction of #1 · counts for its day');
  });

  it('carries a long note whole, in as many strings as it takes', () => {
    const lines = entries[2]!.rows;
    const noteLines = lines.filter((line) => line.startsWith('Parede') || line.startsWith('norte'));
    expect(noteLines.length).toBeGreaterThan(1);
    const carried = pieces(LONG_NOTE);
    expect(carried.join(' ')).toBe(LONG_NOTE);
    for (const piece of carried) expect(lines).toContain(piece);
  });

  it('names a person the plan no longer has without guessing, and counts the photos', () => {
    expect(entries[2]!.rows).toContain('On site: Maria Pedreira, someone no longer in the plan');
    expect(entries[0]!.rows).toContain('1 photo, kept in the work’s folder');
    expect(text(document)).toContain('Photos are not printed');
  });

  it('keeps a diary of 3 000 entries inside what the host prints', () => {
    const many = Array.from({ length: 3000 }, (_, index) =>
      entry(index + 1, '2026-09-28', {
        note: 'Line one\nLine two',
        weather: 'cloud',
        hours: 8,
        done: [worked('a1'), finished('a2', 3)],
        present: ['p1', 'p2'],
      }),
    );
    const document = composeDiary(
      diaryReport(PLAN, many),
      PLAN,
      i18nOf('en'),
      termsFor('en', 'owner'),
    );
    expect(refusal(document)).toBeNull();
  });

  it('says an empty diary is empty', () => {
    const empty = composeDiary(
      diaryReport(PLAN, []),
      PLAN,
      i18nOf('pt-BR'),
      termsFor('pt-BR', 'owner'),
    );
    expect(text(empty)).toContain('Nada foi escrito no diário ainda.');
  });
});

describe('the schedule document', () => {
  it('is a landscape page with a bar per placed activity and a row for every activity', () => {
    const { schedule: document } = composeAll('en');
    expect(document.pageSize).toBe('a4-landscape');
    const gantt = document.blocks.find((block) => block.type === 'gantt');
    expect(gantt).toBeDefined();
    if (gantt?.type !== 'gantt') return;
    expect(gantt.rows.map((row) => row.label)).toEqual([
      '1.1 Quebrar o piso',
      '2.1 Assentar azulejo',
    ]);
    expect(gantt.dayLabels).toHaveLength(gantt.days);
    expect(gantt.dayLabels[0]).not.toBe('');
    expect(gantt.rows.every((row) => row.baselineStart !== null)).toBe(true);
    const table = document.blocks.find((block) => block.type === 'table');
    if (table?.type !== 'table') throw new Error('no table');
    expect(table.rows).toHaveLength(3);
    // An activity with no duration is a row with its reason, never left out.
    expect(table.rows[2]).toContain('no duration yet');
    // The critical path is said in words, not by the bar's fill alone.
    expect(table.rows[0]![1]).toBe('Quebrar o piso · critical path');
  });

  it('says why nothing can be drawn, and still prints the table', () => {
    const looped: WorkSnapshot = {
      ...PLAN,
      baselines: [],
      dependencies: [link('l1', 'a1', 'a2'), link('l2', 'a2', 'a1')],
    };
    const document = composeSchedule(
      scheduleReport(looped, schedule(looped)),
      looped,
      i18nOf('en'),
      termsFor('en', 'owner'),
    );
    expect(document.blocks.some((block) => block.type === 'gantt')).toBe(false);
    expect(document.blocks).toContainEqual({
      type: 'paragraph',
      tone: 'strong',
      text: 'Nothing can be drawn: the links make a loop. Remove one of them in the breakdown.',
    });
    const table = document.blocks.find((block) => block.type === 'table');
    expect(table?.type === 'table' && table.rows.length).toBe(3);
  });
});

describe('what the page can print', () => {
  it('prints every sentence both dictionaries hold as itself, or with a documented substitute', () => {
    // Every string of a document passes through `printable` on its way out, as here.
    for (const language of LANGUAGES) {
      for (const [key, sentence] of Object.entries(DICTIONARIES[language])) {
        expect(unprintable(printable(sentence)), `${language} ${key}`).toEqual([]);
      }
    }
  });

  it('prints every word of the glossary, in every lens, as itself', () => {
    for (const language of LANGUAGES) {
      for (const lens of LENSES) {
        const term = termsFor(language, lens);
        for (const key of TERM_KEYS) {
          expect(unprintable(term(key, { capital: true })), `${language} ${lens} ${key}`).toEqual(
            [],
          );
        }
      }
    }
  });

  it('prints dates, times, numbers and money as each language writes them', () => {
    for (const language of LANGUAGES) {
      const i18n = build(language, language);
      for (const written of [
        i18n.day('2026-09-28'),
        i18n.dayShort('2026-09-28'),
        i18n.instant('2026-09-28T15:30:00.000Z'),
        i18n.number(-1234.5),
        i18n.money(-123_456, 'BRL'),
        i18n.money(123_456, 'USD'),
        i18n.money(123_456, 'EUR'),
      ]) {
        expect(unprintable(printable(written)), written).toEqual([]);
      }
    }
  });

  it('knows exactly the three stand-ins the host documents', () => {
    expect(Object.keys(SUBSTITUTES).sort()).toEqual(['→', '≤', '≥'].sort());
    // × is Latin-1 (0xD7): inside the set, printed as itself, never a stand-in.
    expect(Object.hasOwn(SUBSTITUTES, '×')).toBe(false);
    expect(unprintable('A → B, ≥ 2, ≤ 3, 2 × 3')).toEqual([]);
    expect(unprintable('Olá ✓ 😀')).toEqual(['✓', '😀']);
  });

  it('folds the spaces and the minus Intl writes onto the ones the faces carry', () => {
    const spaced = ['10:00', String.fromCharCode(0x202f), 'AM ', String.fromCharCode(0x2212), '5'];
    expect(unprintable(printable(spaced.join('')))).toEqual([]);
    // A line break is kept for the host to break the line at; a tab is a space.
    expect(printable('one\r\ntwo\tthree')).toBe('one\ntwo three');
    expect(unprintable('one\ntwo')).toEqual([]);
  });
});
