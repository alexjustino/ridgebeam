import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, chooseTheme, createWork, go, startSession, type Session } from './session';

/**
 * Slice E1's proof of done, against the real binary:
 *
 *   after the plan is approved, nothing changes without a price and a date — a change order is
 *   raised on record with who asked, what changes and what it costs; what it does to the finish is
 *   computed by the schedule before anybody decides; an approval opens the replanning with the
 *   change already in the plan; a decline changes nothing; the tally says how much the work grew.
 */

const WORK = 'Kitchen, synthetic changes';

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

async function changesTab(session: Session): Promise<void> {
  await go(session, 'plan');
  await click(session, '[data-testid="plan-tabs"] [data-tab="changes"]');
}

/** Fill the raise form's common fields; effects are added by the caller. */
async function raise(
  session: Session,
  fields: { title: string; askedBy: 'owner' | 'person' | 'other'; person?: string; cost?: string },
): Promise<void> {
  await changesTab(session);
  await click(session, t('change-raise'));
  await setValue(session, t('change-title'), fields.title);
  await click(session, `${t('change-asked-by')} [data-value="${fields.askedBy}"]`);
  if (fields.person) await setValue(session, t('change-person'), fields.person);
  if (fields.cost !== undefined) await setValue(session, t('change-cost'), fields.cost);
}

