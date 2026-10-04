import { describe, expect, it } from 'vitest';

import type { ReportBlock, ReportDocument } from '@/data/commands';
import {
  activity,
  changeDecision,
  changeOrder,
  link,
  person,
  snapshot,
  stage,
  takeBaseline,
} from '@/domain/__fixtures__/plan';
import type { WorkSnapshot } from '@/domain/plan';
import { weekly } from '@/domain/reports/weekly';
import { schedule } from '@/domain/schedule';
import { finishProbability } from '@/domain/schedule/probability';
import { LANGUAGES, type Language } from '@/i18n/index';
import { build, type I18n } from '@/i18n/useI18n';

import { REPORT_LIMITS, stringsOf } from './document';
import { composeSnapshot } from './snapshot';
import { composeWeekly } from './weekly';
import { unprintable } from './winansi';

/**
 * Change orders on the owner's two documents (slice E1): the weekly report's "Changes" section — the
 * changes decided this week and the ones waiting — and the owner's snapshot's "Waiting for your
 * decision", each followed by the standing tally, in the owner's words and in both languages. Before
 * the plan is approved neither prints a word about changes: there are none. Every name is synthetic.
 */

/** Wednesday 30 September 2026: the week under report is 28 September – 4 October. */
const TODAY = '2026-09-30';

const BASE = snapshot({
  work: { ...snapshot().work, name: 'Banheiro — ensaio', place: 'Rua Exemplo, 100' },
  people: [person('p1', 'Ana Eletricista')],
  stages: [stage('s1', 1, 'Instalações'), stage('s2', 2, 'Acabamento')],
  activities: [
    { ...activity('a1', 's1', 1, 2), name: 'Passar os fios' },
    { ...activity('a2', 's2', 1, 3), name: 'Assentar azulejo' },
  ],
  dependencies: [link('l1', 'a1', 'a2')],
});

const APPROVED: WorkSnapshot = {
  ...BASE,
  work: { ...BASE.work, approvedAt: '2026-09-02T12:00:00.000Z' },
  baselines: [takeBaseline(BASE, 1)],
  changeOrders: [
    changeOrder('co1', 1, 's2', '2026-09-20', {
      title: 'Tomada extra',
      costCents: 300_00,
      decision: changeDecision('approved', '2026-09-29', {
        finishBefore: '2026-09-07',
        finishAfter: '2026-09-09',
        daysDelta: 2,
        costCents: 300_00,
      }),
    }),
    changeOrder('co2', 2, 's2', '2026-09-21', {
      title: 'Banheira de hidromassagem',
      askedBy: 'person',
      askedByPersonId: 'p1',
      costCents: 5_000_00,
      decision: changeDecision('declined', '2026-09-28', { note: 'Fica para depois.' }),
    }),
    changeOrder('co3', 3, 's2', '2026-09-29', {
      title: 'Nicho no box',
      askedBy: 'other',
      askedByName: 'Vizinha do 12',
      costCents: -50_00,
    }),
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

/** The figure labelled `label`, which must be there. */
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
    heading: 'Changes',
    decided: 'Decided this week',
    waiting: 'Waiting for a decision',
    yours: 'Waiting for your decision',
    cost: 'Changes approved',
    days: 'Working days added by changes',
    you: 'A change you asked for',
    later: '2 working days later',
  },
  'pt-BR': {
    heading: 'Aditivos',
    decided: 'Decididos nesta semana',
    waiting: 'Esperando uma decisão',
    yours: 'Esperando a sua decisão',
    cost: 'Aditivos aprovados',
    days: 'Dias úteis acrescentados por aditivos',
    you: 'Um aditivo que você pediu',
    later: '2 dias úteis depois',
  },
} as const;

describe.each(LANGUAGES)('the weekly report’s Changes, in %s', (language) => {
  const words = WORDS[language];
  const document = weeklyDocument(APPROVED, language);

  it('lists the changes decided this week, with how and the impact the decision froze', () => {
    expect(headings(document)).toContain(words.heading);
    const decided = figureOf(document, words.decided);
    expect(decided.value).toBe('2');
    expect(decided.rows).toHaveLength(2);
    const [approved, declined] = decided.rows;
    expect(approved).toContain('Tomada extra');
    expect(approved).toContain(words.you);
    expect(approved).toContain(words.later);
    expect(declined).toContain('Banheira de hidromassagem');
    expect(declined).toContain('Ana Eletricista');
  });

  it('lists the change waiting, who asked and that it saves money, then the tally', () => {
    const waiting = figureOf(document, words.waiting);
    expect(waiting.value).toBe('1');
    expect(waiting.rows[0]).toContain('Nicho no box');
    expect(waiting.rows[0]).toContain('Vizinha do 12');
    expect(figureOf(document, words.cost).value).toMatch(/300/);
    expect(figureOf(document, words.cost).rows).toHaveLength(1);
    expect(figureOf(document, words.days).value).toBe('+2');
  });

  it('prints every string within the host’s limits, and in WinAnsi', () => {
    for (const each of stringsOf(document)) {
      expect([...each].length).toBeLessThanOrEqual(REPORT_LIMITS.text);
      expect(unprintable(each), each).toEqual([]);
    }
  });

  it('says nothing of changes before the plan is approved', () => {
    const before = weeklyDocument(BASE, language);
    expect(headings(before)).not.toContain(words.heading);
    expect(
      before.blocks.some((block) => block.type === 'figure' && block.label === words.decided),
    ).toBe(false);
  });
});

describe.each(LANGUAGES)('the owner’s snapshot, in %s', (language) => {
  const words = WORDS[language];

  it('says what waits for the owner’s decision, and the tally in the owner’s words', () => {
    const document = snapshotDocument(APPROVED, language);
    expect(headings(document)).toContain(words.heading);
    const waiting = figureOf(document, words.yours);
    expect(waiting.value).toBe('1');
    expect(waiting.rows[0]).toContain('Nicho no box');
    expect(figureOf(document, words.cost).value).toMatch(/300/);
    expect(figureOf(document, words.days).value).toBe('+2');
    const tally = document.blocks.find(
      (block) =>
        block.type === 'paragraph' &&
        block.text.includes(language === 'en' ? 'were asked for by' : 'vieram de'),
    );
    expect(tally).toBeDefined();
    expect(JSON.stringify(tally)).toContain(language === 'en' ? 'you' : 'você');
  });

  it('says nothing of changes before the plan is approved', () => {
    const document = snapshotDocument(BASE, language);
    expect(headings(document)).not.toContain(words.heading);
  });
});
