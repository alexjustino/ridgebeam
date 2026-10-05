import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pdfImageCount, pdfText } from './pdf';
import { chooseLanguage, createWork, go, startSession, type Session } from './session';

/**
 * Slice D3's proof of done, against the real binary:
 *
 *   one PDF the owner keeps — room by room what was done, the decisions made, the photos of hidden
 *   work taken before it was closed, the documents by kind, who did what, and the care notes; a
 *   check can require its photo; the book says what it still lacks.
 */

const WORK = 'Bathroom, synthetic handover';
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

describe('D3 — the handover book: the record of the work, with the photos of what was closed', () => {
  let session: Session;
  let parent: string;
  let hidden = '';

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-d3-'));
    writeFileSync(path.join(parent, 'pipes.png'), ONE_PIXEL_PNG);
    writeFileSync(path.join(parent, 'warranty.pdf'), TINY_PDF);
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'bathroom'));
    await setValue(session, t('work-template'), 'bathroom-renovation');
    await createWork(session);
    await driver.waitForElement(t('lens-switch'));
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    await click(session, t('ranges-take-high'));
    await driver.waitFor('the ranges taken', async () =>
      (await driver.findAll(t('ranges-take-high'))).length === 0 ? true : null,
    );
  }, 180_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('a hidden-work check refuses a "yes" without its photo, and takes one with it', async () => {
    const { driver } = session;
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="gates"]');
    hidden = await driver.execute<string>(
      `const el = document.querySelector('[data-check-id][data-needs-photo="true"]'); return el ? el.getAttribute('data-check-id') : ''`,
    );
    expect(hidden).not.toBe('');
    const item = `[data-check-id="${hidden}"]`;
    await click(session, `${item} ${t('check-answer-yes')}`);
    expect(await text(session, `${item} ${t('check-problem')}`)).toMatch(/photo/i);
    await setValue(
      session,
      `${item} ${t('check-answer-photo-path')}`,
      path.join(parent, 'pipes.png'),
    );
    await click(session, `${item} ${t('check-answer-photo-add')}`);
    await click(session, `${item} ${t('check-answer-yes')}`);
    await driver.waitForElement(`${item} ${t('photo-thumb')}`);
    await driver.execute(`document.querySelector('${item}').scrollIntoView({ block: 'center' })`);
    await session.screenshot('d3-hidden-work-en');
  });

  it('a warranty and a care note join the record', async () => {
    const { driver } = session;
    await go(session, 'documents');
    await setValue(session, t('document-path'), path.join(parent, 'warranty.pdf'));
    await click(session, t('document-path-add'));
    await driver.waitForElement('[data-pending-document]');
    await setValue(session, t('document-kind'), 'warranty');
    await click(session, t('documents-add'));
    await driver.waitForElement(`[data-document-id] ${t('document-mark')}`);

    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="handover"]');
    const room = await driver.execute<string>(
      `const el = document.querySelector('[data-care-target^="room:"]'); return el ? el.getAttribute('data-care-target') : ''`,
    );
    expect(room).not.toBe('');
    const block = `[data-care-target="${room}"]`;
    await setValue(
      session,
      `${block} ${t('care-note-add-text')}`,
      'Reseal the shower grout once a year.',
    );
    await click(session, `${block} ${t('care-note-add')}`);
    await driver.waitForElement(`${block} [data-care-note-id]`);
    await session.screenshot('d3-handover-tab-en');
  });

  it('the book says what it lacks, and is written with its photos', async () => {
    await go(session, 'reports');
    expect(await text(session, t('handover-gaps'))).toMatch(/\d/);
    const file = path.join(parent, 'handover.pdf');
    await setValue(session, t('handover-path'), file);
    await click(session, t('handover-write'));
    await session.driver.waitFor('the book written', async () => {
      const done = await session.driver.findAll(t('handover-done'));
      return done.length > 0 && (await done[0]!.text()).includes('handover.pdf') ? true : null;
    });
    await session.driver.execute(
      `document.querySelector('[data-testid="handover-done"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('d3-reports-en');
    const raw = readFileSync(file);
    expect(pdfImageCount(raw)).toBeGreaterThanOrEqual(1);
    const words = pdfText(raw);
    expect(words).toMatch(/Handover book/);
    expect(words).toContain(WORK);
    expect(words).toContain('Reseal the shower grout once a year.');
    expect(words).toContain('warranty.pdf');
    expect(words).toMatch(/in progress/i);
  });

  it('says it in Portuguese', async () => {
    await chooseLanguage(session, 'Português (Brasil)');
    await go(session, 'reports');
    const file = path.join(parent, 'manual.pdf');
    await setValue(session, t('handover-path'), file);
    await click(session, t('handover-write'));
    await session.driver.waitFor('o manual gravado', async () => {
      const done = await session.driver.findAll(t('handover-done'));
      return done.length > 0 && (await done[0]!.text()).includes('manual.pdf') ? true : null;
    });
    const palavras = pdfText(readFileSync(file));
    expect(palavras).toMatch(/Manual de entrega/);
    // The words agree with the whole: "0 de 22 concluídas", never "concluída".
    expect(palavras).toMatch(/\b0 de \d+ concluídas/);
    await chooseLanguage(session, 'English');
  });
});
