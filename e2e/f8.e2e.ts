import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, createWork, go, openRecent, startSession, type Session } from './session';

/**
 * Slice F8's proof of done, against the real binary:
 *
 *   editing an approved plan asks for a reason and makes baseline N+1; any two baselines compare
 *   with dates moved, stages added or removed, money changed, and the reasons between them; a
 *   what-if that is not saved is not a baseline.
 *
 * The plan: Foundations (3 d) → Walls (2 d) → Paint (1 d), with money on Foundations. Approved as
 * baseline 1; then Walls grows to 4 d, a Roof stage arrives and the money changes, for a reason;
 * baseline 2 records it, and the two compare.
 */

const WORK = 'Cottage, synthetic';

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

async function value(session: Session, selector: string): Promise<string> {
  await session.driver.waitForElement(selector);
  return session.driver.execute<string>(
    `return document.querySelector(${JSON.stringify(selector)}).value`,
  );
}

const t = (id: string) => `[data-testid="${id}"]`;
const digits = (s: string) => s.replace(/[^0-9]/g, '');

async function breakdown(session: Session): Promise<void> {
  await go(session, 'plan');
  await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
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

async function linkAfter(session: Session, blockedId: string, blockerValue: string): Promise<void> {
  const row = `[data-activity-id="${blockedId}"]`;
  const before = (await session.driver.findAll(`${row} [data-link-id]`)).length;
  await setValue(session, `${row} ${t('link-blocker')}`, blockerValue);
  await setValue(session, `${row} ${t('link-lag')}`, '0');
  await click(session, `${row} ${t('link-add')}`);
  await session.driver.waitFor('the link added', async () =>
    (await session.driver.findAll(`${row} [data-link-id]`)).length === before + 1 ? true : null,
  );
}

describe('F8 — replanning: an approved plan asks for a reason, and any two baselines compare', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-f8-'));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'cottage'));
    await createWork(session);
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
    await linkAfter(session, id['B'], `activity:${id['A']}`);
    await linkAfter(session, id['C'], `activity:${id['B']}`);
    const rowA = `[data-activity-id="${id['A']}"]`;
    await setValue(session, `${rowA} ${t('cost-line-add-label')}`, 'Concrete');
    await setValue(session, `${rowA} ${t('cost-line-add-amount')}`, '1000.00');
    await click(session, `${rowA} ${t('cost-line-add')}`);
    await driver.waitForElement(`${rowA} [data-cost-line-id]`);
    await go(session, 'schedule');
    await click(session, t('plan-approve'));
    await driver.waitForElement(t('baseline-number'));
  }, 180_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('an approved plan is locked: a duration edit is refused with a sentence, and the way out is offered', async () => {
    const { driver } = session;
    expect(await text(session, t('baseline-number'))).toBe('1');
    await breakdown(session);
    await driver.waitForElement(t('plan-locked'));
    const rowB = `[data-activity-id="${id['B']}"]`;
    await setValue(session, `${rowB} ${t('activity-duration')}`, '4');
    const problem = await text(session, `${rowB} ${t('activity-problem')}`);
    expect(problem).toMatch(/approved/i);
    // The file still says 2, and so does the screen once it has re-read it.
    await go(session, 'schedule');
    await breakdown(session);
    expect(await value(session, `${rowB} ${t('activity-duration')}`)).toBe('2');
    await session.screenshot('f8-locked-en');
  });

  it('replanning asks for a reason: blank is refused, a sentence is kept, and the edits go through', async () => {
    const { driver } = session;
    await click(session, t('replan-open'));
    await setValue(session, t('replan-reason'), '   ');
    await click(session, t('replan-confirm'));
    expect(await text(session, t('replan-problem'))).not.toBe('');
    await setValue(session, t('replan-reason'), 'Tiles arrive two weeks late.');
    await click(session, t('replan-confirm'));
    await driver.waitForElement(t('replanning-open'));
    expect(await text(session, t('replanning-open'))).toContain('Tiles arrive two weeks late.');
    // The button that opened the dialog is gone: focus must land somewhere a keyboard can use.
    const focused = await driver.execute<string>(
      `const el = document.activeElement; return el === null || el === document.body ? 'body' : el.tagName + ' ' + (el.getAttribute('data-testid') || el.textContent.trim().slice(0, 40))`,
    );
    expect(focused).not.toBe('body');
    expect(await driver.findAll(t('plan-locked'))).toHaveLength(0);

    const rowB = `[data-activity-id="${id['B']}"]`;
    await setValue(session, `${rowB} ${t('activity-duration')}`, '4');
    await go(session, 'schedule');
    await breakdown(session);
    expect(await value(session, `${rowB} ${t('activity-duration')}`)).toBe('4');
    id['roof'] = await addStage(session, 'Roof');
    id['D'] = await addActivity(session, id['roof'], 'Tiles', 2);
    const rowA = `[data-activity-id="${id['A']}"]`;
    await setValue(session, `${rowA} ${t('cost-line-add-label')}`, 'Steel');
    await setValue(session, `${rowA} ${t('cost-line-add-amount')}`, '250.00');
    await click(session, `${rowA} ${t('cost-line-add')}`);
    await driver.waitFor('two cost lines', async () =>
      (await driver.findAll(`${rowA} [data-cost-line-id]`)).length === 2 ? true : null,
    );
    await session.screenshot('f8-replanning-en');
  });

  it('taking baseline 2 closes the replanning and keeps the reason with the baseline', async () => {
    const { driver } = session;
    await go(session, 'schedule');
    await driver.waitForElement(t('replanning-open'));
    await click(session, t('baseline-take'));
    await driver.waitFor('baseline 2', async () =>
      (await text(session, t('baseline-number'))) === '2' ? true : null,
    );
    expect(await driver.findAll(t('replanning-open'))).toHaveLength(0);
    await driver.waitForElement(t('baselines-card'));
    const second = await text(session, '[data-baseline-number="2"]');
    expect(second).toContain('Tiles arrive two weeks late.');
    expect(await text(session, t('slip-value'))).toMatch(/^0 /);
    await go(session, 'dashboard');
    expect(await text(session, t('baselines-count'))).toMatch(/2/);
  });

  it('any two baselines compare: dates moved, a stage added, money changed, the reason between them', async () => {
    const { driver } = session;
    await go(session, 'schedule');
    await setValue(session, t('compare-a'), '1');
    await setValue(session, t('compare-b'), '2');
    await driver.waitForElement(t('compare-result'));
    expect(await text(session, t('compare-finish'))).toMatch(/\d/);
    // Walls grew by two days; Paint follows it. Foundations did not move.
    const moved = await Promise.all(
      (await driver.findAll('[data-compare-moved]')).map((row) => row.text()),
    );
    expect(moved.some((row) => row.includes('Walls'))).toBe(true);
    expect(moved.some((row) => row.includes('Paint'))).toBe(true);
    expect(moved.some((row) => row.includes('Foundations'))).toBe(false);
    const added = await Promise.all(
      (await driver.findAll('[data-compare-added]')).map((row) => row.text()),
    );
    expect(added.some((row) => row.includes('Tiles'))).toBe(true);
    expect(await driver.findAll('[data-compare-removed]')).toHaveLength(0);
    const stagesAdded = await Promise.all(
      (await driver.findAll('[data-compare-stage-added]')).map((row) => row.text()),
    );
    expect(stagesAdded.some((row) => row.includes('Roof'))).toBe(true);
    expect(digits(await text(session, t('compare-money')))).toContain('25000');
    const reasons = await Promise.all(
      (await driver.findAll('[data-compare-reason]')).map((row) => row.text()),
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('Tiles arrive two weeks late.');
    await driver.execute(
      `document.querySelector('[data-testid="compare-result"]').scrollIntoView({ block: 'start' })`,
    );
    await session.screenshot('f8-compare-en');

    // The same pair in the other order reads the same way, and a baseline against itself is refused.
    await setValue(session, t('compare-a'), '2');
    await setValue(session, t('compare-b'), '1');
    await driver.waitForElement(t('compare-result'));
    expect(await driver.findAll('[data-compare-stage-added]')).toHaveLength(1);
    await setValue(session, t('compare-b'), '2');
    await driver.waitForElement(t('compare-same'));
    expect(await driver.findAll(t('compare-result'))).toHaveLength(0);
  });

  it('a what-if moves the finish on screen and writes nothing: the plan and the baselines survive a restart unchanged', async () => {
    const { driver } = session;
    await go(session, 'schedule');
    const finish = await text(session, t('schedule-finish'));
    await setValue(session, t('whatif-activity'), id['A']!);
    await setValue(session, t('whatif-duration'), '10');
    await click(session, t('whatif-add'));
    await driver.waitForElement('[data-whatif-row]');
    const whatIf = await text(session, t('whatif-finish'));
    expect(whatIf).not.toBe(finish);
    expect(await text(session, t('whatif-delta'))).toMatch(/7/);
    expect(await text(session, t('whatif-note'))).toMatch(/not saved/i);
    // The real schedule did not move.
    expect(await text(session, t('schedule-finish'))).toBe(finish);
    await driver.execute(
      `document.querySelector('[data-testid="whatif-finish"]').scrollIntoView({ block: 'start' })`,
    );
    await session.screenshot('f8-whatif-en');

    await session.restart();
    await openRecent(session);
    await go(session, 'schedule');
    expect(await text(session, t('baseline-number'))).toBe('2');
    expect(await text(session, t('schedule-finish'))).toBe(finish);
    expect(await session.driver.findAll('[data-whatif-row]')).toHaveLength(0);
    await breakdown(session);
    expect(await value(session, `[data-activity-id="${id['A']}"] ${t('activity-duration')}`)).toBe(
      '3',
    );
  });

  it('says it in Portuguese', async () => {
    await chooseLanguage(session, 'Português (Brasil)');
    await go(session, 'schedule');
    await session.driver.waitForElement(t('baselines-card'));
    const second = await text(session, '[data-baseline-number="2"]');
    expect(second).toContain('Tiles arrive two weeks late.');
    expect(await text(session, t('whatif-note'))).toMatch(/não/i);
    await session.driver.execute(
      `document.querySelector('[data-testid="baselines-card"]').scrollIntoView({ block: 'start' })`,
    );
    await session.screenshot('f8-baselines-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
