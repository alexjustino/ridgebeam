import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type Session } from './session';

/**
 * Slice F5's proof of done, against the real binary:
 *
 *   start and close checklists per stage; a stage cannot close with an unanswered item; not
 *   applicable needs a reason; checks come from the template and are edited per work; the
 *   inspection is a check with a photo.
 *
 * And the case deferred since F2: a dependency onto an activity in a closed stage is refused.
 */

const WORK = 'Roof, synthetic';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

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

async function tab(session: Session, name: 'breakdown' | 'gates' | 'checklist'): Promise<void> {
  await go(session, 'plan');
  await click(session, `[data-testid="plan-tabs"] [data-tab="${name}"]`);
}

async function lastId(session: Session, selector: string, attr: string): Promise<string> {
  const ids = await session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((e) => e.getAttribute(${JSON.stringify(attr)}))`,
  );
  return ids[ids.length - 1]!;
}

async function addStage(session: Session, name: string): Promise<string> {
  const { driver } = session;
  const before = (await driver.findAll('[data-stage-id]')).length;
  await setValue(session, t('stage-add-name'), name);
  await click(session, t('stage-add'));
  await driver.waitFor(`stage ${name}`, async () =>
    (await driver.findAll('[data-stage-id]')).length === before + 1 ? true : null,
  );
  return lastId(session, '[data-stage-id]', 'data-stage-id');
}

async function addActivity(session: Session, stageId: string, name: string, days: number) {
  const { driver } = session;
  const stage = `[data-stage-id="${stageId}"]`;
  const before = (await driver.findAll(`${stage} [data-activity-id]`)).length;
  await setValue(session, `${stage} ${t('activity-add-name')}`, name);
  await click(session, `${stage} ${t('activity-add')}`);
  await driver.waitFor(`activity ${name}`, async () =>
    (await driver.findAll(`${stage} [data-activity-id]`)).length === before + 1 ? true : null,
  );
  const id = await lastId(session, `${stage} [data-activity-id]`, 'data-activity-id');
  await setValue(session, `[data-activity-id="${id}"] ${t('activity-duration')}`, String(days));
  return id;
}

/** The check ids of one gate on the Gates tab, in order. */
async function gateItems(session: Session, stageId: string, gate: 'start' | 'close') {
  return session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll('[data-stage-id="${stageId}"] [data-gate="${gate}"] [data-check-id]')).map((e) => e.getAttribute('data-check-id'))`,
  );
}

async function answer(
  session: Session,
  checkId: string,
  which: 'yes' | 'no' | 'na',
  reason?: string,
) {
  const { driver } = session;
  const row = `[data-check-id="${checkId}"]`;
  await click(session, `${row} ${t(`check-answer-${which}`)}`);
  if (which === 'na') {
    await driver.waitForElement(t('na-reason'));
    if (reason !== undefined) await setValue(session, t('na-reason'), reason);
    await click(session, t('na-confirm'));
  }
}

