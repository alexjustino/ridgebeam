// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChoiceGroup } from './ChoiceGroup';

/**
 * A radio group answers the arrows (F11, decision 10): the choice moves and the focus goes with it,
 * wrapping at either end — and every option is still a button in the Tab order, pressed by Space.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = ['sun', 'cloud', 'rain'] as const;
type Option = (typeof OPTIONS)[number];

function Harness() {
  const [value, setValue] = useState<Option | null>(null);
  return <ChoiceGroup label="weather" options={OPTIONS} value={value} onChange={setValue} />;
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

function option(id: Option): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(`[data-value="${id}"]`);
  if (found === null) throw new Error(`no option ${id}`);
  return found;
}

function press(key: string) {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

const checked = () => host.querySelector('[aria-checked="true"]')?.getAttribute('data-value');
const focused = () => document.activeElement?.getAttribute('data-value');

describe('ChoiceGroup, by keyboard', () => {
  it('moves the choice and the focus with the arrows, wrapping', () => {
    act(() => option('sun').focus());
    press('ArrowRight');
    expect([checked(), focused()]).toEqual(['cloud', 'cloud']);
    press('ArrowDown');
    expect([checked(), focused()]).toEqual(['rain', 'rain']);
    press('ArrowRight');
    expect([checked(), focused()]).toEqual(['sun', 'sun']);
    press('ArrowLeft');
    expect([checked(), focused()]).toEqual(['rain', 'rain']);
  });

  it('keeps every option in the Tab order', () => {
    for (const id of OPTIONS) expect(option(id).tabIndex).toBe(0);
  });

  it('leaves the Alt chord alone, for the row that owns it', () => {
    act(() => option('sun').focus());
    act(() => {
      option('sun').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
      );
    });
    expect(checked()).toBeUndefined();
    expect(focused()).toBe('sun');
  });
});
