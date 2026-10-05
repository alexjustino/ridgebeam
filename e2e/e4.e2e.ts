import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pdfImageCount, pdfText } from './pdf';
import { chooseLanguage, chooseTheme, createWork, go, startSession, type Session } from './session';

/**
 * Slice E4's proof of done, against the real binary:
 *
 *   a work that ends well — what is still wrong at the end is written down as snags, each on
 *   somebody, each with a photo; a snag is closed with a photo of it fixed, or withdrawn with a
 *   reason, never deleted; the tiler's last part is held back as retention until the stage is closed
 *   and the tiler's snags are closed; the handover book lists what is still to fix, then prints the
 *   fixed snag with both photos.
 */

const WORK = 'Bathroom, synthetic snags';

/** Three one-pixel PNGs of different colours — different bytes, so three photos of the work. */
const PNG = {
  crack:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  grout:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  fixed:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
};

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

async function planTab(session: Session, name: string): Promise<void> {
  await go(session, 'plan');
  await click(session, `[data-testid="plan-tabs"] [data-tab="${name}"]`);
}

async function byStage(session: Session): Promise<void> {
  await go(session, 'money');
  await click(session, '[data-testid="money-tabs"] [data-tab="by-stage"]');
}

/** Confirm the dialog in front, as the gates' start and close do. */
async function confirm(session: Session): Promise<void> {
  await session.driver.waitForElement('[role="dialog"]');
  await click(
    session,
    '[role="dialog"] button[data-confirm], [role="dialog"] [data-testid="confirm"]',
  );
}

