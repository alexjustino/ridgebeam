// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_SETTINGS } from '@/data/commands';
import { keys } from '@/data/queries';
import { activity, link, snapshot, stage } from '@/domain/__fixtures__/plan';
import type { CostLine, Funding as Fund, WorkSnapshot } from '@/domain/plan';
import { MoneyCard } from '@/features/dashboard/MoneyCard';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { RunwayCard } from './RunwayCard';

/**
 * **Will the money last?** (slice E2) on Money and its figure on the dashboard, rendered in both
 * languages over a work whose numbers are known: the sentence says the week the money runs short
 * and by how much, or that it lasts with what is left; money expected yesterday and not received is
 * listed as late and not counted; the chance is said in natural frequencies when the schedule has
 * ranges, and every duration is said to be taken as certain when it has none; the weekly table marks
 * a short week in words; the dashboard's figure is a short value with its meaning in the label.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

/** Wednesday of the week before the work starts (Monday 7 September 2026). */
const TODAY = '2026-09-02';
vi.mock('@/app/today', async (original) => ({
  ...(await original<typeof import('@/app/today')>()),
  useToday: () => '2026-09-02',
}));

const line = (id: string, stageId: string, amountCents: number): CostLine => ({
  id,
  stageId,
  activityId: null,
  label: `Line ${id}`,
  amountCents,
});

const fund = (id: string, label: string, amountCents: number, expectedOn: string, position = 1) =>
  ({ id, position, label, source: null, amountCents, expectedOn, note: null }) satisfies Fund;

/**
 * Walls (a, then b) then Paint (c), five working days each, from Monday 7 September: Walls runs the
 * weeks of 7 and 14 September, Paint the week of 21. $3,000 planned on Walls, $2,000 on Paint, none
 * of it agreed with anyone yet — so it is spread evenly over each stage's working days: $1,500 out in
 * each of Walls' weeks, $2,000 in Paint's. $1,000 of savings arrive today.
 */
const SHORT: WorkSnapshot = snapshot({
  work: { ...snapshot().work, startDate: '2026-09-07' },
  stages: [stage('s1', 1, 'Walls'), stage('s2', 2, 'Paint')],
  activities: [activity('a', 's1', 1, 5), activity('b', 's1', 2, 5), activity('c', 's2', 1, 5)],
  dependencies: [link('ab', 'a', 'b'), link('bc', 'b', 'c')],
  costLines: [line('l1', 's1', 3000_00), line('l2', 's2', 2000_00)],
  funding: [fund('savings', 'Savings', 1000_00, TODAY)],
});

/** The same, with a loan arriving tomorrow that covers it, and a client's sum that never came. */
const LASTS: WorkSnapshot = {
  ...SHORT,
  funding: [
    fund('savings', 'Savings', 1000_00, TODAY, 1),
    fund('loan', 'Bank loan', 6000_00, '2026-09-03', 2),
    fund('client', 'Client instalment', 300_00, '2026-09-01', 3),
  ],
};

/** The short work, with Paint's duration a range: something for the runs to vary. */
const RANGED: WorkSnapshot = {
  ...SHORT,
  activities: [
    activity('a', 's1', 1, 5),
    activity('b', 's1', 2, 5),
    { ...activity('c', 's2', 1, 5), durationMinDays: 3, durationMaxDays: 9 },
  ],
};

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

async function render(node: ReactNode, language: Language) {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens: 'owner' });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>{node}</I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
  // The diary is read in the background before anything is projected.
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function find(testId: string, within: ParentNode = host): HTMLElement {
  const found = within.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`no ${testId}`);
  return found;
}

const digits = (text: string | null) => (text ?? '').replace(/[^0-9]/g, '');

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string) =>
    Promise.resolve(command === 'diary_list' ? [] : null),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const WORDS = {
  en: {
    title: 'Will the money last?',
    short: /^Money runs short in the week of .+ — .+ short\.$/,
    lasts: /^The money lasts to the end, with .+ to spare\.$/,
    late: '1 sum expected has not arrived',
    certain: 'Every duration is taken as certain',
    chance:
      /^(\d+ in 10 chances|Almost no chance|Fewer than 1 in 10 chances|10 in 10 chances) that the money runs short before the work ends\./,
    shortMark: 'short',
    shortLabel: 'Money runs short in the week of',
    endLabel: 'Money left at the end',
  },
  'pt-BR': {
    title: 'O dinheiro vai dar?',
    short: /^Falta dinheiro na semana de .+ — faltam .+\.$/,
    lasts: /^O dinheiro dá até o fim, e sobram .+\.$/,
    late: '1 valor esperado não chegou',
    certain: 'Toda duração é tomada como certa',
    chance:
      /^(\d+ em 10 chances|Quase nenhuma chance|Menos de 1 em 10 chances|10 em 10 chances) de faltar dinheiro antes de a obra terminar\./,
    shortMark: 'falta',
    shortLabel: 'Falta dinheiro na semana de',
    endLabel: 'Dinheiro que sobra no fim',
  },
} as const;