describe('F5 — checks: two gates per stage, answered facts, and a closed stage that stays closed', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-f5-'));
    writeFileSync(path.join(parent, 'inspection.png'), ONE_PIXEL_PNG);
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'roof'));
    await click(session, t('work-create'));
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await tab(session, 'breakdown');
    id['tiling'] = await addStage(session, 'Tiling');
    id['lay'] = await addActivity(session, id['tiling'], 'Lay the roof tiles', 3);
  }, 180_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('a stage with no checks is what the plan does not know; the usual checks fill both gates', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    expect(await text(session, `${t('readiness-rules')} [data-rule-id="stage.checks"]`)).toMatch(
      /0 of 1/,
    );
    await tab(session, 'breakdown');
    const stage = `[data-stage-id="${id['tiling']}"]`;
    await click(session, `${stage} ${t('checks-add-defaults')}`);
    await driver.waitFor('eight checks', async () =>
      // Four start items and five close items — the fifth, since D3, the hidden-work photo.
      (await driver.findAll(`${stage} ${t('checks')} [data-check-id]`)).length === 9 ? true : null,
    );
    await go(session, 'dashboard');
    expect(await text(session, `${t('readiness-rules')} [data-rule-id="stage.checks"]`)).toMatch(
      /1 of 1/,
    );
  });

  it('the start gate holds until every item is answered, and N/A needs a reason', async () => {
    const { driver } = session;
    await tab(session, 'gates');
    const stage = `[data-stage-id="${id['tiling']}"]`;
    const start = await driver.waitForElement(`${stage} ${t('stage-start')}`);
    expect(await start.attribute('disabled')).not.toBeNull();
    expect(await text(session, `${stage} ${t('gate-holding')}`)).not.toBe('');
    const items = await gateItems(session, id['tiling']!, 'start');
    expect(items).toHaveLength(4);
    await answer(session, items[0]!, 'yes');
    await answer(session, items[1]!, 'yes');
    // Not applicable with no reason is refused; the reason is required.
    await click(session, `[data-check-id="${items[2]}"] ${t('check-answer-na')}`);
    await driver.waitForElement(t('na-reason'));
    await click(session, t('na-confirm'));
    const still = await driver.execute<boolean>(
      'return document.querySelector(\'[data-testid="na-reason"]\') !== null',
    );
    expect(still).toBe(true);
    await setValue(session, t('na-reason'), 'No materials are needed for this roof.');
    await click(session, t('na-confirm'));
    await answer(session, items[3]!, 'yes');
    await driver.waitFor('the gate open', async () =>
      (await (await driver.find(`${stage} ${t('stage-start')}`)).attribute('disabled')) === null
        ? true
        : null,
    );
    await session.screenshot('f5-gates-start-en');
    await click(session, `${stage} ${t('stage-start')}`);
    await driver.waitForElement('[role="dialog"]');
    await click(
      session,
      '[role="dialog"] button[data-confirm], [role="dialog"] [data-testid="confirm"]',
    );
    await driver.waitFor('started', async () =>
      /started/i.test(await text(session, `${stage} ${t('stage-state')}`)) ? true : null,
    );
  });

  it('a stage cannot close with an unanswered item, a "no" holds it, and the inspection carries a photo', async () => {
    const { driver } = session;
    const stage = `[data-stage-id="${id['tiling']}"]`;
    const items = await gateItems(session, id['tiling']!, 'close');
    expect(items).toHaveLength(5);
    const close = await driver.find(`${stage} ${t('stage-close')}`);
    expect(await close.attribute('disabled')).not.toBeNull();
    // The inspection, with a photo.
    await setValue(
      session,
      `[data-check-id="${items[0]}"] ${t('check-answer-photo-path')}`,
      path.join(parent, 'inspection.png'),
    );
    await click(session, `[data-check-id="${items[0]}"] ${t('check-answer-photo-add')}`);
    await answer(session, items[0]!, 'yes');
    await driver.waitForElement(`[data-check-id="${items[0]}"] ${t('photo-thumb')}`);
    await answer(session, items[1]!, 'yes');
    await answer(session, items[2]!, 'yes');
    // The hidden-work item (D3) needs its photo before a yes.
    await setValue(
      session,
      `[data-check-id="${items[4]}"] ${t('check-answer-photo-path')}`,
      path.join(parent, 'inspection.png'),
    );
    await click(session, `[data-check-id="${items[4]}"] ${t('check-answer-photo-add')}`);
    await answer(session, items[4]!, 'yes');
    await driver.waitForElement(`[data-check-id="${items[4]}"] ${t('photo-thumb')}`);
    await answer(session, items[3]!, 'no');
    const holding = await text(session, `${stage} ${t('gate-holding')}`);
    expect(holding).not.toBe('');
    expect(
      await (await driver.find(`${stage} ${t('stage-close')}`)).attribute('disabled'),
    ).not.toBeNull();
    await session.screenshot('f5-gates-close-held-en');
    // A later answer counts: yes after no opens the gate.
    await answer(session, items[3]!, 'yes');
    await driver.waitFor('the close gate open', async () =>
      (await (await driver.find(`${stage} ${t('stage-close')}`)).attribute('disabled')) === null
        ? true
        : null,
    );
    await click(session, `${stage} ${t('stage-close')}`);
    await driver.waitForElement('[role="dialog"]');
    await click(
      session,
      '[role="dialog"] button[data-confirm], [role="dialog"] [data-testid="confirm"]',
    );
    await driver.waitFor('closed', async () =>
      /closed/i.test(await text(session, `${stage} ${t('stage-state')}`)) ? true : null,
    );
    await session.screenshot('f5-gates-closed-en');
  });

  it('a closed stage is closed: a link onto its activity is refused, and the dashboard counts it', async () => {
    const { driver } = session;
    await tab(session, 'breakdown');
    id['painting'] = await addStage(session, 'Painting');
    id['paint'] = await addActivity(session, id['painting'], 'Paint the eaves', 1);
    // Tiling's activity waiting for Painting's would put a blocked end in a closed stage.
    const rowLay = `[data-activity-id="${id['lay']}"]`;
    const editable = await driver.execute<boolean>(
      `const el = document.querySelector('${rowLay} [data-testid="link-blocker"]'); return !!el && !el.disabled;`,
    );
    if (editable) {
      await setValue(session, `${rowLay} ${t('link-blocker')}`, `activity:${id['paint']}`);
      await click(session, `${rowLay} ${t('link-add')}`);
      expect(await text(session, t('link-problem'))).not.toBe('');
    } else {
      // The closed stage's rows are read-only: that is the refusal, said in place.
      expect(await text(session, `[data-stage-id="${id['tiling']}"]`)).toMatch(/closed/i);
    }
    // The other way round is fine: Painting waits for the closed Tiling.
    const rowPaint = `[data-activity-id="${id['paint']}"]`;
    await setValue(session, `${rowPaint} ${t('link-blocker')}`, `activity:${id['lay']}`);
    await click(session, `${rowPaint} ${t('link-add')}`);
    await driver.waitForElement(`${rowPaint} [data-link-id]`);

    await go(session, 'dashboard');
    expect(await text(session, t('stages-closed-value'))).toMatch(/^1\b/);
    expect(await text(session, t('stages-planned-value'))).toMatch(/^1\b/);
    await session.screenshot('f5-dashboard-en');
  });

  it('a stage can be reopened, and then edited again', async () => {
    const { driver } = session;
    await tab(session, 'gates');
    const stage = `[data-stage-id="${id['tiling']}"]`;
    await click(session, `${stage} ${t('stage-reopen')}`);
    await driver.waitFor('started again', async () =>
      /started/i.test(await text(session, `${stage} ${t('stage-state')}`)) ? true : null,
    );
    await tab(session, 'breakdown');
    const enabled = await driver.execute<boolean>(
      `const el = document.querySelector('[data-activity-id="${id['lay']}"] [data-testid="activity-duration"]'); return !!el && !el.disabled;`,
    );
    expect(enabled).toBe(true);
  });

  it('says it in Portuguese', async () => {
    await chooseLanguage(session, 'Português (Brasil)');
    await tab(session, 'gates');
    await session.driver.waitForElement(`[data-stage-id="${id['tiling']}"] ${t('stage-state')}`);
    await session.screenshot('f5-gates-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
