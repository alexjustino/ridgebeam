// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activity,
  changeDecision,
  changeOrder,
  snapshot,
  stage,
  takeBaseline,
} from '@/domain/__fixtures__/plan';
import type { WorkSnapshot } from '@/domain/plan';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { BaselinesCard } from './BaselinesCard';

/**
 * Two baselines compared (slice E1): the change orders approved between them are counted with the
 * rest — "1 change order approved" — each listed with how it was decided and what its decision froze,
 * and what of the move they account for is said under them, in both languages.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const BASE = snapshot({ stages: [stage('s1', 1)], activities: [activity('a1', 's1', 1, 2)] });

const PLAN: WorkSnapshot = {
  ...BASE,
  work: { ...BASE.work, approvedAt: '2026-08-31T12:00:00.000Z' },
  baselines: [
    takeBaseline(BASE, 1, { takenAt: '2026-08-31T12:00:00.000Z' }),
    takeBaseline(BASE, 2, { takenAt: '2026-09-15T12:00:00.000Z', reason: 'Change order #1' }),
  ],
  changeOrders: [
    changeOrder('co1', 1, 's1', '2026-09-09', {
      title: 'Extra socket',
      costCents: 300_00,
      decision: changeDecision('approved', '2026-09-10', {
        finishBefore: '2026-09-02',
        finishAfter: '2026-09-04',
        daysDelta: 2,
        costCents: 300_00,
      }),
    }),
    // Declined: it changed nothing in the plan, so the comparison does not list it.
    changeOrder('co2', 2, 's1', '2026-09-09', {
      title: 'Bathtub',
      decision: changeDecision('declined', '2026-09-10'),
    }),
  ],
};

let host: HTMLDivElement;
let root: Root;

function render(language: Language) {
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nContext.Provider value={build(language, language)}>
          <BaselinesCard snapshot={PLAN} />
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(null);
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
    summary: '1 change order approved',
    explained: /\$\s?300\.00 more and 2 working days later/,
  },
  'pt-BR': { summary: '1 aditivo aprovado', explained: /300,00 a mais e 2 dias úteis depois/ },
} as const;

describe.each(['en', 'pt-BR'] as const)('a comparison with change orders, in %s', (language) => {
  it('counts the approved ones, lists them, and says what of the move they account for', () => {
    render(language);
    const result = host.querySelector<HTMLElement>('[data-testid="compare-result"]');
    expect(result?.textContent).toContain(WORDS[language].summary);
    const rows = [...host.querySelectorAll('[data-compare-change]')];
    expect(rows.map((row) => row.getAttribute('data-compare-change'))).toEqual(['co1']);
    expect(rows[0]?.textContent).toContain('Extra socket');
    expect(host.querySelector('[data-testid="compare-changes"]')?.textContent).toMatch(
      WORDS[language].explained,
    );
  });
});
