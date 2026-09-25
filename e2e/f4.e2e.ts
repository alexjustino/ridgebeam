import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type Session } from './session';

/**
 * Slice F4's proof of done, against the real binary:
 *
 *   one-tap and detailed entries with photos copied in; entries append-only with a verified
 *   chain; an edit is refused and a correction offered; progress on the plan derived from
 *   entries; the day view; restart and the chain still holds.
 *
 * The photo is a one-pixel PNG the test writes itself; the hostile file is a text file that
 * calls itself a JPEG. Both live in a temporary folder the test removes.
 */

const WORK = 'Bathroom, synthetic';

/** A valid 1×1 opaque PNG, 67 bytes. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function setValue(session: Session, selector: string, value: string): Promise<void> {
  await session.driver.waitForElement(selector);
  await session.driver.execute(
    `const el = document.querySelector(${JSON.stringify(selector)});
     const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
       : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
     Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
     el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));`,
  );
}

async function click(session: Session, selector: string): Promise<void> {
  await (await session.driver.waitForElement(selector)).click();
}

async function text(session: Session, selector: string): Promise<string> {
  return (await (await session.driver.waitForElement(selector)).text()).trim();
}

const t = (id: string) => `[data-testid="${id}"]`;

async function breakdown(session: Session): Promise<void> {
  await go(session, 'plan');
  await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
}

async function lastId(session: Session, selector: string, attr: string): Promise<string> {
  const ids = await session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((e) => e.getAttribute(${JSON.stringify(attr)}))`,
  );
  return ids[ids.length - 1]!;
}

async function entryCount(session: Session): Promise<number> {
  return (await session.driver.findAll('[data-entry-seq]')).length;
}

/** Open the detailed fields if they are closed — `entry-more` toggles them. */
async function more(session: Session): Promise<void> {
  const open = await session.driver.execute<boolean>(
    `return document.querySelector('[data-testid="entry-note"]') !== null`,
  );
  if (!open) await click(session, t('entry-more'));
  await session.driver.waitForElement(t('entry-note'));
}

