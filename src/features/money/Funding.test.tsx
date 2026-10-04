// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { today as todayOf } from '@/app/today';
import { BUILT_IN_SETTINGS } from '@/data/commands';
import { keys } from '@/data/queries';
import { snapshot, stage } from '@/domain/__fixtures__/plan';
import { addCalendarDays } from '@/domain/calendar';
import type { Funding as Fund, FundingReceipt, WorkSnapshot } from '@/domain/plan';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { Funding } from './Funding';

/**
 * Money → Funding (slice E2), rendered and pressed in both languages: an expected sum is added with
 * the host's own argument keys, refused in words before the host is asked when it is not one; each
 * row says what has arrived of it and whether it is late; "Mark as received…" records a receipt and
 * refuses a day after today first; a row a receipt names cannot be removed and says why; and the
 * receipts ledger reverses a receipt on a day, once.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const TODAY = todayOf();
const LAST_WEEK = addCalendarDays(TODAY, -7);
const IN_A_MONTH = addCalendarDays(TODAY, 30);

function fund(
  id: string,
  position: number,
  label: string,
  amountCents: number,
  expectedOn: string,
) {
  return {
    id,
    position,
    label,
    source: null,
    amountCents,
    expectedOn,
    note: null,
  } satisfies Fund;
}

function receipt(
  seq: number,
  fundingId: string | null,
  amountCents: number,
  reversesSeq: number | null = null,
): FundingReceipt {
  return {
    seq,
    fundingId,
    amountCents,
    day: LAST_WEEK,
    note: null,
    reversesSeq,
    authorName: 'Sample author',
    createdAt: `${LAST_WEEK}T12:00:00.000Z`,
  };
}

const WORK = snapshot({
  stages: [stage('s', 1, 'Tiling')],
  funding: [
    fund('savings', 1, 'Savings', 5000_00, LAST_WEEK),
    fund('tranche', 2, 'Loan, 2nd tranche', 8000_00, IN_A_MONTH),
    fund('client', 3, 'Client instalment', 2000_00, LAST_WEEK),
  ],
  fundingReceipts: [receipt(1, 'savings', 5000_00)],
});

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(of: WorkSnapshot, language: Language) {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens: 'owner' });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <Funding snapshot={of} outcome={{ kept: () => undefined, refused: () => undefined }} />
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

function find(selector: string, within: ParentNode = document): HTMLElement {
  const found = within.querySelector<HTMLElement>(
    selector.startsWith('[') ? selector : `[data-testid="${selector}"]`,
  );
  if (found === null) throw new Error(`no ${selector}`);
  return found;
}

/** Type or choose the way the browser does: the native setter, then the event React listens to. */
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
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const calls = (command: string) =>
  invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args as unknown);

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

const WORDS = {
  en: {
    expected: 'Money expected',
    received: 'received in full',
    late: 'late: expected on',
    notYet: 'not received yet',
    locked: 'can be edited but not removed',
    label: 'Say what the money is.',
    future: 'Money received cannot be dated after today.',
    unplanned: 'arrived unplanned',
    reverses: 'Reverses #1',
  },
  'pt-BR': {
    expected: 'Dinheiro esperado',
    received: 'recebido por inteiro',
    late: 'atrasado: esperado em',
    notYet: 'ainda não recebido',
    locked: 'pode ser editado, mas não removido',
    label: 'Diga que dinheiro é este.',
    future: 'Dinheiro recebido não pode ter data depois de hoje.',
    unplanned: 'chegou sem estar previsto',
    reverses: 'Estorna o nº 1',
  },
} as const;

