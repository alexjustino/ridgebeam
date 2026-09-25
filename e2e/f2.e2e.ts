import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type Session } from './session';

/**
 * Slice F2's proof of done, against the real binary:
 *
 *   dependencies with lag on the working calendar; critical path highlighted on the Gantt; the
 *   finish date; approve = baseline 1; a slipped activity moves every dependent one and the
 *   finish date, and the slip is a figure that carries its rows.
 *
 * The plan: Foundations (3 d) → +1 d lag → Walls (2 d) → Paint (1 d), and Roof (1 d) after
 * Foundations in parallel. The chain through Walls is the critical one; Roof has slack.
 */

const WORK = 'House, synthetic';

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

const t = (id: string) => `[data-testid="${id}"]`;

async function breakdown(session: Session): Promise<void> {
  await go(session, 'plan');
  await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
}

/** Add a stage and return its id. */
async function addStage(session: Session, name: string): Promise<string> {
  const { driver } = session;
  const before = (await driver.findAll('[data-stage-id]')).length;
  await setValue(session, t('stage-add-name'), name);
  await click(session, t('stage-add'));
  await driver.waitFor(`stage ${name}`, async () =>
    (await driver.findAll('[data-stage-id]')).length === before + 1 ? true : null,
  );
  const ids = await driver.execute<string[]>(
    `return Array.from(document.querySelectorAll('[data-stage-id]')).map((e) => e.getAttribute('data-stage-id'))`,
  );
  return ids[ids.length - 1]!;
}

/** Add an activity to a stage with a duration, and return its id. */
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
  const ids = await driver.execute<string[]>(
    `return Array.from(document.querySelectorAll('${stage} [data-activity-id]')).map((e) => e.getAttribute('data-activity-id'))`,
  );
  const id = ids[ids.length - 1]!;
  await setValue(session, `[data-activity-id="${id}"] ${t('activity-duration')}`, String(days));
  return id;
}

/** Link `blocked` after `blocker` with a lag, through the row's Links line. */
async function linkAfter(
  session: Session,
  blockedId: string,
  blockerValue: string,
  lag: number,
): Promise<void> {
  const row = `[data-activity-id="${blockedId}"]`;
  const before = (await session.driver.findAll(`${row} [data-link-id]`)).length;
  await setValue(session, `${row} ${t('link-blocker')}`, blockerValue);
  await setValue(session, `${row} ${t('link-lag')}`, String(lag));
  await click(session, `${row} ${t('link-add')}`);
  await session.driver.waitFor('the link added', async () =>
    (await session.driver.findAll(`${row} [data-link-id]`)).length === before + 1 ? true : null,
  );
}

async function text(session: Session, selector: string): Promise<string> {
  return (await (await session.driver.waitForElement(selector)).text()).trim();
}

