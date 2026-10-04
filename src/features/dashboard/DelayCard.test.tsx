// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_SETTINGS } from '@/data/commands';
import { keys } from '@/data/queries';
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
import { schedule } from '@/domain/schedule';
import { ForecastCard } from '@/features/schedule/ForecastCard';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { DelayCard } from './DelayCard';

/**
 * As things stand and Why is it late? (slice E3), the e2e's work in small: a stage of two chained
 * activities, the plumber responsible, approved; the diary says Monday worked, Tuesday lost waiting
 * for a decision, Wednesday lost to rain, Thursday the plumber not there and nothing done. The
 * Schedule's card says when it finishes as things stand, against the baseline and against the plan's
 * date, never as one number; the dashboard's card says why, by cause and by party, with what the
 * record does not explain — in both languages, and every number the domain's.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

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

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(of: WorkSnapshot, entries: readonly DiaryEntry[], language: Language) {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens: 'owner' });
  client.setQueryData(keys.diary, entries);
  const scheduled = schedule(of);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <ForecastCard snapshot={of} scheduled={scheduled} today={TODAY} />
          <DelayCard snapshot={of} scheduled={scheduled} today={TODAY} />
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

const find = (testId: string) => {
  const found = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`no ${testId}`);
  return found;
};
const text = (testId: string) => find(testId).textContent ?? '';
const causes = () =>
  [...host.querySelectorAll('[data-delay-cause]')].map((row) =>
    row.getAttribute('data-delay-cause'),
  );

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(null);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('as things stand (the Schedule)', () => {
  it('says when it finishes from the diary, against the baseline and against the plan’s date', () => {
    const ledger = delayLedger(APPROVED, schedule(APPROVED), ENTRIES, TODAY);
    const ahead = ledger.forecast;
    expect(ahead.daysAgainstBaseline).toBeGreaterThan(0);
    render(APPROVED, ENTRIES, 'en');
    const en = build('en', 'en');
    expect(find('forecast-finish').getAttribute('data-day')).toBe(ahead.finishDate);
    expect(text('forecast-against-baseline')).toBe(
      `As things stand it finishes on ${en.day(ahead.finishDate!)} — ${en.tp('plan.checklist.days', ahead.daysAgainstBaseline!)} after the baseline’s ${en.day(ahead.baselineFinish!)}.`,
    );
    // The plan's date is another answer, labelled as the plan's, never the forecast's number.
    expect(text('forecast-plan-finish')).toBe(en.day(ahead.planFinish!));
    expect(text('forecast-plan-finish')).not.toBe(text('forecast-finish'));
    expect(text('forecast-against-plan')).toContain('The plan’s own finish date is');
    expect(text('forecast-assumes')).toContain('not a promise');
  });

  it('before approval says the date alone, and that there is no baseline yet', () => {
    render(PLAN, ENTRIES, 'en');
    expect(text('forecast-against-baseline')).toMatch(/^As things stand it finishes on /);
    expect(text('forecast-card')).toContain('There is no baseline yet');
    expect(host.querySelector('[data-testid="forecast-against-baseline-days"]')).toBeNull();
  });

  it('says it in Portuguese', () => {
    render(APPROVED, ENTRIES, 'pt-BR');
    expect(text('forecast-card')).toContain('Do jeito que está');
    expect(text('forecast-against-baseline')).toMatch(
      /^Do jeito que está, termina em .+ dias úteis depois de/,
    );
  });
});

describe('why is it late? (the dashboard)', () => {
  it('puts the days late down to their causes and parties, with what is not explained', () => {
    const ledger = delayLedger(APPROVED, schedule(APPROVED), ENTRIES, TODAY);
    expect(ledger.status).toBe('late');
    render(APPROVED, ENTRIES, 'en');
    expect(text('delay-total-value')).toBe(String(ledger.total));
    expect(causes()).toEqual(ledger.figures!.byCause.rows.map((row) => row.cause));
    expect(causes()).toEqual(expect.arrayContaining(['decision', 'weather', 'absence']));
    expect(text('delay-by-cause')).toContain('Waiting for a decision');
    expect(text('delay-by-party')).toContain('J. Plumber');
    expect(text('delay-by-party')).toContain('The owner');
    // Every line's days are the domain's, and they add up to the total.
    const days = [...host.querySelectorAll('[data-delay-cause]')].map((row) =>
      Number(row.getAttribute('data-days')),
    );
    expect(days.reduce((sum, each) => sum + each, 0)).toBe(ledger.total);
    if (ledger.unexplainedDays > 0) {
      expect(causes()).toContain('unexplained');
      expect(text('delay-unexplained')).toBe(
        build('en', 'en').tp('delay.unexplained', ledger.unexplainedDays),
      );
    }
  });

  it('opens a line onto the days it was made from', () => {
    render(APPROVED, ENTRIES, 'en');
    const line = host.querySelector<HTMLElement>('[data-delay-cause="decision"]')!;
    const button = line.querySelector('button')!;
    expect(line.querySelector('[hidden]')).not.toBeNull();
    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(line.textContent).toContain('the diary says why');
  });

  it('says it needs an approved plan before there is one, and invents nothing', () => {
    render(PLAN, ENTRIES, 'en');
    expect(text('delay-status')).toContain('Approve the plan');
    expect(causes()).toEqual([]);
    expect(host.querySelector('[data-testid="delay-total"]')).toBeNull();
  });

  it('says the work is ahead in words when it is, and gives no cause', () => {
    // The diary says both finished early: the forecast lies before the baseline.
    const early = [
      entry(1, '2026-09-01', {
        done: [{ activityId: 'a1', state: 'finished', quantity: null, note: null }],
      }),
      entry(2, '2026-09-02', {
        done: [{ activityId: 'a2', state: 'finished', quantity: null, note: null }],
      }),
    ];
    const ledger = delayLedger(APPROVED, schedule(APPROVED), early, TODAY);
    expect(ledger.status).toBe('ahead');
    render(APPROVED, early, 'en');
    expect(text('delay-status')).toContain('it is ahead');
    expect(causes()).toEqual([]);
  });

  it('says it in Portuguese', () => {
    render(APPROVED, ENTRIES, 'pt-BR');
    expect(text('delay-card')).toContain('Por que está atrasada?');
    expect(text('delay-by-cause')).toContain('Esperando uma decisão');
    expect(text('delay-by-cause')).toContain('Clima');
    expect(text('delay-by-party')).toContain('O dono');
  });
});