describe('E1 — change orders: nothing changes without a price and a date', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-e1-'));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'kitchen'));
    await createWork(session);
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    await setValue(session, t('person-add-name'), 'G. Electrician');
    await click(session, t('person-add'));
    await driver.waitForElement('[data-person-id]');
    id['electrician'] = await lastId(session, '[data-person-id]', 'data-person-id');
    await setValue(session, t('stage-add-name'), 'Electrics');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    id['stage'] = await lastId(session, '[data-stage-id]', 'data-stage-id');
    const stage = `[data-stage-id="${id['stage']}"]`;
    await setValue(session, `${stage} ${t('activity-add-name')}`, 'Run the new circuit');
    await click(session, `${stage} ${t('activity-add')}`);
    await driver.waitForElement('[data-activity-id]');
    id['circuit'] = await lastId(session, '[data-activity-id]', 'data-activity-id');
    const row = `[data-activity-id="${id['circuit']}"]`;
    await setValue(session, `${row} ${t('activity-duration')}`, '3');
    await setValue(session, `${row} ${t('activity-responsible')}`, id['electrician']!);
  }, 180_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('before the plan is approved, a change cannot be raised — the plan is still being written', async () => {
    await changesTab(session);
    const disabled = await session.driver.execute<boolean>(
      `const b = document.querySelector('[data-testid="change-raise"]');
       return b === null || b.disabled || b.getAttribute('aria-disabled') === 'true'`,
    );
    expect(disabled).toBe(true);
    await go(session, 'schedule');
    await click(session, t('plan-approve'));
    await session.driver.waitForElement(t('baseline-number'));
  });

  it('a change is raised with its price, and what it does to the finish is computed first', async () => {
    const { driver } = session;
    await raise(session, {
      title: 'An extra socket by the window',
      askedBy: 'owner',
      cost: '300.00',
    });
    await click(session, t('change-effect-add'));
    await setValue(session, t('change-effect-kind'), 'add');
    await setValue(session, t('change-effect-name'), 'Fit the extra socket');
    await setValue(session, t('change-effect-days'), '2');
    await setValue(session, t('change-effect-after'), id['circuit']!);
    await driver.waitFor('the impact', async () =>
      /2 working days later/i.test(await text(session, t('change-impact'))) ? true : null,
    );
    await session.screenshot('e1-raise-en');
    await click(session, t('change-save'));
    await driver.waitForElement('[data-change-id]');
    id['co1'] = await lastId(session, '[data-change-id]', 'data-change-id');
  });

  it('approving it opens the replanning with the change already in the plan, and its money', async () => {
    const { driver } = session;
    const change = `[data-change-id="${id['co1']}"]`;
    await click(session, `${change} ${t('change-approve')}`);
    expect(await text(session, t('change-impact'))).toMatch(/2 working days later/i);
    await click(session, t('change-confirm'));
    await go(session, 'schedule');
    await driver.waitForElement(t('replanning-open'));
    expect(await text(session, t('replanning-open'))).toMatch(/Change order #1/);
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    const plan = await driver.execute<string>(
      `return document.querySelector('main')?.innerText ?? ''`,
    );
    const fields = await driver.execute<string>(
      `return Array.from(document.querySelectorAll('input')).map((e) => e.value).join(' | ')`,
    );
    expect(`${plan} ${fields}`).toContain('Fit the extra socket');
    expect(`${plan} ${fields}`).toMatch(/Change order #1/);
    await go(session, 'schedule');
    await click(session, t('baseline-take'));
    await driver.waitFor('baseline 2', async () =>
      (await text(session, t('baseline-number'))) === '2' ? true : null,
    );
  });

  it('a change somebody else asked for can be declined, and the plan does not move', async () => {
    const { driver } = session;
    await raise(session, {
      title: 'Move the panel',
      askedBy: 'person',
      person: id['electrician']!,
      cost: '900.00',
    });
    await click(session, t('change-save'));
    await driver.waitFor('the second change', async () =>
      (await driver.findAll('[data-change-id]')).length === 2 ? true : null,
    );
    const second = await driver.execute<string>(
      `return Array.from(document.querySelectorAll('[data-change-id]')).map((e) => e.getAttribute('data-change-id')).find((v) => v !== ${JSON.stringify(id['co1'])})`,
    );
    await click(session, `[data-change-id="${second}"] ${t('change-decline')}`);
    await setValue(session, t('change-note'), 'Not this time.');
    await click(session, t('change-confirm'));
    await go(session, 'schedule');
    expect(await driver.findAll(t('replanning-open'))).toHaveLength(0);
  });

  it('a third change waits; the front door says how much the work grew, and what waits', async () => {
    const { driver } = session;
    await raise(session, { title: 'Dimmer in the hall', askedBy: 'other', cost: '80.00' });
    await setValue(session, t('change-other-name'), 'H. Neighbour');
    await click(session, t('change-save'));
    await driver.waitFor('the third change', async () =>
      (await driver.findAll('[data-change-id]')).length === 3 ? true : null,
    );
    await session.screenshot('e1-changes-en');
    await go(session, 'dashboard');
    await driver.waitForElement(t('dashboard-changes'));
    expect(await text(session, t('changes-cost-value'))).toContain('300');
    expect(await text(session, t('changes-days-value'))).toMatch(/^\+2\b/);
    expect(await text(session, t('changes-waiting-value'))).toMatch(/^1\b/);
    await driver.execute(
      `document.querySelector('[data-testid="dashboard-changes"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('e1-dashboard-en');
  });

  it('the owner’s snapshot names the change waiting for a decision', async () => {
    await go(session, 'reports');
    const file = path.join(parent, 'kitchen.html');
    await setValue(session, t('snapshot-path'), file);
    await click(session, t('snapshot-write'));
    await session.driver.waitFor('the snapshot written', async () => {
      const done = await session.driver.findAll(t('snapshot-done'));
      return done.length > 0 && (await done[0]!.text()).includes('kitchen.html') ? true : null;
    });
    const html = readFileSync(file, 'utf8');
    expect(html).toContain('Dimmer in the hall');
  });

  it('says it in Portuguese: aditivo', async () => {
    await chooseLanguage(session, 'Português (Brasil)');
    // The light theme too: these screens are captured and looked at in both themes.
    await chooseTheme(session, 'Português (Brasil)', 'light');
    await changesTab(session);
    const page = await session.driver.execute<string>(
      `return document.querySelector('main')?.innerText ?? ''`,
    );
    expect(page.toLowerCase()).toContain('aditivo');
    await session.screenshot('e1-changes-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
