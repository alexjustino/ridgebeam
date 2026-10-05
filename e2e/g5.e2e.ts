import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, chooseTheme, createWork, go, startSession, type Session } from './session';

/**
 * Slice G5's proof of done, against the real binary:
 *
 *   a photo straight from an iPhone (HEIC) is taken where a photo is taken — a diary entry, the
 *   Documents page — converted to a JPEG through Windows' own decoder, kept under the person's name
 *   and thumbnailed; the screen says so before and after; a file that only looks like HEIC is
 *   refused with a sentence.
 *
 * The HEIC is `e2e/fixtures/synthetic-photo.heic`: a gradient and two shapes, encoded by Windows on
 * the machine that made it, with no metadata. Converting it needs the HEIF and HEVC extensions; on a
 * computer without them the suite says so and skips.
 */

const WORK = 'Bathroom, synthetic iPhone photos';
const HEIC = path.resolve(import.meta.dirname, 'fixtures', 'synthetic-photo.heic');

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

/** Whether Windows on this computer has the HEIF extension: its package is registered. */
function heifInstalled(): boolean {
  if (process.platform !== 'win32') return false;
  const packages = path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'WindowsApps');
  try {
    return readdirSync(packages).some((name) => name.startsWith('Microsoft.HEIFImageExtension'));
  } catch {
    // The folder is not listable without rights: assume present and let the host say otherwise.
    return true;
  }
}

async function more(session: Session): Promise<void> {
  const open = await session.driver.execute<boolean>(
    `return document.querySelector('[data-testid="entry-lost-day"]') !== null`,
  );
  if (!open) await click(session, t('entry-more'));
  await session.driver.waitForElement(t('entry-lost-day'));
}

describe.skipIf(!heifInstalled())(
  'G5 — photos from an iPhone: HEIC converted through Windows’ own decoder',
  () => {
    let session: Session;
    let parent: string;
    let workFolder: string;

    beforeAll(async () => {
      session = await startSession();
      parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-g5-'));
      workFolder = path.join(parent, 'bathroom');
      // A file that begins like a HEIC and is not one: the hostile corpus's fake.
      const fake = Buffer.alloc(64, 0x5a);
      fake.writeUInt32BE(24, 0);
      fake.write('ftypheic', 4, 'latin1');
      writeFileSync(path.join(parent, 'IMG_9999.HEIC'), fake);
      const { driver } = session;
      await driver.waitForElement(t('start'));
      await click(session, t('new-work'));
      await setValue(session, t('work-name'), WORK);
      await setValue(session, t('work-folder'), workFolder);
      await createWork(session);
    }, 120_000);

    afterAll(async () => {
      await session?.stop();
      if (!process.env.RIDGEBEAM_E2E_KEEP && parent) {
        rmSync(parent, { recursive: true, force: true });
      }
    });

    it('a diary photo from an iPhone says it will be converted, and is kept as a JPEG', async () => {
      const { driver } = session;
      await go(session, 'diary');
      await more(session);
      await setValue(session, t('entry-note'), 'The pipes before the wall is closed.');
      await setValue(session, t('entry-photo-path'), HEIC);
      await click(session, t('entry-photo-add'));
      await driver.waitForElement('[data-pending-photo]');
      expect(await text(session, `[data-pending-photo] ${t('photo-converted-note')}`)).toMatch(
        /converted to JPEG/i,
      );
      await driver.execute(
        `document.querySelector('[data-pending-photo]').scrollIntoView({ block: 'center' })`,
      );
      await session.screenshot('g5-pending-en');
      await click(session, t('entry-save'));
      await driver.waitForElement('[data-entry-seq="1"]');
      expect(await text(session, t('photo-converted'))).toMatch(/synthetic-photo\.heic/i);
      const img = await driver.waitForElement(`[data-entry-seq="1"] ${t('photo-thumb')}`);
      expect(await img.attribute('src')).toMatch(/^data:image\/jpeg;base64,/);
      const files = readdirSync(path.join(workFolder, 'documents'));
      expect(files.filter((f) => /^[0-9a-f]{64}\.jpg$/.test(f))).toHaveLength(1);
      expect(files.some((f) => /\.heic$/i.test(f))).toBe(false);
      await session.screenshot('g5-diary-en');
    });

    it('the Documents page takes it too, under the person’s own name', async () => {
      const { driver } = session;
      await go(session, 'documents');
      await setValue(session, t('document-path'), HEIC);
      await click(session, t('document-path-add'));
      await driver.waitForElement('[data-pending-document]');
      await click(session, t('documents-add'));
      await driver.waitForElement(t('photo-converted'));
      expect(await text(session, t('photo-converted'))).toMatch(/HEIC to JPEG/i);
      const page = await driver.execute<string>(
        `return document.querySelector('main')?.innerText ?? ''`,
      );
      expect(page).toContain('synthetic-photo.heic');
      // The same HEIC converts to the same bytes: still one copy in the folder.
      const jpegs = readdirSync(path.join(workFolder, 'documents')).filter((f) =>
        /^[0-9a-f]{64}\.jpg$/.test(f),
      );
      expect(jpegs).toHaveLength(1);
      await session.screenshot('g5-documents-en');
    });

    it('a file that only looks like a HEIC is refused with a sentence', async () => {
      await go(session, 'documents');
      await setValue(session, t('document-path'), path.join(parent, 'IMG_9999.HEIC'));
      await click(session, t('document-path-add'));
      await session.driver.waitForElement('[data-pending-document]');
      await click(session, t('documents-add'));
      const problem = await text(session, t('documents-problem'));
      expect(problem).toContain('IMG_9999.HEIC');
      expect(problem).toMatch(/could not read it/i);
    });

    it('says it in Portuguese: será convertida para JPEG', async () => {
      const { driver } = session;
      await chooseLanguage(session, 'Português (Brasil)');
      // The light theme too: these screens are captured and looked at in both themes.
      await chooseTheme(session, 'Português (Brasil)', 'light');
      await go(session, 'diary');
      await more(session);
      await setValue(session, t('entry-photo-path'), HEIC);
      await click(session, t('entry-photo-add'));
      await driver.waitForElement('[data-pending-photo]');
      expect(await text(session, `[data-pending-photo] ${t('photo-converted-note')}`)).toMatch(
        /convertida para JPEG/i,
      );
      await driver.execute(
        `document.querySelector('[data-pending-photo]').scrollIntoView({ block: 'center' })`,
      );
      await session.screenshot('g5-pending-pt-BR');
      await driver.execute(
        `document.querySelectorAll('[data-pending-photo] button').forEach((b) => b.click())`,
      );
      await chooseLanguage(session, 'English');
    });
  },
);
