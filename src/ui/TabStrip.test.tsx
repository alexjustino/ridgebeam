// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TabStrip } from './TabStrip';

/**
 * The tabs pattern, driven by keys (F11, decision 10): the focus goes with the selection, so a
 * keyboard user reaches every tab — not only the one next to the selected one — and Home and End
 * reach either end. Rendered for real and pressed, because the defect this guards (the focus left
 * behind on a tab that had left the Tab order) is invisible to anything that only reads the code.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TABS = ['one', 'two', 'three', 'four', 'five'].map((id) => ({ id, label: id }));

function Harness() {
  const [active, setActive] = useState('one');
  return <TabStrip label="tabs" tabs={TABS} active={active} onSelect={setActive} />;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function tab(id: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`);
  if (found === null) throw new Error(`no tab ${id}`);
  return found;
}

/** Press a key on whatever holds the focus, as the browser would dispatch it. */
function press(key: string) {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function selected(): string | null {
  return host.querySelector('[aria-selected="true"]')?.getAttribute('data-tab') ?? null;
}

function focused(): string | null {
  return document.activeElement?.getAttribute('data-tab') ?? null;
}

describe('TabStrip, by keyboard', () => {
  it('three ArrowRight presses land on the fourth tab, with the focus on it', () => {
    act(() => tab('one').focus());
    press('ArrowRight');
    press('ArrowRight');
    press('ArrowRight');
    expect(selected()).toBe('four');
    expect(focused()).toBe('four');
    // Only the selected tab is in the Tab order.
    expect(tab('four').tabIndex).toBe(0);
    expect(tab('one').tabIndex).toBe(-1);
  });

  it('ArrowLeft wraps from the first tab to the last', () => {
    act(() => tab('one').focus());
    press('ArrowLeft');
    expect(selected()).toBe('five');
    expect(focused()).toBe('five');
  });

  it('End reaches the last tab and Home the first, from anywhere', () => {
    act(() => tab('one').focus());
    press('ArrowRight');
    press('End');
    expect(selected()).toBe('five');
    expect(focused()).toBe('five');
    press('Home');
    expect(selected()).toBe('one');
    expect(focused()).toBe('one');
  });

  it('leaves every other key alone', () => {
    act(() => tab('one').focus());
    press('ArrowDown');
    press('a');
    expect(selected()).toBe('one');
    expect(focused()).toBe('one');
  });
});
