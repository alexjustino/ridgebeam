import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, createWork, go, startSession, type Session } from './session';

/**
 * Slice F7's proof of done, against the real binary:
 *
 *   trades and contacts; who is on site from the diary; files copied into the work folder with
 *   thumbnails, hashes and caps; the hostile file corpus is refused with a sentence; a work folder
 *   moved is found again from a dialog.
 *
 * The files are written by the test: a one-pixel PNG, a minimal PDF, and a text file that calls
 * itself a Word document. The hostile corpus proper lives in `cargo test`; here one liar is enough
 * to see the sentence on the screen.
 */

const WORK = 'Studio, synthetic';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** The smallest PDF that is a PDF: a header, one empty page tree, a trailer. Never parsed by the product. */
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

async function tab(session: Session, name: string): Promise<void> {
  await go(session, 'plan');
  await click(session, `[data-testid="plan-tabs"] [data-tab="${name}"]`);
}

async function lastId(session: Session, selector: string, attr: string): Promise<string> {
  const ids = await session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((e) => e.getAttribute(${JSON.stringify(attr)}))`,
  );
  return ids[ids.length - 1]!;
}

async function addDocuments(session: Session, files: string[], kind?: string): Promise<void> {
  const { driver } = session;
  for (const file of files) {
    await setValue(session, t('document-path'), file);
    await click(session, t('document-path-add'));
  }
  await driver.waitFor('the pending files', async () =>
    (await driver.findAll('[data-pending-document]')).length === files.length ? true : null,
  );
  if (kind) await setValue(session, t('document-kind'), kind);
  await click(session, t('documents-add'));
}

async function documentCount(session: Session): Promise<number> {
  return (await session.driver.findAll('[data-document-id]')).length;
}

describe('F7 — people and documents: contacts, presence from the diary, files the work owns', () => {
  let session: Session;
  let parent: string;
  let workFolder: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-f7-'));
    workFolder = path.join(parent, 'studio');
    writeFileSync(path.join(parent, 'plan.png'), ONE_PIXEL_PNG);
    writeFileSync(path.join(parent, 'permit.pdf'), TINY_PDF, 'latin1');
    writeFileSync(path.join(parent, 'lie.docx'), 'Not a document the product keeps.\n');
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), workFolder);
    await createWork(session);
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await tab(session, 'breakdown');
    await setValue(session, t('stage-add-name'), 'Fit-out');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    id['stage'] = await lastId(session, '[data-stage-id]', 'data-stage-id');
    await setValue(session, t('activity-add-name'), 'Hang the doors');
    await click(session, t('activity-add'));
    await driver.waitForElement('[data-activity-id]');
    id['activity'] = await lastId(session, '[data-activity-id]', 'data-activity-id');
    await setValue(
      session,
      `[data-activity-id="${id['activity']}"] ${t('activity-duration')}`,
      '2',
    );
    await setValue(session, t('person-add-name'), 'J. Carpenter');
    await click(session, t('person-add'));
    await driver.waitForElement('[data-person-id]');
    id['person'] = await lastId(session, '[data-person-id]', 'data-person-id');
  }, 180_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('a person is a contact with a trade, a phone and the stages they are expected on', async () => {
    const { driver } = session;
    const row = `[data-person-id="${id['person']}"]`;
    await setValue(session, `${row} ${t('person-trade')}`, 'carpenter');
    await setValue(session, `${row} ${t('person-phone')}`, '+00 000 000 000');
    await setValue(session, `${row} ${t('person-availability')}`, 'mornings only');
    await click(session, `${row} ${t('person-stages')} input[type="checkbox"]`);
    await tab(session, 'people');
    const line = await driver.waitForElement(`[data-person-id="${id['person']}"]`);
    const shown = await line.text();
    expect(shown).toContain('J. Carpenter');
    expect(shown).toContain('carpenter');
    expect(shown).toContain('Fit-out');
    expect(
      await text(session, `[data-person-id="${id['person']}"] ${t('person-days-on-site')}`),
    ).toMatch(/^0\b/);
    await session.screenshot('f7-people-en');
  });

  it('who is on site comes from the diary, not from the contact', async () => {
    const { driver } = session;
    await go(session, 'diary');
    await driver.waitForElement(t('entry-today'));
    await click(session, t(`entry-done-${id['activity']}`));
    await click(session, t(`entry-present-${id['person']}`));
    await click(session, t('entry-save'));
    await driver.waitForElement('[data-entry-seq="1"]');
    await tab(session, 'people');
    expect(
      await text(session, `[data-person-id="${id['person']}"] ${t('person-days-on-site')}`),
    ).toMatch(/^1\b/);
    expect(
      await text(session, `[data-person-id="${id['person']}"] ${t('person-last-on-site')}`),
    ).not.toBe('');
  });

  it('documents are copied into the work folder by their hash, typed by their bytes', async () => {
    const { driver } = session;
    await go(session, 'documents');
    await driver.waitForElement(t('documents-add'));
    await addDocuments(
      session,
      [path.join(parent, 'plan.png'), path.join(parent, 'permit.pdf')],
      'permit',
    );
    await driver.waitFor('two documents', async () =>
      (await documentCount(session)) === 2 ? true : null,
    );
    const marks = await driver.findAll(t('document-mark'));
    expect(marks.length).toBeGreaterThanOrEqual(1);
    const thumbs = await driver.findAll(t('document-thumb'));
    expect(thumbs.length).toBeGreaterThanOrEqual(1);
    const files = readdirSync(path.join(workFolder, 'documents'));
    expect(
      files.some((f) => /^[0-9a-f]{64}\.png$/.test(f)),
      files.join(', '),
    ).toBe(true);
    expect(
      files.some((f) => /^[0-9a-f]{64}\.pdf$/.test(f)),
      files.join(', '),
    ).toBe(true);
    await session.screenshot('f7-documents-en');
  });

  it('a file the product does not keep is refused by name, and the others of the batch are kept', async () => {
    const { driver } = session;
    const before = await documentCount(session);
    await addDocuments(session, [path.join(parent, 'lie.docx'), path.join(parent, 'plan.png')]);
    const problem = await text(session, t('documents-problem'));
    expect(problem).toContain('lie.docx');
    // The PNG was already in the folder: the same bytes are never copied twice.
    await driver.waitFor('the library settled', async () =>
      (await documentCount(session)) >= before ? true : null,
    );
    const files = readdirSync(path.join(workFolder, 'documents')).filter((f) => f.endsWith('.png'));
    expect(files).toHaveLength(1);
  });

  it('a document is attached to a stage, counted there, detached, and removed — the shared file stays', async () => {
    const { driver } = session;
    await go(session, 'documents');
    const pdf = await driver.execute<string>(
      `return Array.from(document.querySelectorAll('[data-document-id]')).find((e) => e.querySelector('[data-testid="document-mark"]')).getAttribute('data-document-id')`,
    );
    const card = `[data-document-id="${pdf}"]`;
    await click(session, `${card} ${t('document-attach')}`);
    await setValue(session, t('attach-kind'), 'stage');
    await setValue(session, t('attach-target'), id['stage']!);
    await click(session, t('attach-confirm'));
    const stageLink = `${card} [data-link-target="stage:${id['stage']}"]`;
    await driver.waitForElement(stageLink);
    await tab(session, 'breakdown');
    expect(
      await text(session, `[data-stage-id="${id['stage']}"] ${t('stage-documents-count')}`),
    ).toMatch(/1/);
    await go(session, 'documents');
    // The work's own link carries no unlink button: only the stage's chip goes.
    await click(session, `${stageLink} ${t('document-unlink')}`);
    await driver.waitFor('detached', async () =>
      (await driver.findAll(stageLink)).length === 0 ? true : null,
    );
    expect(await driver.findAll(`${card} [data-link-target]`)).toHaveLength(1);
    expect(await documentCount(session)).toBe(2);
    // The PNG is also the diary's photo? Not yet — attach it to the diary first, then remove the document.
    const png = await driver.execute<string>(
      `return Array.from(document.querySelectorAll('[data-document-id]')).find((e) => e.querySelector('[data-testid="document-thumb"]')).getAttribute('data-document-id')`,
    );
    await go(session, 'diary');
    await click(session, t('entry-more'));
    await setValue(session, t('entry-photo-path'), path.join(parent, 'plan.png'));
    await click(session, t('entry-photo-add'));
    await click(session, t('entry-save'));
    await driver.waitForElement('[data-entry-seq="2"]');
    await go(session, 'documents');
    await click(session, `[data-document-id="${png}"] ${t('document-remove')}`);
    await click(session, '[role="dialog"] [data-testid="confirm"]');
    await driver.waitFor('one document left', async () =>
      (await documentCount(session)) === 1 ? true : null,
    );
    const pngs = readdirSync(path.join(workFolder, 'documents')).filter((f) => f.endsWith('.png'));
    expect(pngs).toHaveLength(1);
  });

  it('Diagnostics reads the folder and re-hashes every document', async () => {
    const { driver } = session;
    await go(session, 'diagnostics');
    await driver.waitForElement(t('folder-health'));
    await click(session, t('documents-verify'));
    const status = await text(session, t('documents-status'));
    expect(status).toMatch(/as recorded|conforme/i);
    await session.screenshot('f7-diagnostics-en');
  });

  it('a work folder moved while closed is found again from the Start screen', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    await click(session, t('work-close'));
    await driver.waitForElement(t('start'));
    const moved = path.join(parent, 'studio-moved');
    renameSync(workFolder, moved);
    expect(existsSync(moved)).toBe(true);
    await session.restart();
    const fresh = session.driver;
    await fresh.waitForElement(t('start'));
    await fresh.waitForElement(t('recent-find'));
    await click(session, t('recent-find'));
    await setValue(session, t('find-folder'), moved);
    await click(session, t('find-confirm'));
    await go(session, 'dashboard');
    await fresh.waitForText(WORK);
    workFolder = moved;
    await session.screenshot('f7-found-again-en');
  });

  it('says it in Portuguese', async () => {
    const { driver } = session;
    await chooseLanguage(session, 'Português (Brasil)');
    const rail = await driver.find('nav[data-rail] button[data-destination="documents"]');
    expect((await rail.text()).trim()).toBe('Documentos');
    await go(session, 'documents');
    await driver.waitForElement('[data-document-id]');
    await session.screenshot('f7-documents-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
