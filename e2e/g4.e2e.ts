import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pdfText } from './pdf';
import { chooseLanguage, chooseTheme, createWork, go, startSession, type Session } from './session';

/**
 * Slice G4's proof of done, against the real binary:
 *
 *   a work does not end at the handover — a warranty with its end day, a maintenance task with its
 *   cycle; what is overdue and what is ending soon; a task done is recorded, never edited, and the
 *   next due day moves on from it; the Dashboard of a finished work leads with it; a calendar of
 *   twelve months; an .ics any calendar reads; the handover book carries it.
 */

const WORK = 'Bathroom, synthetic aftercare';

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

async function attr(session: Session, selector: string, name: string): Promise<string> {
  return session.driver.execute<string>(
    `return document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? ''`,
  );
}

const t = (id: string) => `[data-testid="${id}"]`;

async function lastId(session: Session, selector: string, attrName: string): Promise<string> {
  const ids = await session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((e) => e.getAttribute(${JSON.stringify(attrName)}))`,
  );
  return ids[ids.length - 1]!;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Today `months` calendar months away, on the 1st so no month end is in play. */
function monthsAway(months: number): string {
  const now = new Date();
  return iso(new Date(now.getFullYear(), now.getMonth() + months, 1));
}

async function confirm(session: Session): Promise<void> {
  await session.driver.waitForElement('[role="dialog"]');
  await click(
    session,
    '[role="dialog"] button[data-confirm], [role="dialog"] [data-testid="confirm"]',
  );
}

async function handoverTab(session: Session): Promise<void> {
  await go(session, 'plan');
  await click(session, '[data-testid="plan-tabs"] [data-tab="handover"]');
}

describe('G4 — after the handover: warranties, maintenance, and a calendar of what comes due', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-g4-'));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'bathroom'));
    await createWork(session);
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    await setValue(session, t('stage-add-name'), 'Bathroom');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    id['stage'] = await lastId(session, '[data-stage-id]', 'data-stage-id');
    const stage = `[data-stage-id="${id['stage']}"]`;
    await setValue(session, `${stage} ${t('activity-add-name')}`, 'Fit the shower');
    await click(session, `${stage} ${t('activity-add')}`);
    await driver.waitForElement('[data-activity-id]');

    // The stage is done and closed: the work is finished.
    await click(session, '[data-testid="plan-tabs"] [data-tab="gates"]');
    await click(session, `${stage} ${t('stage-start')}`);
    await confirm(session);
    await driver.waitFor('started', async () =>
      /started/i.test(await text(session, `${stage} ${t('stage-state')}`)) ? true : null,
    );
    await click(session, `${stage} ${t('stage-close')}`);
    await confirm(session);
    await driver.waitFor('closed', async () =>
      /closed/i.test(await text(session, `${stage} ${t('stage-state')}`)) ? true : null,
    );
  }, 240_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('a warranty of two years, given 23 months ago, is ending soon', async () => {
    const { driver } = session;
    await handoverTab(session);
    await click(session, t('warranty-add'));
    await setValue(session, t('warranty-title'), 'Shower valve');
    await setValue(session, t('warranty-target'), `stage:${id['stage']}`);
    await setValue(session, t('warranty-given-by'), 'The installer');
    await setValue(session, t('warranty-starts'), monthsAway(-23));
    await setValue(session, t('warranty-length'), '2');
    await click(session, `${t('warranty-unit')} [data-value="years"]`);
    await click(session, t('warranty-save'));
    await driver.waitForElement('[data-warranty-id]');
    const warranty = '[data-warranty-id]';
    expect(await attr(session, warranty, 'data-state')).toBe('ending-soon');
    expect(await attr(session, warranty, 'data-ends')).toBe(monthsAway(1));
  });

  it('a task due a month ago is overdue; done today, it is due again in twelve months', async () => {
    const { driver } = session;
    await handoverTab(session);
    await click(session, t('maintenance-add'));
    await setValue(session, t('maintenance-title'), 'Reseal the shower');
    await setValue(session, t('maintenance-target'), `stage:${id['stage']}`);
    await setValue(session, t('maintenance-every'), '12');
    await setValue(session, t('maintenance-first'), monthsAway(-1));
    await click(session, t('maintenance-save'));
    await driver.waitForElement('[data-task-id]');
    const task = '[data-task-id]';
    expect(await attr(session, task, 'data-overdue')).toBe('true');
    await driver.execute(
      `document.querySelector('[data-task-id]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('g4-maintenance-overdue-en');

    await click(session, `${task} ${t('maintenance-done')}`);
    await click(session, t('maintenance-done-confirm'));
    await driver.waitFor('the record', async () =>
      (await driver.findAll(`${task} [data-done-seq]`)).length === 1 ? true : null,
    );
    expect(await attr(session, task, 'data-overdue')).toBe('false');
    const today = new Date();
    expect(await attr(session, task, 'data-next')).toBe(
      iso(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())),
    );
  });

  it('the Dashboard of a finished work leads with what comes due', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    await driver.waitForElement(t('dashboard-aftercare'));
    // First on the page: the work is finished.
    const order = await driver.execute<string[]>(
      `// The cards, not the header's buttons (Snapshot, Close), which carry the prefix too.
       return Array.from(document.querySelectorAll('main [data-testid^="dashboard-"]'))
         .filter((el) => el.closest('header') === null && el.offsetParent !== null)
         .map((el) => el.getAttribute('data-testid'));`,
    );
    // The backup reminder is a notice above the cards (the new work was never backed up); among
    // the cards, After the handover is first.
    expect(order.filter((id) => !id.startsWith('dashboard-backup'))[0]).toBe('dashboard-aftercare');
    expect(await text(session, t('aftercare-overdue-value'))).toMatch(/^0\b/);
    expect(await text(session, t('aftercare-ending-value'))).toMatch(/^1\b/);
    await driver.execute(
      `document.querySelector('[data-testid="dashboard-aftercare"]').scrollIntoView({ block: 'start' })`,
    );
    await session.screenshot('g4-dashboard-en');
  });

  it('the calendar lists the warranty’s month, and the .ics is written for any calendar', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    await click(session, t('dashboard-aftercare-open'));
    await driver.waitForElement(t('aftercare-calendar'));
    const ends = monthsAway(1);
    expect(
      await driver.findAll(`[data-calendar-item][data-kind="warranty-ends"][data-day="${ends}"]`),
    ).toHaveLength(1);
    await session.screenshot('g4-calendar-en');

    const file = path.join(parent, 'aftercare.ics');
    await click(session, t('aftercare-ics'));
    await setValue(session, t('aftercare-ics-path'), file);
    await click(session, t('aftercare-ics-write'));
    await driver.waitFor('the .ics written', async () => {
      const done = await driver.findAll(t('aftercare-ics-done'));
      return done.length > 0 && (await done[0]!.text()).includes('aftercare.ics') ? true : null;
    });
    const ics = readFileSync(file, 'utf8');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('RRULE:FREQ=MONTHLY;INTERVAL=12');
    expect(ics).toContain('Shower valve');
    expect(ics).toContain('Reseal the shower');
    // Every line ends in CRLF: no bare LF anywhere.
    expect(/[^\r]\n/.test(ics)).toBe(false);
    await driver.execute(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    );
  });

  it('the handover book carries the warranty and the maintenance', async () => {
    await go(session, 'reports');
    const file = path.join(parent, 'handover.pdf');
    await setValue(session, t('handover-path'), file);
    await click(session, t('handover-write'));
    await session.driver.waitFor('the book written', async () => {
      const done = await session.driver.findAll(t('handover-done'));
      return done.length > 0 && (await done[0]!.text()).includes('handover.pdf') ? true : null;
    });
    const words = pdfText(readFileSync(file));
    expect(words).toContain('Shower valve');
    expect(words).toContain('Reseal the shower');
  });

  it('says it in Portuguese: Depois da entrega', async () => {
    await chooseLanguage(session, 'Português (Brasil)');
    // The light theme too: these screens are captured and looked at in both themes.
    await chooseTheme(session, 'Português (Brasil)', 'light');
    await go(session, 'dashboard');
    expect(await text(session, t('dashboard-aftercare'))).toMatch(/Depois da entrega/);
    await session.driver.execute(
      `document.querySelector('[data-testid="dashboard-aftercare"]').scrollIntoView({ block: 'start' })`,
    );
    await session.screenshot('g4-dashboard-pt-BR');
    await handoverTab(session);
    await session.driver.execute(
      `document.querySelector('[data-task-id]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('g4-maintenance-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
