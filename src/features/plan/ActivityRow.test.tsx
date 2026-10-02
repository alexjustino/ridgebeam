// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activity, person, snapshot, stage } from '@/domain/__fixtures__/plan';
import type { Activity, WorkSnapshot } from '@/domain/plan';

import { ActivityRow } from './ActivityRow';

/**
 * An activity's range on its row (D1, decision 1): **Optimistic** and **Pessimistic** working days,
 * kept when the focus leaves the pair — both or neither, never one end alone — sent with a duration
 * typed but not kept yet so the three move together, and read back from the file when the host
 * refuses them.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
const refused = vi.fn();
const kept = vi.fn();

function tiling(patch: Partial<Activity> = {}): Activity {
  return { ...activity('tiles', 's', 1, 4, 'p'), name: 'Tiling', ...patch };
}

function render(row: Activity) {
  const work: WorkSnapshot = snapshot({
    people: [person('p')],
    stages: [stage('s', 1, 'Bathroom')],
    activities: [row],
  });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <ul>
          <ActivityRow
            activity={row}
            number="1.1"
            people={work.people}
            rooms={work.rooms}
            outcome={{ refused, kept }}
            focus={false}
            onFocused={() => undefined}
            onMove={() => undefined}
            onRemove={() => undefined}
            snapshot={work}
          />
        </ul>
      </QueryClientProvider>,
    ),
  );
}

function find(testId: string): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`no ${testId}`);
  return found;
}

/** Type as the browser does — the native setter, then `input` — and leave the field. */
function type(element: HTMLInputElement, text: string, leave = true) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(element, text);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    if (leave) element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const patches = () =>
  invoke.mock.calls
    .filter(([command]) => command === 'activity_update')
    .map(([, args]) => (args as { patch: unknown }).patch);

beforeEach(() => {
  invoke.mockReset();
  refused.mockReset();
  kept.mockReset();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the range on an activity row', () => {
  it('sends nothing while one end waits for the other, and both together once both are there', async () => {
    invoke.mockResolvedValue(snapshot());
    render(tiling());
    type(find('activity-range-min'), '3');
    expect(patches()).toEqual([]);
    expect(host.textContent).toContain('Give both ends, or clear both.');
    type(find('activity-range-max'), '6');
    await settle();
    expect(patches()).toEqual([{ durationMinDays: 3, durationMaxDays: 6 }]);
    expect(host.textContent).not.toContain('Give both ends');
  });

  it('does not keep the pair while the focus moves from one end to the other', () => {
    render(tiling());
    const min = find('activity-range-min');
    const max = find('activity-range-max');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(min, '3');
      min.dispatchEvent(new Event('input', { bubbles: true }));
      min.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: max }));
    });
    expect(patches()).toEqual([]);
    expect(host.textContent).not.toContain('Give both ends');
  });

  it('clears the range when both ends are emptied', async () => {
    invoke.mockResolvedValue(snapshot());
    render(tiling({ durationMinDays: 3, durationMaxDays: 6 }));
    type(find('activity-range-min'), '', false);
    type(find('activity-range-max'), '');
    await settle();
    expect(patches()).toEqual([{ durationMinDays: null, durationMaxDays: null }]);
  });

  it('refuses an end that is not a whole number of working days, and sends nothing', () => {
    render(tiling());
    type(find('activity-range-min'), '2.5', false);
    type(find('activity-range-max'), '6');
    expect(patches()).toEqual([]);
    expect(host.textContent).toContain('Each end is a whole number of working days');
  });

  it('sends a duration typed but not kept with the range, so the three move together', async () => {
    // The host refused 8 alone: it lies outside the range 3–6 the file holds.
    invoke.mockRejectedValueOnce({ kind: 'invalid_input', message: 'outside the range' });
    render(tiling({ durationMinDays: 3, durationMaxDays: 6 }));
    type(find('activity-duration'), '8');
    await settle();
    expect(find('activity-duration').value).toBe('8');
    invoke.mockResolvedValue(snapshot());
    type(find('activity-range-max'), '9');
    await settle();
    expect(patches()).toEqual([
      { durationDays: 8 },
      { durationDays: 8, durationMinDays: 3, durationMaxDays: 9 },
    ]);
  });

  it('reads the pair back from the file when the host refuses it', async () => {
    invoke.mockRejectedValue({
      kind: 'invalid_input',
      message: 'A duration of 4 working days is outside the range of 5 to 6.',
    });
    render(tiling({ durationMinDays: 2, durationMaxDays: 6 }));
    type(find('activity-range-min'), '5');
    await settle();
    expect(refused).toHaveBeenCalledTimes(1);
    expect(find('activity-range-min').value).toBe('2');
    expect(find('activity-range-max').value).toBe('6');
  });
});
