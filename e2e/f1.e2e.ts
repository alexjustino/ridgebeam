import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * Slice F1's proof of done, against the real binary:
 *
 *   stages, activities, rooms, quantities, responsibles; the work breakdown and the owner's
 *   checklist are the same rows in two arrangements; reorder by keyboard; the lens switch changes
 *   every term through the glossary and stores nothing.
 *
 * And the F0 deferral: the screen to enter holidays, which moves the finish date.
 */

const WORK = 'Flat, second floor';
const ACTIVITY = 'Lay the floor tile';

async function setValue(session: Session, testId: string, value: string): Promise<void> {
  await session.driver.waitForElement(`[data-testid="${testId}"]`);
  await session.driver.execute(
    `const el = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
     const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
       : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
     Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
     el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));`,
  );
}

async function click(session: Session, testId: string): Promise<void> {
  await (await session.driver.waitForElement(`[data-testid="${testId}"]`)).click();
}

async function tab(session: Session, tab: 'breakdown' | 'by-room' | 'checklist'): Promise<void> {
  await (
    await session.driver.waitForElement(`[data-testid="plan-tabs"] [data-tab="${tab}"]`)
  ).click();
}

/** The numbers shown on the breakdown, in document order. */
async function numbering(session: Session): Promise<string[]> {
  return session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll('[data-testid="row-number"]')).map((e) => e.textContent.trim())`,
  );
}

/** The activity names as the breakdown holds them — in fields, which innerText does not carry. */
async function activityNames(session: Session): Promise<string[]> {
  return session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll('[data-activity-id]')).map((row) => {
       const field = row.querySelector('input:not([type="checkbox"]):not([type="number"])');
       return field ? field.value : row.textContent.trim();
     })`,
  );
}

async function mainText(session: Session): Promise<string> {
  return session.driver.execute<string>('return document.querySelector("main").innerText');
}

async function finishDate(session: Session): Promise<string> {
  await go(session, 'dashboard');
  const el = await session.driver.waitForElement('[data-testid="finish-date"]');
  return (await el.text()).trim();
}

