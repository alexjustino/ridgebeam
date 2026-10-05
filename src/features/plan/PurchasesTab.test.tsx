// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_SETTINGS } from '@/data/commands';
import { keys } from '@/data/queries';
import {
  activity,
  link,
  purchase,
  purchaseEvent,
  snapshot,
  stage,
} from '@/domain/__fixtures__/plan';
import type { WorkSnapshot } from '@/domain/plan';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { PurchasesTab } from './PurchasesTab';

/**
 * The Plan's Purchases tab (slice G2, decision 3), rendered and pressed in both languages: nothing
 * to add on a plan with no stage, with the sentence that says why; the purchases grouped by where
 * they stand, each with its day to order by or the day it is expected and its flags in words; one
 * added with the host's keys, and refused before the host is asked when its lead time is not whole
 * days; **Mark as ordered…** sent with today's day, and a day after today refused inside its
 * dialog; **The order fell through…** sent with its note; and edit and remove offered only while
 * nothing has happened to a purchase.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Tuesday 1 September 2026, the work's first day: with the diary empty the forecast is the plan.
// Scheduled: a1 1–7 September, a2 8–10, b1 11–16. This week runs to Sunday the 6th.
const TODAY = '2026-09-01';
vi.mock('@/app/today', () => ({ today: () => TODAY, useToday: () => TODAY }));

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const PLAN = snapshot({
  stages: [stage('s1', 1, 'Kitchen'), stage('s2', 2, 'Finishes')],
  activities: [
    { ...activity('a1', 's1', 1, 5), name: 'Strip out' },
    { ...activity('a2', 's1', 2, 3), name: 'Fit the cabinets' },
    { ...activity('b1', 's2', 1, 4), name: 'Lay the tiles' },
  ],
  dependencies: [link('l1', 'a1', 'a2'), link('l2', 'a2', 'b1')],
});

const LISTED: WorkSnapshot = {
  ...PLAN,
  purchases: [
    // Needed on the 11th, 21 days to arrive: it should have been ordered by 21 August.
    purchase('p1', 1, 's2', 21, { name: 'Worktop', quantity: '3 m', supplier: 'Sample stone' }),
    // Needed on the 11th, 3 days: order by the 8th — next week.
    purchase('p2', 2, 's2', 3, { name: 'Cabinet handles' }),
    // Ordered on 20 August, 5 days: expected on the 25th, not here yet.
    purchase('p3', 3, 's1', 5, {
      name: 'Hinges',
      activityId: 'a2',
      events: [purchaseEvent(1, 'ordered', '2026-08-20')],
    }),
    purchase('p4', 4, 's1', 2, {
      name: 'Screws',
      events: [
        purchaseEvent(1, 'ordered', '2026-08-20'),
        purchaseEvent(2, 'delivered', '2026-08-21'),
      ],
    }),
  ],
};

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(of: WorkSnapshot, language: Language) {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens: 'owner' });
  client.setQueryData(keys.diary, []);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <PurchasesTab snapshot={of} />
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

function find(selector: string, within: ParentNode = document.body): HTMLElement {
  const found = within.querySelector<HTMLElement>(
    selector.startsWith('[') ? selector : `[data-testid="${selector}"]`,
  );
  if (found === null) throw new Error(`no ${selector}`);
  return found;
}

function set(element: HTMLElement, value: string) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

const press = (element: HTMLElement) => act(() => element.click());

async function settle() {
  for (let tick = 0; tick < 5; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const calls = (command: string) =>
  invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args as unknown);

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string) => {
    if (command === 'settings_get') return Promise.resolve(null);
    if (command === 'diary_list') return Promise.resolve([]);
    return Promise.resolve(LISTED);
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
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
    noStage: 'A purchase is for a stage: add one to the plan first.',
    lateToOrder: 'Late to order',
    lateToArrive: 'Late to arrive',
    orderBy: /^Order by: August 21, 2026 — 11 days late$/,
    notThisWeek: /^Order by: September 8, 2026$/,
    expected: /^Ordered on August 20, 2026 — expected on August 25, 2026 — 7 days late$/,
    lead: 'Lead time: 21 days',
    needed: 'Needed on September 11, 2026, as things stand',
    leadProblem: 'Say the lead time in whole days, from 0 to 365.',
    future: 'That day is after today: what happened is recorded on the day it happened.',
    locked: /stays as written/,
    groups: ['To order', 'Ordered, waiting to arrive', 'Delivered'],
  },
  'pt-BR': {
    noStage: 'Uma compra é para uma etapa: acrescente uma ao plano primeiro.',
    lateToOrder: 'Atrasado para encomendar',
    lateToArrive: 'Atrasado para chegar',
    orderBy: /^Encomendar até: 21 de agosto de 2026 — 11 dias de atraso$/,
    notThisWeek: /^Encomendar até: 8 de setembro de 2026$/,
    expected:
      /^Encomendada em 20 de agosto de 2026 — prevista para 25 de agosto de 2026 — 7 dias de atraso$/,
    lead: 'Prazo de entrega: 21 dias',
    needed: 'Necessária em 11 de setembro de 2026, do jeito que a obra está',
    leadProblem: 'Diga o prazo de entrega em dias inteiros, de 0 a 365.',
    future: 'Esse dia é depois de hoje: o que aconteceu é registrado no dia em que aconteceu.',
    locked: /fica como foi escrita/,
    groups: ['A encomendar', 'Encomendadas, esperando chegar', 'Entregues'],
  },
} as const;

describe.each(['en', 'pt-BR'] as const)('the Purchases tab, in %s', (language) => {
  const words = WORDS[language];

  it('adds nothing on a plan with no stage, and says why beside the button', () => {
    render(snapshot(), language);
    const add = find('purchase-add') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    const reason = find('purchase-add-locked');
    expect(reason.textContent).toBe(words.noStage);
    expect(add.getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('lists the purchases by where they stand, with the day to order by and the flags in words', () => {
    render(LISTED, language);
    const headings = [...host.querySelectorAll('[data-purchase-group] h3')].map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual(words.groups);

    const worktop = find('[data-purchase-id="p1"]');
    expect(worktop.dataset.state).toBe('to-order');
    expect(worktop.dataset.late).toBe('true');
    expect(find('purchase-day', worktop).textContent).toMatch(words.orderBy);
    expect(find('purchase-day', worktop).dataset.orderBy).toBe('2026-08-21');
    expect(worktop.textContent).toContain(words.lead);
    // The day it is needed is the forecast's, and says so: it moves when the work does.
    expect(worktop.textContent).toContain(words.needed);
    const flags = [...find('purchase-flags', worktop).querySelectorAll('li')];
    expect(flags.map((flag) => flag.dataset.flag)).toEqual(['lateToOrder']);
    expect(flags[0]?.textContent).toBe(words.lateToOrder);
    // Never colour alone: each flag carries its icon.
    expect(flags[0]?.querySelector('svg')).not.toBeNull();

    const handles = find('[data-purchase-id="p2"]');
    expect(handles.dataset.late).toBe('false');
    expect(handles.dataset.thisWeek).toBe('false');
    expect(find('purchase-day', handles).textContent).toMatch(words.notThisWeek);
    expect(handles.querySelector('[data-testid="purchase-flags"]')).toBeNull();

    const hinges = find('[data-purchase-id="p3"]');
    expect(hinges.dataset.state).toBe('ordered');
    expect(find('purchase-day', hinges).textContent).toMatch(words.expected);
    expect(find('purchase-flags', hinges).textContent).toContain(words.lateToArrive);
    expect(find('purchase-history', hinges).querySelectorAll('li')).toHaveLength(1);

    expect(find('[data-purchase-id="p4"]').dataset.state).toBe('delivered');
  });

  it('offers edit and remove only while nothing has happened to a purchase', () => {
    render(LISTED, language);
    const worktop = find('[data-purchase-id="p1"]');
    expect(worktop.querySelector('[data-testid="purchase-edit"]')).not.toBeNull();
    expect(worktop.querySelector('[data-testid="purchase-remove"]')).not.toBeNull();
    const hinges = find('[data-purchase-id="p3"]');
    expect(hinges.querySelector('[data-testid="purchase-edit"]')).toBeNull();
    expect(hinges.querySelector('[data-testid="purchase-remove"]')).toBeNull();
    expect(hinges.textContent).toMatch(words.locked);
    // The way forward follows the state: ordered, then delivered or fell through; nothing after.
    expect(worktop.querySelector('[data-testid="purchase-ordered"]')).not.toBeNull();
    expect(hinges.querySelector('[data-testid="purchase-delivered"]')).not.toBeNull();
    expect(hinges.querySelector('[data-testid="purchase-cancel"]')).not.toBeNull();
    const screws = find('[data-purchase-id="p4"]');
    expect(screws.querySelector('button[data-testid^="purchase-"]')).toBeNull();
  });

  it('adds a purchase with the host’s keys, and refuses a lead time that is not whole days', async () => {
    render(PLAN, language);
    expect(find('purchases-none')).toBeTruthy();
    press(find('purchase-add'));
    set(find('purchase-name'), 'Worktop');
    set(find('purchase-stage'), 's2');
    set(find('purchase-activity'), 'b1');
    set(find('purchase-quantity'), '3 m');
    set(find('purchase-supplier'), 'Sample stone');
    set(find('purchase-lead'), '2.5');
    press(find('purchase-save'));
    await settle();
    expect(find('purchase-problem').textContent).toContain(words.leadProblem);
    expect(calls('purchase_add')).toEqual([]);

    set(find('purchase-lead'), '21');
    press(find('purchase-save'));
    await settle();
    expect(calls('purchase_add')).toEqual([
      {
        draft: {
          stageId: 's2',
          activityId: 'b1',
          name: 'Worktop',
          quantity: '3 m',
          supplier: 'Sample stone',
          leadDays: 21,
          note: null,
        },
      },
    ]);
  });

  it('marks a purchase as ordered on today, and refuses a day after today inside the dialog', async () => {
    render(LISTED, language);
    press(find('purchase-ordered', find('[data-purchase-id="p1"]')));
    const day = find('purchase-event-day') as HTMLInputElement;
    set(day, '2026-09-05');
    act(() => day.dispatchEvent(new FocusEvent('blur')));
    press(find('purchase-event-confirm'));
    await settle();
    expect(find('purchase-event-problem').textContent).toContain(words.future);
    expect(calls('purchase_event_add')).toEqual([]);

    set(day, TODAY);
    press(find('purchase-event-confirm'));
    await settle();
    expect(calls('purchase_event_add')).toEqual([
      { event: { purchaseId: 'p1', kind: 'ordered', day: TODAY, note: null } },
    ]);
    expect(document.querySelector('[data-testid="purchase-event"]')).toBeNull();
  });

  it('records that an order fell through, with its note', async () => {
    render(LISTED, language);
    press(find('purchase-cancel', find('[data-purchase-id="p3"]')));
    expect(find('purchase-event').dataset.kind).toBe('cancelled');
    set(find('purchase-event-note'), 'Out of stock');
    press(find('purchase-event-confirm'));
    await settle();
    expect(calls('purchase_event_add')).toEqual([
      { event: { purchaseId: 'p3', kind: 'cancelled', day: TODAY, note: 'Out of stock' } },
    ]);
  });

  it('removes an untouched purchase only after asking', async () => {
    render(LISTED, language);
    press(find('purchase-remove', find('[data-purchase-id="p2"]')));
    expect(calls('purchase_remove')).toEqual([]);
    press(find('purchase-remove-confirm'));
    await settle();
    expect(calls('purchase_remove')).toEqual([{ id: 'p2' }]);
  });
});