describe.each(['en', 'pt-BR'] as const)('Money → Funding, in %s', (language) => {
  const words = WORDS[language];

  it('adds money expected with the host’s own keys', async () => {
    render(snapshot(), language);
    expect(host.textContent).toContain(words.expected);
    set(find('funding-label'), 'Savings');
    set(find('funding-source'), 'My account');
    set(find('funding-amount'), '5000.50');
    set(find('funding-expected'), IN_A_MONTH);
    act(() => find('funding-add').click());
    await settle();
    expect(calls('funding_add')).toEqual([
      {
        draft: {
          label: 'Savings',
          source: 'My account',
          amountCents: 5000_50,
          expectedOn: IN_A_MONTH,
          note: null,
        },
      },
    ]);
  });

  it('refuses a sum with no name before the host is asked, in words', () => {
    render(snapshot(), language);
    set(find('funding-amount'), '100');
    act(() => find('funding-add').click());
    expect(find('funding-problem').textContent).toContain(words.label);
    expect(calls('funding_add')).toEqual([]);
  });

  it('says of each row what has arrived of it, and which is late', () => {
    render(WORK, language);
    const savings = find('[data-funding-id="savings"]', host);
    const tranche = find('[data-funding-id="tranche"]', host);
    const late = find('[data-funding-id="client"]', host);
    expect(find('funding-state', savings).textContent).toBe(words.received);
    expect(find('funding-state', tranche).textContent).toBe(words.notYet);
    expect(find('funding-state', late).textContent).toContain(words.late);
    expect(late.getAttribute('data-state')).toBe('late');
    // A row a receipt names says why it stays, and offers no Remove; the others do.
    expect(savings.querySelector('[data-testid="funding-remove"]')).toBeNull();
    expect(savings.textContent).toContain(words.locked);
    expect(tranche.querySelector('[data-testid="funding-remove"]')).not.toBeNull();
    // Received in full: nothing more to mark.
    expect(savings.querySelector('[data-testid="funding-receive"]')).toBeNull();
    // What arrived is a figure that opens onto its receipts.
    act(() => find('funding-received-value', savings).click());
    expect(savings.querySelectorAll('[data-testid="funding-received-row"]')).toHaveLength(1);
  });

  it('marks money as received: a receipt for the row, on a day not after today', async () => {
    render(WORK, language);
    const tranche = find('[data-funding-id="tranche"]', host);
    act(() => find('funding-receive', tranche).click());
    set(find('receipt-amount'), '3000');
    set(find('receipt-day'), addCalendarDays(TODAY, 1));
    act(() => find('receipt-confirm').click());
    expect(find('receipt-dialog-problem').textContent).toContain(words.future);
    expect(calls('funding_receipt_add')).toEqual([]);

    set(find('receipt-day'), TODAY);
    act(() => find('receipt-confirm').click());
    await settle();
    expect(calls('funding_receipt_add')).toEqual([
      { draft: { fundingId: 'tranche', amountCents: 3000_00, day: TODAY, note: null } },
    ]);
  });

  it('records money that arrived unplanned, naming no row', async () => {
    render(WORK, language);
    act(() => find('receipt-add').click());
    expect((find('receipt-funding') as HTMLSelectElement).value).toBe('');
    set(find('receipt-amount'), '150');
    act(() => find('receipt-confirm').click());
    await settle();
    expect(calls('funding_receipt_add')).toEqual([
      { draft: { fundingId: null, amountCents: 150_00, day: TODAY, note: null } },
    ]);
  });

  it('keeps the receipts newest first and reverses one on a day, once', async () => {
    const reversed = snapshot({
      ...WORK,
      fundingReceipts: [
        receipt(1, 'savings', 5000_00),
        receipt(2, null, 100_00),
        receipt(3, 'savings', -5000_00, 1),
      ],
    });
    render(reversed, language);
    const lines = [...host.querySelectorAll<HTMLElement>('[data-receipt-seq]')];
    expect(lines.map((line) => line.getAttribute('data-receipt-seq'))).toEqual(['3', '2', '1']);
    expect(lines[0]?.textContent).toContain(words.reverses);
    expect(lines[1]?.textContent).toContain(words.unplanned);
    // Only the unplanned one can still be reversed: the first is, and the third is a reversal.
    expect(lines[0]?.querySelector('[data-testid="receipt-reverse"]')).toBeNull();
    expect(lines[2]?.querySelector('[data-testid="receipt-reverse"]')).toBeNull();
    act(() => find('receipt-reverse', lines[1]).click());
    act(() => find('receipt-reversal-confirm').click());
    await settle();
    expect(calls('funding_receipt_reverse')).toEqual([{ seq: 2, day: TODAY }]);
  });
});
