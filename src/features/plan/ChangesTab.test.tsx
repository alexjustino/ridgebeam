// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavigationContext, type Navigation } from '@/app/navigation';
import { today } from '@/app/today';
import { BUILT_IN_SETTINGS } from '@/data/commands';
import { keys } from '@/data/queries';
import {
  activity,
  changeDecision,
  changeOrder,
  link,
  person,
  snapshot,
  stage,
} from '@/domain/__fixtures__/plan';
import type { ChangeOrder, WorkSnapshot } from '@/domain/plan';
import type { LensChoice } from '@/domain/settings';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { ChangesTab } from './ChangesTab';

/**
 * The Plan's Changes tab (slice E1, decision 6), rendered and pressed in both languages: no change
 * before approval, with the sentence that says why; a change raised with its impact worked out by the
 * schedule and shown before it is saved, and sent with the host's keys; and a change decided — the
 * impact shown again in the dialog, the decision sent with that impact frozen, and the way to the
 * Schedule offered after an approval.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

/**
 * Tuesday 1 September 2026, Monday to Friday: Wiring takes 2 working days (1–2 Sep), Tiling 3 after
 * it (3, 4, 7 Sep). The plan finishes on 7 September; two days added after Tiling finish on the 9th.
 */
const BASE = snapshot({
  people: [person('p1', 'Sample electrician')],
  stages: [stage('s1', 1, 'Rough-in'), stage('s2', 2, 'Finishes')],
  activities: [
    { ...activity('a1', 's1', 1, 2), name: 'Wiring' },
    { ...activity('a2', 's2', 1, 3), name: 'Tiling' },
  ],
  dependencies: [link('l1', 'a1', 'a2')],
});

function approved(changeOrders: readonly ChangeOrder[] = []): WorkSnapshot {
  return {
    ...BASE,
    work: { ...BASE.work, approvedAt: '2026-08-31T12:00:00.000Z' },
    changeOrders,
  };
}

const SOCKET = changeOrder('co1', 1, 's2', today(), {
  title: 'Extra socket',
  costCents: 300_00,
  effects: [{ kind: 'add', name: 'Extra socket', durationDays: 2, after: 'a2' }],
});

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
const openSchedule = vi.fn();

const NAVIGATION: Navigation = {
  openDocuments: () => undefined,
  openDiary: () => undefined,
  openPlan: () => undefined,
  openPaymentPlan: () => undefined,
  openSnapshot: () => undefined,
  openBackup: () => undefined,
  openSchedule,
  openChanges: () => undefined,
  openSnags: () => undefined,
  openMeeting: () => undefined,
  openMinutes: () => undefined,
};

/** What the host answers: `next` for any command that answers with the plan. */
let next: WorkSnapshot;

