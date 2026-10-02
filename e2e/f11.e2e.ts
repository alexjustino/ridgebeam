import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type Session } from './session';

/**
 * Slice F11's proof of done, against the real binary:
 *
 *   backup is one file and restore brings a full work back byte for byte; Diagnostics lists
 *   schema, chain and folder health.
 *
 * "Byte for byte" is the host's cargo test (the restored database equal to the archived snapshot,
 * table by table and byte by byte). Here a person's view of it: everything the screens said before
 * the backup, they say again after the restore, from a new folder.
 */

const WORK = 'Bathroom, synthetic backup';
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const TINY_PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n' +
  'trailer<</Root 1 0 R>>\n%%EOF\n';

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

async function more(session: Session): Promise<void> {
  const open = await session.driver.execute<boolean>(
    `return document.querySelector('[data-testid="entry-note"]') !== null`,
  );
  if (!open) await click(session, t('entry-more'));
  await session.driver.waitForElement(t('entry-note'));
}

/** What the front door says about the work — read before the backup and after the restore. */
async function frontDoor(session: Session): Promise<Record<string, string>> {
  await go(session, 'dashboard');
  const read = async (id: string) => text(session, t(id));
  return {
    readiness: await read('figure-value'),
    finish: await read('finish-date'),
    planned: await read('money-planned-value'),
    paid: await read('money-paid-value'),
  };
}

