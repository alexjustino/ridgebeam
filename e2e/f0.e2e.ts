import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * Slice F0's proof of done, against the real binary:
 *
 *   a work is created as a folder; one stage with one activity is scheduled on a working
 *   calendar; the readiness figure reads below 100 % and opens onto "1 activity has no
 *   responsible"; the sentence is in English and in Portuguese.
 *
 * And what the specification's end-to-end row adds for the foundation: fill what is missing,
 * readiness reaches 100 %, restart, everything is still there. The folder is a real temporary
 * folder on this machine; the operating system's folder dialog cannot be driven by WebDriver,
 * so the Start screen's folder field — a real field a person may paste into — is typed into.
 */

const NAME = 'Bathroom, ground floor';

function tempWorkFolder(): string {
  const parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-work-'));
  // The product creates the folder itself; it must not exist yet.
  return path.join(parent, 'bathroom');
}

/** A controlled input set through React's own setter: WebDriver's clear does not reach it. */
async function setValue(session: Session, testId: string, value: string): Promise<void> {
  await session.driver.waitForElement(`[data-testid="${testId}"]`);
  await session.driver.execute(
    `const el = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
     const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
       : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
     Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
     el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));`,
  );
}

async function click(session: Session, testId: string): Promise<void> {
  await (await session.driver.waitForElement(`[data-testid="${testId}"]`)).click();
}

async function readinessValue(session: Session): Promise<string> {
  const value = await session.driver.waitForElement('[data-testid="figure-value"]');
  return (await value.text()).trim();
}

describe('F0 — a work, one stage, one activity, and what the plan does not know', () => {
  let session: Session;
  let folder: string;

  beforeAll(async () => {
    session = await startSession();
    folder = tempWorkFolder();
  });

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && folder) {
      rmSync(path.dirname(folder), { recursive: true, force: true });
    }
  });

  it('opens on the Start screen with nothing open, and the rail says so', async () => {
    const { driver } = session;
    expect(await driver.title()).toBe('Ridgebeam');
    await driver.waitForElement('[data-testid="start"]');
    const dashboard = await driver.find('nav[data-rail] button[data-destination="dashboard"]');
    expect(await dashboard.attribute('aria-disabled')).toBe('true');
    await session.screenshot('f0-start-en');
  });

  it('creates a work as a folder on disk', async () => {
    const { driver } = session;
    await click(session, 'new-work');
    await driver.waitForElement('[role="dialog"]');
    await setValue(session, 'work-name', NAME);
    await setValue(session, 'work-place', 'Somewhere synthetic');
    await setValue(session, 'work-folder', folder);
    await session.screenshot('f0-new-work-en');
    await click(session, 'work-create');
    await go(session, 'dashboard');
    await driver.waitForText(NAME);

    const files = readdirSync(folder);
    expect(files, files.join(', ')).toContain('work.sqlite3');
  });

  it('a stage with one activity is scheduled on the working calendar', async () => {
    const { driver } = session;
    await go(session, 'plan');
    await setValue(session, 'stage-add-name', 'Tiling');
    await click(session, 'stage-add');
    await driver.waitForElement('[data-stage-id]');
    await setValue(session, 'activity-add-name', 'Lay the floor tile');
    await click(session, 'activity-add');
    await driver.waitForElement('[data-activity-id]');
    await setValue(session, 'activity-duration', '3');
    await session.screenshot('f0-plan-en');
    // The finish date is computed on the calendar and shown on the dashboard.
    await go(session, 'dashboard');
    const finish = await driver.waitForElement('[data-testid="finish-date"]');
    expect((await finish.text()).trim()).not.toBe('');
  });

  it('readiness reads below 100 % and opens onto "1 activity has no responsible"', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    expect(await readinessValue(session)).toBe('50 %');
    const sentence = await driver.waitForElement('[data-testid="readiness-sentence"]');
    expect((await sentence.text()).trim()).toBe('1 activity has no responsible.');

    await click(session, 'figure-value');
    const rows = await driver.findAll('[data-testid="figure-row"]');
    expect(rows).toHaveLength(1);
    expect(await rows[0]!.text()).toContain('Lay the floor tile');
    await session.screenshot('f0-dashboard-en');
  });

  it('says the same sentence in Portuguese', async () => {
    const { driver } = session;
    await chooseLanguage(session, 'Português (Brasil)');
    await go(session, 'dashboard');
    const sentence = await driver.waitForElement('[data-testid="readiness-sentence"]');
    expect((await sentence.text()).trim()).toBe('1 atividade não tem responsável.');
    expect(await readinessValue(session)).toBe('50 %');
    await session.screenshot('f0-dashboard-pt-BR');
    await chooseLanguage(session, 'English');
  });

  it('reaches 100 % once a responsible is named — and nothing on the plan sets progress', async () => {
    const { driver } = session;
    await go(session, 'plan');
    await setValue(session, 'person-add-name', 'A. Tiler');
    await click(session, 'person-add');
    await driver.waitFor('the person in the select', async () => {
      const options = await driver.execute<string[]>(
        `return Array.from(document.querySelectorAll('[data-testid="activity-responsible"] option')).map(o => o.textContent)`,
      );
      return options.some((o) => o.includes('A. Tiler')) ? true : null;
    });
    const value = await driver.execute<string>(
      `const o = Array.from(document.querySelectorAll('[data-testid="activity-responsible"] option')).find(o => o.textContent.includes('A. Tiler')); return o.value;`,
    );
    await setValue(session, 'activity-responsible', value);
    const html = await driver.execute<string>('return document.body.innerHTML');
    expect(html).not.toMatch(/progress/i);
    expect(html).not.toMatch(/data-testid="[^"]*percent[^"]*"/);

    await go(session, 'dashboard');
    await driver.waitFor('readiness at 100 %', async () =>
      (await readinessValue(session)) === '100 %' ? true : null,
    );
    await session.screenshot('f0-dashboard-ready-en');
  });

  it('survives a restart: the work reopens from the recent list and reads the same', async () => {
    await session.restart();
    const { driver } = session;
    await driver.waitForElement('[data-testid="start"]');
    await (await driver.waitForElement(`[data-testid="recent-work"]`)).click();
    await go(session, 'dashboard');
    await driver.waitForText(NAME);
    expect(await readinessValue(session)).toBe('100 %');
  });

  it('refuses to create a work in a folder that is not empty, with a sentence', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    await session.driver.execute('document.activeElement && document.activeElement.blur();');
    await click(session, 'work-close');
    await driver.waitForElement('[data-testid="start"]');
    await click(session, 'new-work');
    await setValue(session, 'work-name', 'Second');
    await setValue(session, 'work-folder', folder);
    await click(session, 'work-create');
    const bar = await driver.waitForElement('[role="status"], [role="alert"]');
    expect((await bar.text()).trim()).not.toBe('');
    await driver.chord(Keys.ESCAPE);
  });
});