describe('F2 — the schedule: lags on the calendar, the critical path, baseline 1, and the slip', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-f2-'));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'house'));
    await click(session, t('work-create'));
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await breakdown(session);
    id['structure'] = await addStage(session, 'Structure');
    id['A'] = await addActivity(session, id['structure'], 'Foundations', 3);
    id['B'] = await addActivity(session, id['structure'], 'Walls', 2);
    id['finish'] = await addStage(session, 'Finish');
    id['C'] = await addActivity(session, id['finish'], 'Paint', 1);
    id['D'] = await addActivity(session, id['finish'], 'Roof', 1);
  }, 180_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('an activity linked to nothing is what the plan does not know', async () => {
    await go(session, 'dashboard');
    const sentence = await text(session, t('readiness-sentence'));
    expect(sentence).toMatch(/not linked/);
  });

  it('links with lag are added in the breakdown, and a cycle is refused by name', async () => {
    const { driver } = session;
    await breakdown(session);
    await linkAfter(session, id['B']!, `activity:${id['A']}`, 1);
    await linkAfter(session, id['C']!, `activity:${id['B']}`, 0);
    await linkAfter(session, id['D']!, `activity:${id['A']}`, 0);

    // Foundations after Paint would close Foundations → Walls → Paint → Foundations.
    const rowA = `[data-activity-id="${id['A']}"]`;
    const linksBefore = (await driver.findAll(`${rowA} [data-link-id]`)).length;
    await setValue(session, `${rowA} ${t('link-blocker')}`, `activity:${id['C']}`);
    await click(session, `${rowA} ${t('link-add')}`);
    const problem = await text(session, t('link-problem'));
    expect(problem).toContain('→');
    expect(problem).toContain('Foundations');
    expect(problem).toContain('Paint');
    expect((await driver.findAll(`${rowA} [data-link-id]`)).length).toBe(linksBefore);
    await session.screenshot('f2-links-en');

    await go(session, 'dashboard');
    expect(await text(session, t('readiness-sentence'))).not.toMatch(/not linked/);
  });

  it('the Gantt highlights the critical path, and Roof has slack', async () => {
    const { driver } = session;
    await go(session, 'schedule');
    await driver.waitForElement(t('gantt'));
    const critical = await driver.execute<Record<string, string | null>>(
      `const out = {}; for (const bar of document.querySelectorAll('[data-bar-id]')) out[bar.getAttribute('data-bar-id')] = bar.getAttribute('data-critical'); return out;`,
    );
    expect(critical[id['A']!]).toBe('true');
    expect(critical[id['B']!]).toBe('true');
    expect(critical[id['C']!]).toBe('true');
    expect(critical[id['D']!]).toBe('false');
    const list = await text(session, '[data-critical-path]');
    expect(list).toContain('Foundations');
    expect(list).toContain('Walls');
    expect(list).toContain('Paint');
    expect(list).not.toContain('Roof');
    // Every bar is reachable by keyboard and describes itself.
    const labels = await driver.execute<number>(
      `return Array.from(document.querySelectorAll('[data-bar-id]')).filter((b) => b.getAttribute('tabindex') === '0' && (b.getAttribute('aria-label') || '').length > 10).length`,
    );
    expect(labels).toBe(4);
    // The finish date on the schedule is the dashboard's.
    const finish = await text(session, t('schedule-finish'));
    await go(session, 'dashboard');
    expect(await text(session, t('finish-date'))).toBe(finish);
    await go(session, 'schedule');
    await session.screenshot('f2-gantt-en');
  });

  it('approving the plan takes baseline 1', async () => {
    const { driver } = session;
    await go(session, 'schedule');
    await click(session, t('plan-approve'));
    await driver.waitForElement(t('baseline-number'));
    expect(await text(session, t('baseline-number'))).toBe('1');
    expect(await text(session, t('slip-value'))).toMatch(/^0 /);
    await go(session, 'dashboard');
    await driver.waitForElement(t('baseline-finish'));
    await session.screenshot('f2-dashboard-approved-en');
  });

  it('a slipped activity moves every dependent one and the finish date, as a figure with rows', async () => {
    const { driver } = session;
    await go(session, 'schedule');
    const before = await text(session, t('schedule-finish'));
    await breakdown(session);
    await setValue(session, `[data-activity-id="${id['B']}"] ${t('activity-duration')}`, '4');
    await go(session, 'schedule');
    await driver.waitFor('the finish moved', async () =>
      (await text(session, t('schedule-finish'))) !== before ? true : null,
    );
    expect(await text(session, t('slip-value'))).toMatch(/^2 /);
    await click(session, t('slip-value'));
    const rows = await driver.findAll(t('slip-row'));
    const names = await Promise.all(rows.map((r) => r.text()));
    expect(names.some((n) => n.includes('Walls'))).toBe(true);
    expect(names.some((n) => n.includes('Paint'))).toBe(true);
    expect(names.some((n) => n.includes('Roof'))).toBe(false);
    expect(names.some((n) => n.includes('Foundations'))).toBe(false);
    await session.screenshot('f2-slip-en');
    await go(session, 'dashboard');
    expect(await text(session, t('slip-value'))).toMatch(/^2 /);
  });

  it('says it in Portuguese', async () => {
    await chooseLanguage(session, 'Português (Brasil)');
    await go(session, 'schedule');
    const list = await text(session, '[data-critical-path]');
    expect(list).toContain('Foundations');
    expect(await text(session, t('slip-value'))).toMatch(/^2 /);
    await session.screenshot('f2-gantt-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