describe('F4 — the diary: append-only, chained, corrected, and the source of progress', () => {
  let session: Session;
  let parent: string;
  let workFolder: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-f4-'));
    workFolder = path.join(parent, 'bathroom');
    writeFileSync(path.join(parent, 'photo.png'), ONE_PIXEL_PNG);
    writeFileSync(path.join(parent, 'lie.jpg'), 'This is not a JPEG.\n');
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), workFolder);
    await click(session, t('work-create'));
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await breakdown(session);
    await setValue(session, t('person-add-name'), 'A. Tiler');
    await click(session, t('person-add'));
    await driver.waitForElement('[data-person-id]');
    id['person'] = await lastId(session, '[data-person-id]', 'data-person-id');
    await setValue(session, t('stage-add-name'), 'Tiling');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    await setValue(session, t('activity-add-name'), 'Lay the floor tile');
    await click(session, t('activity-add'));
    await driver.waitForElement('[data-activity-id]');
    id['lay'] = await lastId(session, '[data-activity-id]', 'data-activity-id');
    await setValue(session, `[data-activity-id="${id['lay']}"] ${t('activity-duration')}`, '3');
  }, 180_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('a one-tap entry for today says what was done, who was there and the weather', async () => {
    const { driver } = session;
    await go(session, 'diary');
    await driver.waitForElement(t('entry-today'));
    await click(session, t(`entry-done-${id['lay']}`));
    await click(session, t(`entry-finished-${id['lay']}`));
    await click(session, t(`entry-present-${id['person']}`));
    await click(
      session,
      `${t('entry-weather')} [value="sun"], ${t('entry-weather')} [data-value="sun"]`,
    );
    await click(session, t('entry-save'));
    await driver.waitForElement('[data-entry-seq="1"]');
    const entry = await text(session, '[data-entry-seq="1"]');
    expect(entry).toContain('Lay the floor tile');
    expect(entry).toContain('A. Tiler');
    await session.screenshot('f4-diary-en');
  });

  it('progress on the plan is derived from the entry, never typed', async () => {
    const { driver } = session;
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="checklist"]');
    const line = await driver.waitForElement('[data-checklist-line]');
    expect(await line.attribute('data-done')).toBe('finished');
    await go(session, 'dashboard');
    expect(await text(session, t('done-value'))).toMatch(/^1\b/);
    await click(session, t('done-value'));
    const rows = await driver.findAll(t('done-row'));
    expect(rows.length).toBeGreaterThan(0);
    expect(await text(session, t('days-without-entry-value'))).toMatch(/^0\b/);
    await session.screenshot('f4-dashboard-en');
  });

  it('a photo is copied into the work folder and shown as a thumbnail', async () => {
    const { driver } = session;
    await go(session, 'diary');
    await more(session);
    // A lost day is never the default, before or after an entry is saved.
    const lostBefore = await driver.execute<boolean>(
      `return document.querySelector('[data-testid="entry-lost-day"]').checked`,
    );
    expect(lostBefore).toBe(false);
    await setValue(session, t('entry-note'), 'Second visit, photo of the north wall.');
    await setValue(session, t('entry-photo-path'), path.join(parent, 'photo.png'));
    await click(session, t('entry-photo-add'));
    await driver.waitForElement('[data-pending-photo]');
    await click(session, t('entry-save'));
    await driver.waitForElement('[data-entry-seq="2"]');
    const saved = await text(session, '[data-entry-seq="2"]');
    expect(saved).not.toMatch(/lost day|dia perdido/i);
    await more(session);
    const lostAfter = await driver.execute<boolean>(
      `return document.querySelector('[data-testid="entry-lost-day"]').checked`,
    );
    expect(lostAfter).toBe(false);
    const img = await driver.waitForElement(`[data-entry-seq="2"] ${t('photo-thumb')}`);
    expect(await img.attribute('src')).toMatch(/^data:image\/jpeg;base64,/);
    const documents = path.join(workFolder, 'documents');
    expect(existsSync(documents)).toBe(true);
    const files = readdirSync(documents);
    expect(
      files.some((f) => /^[0-9a-f]{64}\.png$/.test(f)),
      files.join(', '),
    ).toBe(true);
    await session.screenshot('f4-photo-en');
  });

  it('a file that is not what it says it is, is refused with a sentence, and nothing is saved', async () => {
    const { driver } = session;
    const before = await entryCount(session);
    await more(session);
    await setValue(session, t('entry-note'), 'This one must not be saved.');
    await setValue(session, t('entry-photo-path'), path.join(parent, 'lie.jpg'));
    await click(session, t('entry-photo-add'));
    await click(session, t('entry-save'));
    const problem = await text(session, t('entry-problem'));
    expect(problem).toContain('lie.jpg');
    expect(await entryCount(session)).toBe(before);
    await driver.execute(
      `document.querySelectorAll('[data-pending-photo] button').forEach((b) => b.click())`,
    );
  });

  it('an entry dated in the future is refused', async () => {
    const before = await entryCount(session);
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 10);
    await more(session);
    await setValue(session, t('entry-day'), future.toISOString().slice(0, 10));
    await setValue(session, t('entry-note'), 'From the future.');
    await click(session, t('entry-save'));
    const problem = await text(session, t('entry-problem'));
    expect(problem).not.toBe('');
    expect(await entryCount(session)).toBe(before);
    await setValue(session, t('entry-day'), new Date().toISOString().slice(0, 10));
  });

  it('an entry is never edited: it is corrected by a new one, and the record shows both', async () => {
    const { driver } = session;
    const editable = await driver.execute<number>(
      `return document.querySelectorAll('[data-entry-seq] [data-testid="entry-edit"]').length`,
    );
    expect(editable).toBe(0);
    await click(session, `[data-entry-seq="1"] ${t('entry-correct')}`);
    await setValue(
      session,
      t('correction-note'),
      'The tile was not finished; half the floor is done.',
    );
    await driver.execute(
      `const el = document.querySelector('[data-testid="entry-finished-${id['lay']}"]'); if (el && el.checked) el.click();`,
    );
    await click(session, t('entry-save'));
    await driver.waitForElement('[data-entry-seq="3"]');
    const original = await driver.find('[data-entry-seq="1"]');
    expect(await original.attribute('data-corrected-by')).toBe('3');
    await session.screenshot('f4-correction-en');
    // The plan follows the correction: the activity is started, not finished.
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="checklist"]');
    const line = await driver.waitForElement('[data-checklist-line]');
    expect(await line.attribute('data-done')).toBe('started');
  });

  it('after a restart the chain still holds, and Diagnostics says so', async () => {
    await session.restart();
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await (await driver.waitForElement(t('recent-work'))).click();
    await go(session, 'diagnostics');
    await click(session, t('diary-verify'));
    const status = await text(session, t('chain-status'));
    expect(status).toMatch(/3/);
    expect(status).toMatch(/intact/i);
    await session.screenshot('f4-diagnostics-chain-en');
  });

  it('says it in Portuguese', async () => {
    const { driver } = session;
    await chooseLanguage(session, 'Português (Brasil)');
    const rail = await driver.find('nav[data-rail] button[data-destination="diary"]');
    expect((await rail.text()).trim()).toBe('Diário');
    await go(session, 'diary');
    await driver.waitForElement('[data-entry-seq="3"]');
    await session.screenshot('f4-diary-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
