// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavigationContext } from '@/app/navigation';
import { activity, person, snapshot, stage } from '@/domain/__fixtures__/plan';
import type { Activity, WorkSnapshot } from '@/domain/plan';
import { schedule } from '@/domain/schedule';

import { NextQuestionCard } from './NextQuestionCard';

/**
 * The Next question card, rendered and pressed (F11, decision 7): it asks what the domain says to
 * ask, writes the answer through the command the domain names, counts "N of M answered", moves on
 * without answering on Skip, and puts the focus on the next question's answer either way.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const TODAY = '2026-09-01';

const ranged = (id: string, position: number, min: number, max: number): Activity => ({
  ...activity(id, 's', position, null, 'p'),
  name: `Remove ${id}`,
  durationMinDays: min,
  durationMaxDays: max,
});

function plan(durations: Record<string, number | null> = {}): WorkSnapshot {
  return snapshot({
    people: [person('p')],
    stages: [stage('s', 1, 'Bathroom')],
    activities: [ranged('tiles', 1, 1, 2), ranged('floor', 2, 2, 4)].map((each) => ({
      ...each,
      durationDays: durations[each.id] ?? null,
    })),
  });
}

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
const gone = vi.fn();

function render(work: WorkSnapshot) {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <NextQuestionCard snapshot={work} scheduled={schedule(work)} today={TODAY} onGone={gone} />
      </QueryClientProvider>,
    ),
  );
}

function find(testId: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`no ${testId}`);
  return found;
}

/** Type into a controlled field the way the browser does: the native setter, then `input`. */
function type(element: HTMLElement, text: string) {
  const input = element as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  invoke.mockReset();
  gone.mockReset();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the Next question card', () => {
  it('asks the first range in plain words and counts what is answered', () => {
    render(plan());
    const card = find('next-question').textContent ?? '';
    expect(card).toContain('How many working days will “Remove tiles” take? Most take 1 to 2.');
    // Two ranges and two responsibles already there: 2 of 4.
    expect(find('next-count').textContent).toBe('2 of 4 answered');
  });

  it('keeps an answer through activity_update, then asks the next with the focus on it', async () => {
    const work = plan();
    const answered = plan({ tiles: 2 });
    invoke.mockResolvedValue(answered);
    render(work);
    type(find('next-answer'), '2');
    act(() => find('next-keep').click());
    await settle();
    expect(invoke).toHaveBeenCalledWith('activity_update', {
      id: 'tiles',
      patch: { durationDays: 2 },
    });
    render(answered);
    await settle();
    expect(find('next-question').textContent).toContain('Remove floor');
    expect(find('next-count').textContent).toBe('3 of 4 answered');
    expect(document.activeElement).toBe(find('next-answer'));
  });

  it('refuses a duration that is not a whole number of working days, and asks nothing', () => {
    render(plan());
    type(find('next-answer'), '1.5');
    act(() => find('next-keep').click());
    // The lens is read from the settings; nothing about the plan is asked of the host.
    expect(invoke.mock.calls.map(([command]) => command)).not.toContain('activity_update');
    expect(find('next-problem').textContent).toContain('whole number of working days');
    expect((find('next-answer') as HTMLInputElement).value).toBe('1.5');
  });

  it('skips to the next question for this session, and says when all left are skipped', async () => {
    render(plan());
    act(() => find('next-skip').click());
    await settle();
    expect(find('next-question').textContent).toContain('Remove floor');
    expect(document.activeElement).toBe(find('next-answer'));
    act(() => find('next-skip').click());
    await settle();
    expect(find('next-question').textContent).toContain('The 2 questions left were skipped');
    expect(document.activeElement).toBe(find('next-again'));
    expect(find('next-count').textContent).toBe('2 of 4 answered');
    act(() => find('next-again').click());
    await settle();
    expect(find('next-question').textContent).toContain('Remove tiles');
  });

  it('is not shown when nothing is left to ask, and says so by giving the focus away', async () => {
    const work = plan({ floor: 3 });
    invoke.mockResolvedValue(plan({ tiles: 1, floor: 3 }));
    render(work);
    type(find('next-answer'), '1');
    act(() => find('next-keep').click());
    await settle();
    render(plan({ tiles: 1, floor: 3 }));
    await settle();
    expect(host.querySelector('[data-testid="next-question"]')).toBeNull();
    expect(gone).toHaveBeenCalledTimes(1);
  });
});

