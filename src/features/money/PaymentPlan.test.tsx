// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { today } from '@/app/today';
import { activity, person, snapshot, stage } from '@/domain/__fixtures__/plan';
import type { Commitment, Milestone, MilestoneTrigger, Payment } from '@/domain/plan';

import { ByStage } from './ByStage';
import { Ledger } from './Ledger';

/**
 * A commitment's payment plan on Money → By stage, and the warning before a payment on the Ledger
 * (slice D2), rendered and pressed: the testids the end-to-end suite reads are where it reads them,
 * a refused milestone is said under the plan with nothing asked of the host, what is sent is the
 * host's own argument keys, a locked plan offers nothing that would change it, and the warning comes
 * before the payment without taking the Save away.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

/** Agreed well before today, so the advance is earned whatever day the suite runs. */
const AGREED = '2026-01-05';

function milestone(
  id: string,
  position: number,
  label: string,
  shareBp: number,
  trigger: MilestoneTrigger,
  activityId: string | null = null,
): Milestone {
  return { id, position, label, shareBp, trigger, activityId };
}

const QUOTE: Commitment = {
  id: 'quote',
  stageId: 's',
  personId: 'tiler',
  label: 'Tiler’s quote',
  amountCents: 1000_00,
  agreedOn: AGREED,
  documentHash: null,
  milestones: [],
};

const OWN_PLAN = [
  milestone('m1', 1, 'Advance', 3000, 'advance'),
  milestone('m2', 2, 'Tiles laid', 4000, 'activity_finished', 'lay'),
  milestone('m3', 3, 'Handover', 3000, 'stage_closed'),
];

function payment(seq: number, amountCents: number, reversesSeq: number | null = null): Payment {
  return {
    id: `pay${seq}`,
    seq,
    day: AGREED,
    stageId: 's',
    personId: 'tiler',
    commitmentId: 'quote',
    amountCents,
    whatFor: `Payment ${seq}`,
    receiptHash: null,
    reversesSeq,
    authorName: 'Sample author',
    createdAt: `${AGREED}T12:00:00.000Z`,
  };
}

function work(milestones: readonly Milestone[] = [], payments: readonly Payment[] = []) {
  return snapshot({
    people: [person('tiler', 'C. Tiler')],
    stages: [stage('s', 1, 'Tiling')],
    activities: [
      { ...activity('prepare', 's', 1, 2), name: 'Prepare the floor' },
      { ...activity('lay', 's', 2, 2), name: 'Lay the tiles' },
    ],
    commitments: [{ ...QUOTE, milestones }],
    payments: [...payments],
  });
}

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(node: ReactNode) {
  act(() => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
}

const outcome = { kept: () => undefined, refused: () => undefined };

function find(selector: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(
    selector.startsWith('[') ? selector : `[data-testid="${selector}"]`,
  );
  if (found === null) throw new Error(`no ${selector}`);
  return found;
}

/** Type or choose the way the browser does: the native setter, then the event React listens to. */
function set(element: HTMLElement, value: string) {
  const select = element instanceof HTMLSelectElement;
  const prototype = select ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event(select ? 'change' : 'input', { bubbles: true }));
  });
}

