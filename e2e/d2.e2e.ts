import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type Session } from './session';

/**
 * Slice D2's proof of done, against the real binary:
 *
 *   a commitment carries a payment plan whose milestones are earned only by facts of the work;
 *   earned, paid, due now and paid ahead are figures with rows; the payment form warns BEFORE a
 *   payment that would put the owner ahead of the work, and still lets the person pay.
 *
 * The tiler's quote is 1 000.00: 30 % as an advance, 40 % when "Lay the tiles" is finished, 30 %
 * when the stage closes.
 */

const WORK = 'Floor, synthetic payment plan';

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
const digits = (s: string) => s.replace(/[^0-9]/g, '');

async function lastId(session: Session, selector: string, attr: string): Promise<string> {
  const ids = await session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((e) => e.getAttribute(${JSON.stringify(attr)}))`,
  );
  return ids[ids.length - 1]!;
}

async function more(session: Session): Promise<void> {
  const open = await session.driver.execute<boolean>(
    `return document.querySelector('[data-testid="entry-note"]') !== null`,
  );
  if (!open) await click(session, t('entry-more'));
  await session.driver.waitForElement(t('entry-note'));
}

async function byStage(session: Session): Promise<void> {
  await go(session, 'money');
  await click(session, '[data-testid="money-tabs"] [data-tab="by-stage"]');
}

async function ledger(session: Session): Promise<void> {
  await go(session, 'money');
  await click(session, '[data-testid="money-tabs"] [data-tab="ledger"]');
}

describe('D2 — a payment plan earned by facts, and a warning before paying ahead of the work', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};
  const commitment = () => `[data-commitment-id="${id['quote']}"]`;

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-d2-'));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'floor'));
    await click(session, t('work-create'));
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    await setValue(session, t('person-add-name'), 'C. Tiler');
    await click(session, t('person-add'));
    await driver.waitForElement('[data-person-id]');
    id['tiler'] = await lastId(session, '[data-person-id]', 'data-person-id');
    await setValue(session, t('stage-add-name'), 'Tiling');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    id['stage'] = await lastId(session, '[data-stage-id]', 'data-stage-id');
    const stage = `[data-stage-id="${id['stage']}"]`;
    for (const [key, name] of [
      ['prepare', 'Prepare the floor'],
      ['lay', 'Lay the tiles'],
    ] as const) {
      const before = (await driver.findAll(`${stage} [data-activity-id]`)).length;
      await setValue(session, `${stage} ${t('activity-add-name')}`, name);
      await click(session, `${stage} ${t('activity-add')}`);
      await driver.waitFor(name, async () =>
        (await driver.findAll(`${stage} [data-activity-id]`)).length === before + 1 ? true : null,
      );
      id[key] = await lastId(session, `${stage} [data-activity-id]`, 'data-activity-id');
      await setValue(session, `[data-activity-id="${id[key]}"] ${t('activity-duration')}`, '2');
    }

    await byStage(session);
    const row = `[data-money-stage="${id['stage']}"]`;
    await setValue(session, `${row} ${t('commitment-add-label')}`, "Tiler's quote");
    await setValue(session, `${row} ${t('commitment-add-person')}`, id['tiler']!);
    await setValue(session, `${row} ${t('commitment-add-amount')}`, '1000.00');
    await click(session, `${row} ${t('commitment-add')}`);
    await driver.waitForElement(`${row} [data-commitment-id]`);
    id['quote'] = await lastId(session, `${row} [data-commitment-id]`, 'data-commitment-id');
  }, 180_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('the usual plan fills three milestones; the person replaces them with their own', async () => {
    const { driver } = session;
    await byStage(session);
    await driver.waitForElement(`${commitment()} ${t('payment-plan-usual')}`);
    await click(session, `${commitment()} ${t('payment-plan-usual')}`);
    await driver.waitFor('three milestones', async () =>
      (await driver.findAll(`${commitment()} [data-milestone-id]`)).length === 3 ? true : null,
    );
    // Replace them: an advance of 30 %, 40 % when the tiles are laid, 30 % when the stage closes.
    for (let left = 3; left > 0; left -= 1) {
      await click(session, `${commitment()} [data-milestone-id] ${t('milestone-remove')}`);
      await driver.waitFor('a milestone removed', async () =>
        (await driver.findAll(`${commitment()} [data-milestone-id]`)).length === left - 1
          ? true
          : null,
      );
    }
    await driver.waitFor('no milestones', async () =>
      (await driver.findAll(`${commitment()} [data-milestone-id]`)).length === 0 ? true : null,
    );
    const add = async (label: string, share: string, trigger: string, activity?: string) => {
      const before = (await driver.findAll(`${commitment()} [data-milestone-id]`)).length;
      await setValue(session, `${commitment()} ${t('milestone-add-label')}`, label);
      await setValue(session, `${commitment()} ${t('milestone-add-share')}`, share);
      await setValue(session, `${commitment()} ${t('milestone-add-trigger')}`, trigger);
      if (activity)
        await setValue(session, `${commitment()} ${t('milestone-add-activity')}`, activity);
      await click(session, `${commitment()} ${t('milestone-add')}`);
      await driver.waitFor(label, async () =>
        (await driver.findAll(`${commitment()} [data-milestone-id]`)).length === before + 1
          ? true
          : null,
      );
    };
    await add('Advance', '30', 'advance');
    await add('Tiles laid', '40', 'activity_finished', id['lay']);
    await add('Handover', '30', 'stage_closed');
    expect(await text(session, `${commitment()} ${t('payment-plan-sum')}`)).toMatch(/100/);
    // A plan that would add up to more than all of the commitment is refused.
    await setValue(session, `${commitment()} ${t('milestone-add-label')}`, 'Too much');
    await setValue(session, `${commitment()} ${t('milestone-add-share')}`, '10');
    await setValue(session, `${commitment()} ${t('milestone-add-trigger')}`, 'advance');
    await click(session, `${commitment()} ${t('milestone-add')}`);
    expect(await text(session, `${commitment()} ${t('milestone-problem')}`)).not.toBe('');
    expect(await driver.findAll(`${commitment()} [data-milestone-id]`)).toHaveLength(3);
    // The advance is earned the day the quote was agreed: 300.00 earned, all of it due.
    expect(digits(await text(session, `${commitment()} ${t('earned-value')}`))).toBe('30000');
    expect(digits(await text(session, `${commitment()} ${t('due-value')}`))).toBe('30000');
    await driver.execute(
      `document.querySelector('${commitment()}').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('d2-payment-plan-en');
  });

  it('paying what is earned raises nothing; a payment beyond it is warned about before it is made', async () => {
    const { driver } = session;
    const pay = async (amount: string, what: string) => {
      await setValue(session, t('payment-stage'), id['stage']!);
      await setValue(session, t('payment-person'), id['tiler']!);
      await setValue(session, t('payment-commitment'), id['quote']!);
      await setValue(session, t('payment-amount'), amount);
      await setValue(session, t('payment-what'), what);
    };
    await ledger(session);
    await pay('300.00', 'The advance');
    await driver.waitForElement(t('payment-preview'));
    expect(await driver.findAll(t('payment-ahead-warning'))).toHaveLength(0);
    await click(session, t('payment-save'));
    await driver.waitForElement('[data-payment-seq="1"]');

    await pay('500.00', 'Asked for more');
    const warning = await text(session, t('payment-ahead-warning'));
    expect(warning).toMatch(/ahead/i);
    expect(warning).toContain('Tiles laid');
    expect(digits(warning)).toContain('50000');
    await driver.execute(
      `document.querySelector('[data-testid="payment-ahead-warning"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('d2-warning-en');
    // Warned, not refused: the person decides.
    await click(session, t('payment-save'));
    await driver.waitForElement('[data-payment-seq="2"]');

    await byStage(session);
    await driver.waitForElement(`${commitment()} ${t('paid-ahead')}`);
    await go(session, 'dashboard');
    expect(await text(session, t('paid-ahead-value'))).toMatch(/^1\b/);
  });

  it('once money has moved, the payment plan is locked', async () => {
    const { driver } = session;
    await byStage(session);
    const remove = await driver.findAll(
      `${commitment()} [data-milestone-id] ${t('milestone-remove')}`,
    );
    if (remove.length > 0) {
      await remove[0]!.click();
      expect(await text(session, `${commitment()} ${t('milestone-problem')}`)).not.toBe('');
    }
    expect(await driver.findAll(`${commitment()} [data-milestone-id]`)).toHaveLength(3);
  });

  it('a fact of the work earns its milestone: the tiles laid in the diary', async () => {
    const { driver } = session;
    await go(session, 'diary');
    await driver.waitForElement(t('entry-today'));
    await click(session, t(`entry-done-${id['lay']}`));
    await click(session, t(`entry-finished-${id['lay']}`));
    await more(session);
    await setValue(session, t('entry-note'), 'The tiles are down.');
    await click(session, t('entry-save'));
    await driver.waitForElement('[data-entry-seq="1"]');

    await byStage(session);
    expect(digits(await text(session, `${commitment()} ${t('earned-value')}`))).toBe('70000');
    // Paid 800.00 against 700.00 earned: still 100.00 ahead.
    expect(digits(await text(session, `${commitment()} ${t('paid-ahead')}`))).toContain('10000');
    const states = await driver.execute<string[]>(
      `return Array.from(document.querySelectorAll('${commitment()} [data-milestone-id] [data-testid="milestone-state"]')).map((e) => e.textContent.trim())`,
    );
    expect(states.filter((state) => /earned/i.test(state))).toHaveLength(2);
  });

  it('says it in Portuguese', async () => {
    await chooseLanguage(session, 'Português (Brasil)');
    await ledger(session);
    await setValue(session, t('payment-stage'), id['stage']!);
    await setValue(session, t('payment-commitment'), id['quote']!);
    await setValue(session, t('payment-amount'), '400.00');
    expect(await text(session, t('payment-ahead-warning'))).toMatch(/à frente/i);
    await session.screenshot('d2-warning-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
