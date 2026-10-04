import { describe, expect, it } from 'vitest';

import type { ReportBlock, ReportDocument } from '@/data/commands';
import {
  activity,
  entry,
  link,
  person,
  snapshot,
  stage,
  takeBaseline,
  worked,
} from '@/domain/__fixtures__/plan';
import { delayLedger } from '@/domain/delay';
import type { DiaryEntry } from '@/domain/diary';
import type { WorkSnapshot } from '@/domain/plan';
import { diaryReport } from '@/domain/reports/diary';
import { weekly } from '@/domain/reports/weekly';
import { schedule } from '@/domain/schedule';
import { finishProbability } from '@/domain/schedule/probability';
import { LANGUAGES, type Language } from '@/i18n/index';
import { termsFor } from '@/i18n/terms';
import { build } from '@/i18n/useI18n';

import { composeDiary } from './diary';
import { stringsOf } from './document';
import { composeSnapshot } from './snapshot';
import { composeWeekly } from './weekly';
import { unprintable } from './winansi';

/**
 * **As things stand** and **Why is it late?** (E3) on paper: the weekly report and the owner's
 * snapshot print the forecast sentence — against the baseline, and the plan's own date beside it —
 * and the ledger by cause in the owner's words (the weekly also by party), with what the record does
 * not explain; the diary's PDF and the snapshot say why a day was lost. Both languages; characters
 * the PDF can print.
 */

const TODAY = '2026-09-10';

const PLAN = snapshot({
  people: [person('p1', 'J. Plumber')],
  stages: [stage('s1', 1, 'Plumbing')],
  activities: [activity('a1', 's1', 1, 3, 'p1'), activity('a2', 's1', 2, 2, 'p1')],
  dependencies: [link('l1', 'a1', 'a2')],
});
const APPROVED: WorkSnapshot = {
  ...PLAN,
  work: { ...PLAN.work, approvedAt: '2026-08-31T12:00:00.000Z' },
  baselines: [takeBaseline(PLAN, 1)],
};
const ENTRIES: DiaryEntry[] = [
  entry(1, '2026-09-01', { done: [worked('a1')], present: ['p1'] }),
  entry(2, '2026-09-02', { lostDay: true, lostCause: 'decision' }),
  entry(3, '2026-09-03', { lostDay: true, weather: 'rain' }),
  entry(4, '2026-09-04', { note: 'Nobody came.' }),
];

const TITLE = { en: 'Why is it late?', 'pt-BR': 'Por que está atrasada?' } as const;
const FORECAST = {
  en: /^As things stand it finishes on /,
  'pt-BR': /^Do jeito que está, termina em /,
};

function weeklyOf(language: Language, plan: WorkSnapshot = APPROVED): ReportDocument {
  const scheduled = schedule(plan);
  const selection = weekly(plan, scheduled, ENTRIES, '2026-09-01', TODAY);
  if (!selection.ok) throw new Error('no week');
  return composeWeekly(
    selection.weekly,
    plan,
    scheduled,
    build(language, language),
    finishProbability(plan, scheduled, { entries: ENTRIES }),
    null,
    delayLedger(plan, scheduled, ENTRIES, TODAY),
  );
}

function snapshotOf(language: Language, plan: WorkSnapshot = APPROVED): ReportDocument {
  const scheduled = schedule(plan);
  return composeSnapshot(
    {
      snapshot: plan,
      scheduled,
      entries: ENTRIES,
      probability: finishProbability(plan, scheduled, { entries: ENTRIES }),
      today: TODAY,
    },
    build(language, language),
  );
}

function section(document: ReportDocument): ReportBlock[] {
  const blocks = document.blocks;
  const at = blocks.findIndex(
    (block) => block.type === 'heading' && block.text === TITLE[document.language as Language],
  );
  if (at < 0) throw new Error('no delay heading');
  const level = (blocks[at] as Extract<ReportBlock, { type: 'heading' }>).level;
  const end = blocks.findIndex(
    (block, index) => index > at && block.type === 'heading' && block.level <= level,
  );
  return blocks.slice(at, end < 0 ? undefined : end);
}

const figures = (blocks: readonly ReportBlock[]) =>
  blocks.filter(
    (block): block is Extract<ReportBlock, { type: 'figure' }> => block.type === 'figure',
  );

describe.each(LANGUAGES)('why it is late, on paper, in %s', (language) => {
  const i18n = build(language, language);
  const ledger = delayLedger(APPROVED, schedule(APPROVED), ENTRIES, TODAY);

  it.each([
    ['weekly report', weeklyOf, 3],
    ['owner’s snapshot', snapshotOf, 2],
  ] as const)('the %s prints the forecast and the ledger', (_name, compose, count) => {
    const blocks = section(compose(language));
    const strong = blocks.find((block) => block.type === 'paragraph' && block.tone === 'strong');
    expect(strong?.type === 'paragraph' && strong.text).toMatch(FORECAST[language]);
    const printed = figures(blocks);
    expect(printed).toHaveLength(count);
    expect(printed[0]!.value).toBe(String(ledger.total));
    // By cause: one row per cause, in the owner's words, each with its days.
    expect(printed[1]!.rows).toHaveLength(ledger.figures!.byCause.rows.length);
    expect(printed[1]!.rows.join(' ')).toContain(i18n.t('delay.cause.decision'));
    if (ledger.unexplainedDays > 0) {
      expect(stringsOf(compose(language))).toContain(
        i18n.tp('delay.unexplained', ledger.unexplainedDays),
      );
    }
  });

  it('the weekly report names the party', () => {
    expect(figures(section(weeklyOf(language)))[2]!.rows.join(' ')).toContain('J. Plumber');
  });

  it('before approval says it needs an approved plan, and prints no figure', () => {
    const blocks = section(snapshotOf(language, PLAN));
    expect(figures(blocks)).toEqual([]);
    const said = blocks.map((block) => (block.type === 'paragraph' ? block.text : '')).join(' ');
    expect(said).toContain(
      i18n.t('delay.status.needsApproval', { baseline: termsFor(language, 'owner')('baseline') }),
    );
  });

  it('the diary’s PDF and the snapshot say why a day was lost', () => {
    const lost = i18n.t('diary.entry.lost', { cause: i18n.t('diary.lost.decision') });
    const diary = composeDiary(
      diaryReport(APPROVED, ENTRIES),
      APPROVED,
      i18n,
      termsFor(language, 'engineer'),
    );
    expect(stringsOf(diary).join('\n')).toContain(lost);
    expect(stringsOf(snapshotOf(language))).toContain(lost);
  });

  it('prints only what the PDF can print', () => {
    expect(stringsOf(weeklyOf(language)).flatMap((text) => unprintable(text))).toEqual([]);
  });
});