describe.each(['en', 'pt-BR'] as const)('Will the money last?, in %s', (language) => {
  const words = WORDS[language];
  const i18n = build(language, language);

  it('says the week the money runs short, and by how much', async () => {
    await render(<RunwayCard snapshot={SHORT} />, language);
    const card = find('runway-card');
    expect(card.textContent).toContain(words.title);
    const sentence = find('runway-sentence');
    expect(sentence.getAttribute('data-state')).toBe('short');
    expect(sentence.textContent).toMatch(words.short);
    expect(sentence.textContent).toContain(i18n.day('2026-09-07'));
    expect(digits(sentence.textContent)).toContain('50000');

    // One row a week, from this week to the finish's; the short one says so in words.
    const weeks = [...host.querySelectorAll<HTMLElement>('[data-testid="runway-week"]')];
    expect(weeks.map((week) => week.getAttribute('data-week'))).toEqual([
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
    ]);
    expect(weeks[0]?.hasAttribute('data-short')).toBe(false);
    expect(weeks[1]?.hasAttribute('data-short')).toBe(true);
    expect(weeks[1]?.textContent).toContain(words.shortMark);
    // The shortfall is said once: "$700.00 short", never "-$700.00 short" (found on E2's screenshots).
    expect(weeks[1]?.textContent).not.toMatch(/[-−]\s?(US|R)?\$/);

    // The figure opens onto the week it runs short in.
    expect(find('runway-short').textContent).toContain(words.shortLabel);
    expect(find('runway-short-value').textContent).toBe(i18n.day('2026-09-07'));
    expect(find('runway-drawing').getAttribute('role')).toBe('img');
  });

  it('says every duration is taken as certain when nothing has a range', async () => {
    await render(<RunwayCard snapshot={SHORT} />, language);
    const chance = find('runway-chance');
    expect(chance.textContent).toContain(words.certain);
    expect(chance.hasAttribute('data-chance')).toBe(false);
  });

  it('says the chance in natural frequencies when the schedule has ranges', async () => {
    await render(<RunwayCard snapshot={RANGED} />, language);
    const chance = find('runway-chance');
    expect(chance.getAttribute('data-chance')).toMatch(/^\d+$/);
    expect(chance.firstChild?.textContent).toMatch(words.chance);
  });

  it('says it lasts, with what is left, and lists money that is late without counting it', async () => {
    await render(<RunwayCard snapshot={LASTS} />, language);
    const sentence = find('runway-sentence');
    expect(sentence.getAttribute('data-state')).toBe('lasts');
    expect(sentence.textContent).toMatch(words.lasts);
    // $1,000 + $6,000 in, $5,000 out: $2,000 left; the client's $300 is late and not counted.
    expect(digits(sentence.textContent)).toContain('200000');
    expect(find('runway-notes').textContent).toContain(words.late);
    expect(find('runway-late-value').textContent).toBe('1');
    act(() => find('runway-late-value').click());
    expect(find('runway-late').textContent).toContain('Client instalment');
    expect(host.querySelector('[data-testid="runway-week"][data-short]')).toBeNull();
  });

  it('puts the figure on the dashboard: the short week, or what is left, its meaning in the label', async () => {
    await render(<MoneyCard snapshot={SHORT} />, language);
    expect(find('dashboard-runway-value').textContent).toBe(i18n.day('2026-09-07'));
    expect(find('dashboard-runway').textContent).toContain(words.shortLabel);
    expect(find('dashboard-runway-sentence').textContent).toMatch(words.short);

    await render(<MoneyCard snapshot={LASTS} />, language);
    expect(digits(find('dashboard-runway-value').textContent)).toBe('200000');
    expect(find('dashboard-runway').textContent).toContain(words.endLabel);
  });
});
