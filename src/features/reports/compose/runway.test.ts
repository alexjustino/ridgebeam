import { describe, expect, it } from 'vitest';

import type { ReportBlock, ReportDocument } from '@/data/commands';
import { activity, link, snapshot, stage } from '@/domain/__fixtures__/plan';
import type { CostLine, Funding, WorkSnapshot } from '@/domain/plan';
import { readiness } from '@/domain/readiness';
import { weekly } from '@/domain/reports/weekly';
import { runway, runwayChance } from '@/domain/runway';
import { schedule } from '@/domain/schedule';
import { finishProbability } from '@/domain/schedule/probability';
import { LANGUAGES, type Language } from '@/i18n/index';
import { build } from '@/i18n/useI18n';

import { stringsOf } from './document';
import { composeSnapshot } from './snapshot';
import { composeWeekly } from './weekly';
import { unprintable } from './winansi';
import { readinessRowText, readinessSentence } from './words';

/**
 * **Will the money last?** (E2) on paper: the weekly report and the owner's snapshot print the Money
 * page's sentence, the chance (or that every duration is taken as certain), the week the money runs
 * short with what comes in and goes out that week, and the money expected and late — in the owner's
 * words, in both languages, and in characters the PDF can print.
 */

/** Wednesday of the week before the work starts (Monday 7 September 2026). */
const TODAY = '2026-09-02';

const line = (id: string, stageId: string, amountCents: number): CostLine => ({
  id,
  stageId,
  activityId: null,
  label: `Line ${id}`,
  amountCents,
});

const fund = (
  id: string,
  label: string,
  amountCents: number,
  expectedOn: string,
  position: number,
) => ({ id, position, label, source: null, amountCents, expectedOn, note: null }) satisfies Funding;

/** Walls, then Paint: $1,500 out in each of Walls' two weeks, $2,000 in Paint's; $1,000 in today. */
const PLAN: WorkSnapshot = snapshot({
  work: { ...snapshot().work, startDate: '2026-09-07' },
  stages: [stage('s1', 1, 'Walls'), stage('s2', 2, 'Paint')],
  activities: [activity('a', 's1', 1, 5), activity('b', 's1', 2, 5), activity('c', 's2', 1, 5)],
  dependencies: [link('ab', 'a', 'b'), link('bc', 'b', 'c')],
  costLines: [line('l1', 's1', 3000_00), line('l2', 's2', 2000_00)],
  funding: [
    fund('savings', 'Savings', 1000_00, TODAY, 1),
    fund('client', 'Client instalment', 300_00, '2026-09-01', 2),
  ],
});

const SENTENCE = {
  en: /^Money runs short in the week of .+ — .+ short\.$/,
  'pt-BR': /^Falta dinheiro na semana de .+ — faltam .+\.$/,
} as const;

const TITLE = { en: 'Will the money last?', 'pt-BR': 'O dinheiro vai dar?' } as const;

function cashOf(plan: WorkSnapshot) {
  const scheduled = schedule(plan);
  return {
    runway: runway(plan, scheduled, [], TODAY),
    chance: runwayChance(plan, scheduled, [], TODAY),
  };
}

function weeklyOf(language: Language): ReportDocument {
  const scheduled = schedule(PLAN);
  const selection = weekly(PLAN, scheduled, [], null, TODAY);
  if (!selection.ok) throw new Error('no week');
  return composeWeekly(
    selection.weekly,
    PLAN,
    scheduled,
    build(language, language),
    finishProbability(PLAN, scheduled, { entries: [] }),
    cashOf(PLAN),
  );
}

function snapshotOf(language: Language): ReportDocument {
  const scheduled = schedule(PLAN);
  return composeSnapshot(
    {
      snapshot: PLAN,
      scheduled,
      entries: [],
      probability: finishProbability(PLAN, scheduled, { entries: [] }),
      today: TODAY,
    },
    build(language, language),
  );
}

/** The blocks from the runway's heading to the next heading of the same or a higher level. */
function runwaySection(document: ReportDocument): ReportBlock[] {
  const blocks = document.blocks;
  const at = blocks.findIndex(
    (block) => block.type === 'heading' && TITLE[document.language as Language] === block.text,
  );
  if (at < 0) throw new Error('no runway heading');
  const level = (blocks[at] as Extract<ReportBlock, { type: 'heading' }>).level;
  const end = blocks.findIndex(
    (block, index) => index > at && block.type === 'heading' && block.level <= level,
  );
  return blocks.slice(at, end < 0 ? undefined : end);
}

describe.each(LANGUAGES)('Will the money last? on paper, in %s', (language) => {
  const i18n = build(language, language);

  it.each([
    ['weekly report', weeklyOf],
    ['owner’s snapshot', snapshotOf],
  ] as const)('the %s prints the sentence and the short week’s rows', (_name, compose) => {
    const section = runwaySection(compose(language));
    const sentence = section.find((block) => block.type === 'paragraph' && block.tone === 'strong');
    expect(sentence?.type === 'paragraph' && sentence.text).toMatch(SENTENCE[language]);

    const short = section.find(
      (block): block is Extract<ReportBlock, { type: 'figure' }> =>
        block.type === 'figure' && block.value === i18n.day('2026-09-07'),
    );
    expect(short).toBeDefined();
    // The week, how far short, and what goes out that week.
    expect(short!.rows[0]).toContain(i18n.day('2026-09-13'));
    expect(short!.rows.slice(1).join(' ')).toContain('Walls');

    // The client's sum, expected yesterday, is listed as late — not counted.
    const late = section.find(
      (block): block is Extract<ReportBlock, { type: 'figure' }> =>
        block.type === 'figure' && block.rows.some((row) => row.includes('Client instalment')),
    );
    expect(late?.value).toBe('1');
  });

  it('prints only what the PDF can print', () => {
    const strange = stringsOf(weeklyOf(language)).flatMap((text) => unprintable(text));
    expect(strange).toEqual([]);
  });
});

describe('the readiness row: where the money comes from is not written down yet', () => {
  const UNFUNDED: WorkSnapshot = { ...PLAN, funding: [] };
  const ROW = {
    en: 'where the money comes from is not written down yet',
    'pt-BR': 'de onde vem o dinheiro ainda não está anotado',
  } as const;

  it.each(LANGUAGES)('is said on its row and in the sentence, in %s', (language) => {
    const i18n = build(language, language);
    const measure = readiness(UNFUNDED, { schedule: schedule(UNFUNDED), today: TODAY });
    const row = measure.missing.find((each) => each.ruleId === 'work.funding');
    expect(row).toBeDefined();
    expect(readinessRowText(i18n, row!)).toBe(ROW[language]);
    expect(readinessSentence(i18n, measure.missing)).toContain(
      i18n.tp('readiness.missing.work.funding', 1),
    );
    // With a fund written down, the rule holds.
    const funded = readiness(PLAN, { schedule: schedule(PLAN), today: TODAY });
    expect(funded.missing.some((each) => each.ruleId === 'work.funding')).toBe(false);
  });
});