/** The names of a ZIP's entries, in the order they were written, read from its central directory. */
function zipEntries(file: string): string[] {
  const bytes = readFileSync(file);
  // The end-of-central-directory record: the last 22 bytes, or earlier by a comment's length.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at -= 1) {
    if (bytes.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  expect(end, 'an end-of-central-directory record').toBeGreaterThanOrEqual(0);
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    names.push(bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8'));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

describe('F11 — a work backed up as one file, and restored whole into a new folder', () => {
  let session: Session;
  let parent: string;
  let before: Record<string, string>;
  let entriesBefore = 0;
  const backup = () => path.join(parent, 'bathroom.ridgebeam');

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-f11-'));
    writeFileSync(path.join(parent, 'site.png'), ONE_PIXEL_PNG);
    writeFileSync(path.join(parent, 'permit.pdf'), TINY_PDF);
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'bathroom'));
    await setValue(session, t('work-template'), 'bathroom-renovation');
    await click(session, t('work-create'));
    await driver.waitForElement(t('lens-switch'));
  }, 120_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('the plan asks one question at a time, and an answer is written like any edit', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    const card = await text(session, t('next-question'));
    expect(card).toMatch(/\d+ of \d+/);
    const countBefore = /(\d+) of (\d+)/.exec(card)!;
    await setValue(session, t('next-answer'), '2');
    await click(session, t('next-keep'));
    await driver.waitFor('the next question', async () => {
      const now = /(\d+) of (\d+)/.exec(await text(session, t('next-question')));
      return now && Number(now[1]) === Number(countBefore[1]) + 1 ? true : null;
    });
    await driver.execute(
      `document.querySelector('[data-testid="next-question"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('f11-next-question-en');
    await click(session, t('next-skip'));
  });

  it('a full work: ranges taken, an entry with a photo, a PDF, a payment, approval and a replanning', async () => {
    const { driver } = session;
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    await click(session, t('ranges-take-high'));
    await driver.waitFor('the ranges taken', async () =>
      (await driver.findAll(t('ranges-take-high'))).length === 0 ? true : null,
    );
    const firstLine = await driver.execute<string>(
      `return document.querySelector('[data-cost-line-id][data-unpriced]').getAttribute('data-cost-line-id')`,
    );
    await setValue(
      session,
      `[data-cost-line-id="${firstLine}"] ${t('cost-line-amount')}`,
      '750.00',
    );
    await driver.waitFor('a priced line', async () =>
      (await driver.findAll(`[data-cost-line-id="${firstLine}"][data-unpriced]`)).length === 0
        ? true
        : null,
    );

    await go(session, 'diary');
    await driver.waitForElement(t('entry-today'));
    const done = await driver.execute<string>(
      `return document.querySelector('[data-testid^="entry-done-"]').getAttribute('data-testid')`,
    );
    await click(session, t(done));
    await more(session);
    await setValue(session, t('entry-note'), 'Old tiles off the north wall.');
    await setValue(session, t('entry-photo-path'), path.join(parent, 'site.png'));
    await click(session, t('entry-photo-add'));
    await driver.waitForElement('[data-pending-photo]');
    await click(session, t('entry-save'));
    await driver.waitForElement('[data-entry-seq="1"]');
    entriesBefore = (await driver.findAll('[data-entry-seq]')).length;

    await go(session, 'documents');
    await setValue(session, t('document-path'), path.join(parent, 'permit.pdf'));
    await click(session, t('document-path-add'));
    await driver.waitForElement('[data-pending-document]');
    await setValue(session, t('document-kind'), 'permit');
    await click(session, t('documents-add'));
    await driver.waitForElement(`[data-document-id] ${t('document-mark')}`);

    await go(session, 'money');
    await click(session, '[data-testid="money-tabs"] [data-tab="ledger"]');
    const stage = await driver.execute<string>(
      `const s = document.querySelector('[data-testid="payment-stage"]'); return s.options[1].value`,
    );
    await setValue(session, t('payment-stage'), stage);
    await setValue(session, t('payment-amount'), '300.00');
    await setValue(session, t('payment-what'), 'Skip hire, first week');
    await click(session, t('payment-save'));
    await driver.waitForElement('[data-payment-seq="1"]');

    await go(session, 'schedule');
    await click(session, t('plan-approve'));
    await driver.waitForElement(t('baseline-number'));
    await click(session, t('replan-open'));
    await setValue(session, t('replan-reason'), 'The tiles arrive a week late.');
    await click(session, t('replan-confirm'));
    await driver.waitForElement(t('replanning-open'));

    before = await frontDoor(session);
  });

  it('the work is backed up as one file: a ZIP whose first entry is its manifest', async () => {
    await go(session, 'settings');
    await setValue(session, t('backup-path'), backup());
    await click(session, t('backup-write'));
    expect(await text(session, t('backup-done'))).toContain('bathroom.ridgebeam');
    await session.driver.execute(
      `document.querySelector('[data-testid="backup-done"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('f11-backup-en');
    const names = zipEntries(backup());
    expect(names[0]).toBe('manifest.json');
    expect(names).toContain('work.sqlite3');
    expect(names.some((name) => name.startsWith('documents/') && name.endsWith('.pdf'))).toBe(true);
    expect(names.some((name) => name.startsWith('documents/') && name.endsWith('.png'))).toBe(true);
  });

  it('a tampered backup is refused, and no folder is left behind', async () => {
    const { driver } = session;
    const tampered = path.join(parent, 'tampered.ridgebeam');
    copyFileSync(backup(), tampered);
    const bytes = readFileSync(tampered);
    // The PNG is stored, not deflated: flip a byte of its data inside the archive.
    const signature = bytes.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(signature).toBeGreaterThan(0);
    bytes[signature + 20] = bytes[signature + 20]! ^ 0xff;
    writeFileSync(tampered, bytes);

    await go(session, 'dashboard');
    await click(session, t('work-close'));
    await driver.waitForElement(t('start'));
    await click(session, t('restore-open'));
    await setValue(session, t('restore-file'), tampered);
    const target = path.join(parent, 'tampered-work');
    await setValue(session, t('restore-folder'), target);
    await click(session, t('restore-confirm'));
    const outcome = await driver
      .waitFor(
        'the restore answered',
        async () => {
          if ((await driver.findAll(t('restore-problem'))).length > 0) return 'refused';
          if ((await driver.findAll(t('restore-done'))).length > 0) return 'restored';
          return null;
        },
        30_000,
      )
      .catch(async (error: unknown) => {
        await session.screenshot('f11-tampered-stuck');
        const state = await driver.execute<string>(
          `const d = document.querySelector('[role="dialog"]'); return d ? d.innerText : 'no dialog: ' + document.querySelector('main')?.innerText.slice(0, 400)`,
        );
        throw new Error(`${String(error)}
${state}`);
      });
    await session.screenshot('f11-tampered-en');
    expect(outcome).toBe('refused');
    const refusal = await driver.execute<string>(
      `return document.querySelector('[data-testid="restore-problem"]').textContent`,
    );
    // A byte flipped inside a stored document fails its CRC before its hash is even taken: the
    // host says the file is damaged, or that it does not match, or that the backup changed.
    expect(refusal).toMatch(/does not match|changed|damaged/i);
    expect(refusal).toContain('tampered.ridgebeam');
    expect(existsSync(target) && readdirSync(target).length > 0).toBe(false);
    await driver.execute(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    );
  });

  it('restored into a new folder, the work says everything it said before', async () => {
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('restore-open'));
    await setValue(session, t('restore-file'), backup());
    await setValue(session, t('restore-folder'), path.join(parent, 'restored'));
    await click(session, t('restore-confirm'));
    const done = await text(session, t('restore-done'));
    expect(done).toMatch(/chain verified/i);
    await session.screenshot('f11-restored-en');
    await driver.waitFor('the restored work open', async () =>
      (await driver.findAll('nav[data-rail] button[aria-current="page"]')).length > 0 ? true : null,
    );
    expect(await frontDoor(session)).toEqual(before);
    await go(session, 'diary');
    await driver.waitForElement('[data-entry-seq="1"]');
    expect((await driver.findAll('[data-entry-seq]')).length).toBe(entriesBefore);
    await driver.waitForElement(t('photo-thumb'));
    await go(session, 'schedule');
    expect(await text(session, t('replanning-open'))).toContain('The tiles arrive a week late.');
    await go(session, 'documents');
    await driver.waitForElement(`[data-document-id] ${t('document-mark')}`);
  });

  it('Diagnostics lists the schema, the chain, the folder health and the last backup', async () => {
    const { driver } = session;
    await go(session, 'diagnostics');
    await driver.waitForElement(t('folder-health'));
    await click(session, t('diary-verify'));
    expect(await text(session, t('chain-status'))).toMatch(/intact|verified|holds/i);
    await click(session, t('documents-verify'));
    expect(await text(session, t('documents-status'))).toMatch(/as recorded/i);
    const page = await text(session, 'main');
    expect(page).toMatch(/Schema version/);
    expect(page).toMatch(/backup/i);
    await session.screenshot('f11-diagnostics-en');
  });

  it('says it in Portuguese', async () => {
    const { driver } = session;
    await chooseLanguage(session, 'Português (Brasil)');
    await go(session, 'settings');
    await driver.waitForElement(t('backup-write'));
    expect(await text(session, 'main')).toMatch(/[Cc]ópia de segurança|[Bb]ackup/);
    await session.screenshot('f11-settings-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
