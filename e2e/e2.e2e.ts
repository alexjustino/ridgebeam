import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, chooseTheme, createWork, go, startSession, type Session } from './session';

/**
 * Slice E2's proof of done, against the real binary:
 *
 *   where the money comes from is written down — each fund expected on a day, each sum received
 *   recorded as a fact — and the work says, week by week from the schedule, whether the money lasts:
 *   the week it runs short and by how much, or what is left at the end; a fund that is late is listed
 *   and not counted; the front door and the owner's snapshot say the same sentence.
 */

const WORK = 'Bathroom, synthetic money';

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

/** This machine's day, offset by whole days, as YYYY-MM-DD — the host's "today" is local too. */
function day(offset = 0): string {
  const now = new Date();
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

async function fundingTab(session: Session): Promise<void> {
  await go(session, 'money');
  await click(session, '[data-testid="money-tabs"] [data-tab="funding"]');
}

async function addFund(session: Session, label: string, amount: string, expected: string) {
  await fundingTab(session);
  const before = (await session.driver.findAll('[data-funding-id]')).length;
  await setValue(session, t('funding-label'), label);
  await setValue(session, t('funding-amount'), amount);
  await setValue(session, t('funding-expected'), expected);
  await click(session, t('funding-add'));
  await session.driver.waitFor(`${label} recorded`, async () =>
    (await session.driver.findAll('[data-funding-id]')).length > before ? true : null,
  );
  return lastId(session, '[data-funding-id]', 'data-funding-id');
}

async function sentence(session: Session): Promise<string> {
  await go(session, 'money');
  return text(session, t('runway-sentence'));
}

describe('E2 — will the money last: funds as plan, receipts as facts, a weekly projection', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-e2-'));
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
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    await setValue(session, t('stage-add-name'), 'Tiling');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    const stage = `[data-stage-id="${await lastId(session, '[data-stage-id]', 'data-stage-id')}"]`;
    await setValue(session, `${stage} ${t('activity-add-name')}`, 'Lay the floor tiles');
    await click(session, `${stage} ${t('activity-add')}`);
    await driver.waitForElement('[data-activity-id]');
    const row = `[data-activity-id="${await lastId(session, '[data-activity-id]', 'data-activity-id')}"]`;
    await setValue(session, `${row} ${t('activity-duration')}`, '10');
    await setValue(session, `${row} ${t('cost-line-add-label')}`, 'Tiles and labour');
    await setValue(session, `${row} ${t('cost-line-add-amount')}`, '2000.00');
    await click(session, `${row} ${t('cost-line-add')}`);
    await driver.waitForElement(`${row} [data-cost-line-id]`);
  }, 180_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('with money planned and no fund written down, the plan says so', async () => {
    expect(await sentence(session)).not.toMatch(/lasts to the end/);
  });

  it('a fund smaller than the work: the money runs short, in a week, by an amount', async () => {
    id['savings'] = await addFund(session, 'Savings', '500.00', day(0));
    const said = await sentence(session);
    expect(said).toMatch(/Money runs short in the week of .+ — \$[\d,.]+ short\./);
    expect(
      await session.driver.execute<number>(
        `return document.querySelectorAll('[data-testid="runway-week"][data-short]').length`,
      ),
    ).toBeGreaterThan(0);
    await session.driver.execute(
      `document.querySelector('[data-testid="runway-card"]').scrollIntoView({ block: 'center' })`,
    );
    // Bringing a tall card into view scrolls the content, never the window: the document is as tall
    // as the window (found on E2's screenshots — visually hidden labels in an unpositioned scroll
    // region stretched the document, and the whole window lifted).
    expect(
      await session.driver.execute<number[]>(
        `return [window.scrollY, document.documentElement.scrollHeight - innerHeight]`,
      ),
    ).toEqual([0, 0]);
    await session.screenshot('e2-short-en');
  });

  it('money received is recorded as a fact, on a day that has happened', async () => {
    const { driver } = session;
    await fundingTab(session);
    await click(session, `[data-funding-id="${id['savings']}"] ${t('funding-receive')}`);
    await setValue(session, t('receipt-amount'), '500.00');
    await setValue(session, t('receipt-day'), day(0));
    await click(session, t('receipt-confirm'));
    await driver.waitForElement('[data-receipt-seq="1"]');
    expect(
      await driver.execute<string>(
        `return document.querySelector('[data-funding-id="${id['savings']}"]').getAttribute('data-state')`,
      ),
    ).toBe('received');
  });

  it('a fund that should have arrived and did not is listed as late, and not counted', async () => {
    await addFund(session, 'Grant', '5000.00', day(-3));
    const said = await sentence(session);
    expect(said).toMatch(/runs short/);
    expect(await text(session, t('runway-late-value'))).toMatch(/^1\b/);
  });

  it('a fund that covers the gap: the money lasts to the end, with what is left', async () => {
    await addFund(session, 'Loan, first tranche', '2000.00', day(0));
    expect(await sentence(session)).toMatch(
      /The money lasts to the end, with \$[\d,.]+ to spare\./,
    );
    await session.screenshot('e2-lasts-en');
    await go(session, 'dashboard');
    expect(await text(session, t('dashboard-runway-value'))).toMatch(/\$/);
  });

  it('the owner’s snapshot carries the same sentence', async () => {
    await go(session, 'reports');
    const file = path.join(parent, 'bathroom.html');
    await setValue(session, t('snapshot-path'), file);
    await click(session, t('snapshot-write'));
    await session.driver.waitFor('the snapshot written', async () => {
      const done = await session.driver.findAll(t('snapshot-done'));
      return done.length > 0 && (await done[0]!.text()).includes('bathroom.html') ? true : null;
    });
    expect(readFileSync(file, 'utf8')).toMatch(/lasts to the end/);
  });

  it('says it in Portuguese: O dinheiro vai dar?', async () => {
    await chooseLanguage(session, 'Português (Brasil)');
    // The light theme too: these screens are captured and looked at in both themes.
    await chooseTheme(session, 'Português (Brasil)', 'light');
    await go(session, 'money');
    expect(await text(session, t('runway-card'))).toMatch(/O dinheiro vai dar\?/);
    expect(await text(session, t('runway-sentence'))).toMatch(/O dinheiro dá até o fim/);
    await session.screenshot('e2-lasts-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
