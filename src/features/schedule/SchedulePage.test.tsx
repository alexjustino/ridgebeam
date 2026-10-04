// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activity, link, person, snapshot, stage, takeBaseline } from '@/domain/__fixtures__/plan';
import type { Activity, WorkSnapshot } from '@/domain/plan';
import { schedule } from '@/domain/schedule';
import { build, I18nContext } from '@/i18n/useI18n';

import { SchedulePage } from './SchedulePage';

/**
 * The Schedule page with the finish as a probability (D1), rendered: the card after the finish and
 * the baseline, its headline in natural frequencies with its date for a reader that must not parse
 * one, the percentiles in order, the plan's chance, the drivers, what was counted as certain — and
 * the Gantt's criticality, in every bar's sentence and as a shade that is the page's to switch.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

let host: HTMLDivElement;
let root: Root;

/** Demolish (3 d) → Rebuild (4 d) → Clean (1 d), in a chain: the e2e's plan. */
function porch(ranges: Record<string, [number, number]> = {}): WorkSnapshot {
  const each = (id: string, position: number, days: number, name: string): Activity => ({
    ...activity(id, 's', position, days, 'p'),
    name,
    durationMinDays: ranges[id]?.[0] ?? null,
    durationMaxDays: ranges[id]?.[1] ?? null,
  });
  return snapshot({
    people: [person('p')],
    stages: [stage('s', 1, 'Porch')],
    activities: [each('a', 1, 3, 'Demolish'), each('b', 2, 4, 'Rebuild'), each('c', 3, 1, 'Clean')],
    dependencies: [link('l1', 'a', 'b'), link('l2', 'b', 'c')],
  });
}

async function render(work: WorkSnapshot, language: 'en' | 'pt-BR' = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <SchedulePage snapshot={work} />
        </I18nContext.Provider>
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function find(selector: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
}

const t = (id: string) => `[data-testid="${id}"]`;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string) =>
    Promise.resolve(
      command === 'diary_list'
        ? []
        : command === 'settings_get'
          ? { language: 'en', theme: 'system', lens: 'owner' }
          : null,
    ),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the Schedule page says when the work will really finish', () => {
  it('with no range, says every activity is counted as certain, and the date is the plan’s', async () => {
    const work = porch();
    await render(work);
    expect(find(t('finish-certain')).textContent).toMatch(/counted as certain/);
    expect(find(t('finish-p80')).dataset.day).toBe(schedule(work).finishDate);
    expect(host.querySelector(t('gantt-criticality'))).toBeNull();
  });

  it('with ranges, gives the headline in natural frequencies and the percentiles in order', async () => {
    await render(porch({ a: [2, 4], b: [3, 6], c: [1, 2] }));
    const headline = find(t('finish-p80'));
    // The label and the value are two blocks on screen; the value is the sentence.
    expect(find(t('finish-p80-figure-value')).textContent).toMatch(
      /^\d+ in 10 chances of finishing by /,
    );
    const p50 = find(t('finish-p50')).dataset.day!;
    const p80 = headline.dataset.day!;
    const p90 = find(t('finish-p90')).dataset.day!;
    expect(p50 <= p80 && p80 <= p90).toBe(true);
    const chance = Number(find(t('finish-plan-chance')).dataset.chance);
    expect(chance).toBeGreaterThanOrEqual(0);
    expect(chance).toBeLessThanOrEqual(1);
    const drivers = host.querySelectorAll('[data-driver]');
    expect(drivers.length).toBeGreaterThanOrEqual(1);
    expect(drivers.length).toBeLessThanOrEqual(3);
    for (const driver of drivers)
      expect(driver.getAttribute('data-activity-id')).toMatch(/^[abc]$/);
    expect(host.querySelector(t('finish-certain'))).toBeNull();
    // Percentages are the engineer's; the owner reads "N in 10".
    expect(find(t('finish-probability')).textContent).not.toMatch(/%/);
  });

  it('says the baseline’s chance once the plan is approved', async () => {
    const work = porch({ a: [2, 4], b: [3, 6], c: [1, 2] });
    await render({ ...work, baselines: [takeBaseline(work, 1)] });
    expect(find(t('finish-baseline-chance')).textContent).toMatch(/baseline 1/);
  });

  it('puts the criticality in every bar’s sentence, and shades the bars only when asked', async () => {
    await render(porch({ a: [2, 4], b: [3, 6], c: [1, 2] }));
    const bar = find('[data-bar-id="a"]');
    expect(bar.getAttribute('aria-label')).toMatch(/critical in \d+ of 10 runs$/);
    expect(host.querySelector('[data-criticality]')).toBeNull();
    const toggle = find(t('gantt-criticality')) as HTMLInputElement;
    await act(async () => {
      toggle.click();
    });
    expect(host.querySelectorAll('[data-criticality]')).toHaveLength(3);
    expect(find('[data-bar-id="a"] [data-criticality]').textContent).toMatch(/^\d+ in 10$/);
  });

  it('keeps the heading order: the card is an h2, its parts h3', async () => {
    await render(porch({ a: [2, 4], b: [3, 6], c: [1, 2] }));
    const card = find(t('finish-probability'));
    expect(card.querySelector('h2')?.textContent).toBe('When will it really finish?');
    expect([...card.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual([
      'Chance of having finished, by date',
      'What moves the finish most',
    ]);
  });

  it('says it in Portuguese', async () => {
    await render(porch({ a: [2, 4], b: [3, 6], c: [1, 2] }), 'pt-BR');
    expect(find(t('finish-p80-figure-value')).textContent).toMatch(
      /^\d+ em 10 chances de terminar até /,
    );
  });

  it('gives the same numbers every time for the same plan', async () => {
    const work = porch({ a: [2, 4], b: [3, 6], c: [1, 2] });
    await render(work);
    const first = find(t('finish-probability')).textContent;
    act(() => root.unmount());
    root = createRoot(host);
    await render(work);
    expect(find(t('finish-probability')).textContent).toBe(first);
  });
});