describe('the optional question (D1)', () => {
  /** One critical activity with a duration and nobody missing: only the optional question is left. */
  const certain = (): WorkSnapshot =>
    snapshot({
      people: [person('p')],
      stages: [stage('s', 1, 'Bathroom')],
      activities: [{ ...activity('tiles', 's', 1, 4, 'p'), name: 'Tiling' }],
    });

  it('asks the most a critical activity could take, says it is optional, and counts it nowhere', () => {
    render(certain());
    expect(find('next-question').textContent).toContain(
      'What is the most “Tiling” could take, in working days? The plan says 4.',
    );
    expect(find('next-optional').textContent).toContain('Optional');
    expect(find('next-count').textContent).toBe('1 of 1 answered');
  });

  it('writes the range whole — the duration as its optimistic end — in one patch', async () => {
    invoke.mockResolvedValue(certain());
    render(certain());
    type(find('next-answer'), '7');
    act(() => find('next-keep').click());
    await settle();
    expect(invoke).toHaveBeenCalledWith('activity_update', {
      id: 'tiles',
      patch: { durationMinDays: 4, durationMaxDays: 7 },
    });
  });

  it('refuses a most below the duration, and asks nothing', () => {
    render(certain());
    type(find('next-answer'), '3');
    act(() => find('next-keep').click());
    expect(invoke.mock.calls.map(([command]) => command)).not.toContain('activity_update');
    expect(find('next-problem').textContent).toContain('from 4 to 3,650');
  });
});

describe('the optional question of a payment plan (D2)', () => {
  /** Nothing else to ask: a commitment with no payment plan is the one question left. */
  const unpaid = (): WorkSnapshot =>
    snapshot({
      people: [person('p')],
      stages: [stage('s', 1, 'Tiling')],
      activities: [
        {
          ...activity('lay', 's', 1, 2, 'p'),
          name: 'Lay the tiles',
          durationMinDays: 2,
          durationMaxDays: 3,
        },
      ],
      commitments: [
        {
          id: 'quote',
          stageId: 's',
          personId: 'p',
          label: 'Tiler’s quote',
          amountCents: 1000_00,
          agreedOn: '2026-08-20',
          documentHash: null,
          milestones: [],
        },
      ],
    });

  it('asks how the commitment is to be paid, and answers by opening its plan — not inline', () => {
    const openPaymentPlan = vi.fn();
    const work = unpaid();
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <NavigationContext.Provider
            value={{
              openDocuments: () => undefined,
              openDiary: () => undefined,
              openPlan: () => undefined,
              openPaymentPlan,
              openSnapshot: () => undefined,
              openBackup: () => undefined,
              openSchedule: () => undefined,
              openChanges: () => undefined,
              openSnags: () => undefined,
            }}
          >
            <NextQuestionCard
              snapshot={work}
              scheduled={schedule(work)}
              today={TODAY}
              onGone={gone}
            />
          </NavigationContext.Provider>
        </QueryClientProvider>,
      ),
    );
    expect(find('next-question').textContent).toContain('How is “Tiler’s quote” to be paid?');
    expect(find('next-optional').textContent).toContain('Optional');
    expect(host.querySelector('[data-testid="next-answer"]')).toBeNull();
    expect(host.querySelector('[data-testid="next-keep"]')).toBeNull();
    act(() => find('next-open-plan').click());
    expect(openPaymentPlan).toHaveBeenCalledWith('quote');
    expect(invoke.mock.calls.map(([command]) => command)).not.toContain('milestone_add');
  });
});