describe('E4 — a work that ends well: snags closed with a photo, retention held until they are', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};
  const file = (name: keyof typeof PNG) => path.join(parent, `${name}.png`);
  const commitment = () => `[data-commitment-id="${id['quote']}"]`;
  const retention = () =>
    session.driver.execute<string>(
      `const rows = Array.from(document.querySelectorAll('${commitment()} [data-milestone-id]'));
       const last = rows[rows.length - 1];
       return (last?.querySelector('[data-testid="milestone-state"]')?.getAttribute('data-held') ?? '') + '|' + (last?.innerText ?? '')`,
    );

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-e4-'));
    for (const [name, data] of Object.entries(PNG)) {
      writeFileSync(file(name as keyof typeof PNG), Buffer.from(data, 'base64'));
    }
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'bathroom'));
    await createWork(session);
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await planTab(session, 'breakdown');
    await setValue(session, t('person-add-name'), 'K. Tiler');
    await click(session, t('person-add'));
    await driver.waitForElement('[data-person-id]');
    id['tiler'] = await lastId(session, '[data-person-id]', 'data-person-id');
    await setValue(session, t('stage-add-name'), 'Tiling');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    id['stage'] = await lastId(session, '[data-stage-id]', 'data-stage-id');
    const stage = `[data-stage-id="${id['stage']}"]`;
    await setValue(session, `${stage} ${t('activity-add-name')}`, 'Lay the wall tiles');
    await click(session, `${stage} ${t('activity-add')}`);
    await driver.waitForElement('[data-activity-id]');
    const row = `[data-activity-id="${await lastId(session, '[data-activity-id]', 'data-activity-id')}"]`;
    await setValue(session, `${row} ${t('activity-duration')}`, '2');
    await setValue(session, `${row} ${t('activity-responsible')}`, id['tiler']!);

    // The tiler's quote: 95 % when the stage closes, and 5 % held back as retention.
    await byStage(session);
    const money = `[data-money-stage="${id['stage']}"]`;
    await setValue(session, `${money} ${t('commitment-add-label')}`, "Tiler's quote");
    await setValue(session, `${money} ${t('commitment-add-person')}`, id['tiler']!);
    await setValue(session, `${money} ${t('commitment-add-amount')}`, '2000.00');
    await click(session, `${money} ${t('commitment-add')}`);
    await driver.waitForElement(`${money} [data-commitment-id]`);
    id['quote'] = await lastId(session, `${money} [data-commitment-id]`, 'data-commitment-id');
    await setValue(session, `${commitment()} ${t('milestone-add-label')}`, 'At the stage’s close');
    await setValue(session, `${commitment()} ${t('milestone-add-share')}`, '95');
    await setValue(session, `${commitment()} ${t('milestone-add-trigger')}`, 'stage_closed');
    await click(session, `${commitment()} ${t('milestone-add')}`);
    await driver.waitForElement(`${commitment()} [data-milestone-id]`);
    await click(session, `${commitment()} ${t('milestone-retention')}`);
    await driver.waitFor('the retention', async () =>
      (await driver.findAll(`${commitment()} [data-milestone-id]`)).length === 2 ? true : null,
    );
  }, 240_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('two snags on the tiler, each with a photo', async () => {
    const { driver } = session;
    for (const [title, photo] of [
      ['Cracked tile behind the basin', 'crack'],
      ['Grout missing by the shower', 'grout'],
    ] as const) {
      await planTab(session, 'snags');
      const before = (await driver.findAll('[data-snag-id]')).length;
      await click(session, t('snag-raise'));
      await setValue(session, t('snag-title'), title);
      await setValue(session, t('snag-stage'), id['stage']!);
      await setValue(session, t('snag-person'), id['tiler']!);
      await setValue(session, t('snag-photo-path'), file(photo));
      await click(session, t('snag-photo-add'));
      await driver.waitForElement('[data-pending-photo]');
      await click(session, t('snag-save'));
      await driver.waitFor(`snag "${title}"`, async () =>
        (await driver.findAll('[data-snag-id]')).length === before + 1 ? true : null,
      );
    }
    id['crack'] = await driver.execute<string>(
      `return Array.from(document.querySelectorAll('[data-snag-id]')).find((e) => e.innerText.includes('Cracked tile'))?.getAttribute('data-snag-id') ?? ''`,
    );
    id['grout'] = await driver.execute<string>(
      `return Array.from(document.querySelectorAll('[data-snag-id]')).find((e) => e.innerText.includes('Grout missing'))?.getAttribute('data-snag-id') ?? ''`,
    );
    expect(id['crack']).not.toBe('');
    expect(id['grout']).not.toBe('');
    await session.screenshot('e4-snags-open-en');
  });

  it('the stage closes, and the retention is still held: the tiler’s snags are open', async () => {
    const { driver } = session;
    await planTab(session, 'gates');
    const stage = `[data-stage-id="${id['stage']}"]`;
    await click(session, `${stage} ${t('stage-start')}`);
    await confirm(session);
    await driver.waitFor('started', async () =>
      /started/i.test(await text(session, `${stage} ${t('stage-state')}`)) ? true : null,
    );
    await click(session, `${stage} ${t('stage-close')}`);
    await confirm(session);
    await driver.waitFor('closed', async () =>
      /closed/i.test(await text(session, `${stage} ${t('stage-state')}`)) ? true : null,
    );
    await byStage(session);
    const held = await retention();
    expect(held.startsWith('true|')).toBe(true);
    expect(held).toMatch(/held until its snags are fixed \(2 open\)/i);
  });

  it('the handover book says what is still to fix', async () => {
    await go(session, 'reports');
    const book = path.join(parent, 'book-open.pdf');
    await setValue(session, t('handover-path'), book);
    await click(session, t('handover-write'));
    await session.driver.waitFor('the book written', async () => {
      const done = await session.driver.findAll(t('handover-done'));
      return done.length > 0 && (await done[0]!.text()).includes('book-open.pdf') ? true : null;
    });
    const words = pdfText(readFileSync(book));
    expect(words).toMatch(/Still to fix/);
    expect(words).toContain('Cracked tile behind the basin');
  });

  it('a fix needs its photo; with it, the snag is fixed — still held, one is open', async () => {
    const { driver } = session;
    await planTab(session, 'snags');
    await click(session, `[data-snag-id="${id['crack']}"] ${t('snag-fix')}`);
    await click(session, t('snag-confirm'));
    expect(await text(session, t('snag-close-problem'))).toMatch(/photo/i);
    await setValue(session, t('snag-fix-photo-path'), file('fixed'));
    await click(session, t('snag-fix-photo-add'));
    await click(session, t('snag-confirm'));
    await driver.waitFor('fixed', async () =>
      (await driver.execute<string>(
        `return document.querySelector('[data-snag-id="${id['crack']}"]')?.getAttribute('data-state') ?? ''`,
      )) === 'fixed'
        ? true
        : null,
    );
    await byStage(session);
    expect(await retention()).toMatch(/\(1 open\)/);
  });

  it('a snag raised by mistake is withdrawn with a reason — and the retention is earned', async () => {
    const { driver } = session;
    await planTab(session, 'snags');
    await click(session, `[data-snag-id="${id['grout']}"] ${t('snag-withdraw')}`);
    await click(session, t('snag-confirm'));
    expect(await text(session, t('snag-close-problem'))).not.toBe('');
    await setValue(session, t('snag-note'), 'The grout was there; the light was poor.');
    await click(session, t('snag-confirm'));
    await driver.waitFor('withdrawn', async () =>
      (await driver.execute<string>(
        `return document.querySelector('[data-snag-id="${id['grout']}"]')?.getAttribute('data-state') ?? ''`,
      )) === 'withdrawn'
        ? true
        : null,
    );
    await session.screenshot('e4-snags-closed-en');
    await byStage(session);
    const earned = await retention();
    expect(earned.startsWith('true|')).toBe(false);
    expect(earned).toMatch(/earned/i);
  });

  it('the handover book prints the fixed snag with both photos, and the gap is gone', async () => {
    await go(session, 'reports');
    const book = path.join(parent, 'book-closed.pdf');
    await setValue(session, t('handover-path'), book);
    await click(session, t('handover-write'));
    await session.driver.waitFor('the book written', async () => {
      const done = await session.driver.findAll(t('handover-done'));
      return done.length > 0 && (await done[0]!.text()).includes('book-closed.pdf') ? true : null;
    });
    const raw = readFileSync(book);
    const words = pdfText(raw);
    expect(words).not.toMatch(/Still to fix/);
    expect(words).toContain('Cracked tile behind the basin');
    expect(words).not.toContain('Grout missing by the shower');
    expect(pdfImageCount(raw)).toBeGreaterThanOrEqual(2);
  });

  it('the front door says nothing is left to fix; in Portuguese, Pendências', async () => {
    await go(session, 'dashboard');
    expect(await text(session, t('snags-open-value'))).toMatch(/^0\b/);
    await chooseLanguage(session, 'Português (Brasil)');
    // The light theme too: these screens are captured and looked at in both themes.
    await chooseTheme(session, 'Português (Brasil)', 'light');
    await planTab(session, 'snags');
    expect(await text(session, '[data-testid="plan-tabs"] [data-tab="snags"]')).toBe('Pendências');
    await session.screenshot('e4-snags-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
