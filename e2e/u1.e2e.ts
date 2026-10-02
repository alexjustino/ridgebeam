import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type Session } from './session';

/**
 * Slice U1's proof of done, against the real binary:
 *
 *   before the first real work — the diary offers the people of the last entry in one press; the
 *   front door says, quietly, that the work has never been backed up, and leads to the backup;
 *   the owner's snapshot lists only the gates that hold something to check; files dropped on the
 *   window are taken as if chosen in the dialog, on the screen that takes them.
 *
 * WebDriver cannot perform the operating system's drag. The drop is the one event Tauri emits for
 * it — `tauri://drag-enter`, then `tauri://drag-drop` with the paths — emitted here to the window
 * through Tauri's own event command, so everything after the gesture is the real product: the
 * listener, the routing, the host's intake and the database.
 */

const WORK = 'Laundry, synthetic first week';

/** Two one-pixel PNGs of different colours, synthetic — different bytes, so two documents. */
const RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** What Tauri emits to the window when files are dragged over it and dropped. */
async function drag(session: Session, kind: 'enter' | 'drop' | 'leave', paths: string[] = []) {
  const event = `tauri://drag-${kind}`;
  const payload = kind === 'leave' ? null : { paths, position: { x: 400, y: 300 } };
  await session.driver.execute(
    `return window.__TAURI_INTERNALS__.invoke('plugin:event|emit_to', {
       target: { kind: 'Webview', label: 'main' },
       event: ${JSON.stringify(event)},
       payload: ${JSON.stringify(payload)},
     })`,
  );
}

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

async function lastId(session: Session, selector: string, attr: string): Promise<string> {
  const ids = await session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((e) => e.getAttribute(${JSON.stringify(attr)}))`,
  );
  return ids[ids.length - 1]!;
}

async function pressed(session: Session, selector: string): Promise<boolean> {
  return session.driver.execute<boolean>(
    `return document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed') === 'true'`,
  );
}

async function present(session: Session, selector: string): Promise<boolean> {
  return session.driver.execute<boolean>(
    `return document.querySelector(${JSON.stringify(selector)}) !== null`,
  );
}

/** The documents the Documents page lists: each title field's value and its accessible label. */
async function documentNames(session: Session): Promise<string> {
  return session.driver.execute<string>(
    `return Array.from(document.querySelectorAll('[data-testid="document-title"]'))
       .map((el) => [el.value, el.getAttribute('aria-label'), el.closest('label')?.innerText]
         .filter(Boolean).join(' ')).join(' | ')`,
  );
}

