import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type Session } from './session';

/**
 * Slice F3's proof of done, against the real binary:
 *
 *   a decision belongs to a stage with a lead time; its deadline is computed and moves with
 *   the schedule; readiness rule by rule with its explanation; "what the plan does not know" is
 *   a list that opens onto each row; the negative battery for decisions and readiness is green.
 *
 * Tiling starts today; "Which tile" with ten working days of lead time is overdue the moment it
 * is added, and the plan says so. Painting follows Tiling; "Which colour" with one day of lead
 * time is due, and its deadline moves when Tiling grows.
 */

const WORK = 'Kitchen, synthetic';

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

async function addDecision(
  session: Session,
  stageId: string,
  name: string,
  lead: number,
): Promise<string> {
  const { driver } = session;
  const stage = `[data-stage-id="${stageId}"]`;
  const before = (await driver.findAll(`${stage} [data-decision-id]`)).length;
  await setValue(session, `${stage} ${t('decision-add-name')}`, name);
  await setValue(session, `${stage} ${t('decision-add-lead')}`, String(lead));
  await click(session, `${stage} ${t('decision-add')}`);
  await driver.waitFor(`decision ${name}`, async () =>
    (await driver.findAll(`${stage} [data-decision-id]`)).length === before + 1 ? true : null,
  );
  return lastId(session, `${stage} [data-decision-id]`, 'data-decision-id');
}

describe('F3 — decisions with a computed deadline, and readiness rule by rule', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-f3-'));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'kitchen'));
    await click(session, t('work-create'));
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await breakdown(session);
    id['tiling'] = await addStage(session, 'Tiling');
    id['lay'] = await addActivity(session, id['tiling'], 'Lay the floor tile', 3);
  }, 180_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('a decision whose lead time is longer than the time left is overdue on creation, and says so', async () => {
    const { driver } = session;
    id['tile'] = await addDecision(session, id['tiling']!, 'Which tile', 10);
    const row = `[data-decision-id="${id['tile']}"]`;
    await driver.waitForElement(`${row} ${t('decision-warning')}`);
    expect(await text(session, `${row} ${t('decision-status')}`)).toMatch(/overdue/i);
    expect(await text(session, `${row} ${t('decision-deadline')}`)).not.toBe('');
    await session.screenshot('f3-decision-overdue-en');
  });

  it('readiness names it, rule by rule, and each rule opens onto its rows', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    expect(await text(session, t('readiness-sentence'))).toMatch(/overdue/i);
    const line = `${t('readiness-rules')} [data-rule-id="decision.timely"]`;
    expect(await text(session, line)).toMatch(/0 of 1/);
    await click(session, `${line} button, button${line}`);
    const rows = await driver.findAll(`[data-rule-id="decision.timely"] [data-rule-row]`);
    expect(rows).toHaveLength(1);
    expect(await rows[0]!.text()).toContain('Which tile');
    // Every rule line sums into the figure: the known and must-know counts add up.
    const sums = await driver.execute<{ known: number; must: number }>(
      `let known = 0, must = 0;
       for (const el of document.querySelectorAll('[data-testid="readiness-rules"] [data-rule-id]')) {
         const m = el.textContent.match(/(\\d+) of (\\d+)/); if (m) { known += +m[1]; must += +m[2]; }
       }
       return { known, must };`,
    );
    const value = await text(session, t('figure-value'));
    expect(value).toBe(`${Math.min(99, Math.round((100 * sums.known) / sums.must))} %`);
    await session.screenshot('f3-readiness-rules-en');
  });

  it('a made decision is ready, whatever its deadline', async () => {
    const { driver } = session;
    await breakdown(session);
    const row = `[data-decision-id="${id['tile']}"]`;
    await click(session, `${row} ${t('decision-make')}`);
    await driver.waitForElement('[role="dialog"]');
    await setValue(session, t('decision-answer'), 'Porcelain, grey');
    await click(session, t('decision-make-confirm'));
    await driver.waitFor('made', async () =>
      /made/i.test(await text(session, `${row} ${t('decision-status')}`)) ? true : null,
    );
    await go(session, 'dashboard');
    expect(await text(session, `${t('readiness-rules')} [data-rule-id="decision.timely"]`)).toMatch(
      /1 of 1/,
    );
    expect(await text(session, t('readiness-sentence'))).not.toMatch(/overdue/i);
  });

  it('a deadline is computed from the schedule and moves with it', async () => {
    const { driver } = session;
    await breakdown(session);
    id['painting'] = await addStage(session, 'Painting');
    id['paint'] = await addActivity(session, id['painting'], 'Paint the walls', 2);
    // Painting after Tiling.
    const rowPaint = `[data-activity-id="${id['paint']}"]`;
    await setValue(session, `${rowPaint} ${t('link-blocker')}`, `activity:${id['lay']}`);
    await click(session, `${rowPaint} ${t('link-add')}`);
    await driver.waitForElement(`${rowPaint} [data-link-id]`);

    id['colour'] = await addDecision(session, id['painting'], 'Which colour', 1);
    const row = `[data-decision-id="${id['colour']}"]`;
    expect(await text(session, `${row} ${t('decision-status')}`)).toMatch(/due/i);
    const before = await text(session, `${row} ${t('decision-deadline')}`);
    expect(before).not.toBe('');

    // Tiling grows by three working days: Painting starts later, and so does the last day to decide.
    await setValue(session, `[data-activity-id="${id['lay']}"] ${t('activity-duration')}`, '6');
    await driver.waitFor('the deadline moved', async () =>
      (await text(session, `${row} ${t('decision-deadline')}`)) !== before ? true : null,
    );
    await session.screenshot('f3-decisions-breakdown-en');
  });

  it('the Decisions destination lists every decision, made last, and the dashboard counts what is due', async () => {
    const { driver } = session;
    await go(session, 'decisions');
    const rows = await driver.findAll('[data-decision-id]');
    expect(rows).toHaveLength(2);
    expect(await rows[0]!.text()).toContain('Which colour');
    expect(await rows[1]!.text()).toContain('Which tile');
    expect(await rows[1]!.text()).toContain('Porcelain, grey');
    await session.screenshot('f3-decisions-en');

    await go(session, 'dashboard');
    expect(await text(session, t('decisions-due-value'))).toMatch(/^1\b/);
    await click(session, t('decisions-due-value'));
    const due = await driver.findAll(t('decisions-due-row'));
    expect(due).toHaveLength(1);
    expect(await due[0]!.text()).toContain('Which colour');
  });

  it('says it in Portuguese', async () => {
    const { driver } = session;
    await chooseLanguage(session, 'Português (Brasil)');
    const rail = await driver.find('nav[data-rail] button[data-destination="decisions"]');
    expect((await rail.text()).trim()).toBe('Decisões');
    await go(session, 'decisions');
    await driver.waitForElement('[data-decision-id]');
    await session.screenshot('f3-decisions-pt-BR');
    await go(session, 'dashboard');
    await session.screenshot('f3-dashboard-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