function isoDaysFromToday(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

describe('F1 — the plan: rooms, quantities, arrangements, order, and the lens', () => {
  let session: Session;
  let parent: string;

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-f1-'));
    const { driver } = session;
    await driver.waitForElement('[data-testid="start"]');
    await click(session, 'new-work');
    await setValue(session, 'work-name', WORK);
    await setValue(session, 'work-folder', path.join(parent, 'flat'));
    await click(session, 'work-create');
    // The owner's lens is the default; the breakdown and its engineer's words are the starting point.
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await go(session, 'plan');
    await tab(session, 'breakdown');
    await setValue(session, 'stage-add-name', 'Tiling');
    await click(session, 'stage-add');
    await driver.waitForElement('[data-stage-id]');
    await setValue(session, 'activity-add-name', ACTIVITY);
    await click(session, 'activity-add');
    await driver.waitForElement('[data-activity-id]');
    await setValue(session, 'activity-duration', '3');
  }, 120_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('a room, and an activity that touches it with a quantity', async () => {
    const { driver } = session;
    await setValue(session, 'room-add-name', 'Bathroom');
    await click(session, 'room-add');
    await driver.waitForElement('[data-room-id]');
    const chip = await driver.waitForElement(
      '[data-activity-id] [data-testid="activity-rooms"] input[type="checkbox"]',
    );
    await chip.click();
    await setValue(session, 'activity-quantity', '12');
    await setValue(session, 'activity-unit', 'm²');
    await driver.waitFor('the quantity kept', async () =>
      (await mainText(session)).includes('12') ? true : null,
    );
    expect(await numbering(session)).toEqual(['1', '1.1']);
    await session.screenshot('f1-breakdown-en');
  });

  it('the same rows appear by room and on the checklist', async () => {
    const { driver } = session;
    await tab(session, 'by-room');
    const group = await driver.waitForElement('[data-room-group]');
    expect(await group.text()).toContain('Bathroom');
    expect(await group.text()).toContain(ACTIVITY);
    await session.screenshot('f1-by-room-en');

    await tab(session, 'checklist');
    const line = await driver.waitForElement('[data-checklist-line]');
    const text = await line.text();
    expect(text).toContain(ACTIVITY);
    expect(text).toContain('12');
    expect(text).toContain('m²');
    // The box on a checklist line is not a control: nothing here sets progress.
    const controls = await driver.execute<number>(
      `return document.querySelectorAll('[data-checklist-line] input, [data-checklist-line] button[aria-pressed]').length`,
    );
    expect(controls).toBe(0);
    await session.screenshot('f1-checklist-en');
    await tab(session, 'breakdown');
  });

  it('a stage is moved by keyboard and the numbering follows', async () => {
    const { driver } = session;
    await setValue(session, 'stage-add-name', 'Painting');
    await click(session, 'stage-add');
    await driver.waitFor('two stages', async () =>
      (await driver.findAll('[data-stage-id]')).length === 2 ? true : null,
    );
    expect(await numbering(session)).toEqual(['1', '1.1', '2']);

    // Focus inside the first stage's row — its Move down button — then Alt+ArrowDown.
    const down = await driver.waitForElement('[data-stage-id] [data-testid="stage-down"]');
    await driver.execute(
      'arguments[0].focus()',
      // The element reference is passed through the actions API by the client.
      [await down.reference()],
    );
    await driver.chord(Keys.ALT, Keys.ARROW_DOWN);
    await driver.waitFor('Tiling second', async () => {
      const numbers = await numbering(session);
      return numbers[0] === '1' && numbers[1] === '2' && numbers[2] === '2.1' ? true : null;
    });
    const names = await driver.execute<string[]>(
      `return Array.from(document.querySelectorAll('[data-stage-id] h3, [data-stage-id] [data-testid="stage-name"]')).map((e) => e.textContent.trim())`,
    );
    expect(names[0]).toContain('Painting');
    // And back up, by the button this time.
    await (
      await driver.waitForElement('[data-stage-id]:nth-of-type(2) [data-testid="stage-up"]')
    ).click();
    await driver.waitFor('Tiling first again', async () =>
      JSON.stringify(await numbering(session)) === JSON.stringify(['1', '1.1', '2']) ? true : null,
    );
  });

  it('the lens changes the words, not the rows, and stores nothing in the work', async () => {
    const { driver } = session;
    const before = await mainText(session);
    expect(before).toContain('Activity');
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Owner"]',
      )
    ).click();
    await driver.waitFor('the owner vocabulary', async () =>
      (await mainText(session)).includes('Job') ? true : null,
    );
    const owner = await mainText(session);
    expect(owner).toContain('Who does it');
    expect(await activityNames(session)).toContain(ACTIVITY);
    expect(owner).not.toContain('Activity');
    await session.screenshot('f1-breakdown-owner-en');

    // Nothing in the work changed: close it, reopen it from the recent list, same rows.
    await go(session, 'dashboard');
    await click(session, 'work-close');
    await driver.waitForElement('[data-testid="start"]');
    await (await driver.waitForElement('[data-testid="recent-work"]')).click();
    await go(session, 'plan');
    await tab(session, 'breakdown');
    expect(await numbering(session)).toEqual(['1', '1.1', '2']);
    expect(await activityNames(session)).toContain(ACTIVITY);

    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await driver.waitFor('the engineer vocabulary', async () =>
      (await mainText(session)).includes('Activity') ? true : null,
    );
  });

  it('a holiday entered on the plan moves the finish date', async () => {
    const { driver } = session;
    const before = await finishDate(session);
    expect(before).not.toBe('');
    await go(session, 'plan');
    await tab(session, 'breakdown');
    await click(session, 'calendar-toggle');
    // Four consecutive days from today always hold at least two working days of a Mon–Fri
    // calendar, and the activity is three working days long: the finish date has to move.
    for (let i = 0; i < 4; i += 1) {
      await setValue(session, 'holiday-date', isoDaysFromToday(i));
      await setValue(session, 'holiday-name', `Synthetic holiday ${i + 1}`);
      await click(session, 'holiday-add');
      await driver.waitFor(`holiday ${i + 1} listed`, async () =>
        (await driver.findAll('[data-holiday-date]')).length === i + 1 ? true : null,
      );
    }
    await click(session, 'calendar-save');
    await driver.waitFor('the finish date moved', async () =>
      (await finishDate(session)) !== before ? true : null,
    );
    await session.screenshot('f1-dashboard-holidays-en');
  });

  it('refuses a calendar with no working day, with a sentence', async () => {
    const { driver } = session;
    await go(session, 'plan');
    await tab(session, 'breakdown');
    const boxes = await driver.findAll(
      '[data-testid="calendar-working-days"] input[type="checkbox"]',
    );
    expect(boxes).toHaveLength(7);
    for (const box of boxes) {
      const checked = await driver.execute<boolean>('return arguments[0].checked', [
        await box.reference(),
      ]);
      if (checked) await box.click();
    }
    await click(session, 'calendar-save');
    const bar = await driver.waitForElement('[data-testid="calendar-problem"]');
    expect((await bar.text()).trim()).not.toBe('');
    // Put Monday back so the work stays usable, and save.
    await boxes[0]!.click();
    await click(session, 'calendar-save');
    await driver.waitFor(
      'the problem gone',
      async () =>
        (await driver.execute<boolean>(
          'return document.querySelector(\'[data-testid="calendar-problem"]\') === null',
        )) === true,
    );
  });

  it('says it all in Portuguese, in the owner’s words', async () => {
    const { driver } = session;
    await chooseLanguage(session, 'Português (Brasil)');
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Dono"]',
      )
    ).click();
    await go(session, 'plan');
    await tab(session, 'checklist');
    await driver.waitFor('the owner vocabulary in Portuguese', async () =>
      (await mainText(session)).includes('Serviço') || (await mainText(session)).includes('serviço')
        ? true
        : null,
    );
    await session.screenshot('f1-checklist-owner-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
