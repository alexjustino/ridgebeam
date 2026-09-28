import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type Session } from './session';

/**
 * Slice F6's proof of done, against the real binary:
 *
 *   planned, committed and paid per stage and trade; the payments ledger with receipts; every
 *   figure opens onto its rows; paid over committed is flagged; the S-curve of planned against
 *   paid.
 *
 * Amounts are typed in dollars and kept in cents; the screen formats them for the language.
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
/** Digits only, so "$2,000.00", "US$ 2.000,00" and "2 000,00" all compare alike. */
const digits = (s: string) => s.replace(/[^0-9]/g, '');

async function tab(session: Session, page: 'plan' | 'money', name: string): Promise<void> {
  await go(session, page);
  await click(
    session,
    `[data-testid="${page === 'plan' ? 'plan-tabs' : 'money-tabs'}"] [data-tab="${name}"]`,
  );
}

async function lastId(session: Session, selector: string, attr: string): Promise<string> {
  const ids = await session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((e) => e.getAttribute(${JSON.stringify(attr)}))`,
  );
  return ids[ids.length - 1]!;
}

describe('F6 — money: planned, committed and paid, with every figure carrying its rows', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-f6-'));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'bathroom'));
    await click(session, t('work-create'));
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await tab(session, 'plan', 'breakdown');
    await setValue(session, t('person-add-name'), 'A. Tiler');
    await click(session, t('person-add'));
    await driver.waitForElement('[data-person-id]');
    id['tiler'] = await lastId(session, '[data-person-id]', 'data-person-id');
    await setValue(session, `[data-person-id="${id['tiler']}"] ${t('person-trade')}`, 'tiler');
    await setValue(session, t('stage-add-name'), 'Tiling');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    id['tiling'] = await lastId(session, '[data-stage-id]', 'data-stage-id');
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

  it('cost lines on the activity and the stage make the planned figure, and readiness knows it', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    expect(await text(session, `${t('readiness-rules')} [data-rule-id="stage.money"]`)).toMatch(
      /0 of 1/,
    );
    await tab(session, 'plan', 'breakdown');
    const activity = `[data-activity-id="${id['lay']}"]`;
    await setValue(session, `${activity} ${t('cost-line-add-label')}`, 'Tiles');
    await setValue(session, `${activity} ${t('cost-line-add-amount')}`, '1200.00');
    await click(session, `${activity} ${t('cost-line-add')}`);
    await driver.waitForElement(`${activity} [data-cost-line-id]`);
    const stage = `[data-stage-id="${id['tiling']}"]`;
    await setValue(
      session,
      `${stage} > * ${t('cost-line-add-label')}, ${stage} ${t('stage-cost-line-add-label')}`,
      'Labour',
    );
    await setValue(session, `${stage} ${t('stage-cost-line-add-amount')}`, '800.00');
    await click(session, `${stage} ${t('stage-cost-line-add')}`);
    await driver.waitFor('two cost lines', async () =>
      (await driver.findAll(`${stage} [data-cost-line-id]`)).length === 2 ? true : null,
    );
    await tab(session, 'money', 'by-stage');
    const row = `[data-money-stage="${id['tiling']}"]`;
    expect(digits(await text(session, `${row} ${t('planned-value')}`))).toBe('200000');
    await click(session, `${row} ${t('planned-value')}`);
    // Only the rows the planned figure opened: every cell keeps its own list, closed.
    const visible = await driver.execute<number>(
      `return Array.from(document.querySelectorAll('${row} [data-testid="money-row"]')).filter((e) => e.offsetParent !== null).length`,
    );
    expect(visible).toBe(2);
    await go(session, 'dashboard');
    expect(digits(await text(session, t('money-planned-value')))).toBe('200000');
    expect(await text(session, `${t('readiness-rules')} [data-rule-id="stage.money"]`)).toMatch(
      /1 of 1/,
    );
    await session.screenshot('f6-dashboard-en');
  });

  it('a commitment makes the committed figure; payments make paid, and over committed is flagged', async () => {
    const { driver } = session;
    await tab(session, 'money', 'by-stage');
    const row = `[data-money-stage="${id['tiling']}"]`;
    await setValue(session, `${row} ${t('commitment-add-label')}`, "Tiler's quote");
    await setValue(session, `${row} ${t('commitment-add-person')}`, id['tiler']!);
    await setValue(session, `${row} ${t('commitment-add-amount')}`, '1500.00');
    await click(session, `${row} ${t('commitment-add')}`);
    await driver.waitFor('committed', async () =>
      digits(await text(session, `${row} ${t('committed-value')}`)) === '150000' ? true : null,
    );

    await tab(session, 'money', 'ledger');
    await setValue(session, t('payment-stage'), id['tiling']!);
    await setValue(session, t('payment-person'), id['tiler']!);
    await setValue(session, t('payment-amount'), '0');
    await setValue(session, t('payment-what'), 'Nothing');
    await click(session, t('payment-save'));
    expect(await text(session, t('payment-problem'))).not.toBe('');

    await setValue(session, t('payment-amount'), '1000.00');
    await setValue(session, t('payment-what'), 'First half');
    await click(session, t('payment-save'));
    await driver.waitForElement('[data-payment-seq="1"]');
    await tab(session, 'money', 'by-stage');
    expect(digits(await text(session, `${row} ${t('paid-value')}`))).toBe('100000');
    expect(digits(await text(session, `${row} ${t('remaining-value')}`))).toBe('100000');
    expect(await text(session, `${row} ${t('variance-value')}`)).toMatch(/500/);
    expect(await driver.findAll(`${row} ${t('over-committed')}`)).toHaveLength(0);

    await tab(session, 'money', 'ledger');
    await setValue(session, t('payment-stage'), id['tiling']!);
    await setValue(session, t('payment-person'), id['tiler']!);
    await setValue(session, t('payment-amount'), '700.00');
    await setValue(session, t('payment-what'), 'Second half, and more');
    await click(session, t('payment-save'));
    await driver.waitForElement('[data-payment-seq="2"]');
    await tab(session, 'money', 'by-stage');
    expect(digits(await text(session, `${row} ${t('paid-value')}`))).toBe('170000');
    await driver.waitForElement(`${row} ${t('over-committed')}`);
    await go(session, 'dashboard');
    expect(await text(session, t('over-committed-value'))).toMatch(/^1\b/);
    await session.screenshot('f6-dashboard-over-committed-en');
  });

  it('a payment is never edited: a reversal is a new payment, and a second reversal is refused', async () => {
    const { driver } = session;
    await tab(session, 'money', 'ledger');
    const editable = await driver.execute<number>(
      `return document.querySelectorAll('[data-payment-seq] [data-testid="payment-edit"]').length`,
    );
    expect(editable).toBe(0);
    await click(session, `[data-payment-seq="2"] ${t('payment-reverse')}`);
    await setValue(session, t('reversal-note'), 'Paid twice by mistake.');
    await click(session, t('reversal-confirm'));
    await driver.waitForElement('[data-payment-seq="3"]');
    expect(await text(session, '[data-payment-seq="3"]')).toMatch(/700/);
    // The second reversal of the same payment is refused (the button is gone or the host says no).
    const again = await driver.findAll(`[data-payment-seq="2"] ${t('payment-reverse')}`);
    if (again.length > 0) {
      await again[0]!.click();
      await setValue(session, t('reversal-note'), 'Again?');
      await click(session, t('reversal-confirm'));
      expect(await text(session, t('payment-problem'))).not.toBe('');
    }
    await tab(session, 'money', 'by-stage');
    const row = `[data-money-stage="${id['tiling']}"]`;
    expect(digits(await text(session, `${row} ${t('paid-value')}`))).toBe('100000');
    expect(await driver.findAll(`${row} ${t('over-committed')}`)).toHaveLength(0);
    await session.screenshot('f6-by-stage-en');
  });

  it('by trade shows the same money under the tiler, and the S-curve ends at the totals', async () => {
    const { driver } = session;
    await tab(session, 'money', 'by-trade');
    const trade = await driver.waitForElement('[data-money-trade]');
    expect((await trade.text()).toLowerCase()).toContain('tiler');
    expect(digits(await text(session, `[data-money-trade] ${t('paid-value')}`))).toBe('100000');
    await session.screenshot('f6-by-trade-en');
    await tab(session, 'money', 'by-stage');
    await driver.waitForElement(t('s-curve'));
    const rows = await driver.findAll('[data-s-curve-row]');
    expect(rows.length).toBeGreaterThan(0);
    const last = await rows[rows.length - 1]!.text();
    expect(digits(last)).toContain('200000');
    expect(digits(last)).toContain('100000');
  });

  it('says it in Portuguese, with the money formatted for the language', async () => {
    const { driver } = session;
    await chooseLanguage(session, 'Português (Brasil)');
    const rail = await driver.find('nav[data-rail] button[data-destination="money"]');
    expect((await rail.text()).trim()).toBe('Dinheiro');
    await tab(session, 'money', 'by-stage');
    const planned = await text(
      session,
      `[data-money-stage="${id['tiling']}"] ${t('planned-value')}`,
    );
    expect(planned).toMatch(/2\.000,00/);
    await session.screenshot('f6-by-stage-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