function render(of: WorkSnapshot, language: Language = 'en', lens: LensChoice = 'owner') {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <NavigationContext.Provider value={NAVIGATION}>
            <ChangesTab snapshot={of} />
          </NavigationContext.Provider>
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

const all = (testId: string) => [
  ...document.body.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
];

/** Type into a field, or choose an option, as React hears it. */
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

async function settle() {
  for (let tick = 0; tick < 4; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const calls = (command: string) =>
  invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args as unknown);

beforeEach(() => {
  invoke.mockReset();
  openSchedule.mockReset();
  next = approved();
  invoke.mockImplementation((command: string) =>
    command === 'settings_get' ? Promise.resolve(null) : Promise.resolve(next),
  );
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
    locked: /once the plan is approved/,
    later: /Finishes 2 working days later/,
    cost: /costs R\$\s?300\.00 more/,
    you: 'A change you asked for',
    owner: 'Asked for by the owner',
    term: 'change order',
    negative: /adds no cost line/,
  },
  'pt-BR': {
    locked: /depois que o plano é aprovado/,
    later: /Termina 2 dias úteis depois/,
    cost: /custa R\$\s?300,00 a mais/,
    you: 'Um aditivo que você pediu',
    owner: 'Pedido pelo dono',
    term: 'aditivo',
    negative: /não acrescenta linha de custo/,
  },
} as const;

describe.each(['en', 'pt-BR'] as const)('the Changes tab, in %s', (language) => {
  const words = WORDS[language];

  it('raises nothing before the plan is approved, and says why beside the button', () => {
    render(BASE, language);
    const raise = find('change-raise') as HTMLButtonElement;
    expect(raise.disabled).toBe(true);
    const reason = find('change-raise-locked');
    expect(reason.textContent).toMatch(words.locked);
    expect(raise.getAttribute('aria-describedby')).toBe(reason.id);
    expect(host.textContent).toContain(words.term);
    expect(document.body.querySelector('[data-testid="change-form"]')).toBeNull();
  });

  it('shows the impact while the change is written, before it is saved, and sends the host’s keys', async () => {
    render(approved(), language);
    act(() => find('change-raise').click());
    set(find('change-title'), '  Extra socket  ');
    set(find('change-cost'), '300');
    act(() => find('change-effect-add').click());
    const row = find('[data-change-effect]');
    // A row not finished says what it lacks, and the panel says it left it out.
    expect(row.getAttribute('data-whole')).toBe('false');
    expect(find('change-impact-unfinished').textContent).toMatch(/1/);
    set(find('change-effect-kind', row), 'add');
    set(find('change-effect-name', row), 'Extra socket');
    set(find('change-effect-days', row), '2');
    set(find('change-effect-after', row), 'a2');
    expect(row.getAttribute('data-whole')).toBe('true');

    const impact = find('change-impact');
    expect(impact.getAttribute('data-impact')).toBe('ok');
    expect(impact.getAttribute('data-days')).toBe('2');
    expect(impact.textContent).toMatch(words.later);
    expect(impact.textContent).toMatch(words.cost);
    expect(calls('change_order_raise')).toEqual([]);

    act(() => find('change-save').click());
    await settle();
    expect(calls('change_order_raise')).toEqual([
      {
        draft: {
          raisedOn: today(),
          title: 'Extra socket',
          description: null,
          askedBy: 'owner',
          askedByPersonId: null,
          askedByName: null,
          stageId: 's1',
          costCents: 300_00,
          effects: [{ kind: 'add', name: 'Extra socket', durationDays: 2, after: 'a2' }],
        },
      },
    ]);
  });

  it('asks who asked before anything is sent, and says a saving adds no cost line', async () => {
    render(approved(), language);
    act(() => find('change-raise').click());
    set(find('change-title'), 'Smaller window');
    act(() => find('[data-testid="change-asked-by"] [data-value="person"]').click());
    set(find('change-cost'), '-150.5');
    expect(find('change-form').textContent).toMatch(words.negative);
    act(() => find('change-save').click());
    await settle();
    expect(find('change-problem').textContent).toBeTruthy();
    expect(calls('change_order_raise')).toEqual([]);

    set(find('change-person'), 'p1');
    act(() => find('change-save').click());
    await settle();
    expect(calls('change_order_raise')).toEqual([
      {
        draft: expect.objectContaining({
          askedBy: 'person',
          askedByPersonId: 'p1',
          askedByName: null,
          costCents: -150_50,
          effects: [],
        }),
      },
    ]);
  });

  it('approves with the impact shown again and frozen in the decision, then offers the Schedule', async () => {
    render(approved([SOCKET]), language);
    const row = find('[data-change-id="co1"]');
    expect(row.getAttribute('data-state')).toBe('pending');
    expect(row.textContent).toContain(words.you);
    act(() => find('change-approve', row).click());

    const dialog = find('change-decide');
    expect(find('change-impact', dialog).textContent).toMatch(words.later);
    set(find('change-note', dialog), '  Agreed on site.  ');
    next = approved([
      {
        ...SOCKET,
        decision: changeDecision('approved', today(), { daysDelta: 2, costCents: 300_00 }),
      },
    ]);
    act(() => find('change-confirm', dialog).click());
    await settle();
    expect(calls('change_order_decide')).toEqual([
      {
        decision: {
          id: 'co1',
          outcome: 'approved',
          decidedOn: today(),
          note: 'Agreed on site.',
          finishBefore: '2026-09-07',
          finishAfter: '2026-09-09',
          daysDelta: 2,
        },
      },
    ]);
    expect(document.body.querySelector('[data-testid="change-decide"]')).toBeNull();
    const notice = find('change-approved');
    act(() => find('change-to-schedule', notice).click());
    expect(openSchedule).toHaveBeenCalledTimes(1);
  });

  it('declines with no note, the plan untouched, and the row says so', async () => {
    render(approved([SOCKET]), language, 'engineer');
    const row = find('[data-change-id="co1"]');
    expect(row.textContent).toContain(words.owner);
    act(() => find('change-decline', row).click());
    act(() => find('change-confirm').click());
    await settle();
    expect(calls('change_order_decide')).toEqual([
      {
        decision: expect.objectContaining({
          id: 'co1',
          outcome: 'declined',
          note: null,
          daysDelta: 2,
        }),
      },
    ]);
    // A decided change offers no decision any more, and says how it was decided.
    render(
      approved([{ ...SOCKET, decision: changeDecision('declined', today()) }]),
      language,
      'engineer',
    );
    const decided = find('[data-change-id="co1"]');
    expect(decided.getAttribute('data-state')).toBe('declined');
    expect(decided.querySelector('[data-testid="change-approve"]')).toBeNull();
    expect(all('change-withdraw')).toHaveLength(0);
    // A declined change cost nothing: no price line of its own, and its impact is said as what
    // approving it would have done (found on E1's screenshots: "costs $900.00 more" on a decline).
    expect(decided.querySelector('[data-testid="change-cost-text"]')).toBeNull();
    expect(decided.querySelector('[data-testid="change-days"]')?.textContent).toMatch(
      language === 'en'
        ? /^Not applied\. Had it been approved: /
        : /^Não aplicado\. Se tivesse sido aprovado: /,
    );
  });
});

describe('the list', () => {
  it('shows the newest change first', () => {
    render(
      approved([
        SOCKET,
        changeOrder('co2', 2, 's1', today(), {
          title: 'Second',
          askedBy: 'other',
          askedByName: 'A neighbour',
        }),
      ]),
    );
    const ids = [...document.body.querySelectorAll('[data-change-id]')].map((each) =>
      each.getAttribute('data-change-id'),
    );
    expect(ids).toEqual(['co2', 'co1']);
    expect(find('[data-change-id="co2"]').textContent).toContain('Asked for by A neighbour');
  });
});
