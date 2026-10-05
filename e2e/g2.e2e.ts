import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, chooseTheme, go, startSession, type Session } from './session';

/**
 * Slice G2's proof of done, against the real binary:
 *
 *   what to order this week — a material an activity needs, with how long the supplier takes, gets
 *   the day to order by from when the activity starts as things stand; the Dashboard says what is
 *   late to order; ordering and delivery are facts on record; an order that falls through is to
 *   order again; the meeting's agenda lists the purchase.
 */

const WORK = 'Kitchen, synthetic purchases';

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

const pad = (n: number) => String(n).padStart(2, '0');
function day(offset = 0): string {
  const now = new Date();
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

async function purchasesTab(session: Session): Promise<void> {
  await go(session, 'plan');
  await click(session, '[data-testid="plan-tabs"] [data-tab="purchases"]');
}

async function purchaseId(session: Session, name: string): Promise<string> {
  return session.driver.execute<string>(
    `return Array.from(document.querySelectorAll('[data-purchase-id]')).find((e) => e.innerText.includes(${JSON.stringify(name)}))?.getAttribute('data-purchase-id') ?? ''`,
  );
}

async function state(session: Session, id: string): Promise<string> {
  return session.driver.execute<string>(
    `return document.querySelector('[data-purchase-id="${id}"]')?.getAttribute('data-state') ?? ''`,
  );
}

/** Mark a purchase's event — ordered, delivered or cancelled — on a day. */
async function mark(
  session: Session,
  id: string,
  button: 'purchase-ordered' | 'purchase-delivered' | 'purchase-cancel',
  on: string,
  expected: string,
): Promise<void> {
  await purchasesTab(session);
  await click(session, `[data-purchase-id="${id}"] ${t(button)}`);
  await setValue(session, t('purchase-event-day'), on);
  await click(session, t('purchase-event-confirm'));
  await session.driver.waitFor(`${id} ${expected}`, async () =>
    (await state(session, id)) === expected ? true : null,
  );
}

describe('G2 — what to order this week: lead times against the forecast, orders as facts', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-g2-'));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'kitchen'));
    // The work starts in two weeks: the worktop, three weeks away, is already late to order.
    await setValue(session, t('work-start'), day(14));
    await click(session, t('work-create'));
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    await setValue(session, t('stage-add-name'), 'Fit-out');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    id['stage'] = await lastId(session, '[data-stage-id]', 'data-stage-id');
    const stage = `[data-stage-id="${id['stage']}"]`;
    await setValue(session, `${stage} ${t('activity-add-name')}`, 'Fit the worktop');
    await click(session, `${stage} ${t('activity-add')}`);
    await driver.waitForElement('[data-activity-id]');
    id['activity'] = await lastId(session, '[data-activity-id]', 'data-activity-id');
    await setValue(
      session,
      `[data-activity-id="${id['activity']}"] ${t('activity-duration')}`,
      '3',
    );

    for (const [name, lead] of [
      ['Worktop', '21'],
      ['Cabinet handles', '3'],
    ] as const) {
      await purchasesTab(session);
      const before = (await driver.findAll('[data-purchase-id]')).length;
      await click(session, t('purchase-add'));
      await setValue(session, t('purchase-name'), name);
      await setValue(session, t('purchase-stage'), id['stage']!);
      await setValue(session, t('purchase-activity'), id['activity']!);
      await setValue(session, t('purchase-lead'), lead);
      await click(session, t('purchase-save'));
      await driver.waitFor(`purchase ${name}`, async () =>
        (await driver.findAll('[data-purchase-id]')).length === before + 1 ? true : null,
      );
    }
    id['worktop'] = await purchaseId(session, 'Worktop');
    id['handles'] = await purchaseId(session, 'Cabinet handles');
  }, 240_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('the worktop is late to order; the handles are not due this week', async () => {
    await purchasesTab(session);
    expect(await state(session, id['worktop']!)).toBe('to-order');
    expect(
      await session.driver.execute<string>(
        `return document.querySelector('[data-purchase-id="${id['worktop']}"]')?.getAttribute('data-late') ?? ''`,
      ),
    ).toBe('true');
    expect(await text(session, `[data-purchase-id="${id['worktop']}"]`)).toMatch(/order by/i);
    await session.screenshot('g2-purchases-en');
    await go(session, 'dashboard');
    await session.driver.waitForElement(t('dashboard-purchases'));
    expect(await text(session, t('purchases-late-value'))).toMatch(/^1\b/);
    expect(await text(session, t('purchases-week-value'))).toMatch(/^1\b/);
  });

  it('the meeting’s agenda lists what to order', async () => {
    await go(session, 'dashboard');
    await click(session, t('meeting-open'));
    await session.driver.waitForElement(t('meeting-agenda'));
    expect(await text(session, t('meeting-agenda'))).toContain('Worktop');
    await click(session, t('meeting-leave'));
  });

  it('ordered today, the worktop arrives after it is needed — and the row says so', async () => {
    await mark(session, id['worktop']!, 'purchase-ordered', day(0), 'ordered');
    expect(await text(session, `[data-purchase-id="${id['worktop']}"]`)).toMatch(
      /after it is needed/i,
    );
    await go(session, 'dashboard');
    expect(await text(session, t('purchases-late-value'))).toMatch(/^0\b/);
  });

  it('delivered, it is off the lists; an order that falls through is to order again', async () => {
    await mark(session, id['worktop']!, 'purchase-delivered', day(0), 'delivered');
    await mark(session, id['handles']!, 'purchase-ordered', day(0), 'ordered');
    await mark(session, id['handles']!, 'purchase-cancel', day(0), 'to-order');
    await session.screenshot('g2-purchases-later-en');
  });

  it('says it in Portuguese: Compras', async () => {
    await chooseLanguage(session, 'Português (Brasil)');
    // The light theme too: these screens are captured and looked at in both themes.
    await chooseTheme(session, 'Português (Brasil)', 'light');
    await purchasesTab(session);
    expect(await text(session, '[data-testid="plan-tabs"] [data-tab="purchases"]')).toBe('Compras');
    await session.screenshot('g2-purchases-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
