import { describe, expect, it } from 'vitest';

import type { ReportBlock, ReportDocument } from '@/data/commands';
import {
  activity,
  link,
  purchase,
  purchaseEvent,
  snapshot,
  stage,
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
 * Purchases on the owner's two documents (slice G2): the weekly report and the owner's snapshot say
 * what to order this week and what is late — a sentence, then figures with the purchases as rows,
 * each with what needs it and its day to order by or the day it is expected — in the owner's words;
 * the snapshot's next two weeks list what is to order in them. A work with no purchase prints nothing
 * of them. Every name is synthetic.
 */

// Wednesday 30 September 2026, nothing on the diary: as things stand, Assentar runs from today to
// 1 October and Pintar starts on the 2nd. This week runs to Sunday 4 October.
const TODAY = '2026-09-30';

const BASE = snapshot({
  work: { ...snapshot().work, name: 'Cozinha — ensaio', place: 'Rua Exemplo, 100' },
  stages: [stage('s1', 1, 'Bancadas'), stage('s2', 2, 'Pintura')],
  activities: [
    { ...activity('a1', 's1', 1, 2), name: 'Assentar' },
    { ...activity('b1', 's2', 1, 3), name: 'Pintar' },
  ],
  dependencies: [link('l1', 'a1', 'b1')],
});

const WITH_PURCHASES: WorkSnapshot = {
  ...BASE,
  purchases: [
    // Needed today, 10 days: should have been ordered by 20 September.
    purchase('p1', 1, 's1', 10, { name: 'Bancada', quantity: '3 m', supplier: 'Marmoraria' }),
    // Needed on the 2nd, 2 days: order by today.
    purchase('p2', 2, 's2', 2, { name: 'Tinta' }),
    // Ordered on the 10th, 5 days: expected on the 15th, not here yet.
    purchase('p3', 3, 's1', 5, {
      name: 'Dobradiças',
      events: [purchaseEvent(1, 'ordered', '2026-09-10')],
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
    heading: 'To order this week',
    week: 'To order this week',
    late: 'Late to order',
    arriving: 'Ordered, late to arrive',
    after: 'Arrive after they are needed',
    toOrder: 'To order',
    sentence:
      '2 purchases to order this week. 1 of them is late to order. 1 ordered purchase is late to arrive.',
    lateRow:
      'Bancada (3 m) — For Assentar — Bancadas — Order by: September 20, 2026 — 10 days late — Late to order',
    arrivingRow:
      'Dobradiças — For Assentar — Bancadas — Ordered on September 10, 2026 — expected on September 15, 2026 — 15 days late — Late to arrive',
  },
  'pt-BR': {
    heading: 'Encomendar esta semana',
    week: 'A encomendar esta semana',
    late: 'Atrasadas para encomendar',
    arriving: 'Encomendadas, atrasadas para chegar',
    after: 'Chegam depois do necessário',
    toOrder: 'A encomendar',
    sentence:
      '2 compras a encomendar esta semana. 1 delas está atrasada para encomendar. 1 compra encomendada está atrasada para chegar.',
    lateRow:
      'Bancada (3 m) — Para Assentar — Bancadas — Encomendar até: 20 de setembro de 2026 — 10 dias de atraso — Atrasado para encomendar',
    arrivingRow:
      'Dobradiças — Para Assentar — Bancadas — Encomendada em 10 de setembro de 2026 — prevista para 15 de setembro de 2026 — 15 dias de atraso — Atrasado para chegar',
  },
} as const;

describe.each(LANGUAGES)('the weekly report’s purchases, in %s', (language) => {
  const words = WORDS[language];
  const document = weeklyDocument(WITH_PURCHASES, language);

  it('says what to order and what is late, each a figure with its purchases', () => {
    expect(headings(document)).toContain(words.heading);
    expect(
      document.blocks.some((block) => block.type === 'paragraph' && block.text === words.sentence),
    ).toBe(true);
    const week = figureOf(document, words.week);
    expect(week.value).toBe('2');
    expect(week.rows[0]).toContain('Bancada');
    expect(week.rows[1]).toContain('Tinta');
    expect(figureOf(document, words.late).rows).toEqual([words.lateRow]);
    expect(figureOf(document, words.arriving).rows).toEqual([words.arrivingRow]);
    // A figure with nothing to count is printed with its zero.
    expect(figureOf(document, words.after).value).toBe('0');
  });

  it('prints every string within the host’s limits, and in WinAnsi', () => {
    for (const each of stringsOf(document)) {
      expect([...each].length).toBeLessThanOrEqual(REPORT_LIMITS.text);
      expect(unprintable(each), each).toEqual([]);
    }
  });

  it('says nothing of purchases on a work that has none', () => {
    expect(headings(weeklyDocument(BASE, language))).not.toContain(words.heading);
  });
});

describe.each(LANGUAGES)('the owner’s snapshot’s purchases, in %s', (language) => {
  const words = WORDS[language];

  it('says what to order and what is late, and lists what is to order in the next two weeks', () => {
    const document = snapshotDocument(WITH_PURCHASES, language);
    expect(headings(document)).toContain(words.heading);
    expect(figureOf(document, words.late).value).toBe('1');
    const toOrder = figureOf(document, words.toOrder);
    expect(toOrder.value).toBe('2');
    expect(toOrder.rows[0]).toContain('Bancada');
  });

  it('says nothing of purchases on a work that has none', () => {
    const document = snapshotDocument(BASE, language);
    expect(headings(document)).not.toContain(words.heading);
    expect(figureOf(document, words.toOrder).value).toBe('0');
  });
});