/** Let the host's answers and the query's notifications land (the diary is read in the background). */
async function settle() {
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const commands = () => invoke.mock.calls.map(([command]) => command as string);
const digits = (text: string | null) => (text ?? '').replace(/[^0-9]/g, '');

beforeEach(() => {
  invoke.mockReset();
  // The diary is empty: nothing is finished, so only the advance is earned.
  invoke.mockImplementation((command: string) =>
    Promise.resolve(command === 'diary_list' ? [] : null),
  );
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('a commitment with no payment plan', () => {
  it('opens its plan, says it is not evaluated, and offers the usual one in the person’s words', async () => {
    render(<ByStage snapshot={work()} outcome={outcome} />);
    await settle();
    const row = find('[data-commitment-id="quote"]');
    expect(find('payment-plan-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(find('no-payment-plan').textContent).toContain('not evaluated');
    expect(row.querySelector('[data-testid="earned-value"]')).toBeNull();
    expect(row.textContent).toContain('A common split');
    act(() => find('payment-plan-usual').click());
    await settle();
    expect(invoke).toHaveBeenCalledWith('milestones_usual', {
      commitment_id: 'quote',
      labels: {
        started: 'Stage started',
        finished: 'Last activity finished',
        closed: 'Stage closed',
      },
    });
    // The button went with the plan it added: the focus is on the first milestone's name.
    render(<ByStage snapshot={work(OWN_PLAN)} outcome={outcome} />);
    await settle();
    expect(document.activeElement).toBe(
      find('[data-milestone-id="m1"]').querySelector('[data-testid="milestone-label"]'),
    );
  });

  it('adds a milestone with the host’s keys, a percent with one decimal in basis points', async () => {
    render(<ByStage snapshot={work()} outcome={outcome} />);
    await settle();
    set(find('milestone-add-label'), 'Tiles laid');
    set(find('milestone-add-share'), '12.5');
    set(find('milestone-add-trigger'), 'activity_finished');
    set(find('milestone-add-activity'), 'lay');
    act(() => find('milestone-add').click());
    await settle();
    expect(invoke).toHaveBeenCalledWith('milestone_add', {
      commitment_id: 'quote',
      label: 'Tiles laid',
      share_bp: 1250,
      trigger: 'activity_finished',
      activity_id: 'lay',
    });
  });

  it('asks for the activity only when a finish earns it, and says an advance is before any work', async () => {
    render(<ByStage snapshot={work()} outcome={outcome} />);
    await settle();
    expect(host.querySelector('[data-testid="milestone-add-activity"]')).toBeNull();
    set(find('milestone-add-trigger'), 'advance');
    expect(find('[data-commitment-id="quote"]').textContent).toContain('before any work');
    set(find('milestone-add-trigger'), 'activity_finished');
    expect(find('milestone-add-activity').tagName).toBe('SELECT');
  });
});

describe('a commitment with its own plan', () => {
  it('shows what is earned and due, each milestone’s state, and the sum', async () => {
    render(<ByStage snapshot={work(OWN_PLAN)} outcome={outcome} />);
    await settle();
    const row = find('[data-commitment-id="quote"]');
    // A plan already written opens closed; its milestones are still there to be read.
    expect(find('payment-plan-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(row.querySelectorAll('[data-milestone-id]')).toHaveLength(3);
    expect(digits(find('earned-value').textContent)).toBe('30000');
    expect(digits(find('due-value').textContent)).toBe('30000');
    expect(find('due-now').textContent).toContain('earned and not paid');
    expect(host.querySelector('[data-testid="paid-ahead"]')).toBeNull();
    const states = [...row.querySelectorAll('[data-testid="milestone-state"]')].map(
      (each) => each.textContent,
    );
    expect(states[0]).toMatch(/^earned on /);
    expect(states.slice(1)).toEqual(['not yet', 'not yet']);
    expect(find('payment-plan-sum').textContent).toBe('100 % in the plan.');
    expect(host.querySelector('[data-testid="payment-plan-usual"]')).toBeNull();
  });

  it('refuses a plan over 100 % under the plan, and asks nothing of the host', async () => {
    render(<ByStage snapshot={work(OWN_PLAN)} outcome={outcome} />);
    await settle();
    set(find('milestone-add-label'), 'Too much');
    set(find('milestone-add-share'), '10');
    set(find('milestone-add-trigger'), 'advance');
    act(() => find('milestone-add').click());
    expect(commands()).not.toContain('milestone_add');
    expect(find('milestone-problem').textContent).toContain('over 100 %');
    // What was typed stays, so it can be corrected.
    expect((find('milestone-add-share') as HTMLInputElement).value).toBe('10');
  });

  it('says a share it cannot read, and keeps it', async () => {
    render(<ByStage snapshot={work(OWN_PLAN.slice(0, 2))} outcome={outcome} />);
    await settle();
    set(find('milestone-add-label'), 'Handover');
    set(find('milestone-add-share'), '12.25');
    act(() => find('milestone-add').click());
    expect(commands()).not.toContain('milestone_add');
    expect(find('milestone-problem').textContent).toContain('at most one decimal');
    expect(find('payment-plan-sum').textContent).toBe(
      '70 % in the plan; 30 % not in the plan yet.',
    );
  });

  it('moves and removes with the host’s keys, and says a host refusal under the plan', async () => {
    render(<ByStage snapshot={work(OWN_PLAN)} outcome={outcome} />);
    await settle();
    const second = find('[data-milestone-id="m2"]');
    act(() => second.querySelector<HTMLElement>('[data-testid="milestone-up"]')!.click());
    await settle();
    expect(invoke).toHaveBeenCalledWith('milestone_move', { id: 'm2', direction: 'up' });
    invoke.mockImplementation((command: string) =>
      command === 'diary_list'
        ? Promise.resolve([])
        : Promise.reject({ kind: 'invalid_input', message: 'the plan is locked' }),
    );
    act(() => second.querySelector<HTMLElement>('[data-testid="milestone-remove"]')!.click());
    await settle();
    expect(invoke).toHaveBeenCalledWith('milestone_remove', { id: 'm2' });
    expect(find('milestone-problem').textContent).not.toBe('');
  });
});

describe('focus, when a control removes itself', () => {
  it('goes to the next milestone’s Remove, and to the add line when none is left', async () => {
    const after = work([OWN_PLAN[0]!, OWN_PLAN[2]!]);
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === 'diary_list' ? [] : after),
    );
    render(<ByStage snapshot={work(OWN_PLAN)} outcome={outcome} />);
    await settle();
    act(() =>
      find('[data-milestone-id="m2"]')
        .querySelector<HTMLElement>('[data-testid="milestone-remove"]')!
        .click(),
    );
    await settle();
    render(<ByStage snapshot={after} outcome={outcome} />);
    await settle();
    expect(document.activeElement).toBe(
      find('[data-milestone-id="m3"]').querySelector('[data-testid="milestone-remove"]'),
    );

    const none = work([]);
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === 'diary_list' ? [] : none),
    );
    render(<ByStage snapshot={work([OWN_PLAN[0]!])} outcome={outcome} />);
    await settle();
    act(() => find('milestone-remove').click());
    await settle();
    render(<ByStage snapshot={none} outcome={outcome} />);
    await settle();
    expect(document.activeElement).toBe(find('milestone-add-label'));
  });
});

describe('once money has moved', () => {
  it('locks the plan, says why, and marks the commitment paid ahead in words', async () => {
    render(<ByStage snapshot={work(OWN_PLAN, [payment(1, 800_00)])} outcome={outcome} />);
    await settle();
    const row = find('[data-commitment-id="quote"]');
    expect(row.querySelector('[data-testid="milestone-remove"]')).toBeNull();
    expect(row.querySelector('[data-testid="milestone-add-label"]')).toBeNull();
    expect(find('payment-plan-locked').textContent).toContain('A payment names this commitment');
    expect(row.querySelectorAll('[data-milestone-id]')).toHaveLength(3);
    expect(find('paid-ahead').textContent).toContain('ahead of the work');
    expect(digits(find('paid-ahead').textContent)).toBe('50000');
  });

  it('stays locked after the payment is reversed', async () => {
    render(
      <ByStage
        snapshot={work(OWN_PLAN, [payment(1, 800_00), { ...payment(2, -800_00, 1) }])}
        outcome={outcome}
      />,
    );
    await settle();
    expect(host.querySelector('[data-testid="milestone-remove"]')).toBeNull();
  });
});

describe('the warning before a payment (Ledger)', () => {
  async function typePayment(amount: string) {
    set(find('payment-stage'), 's');
    set(find('payment-commitment'), 'quote');
    set(find('payment-amount'), amount);
    await settle();
  }

  it('previews a payment within what is earned, and does not warn', async () => {
    render(<Ledger snapshot={work(OWN_PLAN)} />);
    await settle();
    await typePayment('300.00');
    expect(find('payment-preview').textContent).toContain('paid after this payment');
    expect(host.querySelector('[data-testid="payment-ahead-warning"]')).toBeNull();
  });

  it('warns before a payment ahead of the work, names the next milestone, and still saves', async () => {
    render(<Ledger snapshot={work(OWN_PLAN, [payment(1, 300_00)])} />);
    await settle();
    await typePayment('500.00');
    const warning = find('payment-ahead-warning').textContent ?? '';
    expect(warning).toContain('ahead of the work');
    expect(warning).toContain('Tiles laid');
    expect(warning).toContain('Lay the tiles is not finished yet.');
    expect(digits(warning)).toContain('50000');
    const save = find('payment-save') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    set(find('payment-what'), 'Asked for more');
    act(() => save.click());
    await settle();
    expect(commands()).toContain('payment_add');
  });

  it('says a commitment with no plan cannot be judged, and does not warn', async () => {
    render(<Ledger snapshot={work()} />);
    await settle();
    await typePayment('900.00');
    expect(find('payment-preview').textContent).toContain('has no payment plan');
    expect(host.querySelector('[data-testid="payment-ahead-warning"]')).toBeNull();
  });

  it('shows nothing until the form names a commitment and an amount', async () => {
    render(<Ledger snapshot={work(OWN_PLAN)} />);
    await settle();
    set(find('payment-stage'), 's');
    set(find('payment-amount'), '500');
    expect(host.querySelector('[data-testid="payment-preview"]')).toBeNull();
    // `today` is the interface's one day; the suite's advance is agreed before it.
    expect(AGREED < today()).toBe(true);
  });
});