describe('U1 — before the first real work: the last crew in one press, a backup reminded', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-u1-'));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'laundry'));
    await click(session, t('work-create'));
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    for (const name of ['E. Plumber', 'F. Tiler']) {
      await setValue(session, t('person-add-name'), name);
      await click(session, t('person-add'));
      await driver.waitFor(`${name} added`, async () =>
        (await driver.findAll('[data-person-id]')).length > Object.keys(id).length ? true : null,
      );
      id[name] = await lastId(session, '[data-person-id]', 'data-person-id');
    }
    await setValue(session, t('stage-add-name'), 'Plumbing');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    const stage = `[data-stage-id="${await lastId(session, '[data-stage-id]', 'data-stage-id')}"]`;
    await setValue(session, `${stage} ${t('activity-add-name')}`, 'Move the washer outlet');
    await click(session, `${stage} ${t('activity-add')}`);
    await driver.waitForElement('[data-activity-id]');
    const row = `[data-activity-id="${await lastId(session, '[data-activity-id]', 'data-activity-id')}"]`;
    await setValue(session, `${row} ${t('activity-duration')}`, '2');
    await setValue(session, `${row} ${t('activity-responsible')}`, id['E. Plumber']!);
  }, 180_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('a work with a plan in it and no backup is reminded, quietly', async () => {
    await go(session, 'dashboard');
    await session.driver.waitForElement(t('readiness-sentence'));
    // An activity is content: the work is worth keeping from the first one. "Not now" is a
    // session's choice, covered by the unit suite — pressing it here would hide the line below.
    expect(await present(session, t('dashboard-backup'))).toBe(true);
  });

  it('the diary offers the people of the last entry, and ticks them in one press', async () => {
    const { driver } = session;
    await go(session, 'diary');
    await driver.waitForElement(t('entry-today'));
    expect(await present(session, t('entry-same-people'))).toBe(false);
    await click(session, t(`entry-present-${id['E. Plumber']}`));
    await click(session, t(`entry-present-${id['F. Tiler']}`));
    await click(session, t('entry-save'));
    await driver.waitForElement('[data-entry-seq="1"]');

    await driver.waitForElement(t('entry-same-people'));
    expect(await pressed(session, t(`entry-present-${id['E. Plumber']}`))).toBe(false);
    expect(await text(session, t('entry-same-people'))).toMatch(/Same people as/);
    await click(session, t('entry-same-people'));
    expect(await pressed(session, t(`entry-present-${id['E. Plumber']}`))).toBe(true);
    expect(await pressed(session, t(`entry-present-${id['F. Tiler']}`))).toBe(true);
    await driver.execute(
      `document.querySelector('[data-testid="entry-same-people"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('u1-same-people-en');
    await click(session, t('entry-save'));
    await driver.waitForElement('[data-entry-seq="2"]');
  });

  it('the front door says the work has never been backed up, and leads to the backup', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    expect(await text(session, t('dashboard-backup'))).toMatch(/never been backed up/);
    await session.screenshot('u1-backup-reminder-en');
    await click(session, t('dashboard-backup-now'));
    await driver.waitFor('the backup path focused', async () =>
      (await driver.execute<string>(
        `return document.activeElement?.getAttribute('data-testid') ?? ''`,
      )) === 'backup-path'
        ? true
        : null,
    );
    const file = path.join(parent, 'laundry.ridgebeam');
    await setValue(session, t('backup-path'), file);
    await click(session, t('backup-write'));
    expect(await text(session, t('backup-done'))).toContain('laundry.ridgebeam');

    await go(session, 'dashboard');
    await driver.waitForElement(t('readiness-sentence'));
    await driver.waitFor('the reminder gone', async () =>
      (await present(session, t('dashboard-backup'))) ? null : true,
    );
  });

  it('the snapshot lists no gate that holds nothing to check', async () => {
    await go(session, 'reports');
    const file = path.join(parent, 'laundry.html');
    await setValue(session, t('snapshot-path'), file);
    await click(session, t('snapshot-write'));
    await session.driver.waitFor('the snapshot written', async () => {
      const done = await session.driver.findAll(t('snapshot-done'));
      return done.length > 0 && (await done[0]!.text()).includes('laundry.html') ? true : null;
    });
    const html = readFileSync(file, 'utf8');
    expect(html).not.toMatch(/nothing to check/);
  });

  it('photos dropped on the Diary join the entry being written, and are kept with it', async () => {
    const { driver } = session;
    const photo = path.join(parent, 'outlet.png');
    writeFileSync(photo, PNG);
    await go(session, 'diary');
    await driver.waitForElement(t('entry-today'));
    await drag(session, 'enter', [photo]);
    expect(await text(session, t('drop-hint'))).toMatch(/photo/i);
    await session.screenshot('u1-drop-hint-en');
    await drag(session, 'drop', [photo]);
    await driver.waitForElement('[data-pending-photo]');
    expect(await present(session, t('drop-hint'))).toBe(false);
    await click(session, t('entry-save'));
    await driver.waitForElement('[data-entry-seq="3"]');
    await go(session, 'documents');
    await driver.waitFor('the dropped photo among the documents', async () =>
      (await documentNames(session)).includes('outlet.png') ? true : null,
    );
  });

  it('a file dropped on Documents is added; one it does not take is named, not sent', async () => {
    const { driver } = session;
    const photo = path.join(parent, 'meter.png');
    const sheet = path.join(parent, 'prices.docx');
    // The same bytes as a photo the work holds would be that document again, linked once more.
    writeFileSync(photo, RED);
    writeFileSync(sheet, 'not a document Ridgebeam takes');
    await go(session, 'documents');
    await drag(session, 'enter', [photo, sheet]);
    await driver.waitForElement(t('drop-hint'));
    await drag(session, 'drop', [photo, sheet]);
    await driver.waitFor('the dropped file added', async () =>
      (await documentNames(session)).includes('meter.png') ? true : null,
    );
    expect(await text(session, t('documents-drop-left'))).toContain('prices.docx');
  });

  it('a drop on a screen that takes no files says where to drop them, and does nothing', async () => {
    const { driver } = session;
    const photo = path.join(parent, 'outlet.png');
    await go(session, 'schedule');
    await drag(session, 'enter', [photo]);
    await driver.waitForElement(t('drop-hint'));
    await drag(session, 'drop', [photo]);
    expect(await text(session, t('drop-status'))).toMatch(/Diary/);
    await session.screenshot('u1-drop-elsewhere-en');
  });

  it('says it in Portuguese', async () => {
    const { driver } = session;
    await chooseLanguage(session, 'Português (Brasil)');
    await go(session, 'diary');
    await driver.waitForElement(t('entry-same-people'));
    expect(await text(session, t('entry-same-people'))).toMatch(/Mesma turma de/);
    await session.screenshot('u1-same-people-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
