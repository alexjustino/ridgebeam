import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pdfText } from './pdf';
import { chooseLanguage, createWork, go, startSession, type Session } from './session';

/**
 * Slice G1's proof of done, against the real binary:
 *
 *   the weekly site meeting writes itself — the agenda comes from the record (a decision overdue, a
 *   change order waiting, a snag open); what is decided is done there through the product's own
 *   commands; actions are written with who and by when; closing writes minutes that are never
 *   edited; the next meeting starts from the open action and closes it.
 */

const WORK = 'Kitchen, synthetic meeting';

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

const item = (kind: string) => `[data-agenda-item][data-kind="${kind}"]`;

async function openMeeting(session: Session): Promise<void> {
  await go(session, 'dashboard');
  await click(session, t('meeting-open'));
  await session.driver.waitForElement(t('meeting-agenda'));
}

async function closeMeeting(session: Session): Promise<void> {
  await click(session, t('meeting-close'));
  await click(session, t('meeting-confirm'));
  await session.driver.waitForElement(t('dashboard-meeting'));
}

describe('G1 — the weekly site meeting: an agenda from the record, minutes never edited', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-g1-'));
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
    for (const name of ['L. Joiner', 'M. Owner']) {
      const before = (await driver.findAll('[data-person-id]')).length;
      await setValue(session, t('person-add-name'), name);
      await click(session, t('person-add'));
      await driver.waitFor(name, async () =>
        (await driver.findAll('[data-person-id]')).length === before + 1 ? true : null,
      );
      id[name] = await lastId(session, '[data-person-id]', 'data-person-id');
    }
    await setValue(session, t('stage-add-name'), 'Joinery');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    id['stage'] = await lastId(session, '[data-stage-id]', 'data-stage-id');
    const stage = `[data-stage-id="${id['stage']}"]`;
    await setValue(session, `${stage} ${t('activity-add-name')}`, 'Fit the cabinets');
    await click(session, `${stage} ${t('activity-add')}`);
    await driver.waitForElement('[data-activity-id]');
    const row = `[data-activity-id="${await lastId(session, '[data-activity-id]', 'data-activity-id')}"]`;
    await setValue(session, `${row} ${t('activity-duration')}`, '3');
    await setValue(session, `${row} ${t('activity-responsible')}`, id['L. Joiner']!);
    // A decision whose lead time has already passed: overdue on the first day.
    await setValue(session, `${stage} ${t('decision-add-name')}`, 'Which worktop');
    await setValue(session, `${stage} ${t('decision-add-lead')}`, '5');
    await click(session, `${stage} ${t('decision-add')}`);
    await go(session, 'schedule');
    await click(session, t('plan-approve'));
    await driver.waitForElement(t('baseline-number'));

    // A change order waiting, and a snag open.
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="changes"]');
    await click(session, t('change-raise'));
    await setValue(session, t('change-title'), 'A deeper pantry');
    await click(session, `${t('change-asked-by')} [data-value="owner"]`);
    await setValue(session, t('change-cost'), '250.00');
    await click(session, t('change-save'));
    await driver.waitForElement('[data-change-id]');
    await click(session, '[data-testid="plan-tabs"] [data-tab="snags"]');
    await click(session, t('snag-raise'));
    await setValue(session, t('snag-title'), 'A door that sticks');
    await setValue(session, t('snag-stage'), id['stage']!);
    await setValue(session, t('snag-person'), id['L. Joiner']!);
    await click(session, t('snag-save'));
    await driver.waitForElement('[data-snag-id]');
  }, 240_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('the agenda is written from the record: the decision, the change, the snag', async () => {
    await openMeeting(session);
    for (const kind of ['decision', 'change', 'snag']) {
      expect(await session.driver.findAll(item(kind))).not.toHaveLength(0);
    }
    expect(await text(session, item('decision'))).toContain('Which worktop');
    expect(await text(session, item('change'))).toContain('A deeper pantry');
    expect(await text(session, item('snag'))).toContain('A door that sticks');
    await session.screenshot('g1-agenda-en');
  });

  it('in the meeting: who was there, the decision made, the change approved, an action written', async () => {
    const { driver } = session;
    for (const name of ['L. Joiner', 'M. Owner']) {
      await click(session, `li[data-person-id="${id[name]}"] ${t('meeting-attendee')}`);
    }
    await setValue(
      session,
      `${item('snag')} ${t('meeting-item-note')}`,
      'The joiner will plane it.',
    );
    await click(session, `${item('decision')} ${t('meeting-item-act')}[data-act="make"]`);
    await setValue(session, t('decision-answer'), 'White oak');
    await click(session, t('decision-make-confirm'));
    await driver.waitFor('the decision outcome', async () =>
      /White oak/.test(await text(session, `${item('decision')} ${t('meeting-item-outcome')}`))
        ? true
        : null,
    );
    await click(session, `${item('change')} ${t('meeting-item-act')}[data-act="approve"]`);
    await click(session, t('change-confirm'));
    await driver.waitForElement(`${item('change')} ${t('meeting-item-outcome')}`);
    await click(session, t('meeting-action-add'));
    await setValue(session, t('meeting-action-text'), 'Bring the worktop samples');
    await setValue(session, t('meeting-action-person'), id['L. Joiner']!);
    await setValue(session, t('meeting-action-due'), day(4));
    await session.screenshot('g1-meeting-en');
    await closeMeeting(session);
    expect(await text(session, t('meeting-actions-open-value'))).toMatch(/^1\b/);
  });

  it('what was done in the meeting is in the record: the decision made, the replanning open', async () => {
    await go(session, 'schedule');
    expect(await text(session, t('replanning-open'))).toMatch(/Change order #1/);
    await go(session, 'decisions');
    const page = await session.driver.execute<string>(
      `return document.querySelector('main')?.innerText ?? ''`,
    );
    expect(page).toContain('White oak');
  });

  it('the next meeting starts from the open action, and closes it', async () => {
    await openMeeting(session);
    expect(await text(session, item('action-carried'))).toContain('Bring the worktop samples');
    expect(await session.driver.findAll(item('decision'))).toHaveLength(0);
    await click(session, `${item('action-carried')} ${t('action-done')}`);
    await closeMeeting(session);
    expect(await text(session, t('meeting-actions-open-value'))).toMatch(/^0\b/);
  });

  it('the minutes print, with the answer and the action closed', async () => {
    await go(session, 'reports');
    const first = await session.driver.execute<string>(
      `return Array.from(document.querySelectorAll('[data-testid="meeting-minutes-choose"] option')).find((o) => o.textContent.trim().startsWith('#1 '))?.value ?? ''`,
    );
    expect(first).not.toBe('');
    await setValue(session, t('meeting-minutes-choose'), first);
    const file = path.join(parent, 'minutes-1.pdf');
    await setValue(session, t('meeting-minutes-path'), file);
    await click(session, t('meeting-minutes-write'));
    await session.driver.waitFor('minutes 1', async () => {
      const done = await session.driver.findAll(t('meeting-minutes-done'));
      return done.length > 0 && (await done[0]!.text()).includes('minutes-1.pdf') ? true : null;
    });
    const words = pdfText(readFileSync(file));
    expect(words).toContain('White oak');
    expect(words).toContain('Bring the worktop samples');
    expect(words).toContain('L. Joiner');
  });

  it('says it in Portuguese: Reunião da semana', async () => {
    await chooseLanguage(session, 'Português (Brasil)');
    await go(session, 'dashboard');
    expect(await text(session, t('dashboard-meeting'))).toMatch(/Reunião da semana/);
    await chooseLanguage(session, 'English');
  });
});
