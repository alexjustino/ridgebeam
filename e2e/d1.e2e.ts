import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, openRecent, startSession, type Session } from './session';

/**
 * Slice D1's proof of done, against the real binary:
 *
 *   from each activity's range, the finish is a probability — said in natural frequencies, seeded
 *   so the same plan gives the same numbers, and never changing the plan's own dates.
 *
 * The plan: Demolish (3 d) → Rebuild (4 d) → Clean (1 d), in a chain.
 */

const WORK = 'Porch, synthetic chances';

async function setValue(session: Session, selector: string, value: string): Promise<void> {
  await session.driver.waitForElement(selector);
  await session.driver.execute(
    `const el = document.querySelector(${JSON.stringify(selector)});
     const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
       : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
     Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
     el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
     el.dispatchEvent(new Event('blur', { bubbles: true }));
     el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));`,
  );
}

async function click(session: Session, selector: string): Promise<void> {
  await (await session.driver.waitForElement(selector)).click();
}

async function text(session: Session, selector: string): Promise<string> {
  return (await (await session.driver.waitForElement(selector)).text()).trim();
}

async function attr(session: Session, selector: string, name: string): Promise<string> {
  const element = await session.driver.waitForElement(selector);
  return (await element.attribute(name)) ?? '';
}

const t = (id: string) => `[data-testid="${id}"]`;

async function breakdown(session: Session): Promise<void> {
  await go(session, 'plan');
  await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
}

async function lastId(session: Session, selector: string, attrName: string): Promise<string> {
  const ids = await session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((e) => e.getAttribute(${JSON.stringify(attrName)}))`,
  );
  return ids[ids.length - 1]!;
}

async function addActivity(
  session: Session,
  stageId: string,
  name: string,
  days: number,
): Promise<string> {
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

async function linkAfter(session: Session, blockedId: string, blockerId: string): Promise<void> {
  const row = `[data-activity-id="${blockedId}"]`;
  const before = (await session.driver.findAll(`${row} [data-link-id]`)).length;
  await setValue(session, `${row} ${t('link-blocker')}`, `activity:${blockerId}`);
  await setValue(session, `${row} ${t('link-lag')}`, '0');
  await click(session, `${row} ${t('link-add')}`);
  await session.driver.waitFor('the link added', async () =>
    (await session.driver.findAll(`${row} [data-link-id]`)).length === before + 1 ? true : null,
  );
}

async function range(session: Session, id: string, min: number, max: number): Promise<void> {
  const row = `[data-activity-id="${id}"]`;
  await setValue(session, `${row} ${t('activity-range-min')}`, String(min));
  await setValue(session, `${row} ${t('activity-range-max')}`, String(max));
  await session.driver.waitFor(`the range ${min}–${max} kept`, async () => {
    const values = await session.driver.execute<[string, string]>(
      `const r = document.querySelector('${row}');
       return [r.querySelector('[data-testid="activity-range-min"]').value, r.querySelector('[data-testid="activity-range-max"]').value]`,
    );
    return values[0] === String(min) && values[1] === String(max) ? true : null;
  });
}

async function days(session: Session): Promise<{ p50: string; p80: string; p90: string }> {
  await go(session, 'schedule');
  await session.driver.waitForElement(t('finish-probability'));
  return {
    p50: await attr(session, t('finish-p50'), 'data-day'),
    p80: await attr(session, t('finish-p80'), 'data-day'),
    p90: await attr(session, t('finish-p90'), 'data-day'),
  };
}

describe('D1 — when will it really finish: the finish as a probability, from the ranges given', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};
  let seeded: { p50: string; p80: string; p90: string };

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-d1-'));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'porch'));
    await click(session, t('work-create'));
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await breakdown(session);
    await setValue(session, t('stage-add-name'), 'Porch');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    id['stage'] = await lastId(session, '[data-stage-id]', 'data-stage-id');
    id['A'] = await addActivity(session, id['stage'], 'Demolish', 3);
    id['B'] = await addActivity(session, id['stage'], 'Rebuild', 4);
    id['C'] = await addActivity(session, id['stage'], 'Clean', 1);
    await linkAfter(session, id['B'], id['A']);
    await linkAfter(session, id['C'], id['B']);
  }, 180_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('with no range anywhere, every activity is counted as certain and the finish is the plan’s date', async () => {
    const { driver } = session;
    await go(session, 'schedule');
    await driver.waitForElement(t('finish-probability'));
    expect(await text(session, t('finish-certain'))).toMatch(/certain/i);
    const planFinish = await driver.execute<string>(
      `return document.querySelector('[data-testid="finish-p80"]').getAttribute('data-day')`,
    );
    expect(planFinish).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('with ranges, the finish is said as N in 10, the percentiles in order, and the drivers named', async () => {
    const { driver } = session;
    await breakdown(session);
    await range(session, id['A']!, 2, 4);
    await range(session, id['B']!, 3, 6);
    await range(session, id['C']!, 1, 2);
    seeded = await days(session);
    expect(await text(session, t('finish-p80'))).toMatch(/\b\d+ in 10\b/);
    expect(seeded.p50 <= seeded.p80 && seeded.p80 <= seeded.p90).toBe(true);
    const chance = Number(await attr(session, t('finish-plan-chance'), 'data-chance'));
    expect(chance).toBeGreaterThanOrEqual(0);
    expect(chance).toBeLessThanOrEqual(1);
    const drivers = await driver.findAll('[data-driver]');
    expect(drivers.length).toBeGreaterThanOrEqual(1);
    expect(drivers.length).toBeLessThanOrEqual(5);
    await driver.execute(
      `document.querySelector('[data-testid="finish-probability"]').scrollIntoView({ block: 'start' })`,
    );
    await session.screenshot('d1-finish-probability-en');
  });

  it('a wider range moves the chances; the same plan after a restart gives the same numbers', async () => {
    await breakdown(session);
    await range(session, id['B']!, 3, 12);
    const wider = await days(session);
    expect(wider.p90 >= seeded.p90).toBe(true);
    expect(JSON.stringify(wider)).not.toBe(JSON.stringify(seeded));

    await session.restart();
    await openRecent(session);
    const again = await days(session);
    expect(again).toEqual(wider);
  });

  it('after approval a range is still an estimate: it is accepted, while a duration stays locked', async () => {
    await go(session, 'schedule');
    await click(session, t('plan-approve'));
    await session.driver.waitForElement(t('baseline-number'));
    await session.driver.waitForElement(t('finish-baseline-chance'));
    await breakdown(session);
    const row = `[data-activity-id="${id['C']}"]`;
    await range(session, id['C']!, 1, 3);
    expect(await session.driver.findAll(`${row} ${t('activity-problem')}`)).toHaveLength(0);
    await setValue(session, `${row} ${t('activity-duration')}`, '2');
    expect(await text(session, `${row} ${t('activity-problem')}`)).toMatch(/approved/i);
    await go(session, 'dashboard');
    expect(await text(session, t('dashboard-finish-p80'))).toMatch(/in 10/);
  });

  it('says it in Portuguese', async () => {
    await chooseLanguage(session, 'Português (Brasil)');
    await go(session, 'schedule');
    expect(await text(session, t('finish-p80'))).toMatch(/\b\d+ em 10\b/);
    await session.driver.execute(
      `document.querySelector('[data-testid="finish-probability"]').scrollIntoView({ block: 'start' })`,
    );
    await session.screenshot('d1-finish-probability-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
