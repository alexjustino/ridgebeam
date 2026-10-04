import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * SPEC §7 F11: the keyboard reaches everything from new work to first entry.
 *
 * Nothing on the page is clicked and no script acts on it: every step is a key a person presses —
 * Tab, Shift+Tab, Enter, Space, the arrows — or text typed into whatever has the focus. Scripts only
 * READ the page (what has the focus, whether it shows its ring, what a field holds).
 */

const TEMPLATE = 'bathroom-renovation';

interface Focus {
  tag: string;
  testId: string;
  destination: string;
  ring: boolean;
  value: string;
  weather: boolean;
}

describe('the keyboard reaches everything from new work to first entry', () => {
  let session: Session;
  let parent: string;

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-keys-'));
  }, 60_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  async function focus(): Promise<Focus> {
    return session.driver.execute<Focus>(
      `const el = document.activeElement;
       if (!el || el === document.body) return { tag: 'BODY', testId: '', destination: '', ring: false, value: '', weather: false };
       return {
         tag: el.tagName,
         testId: el.getAttribute('data-testid') || '',
         destination: el.getAttribute('data-destination') || '',
         ring: el.matches(':focus-visible'),
         value: 'value' in el ? String(el.value) : '',
         weather: !!el.closest('[data-testid="entry-weather"]'),
       };`,
    );
  }

  /** Press Tab (or Shift+Tab) until the focus is on what `wanted` accepts; fail naming the path. */
  async function tabTo(
    what: string,
    wanted: (f: Focus) => boolean,
    { back = false, budget = 400 } = {},
  ): Promise<Focus> {
    const seen: string[] = [];
    for (let i = 0; i < budget; i += 1) {
      if (back) await session.driver.chord(Keys.SHIFT, Keys.TAB);
      else await session.driver.chord(Keys.TAB);
      const now = await focus();
      seen.push(`${now.tag}:${now.testId || now.destination}`);
      if (wanted(now)) return now;
    }
    throw new Error(`the keyboard never reached ${what}; it went ${seen.slice(-30).join(' | ')}`);
  }

  const testId = (id: string) => (f: Focus) => f.testId === id;

  async function type(text: string): Promise<void> {
    const actions = [...text].flatMap((value) => [
      { type: 'keyDown', value },
      { type: 'keyUp', value },
    ]);
    await session.driver.perform([{ type: 'key', id: 'keyboard', actions }]);
  }

  async function press(key: string): Promise<void> {
    await session.driver.press(key);
  }

  it('creates a work from a template, picks its ranges, and writes the first entry', async () => {
    const { driver } = session;
    await driver.waitForElement('[data-testid="start"]');

    // New work.
    const newWork = await tabTo('New work', testId('new-work'));
    expect(newWork.ring).toBe(true);
    await session.screenshot('keyboard-1-new-work');
    await press(Keys.ENTER);
    await driver.waitForElement('[data-testid="work-name"]');
    await tabTo('the name', testId('work-name'), { budget: 40 });
    await type('Keyboard, synthetic');
    await tabTo('the folder', testId('work-folder'), { budget: 40 });
    await type(path.join(parent, 'keys'));
    await tabTo('the template picker', testId('work-template'), { budget: 40 });
    for (let i = 0; i < 20 && (await focus()).value !== TEMPLATE; i += 1) {
      await press(Keys.ARROW_DOWN);
    }
    expect((await focus()).value).toBe(TEMPLATE);
    await tabTo('Create work', testId('work-create'), { budget: 40 });
    await press(Keys.ENTER);
    await driver.waitForElement('[data-testid="lens-switch"]');
    await driver.waitFor('the work open', async () =>
      (await driver.findAll('nav[data-rail] button[aria-current="page"]')).length > 0 ? true : null,
    );

    // The rail to the Plan, the breakdown tab, and the ranges taken at their upper end.
    await tabTo('the Plan in the rail', (f) => f.destination === 'plan', { back: true });
    await press(Keys.ENTER);
    // Tab lands on the selected tab of the Plan's strip; Home selects the first, the breakdown.
    await tabTo(
      'the plan tabs',
      (f) => f.tag === 'BUTTON' && f.testId === '' && f.destination === '',
      {
        budget: 60,
      },
    );
    for (let i = 0; i < 60; i += 1) {
      const inStrip = await driver.execute<boolean>(
        `return document.activeElement?.getAttribute('role') === 'tab' && !!document.activeElement.closest('[data-testid="plan-tabs"]')`,
      );
      if (inStrip) break;
      await driver.chord(Keys.TAB);
    }
    await press(Keys.HOME);
    await driver.waitForElement(
      '[data-testid="plan-tabs"] [data-tab="breakdown"][aria-selected="true"]',
    );
    expect(
      await driver.execute<string>(`return document.activeElement?.getAttribute('data-tab') ?? ''`),
    ).toBe('breakdown');
    const take = await tabTo('Use the upper end', testId('ranges-take-high'));
    expect(take.ring).toBe(true);
    await session.screenshot('keyboard-2-ranges');
    await press(Keys.ENTER);
    await driver.waitFor('the ranges taken', async () =>
      (await driver.findAll('[data-testid="ranges-take-high"]')).length === 0 ? true : null,
    );

    // The rail to the Diary, one activity done, the weather, and Save.
    await tabTo('the Diary in the rail', (f) => f.destination === 'diary', { back: true });
    await press(Keys.ENTER);
    await driver.waitForElement('[data-testid="entry-today"]');
    await tabTo('an activity to mark done', (f) => f.testId.startsWith('entry-done-'));
    await type(' ');
    // The weather is a radio group: Tab lands in it, Space chooses the one with the focus.
    await tabTo('the weather', (f) => f.weather);
    await type(' ');
    expect(
      await driver.execute<boolean>(
        `return !!document.querySelector('[data-testid="entry-weather"] [aria-checked="true"], [data-testid="entry-weather"] input:checked')`,
      ),
    ).toBe(true);
    const save = await tabTo('Save', testId('entry-save'));
    expect(save.ring).toBe(true);
    await session.screenshot('keyboard-3-save');
    await press(Keys.ENTER);
    await driver.waitForElement('[data-entry-seq="1"]');
  }, 240_000);
});
