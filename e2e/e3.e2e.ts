import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, chooseTheme, go, startSession, type Session } from './session';

/**
 * Slice E3's proof of done, against the real binary:
 *
 *   the work says when it finishes as things stand — a forecast from the diary, beside the plan's
 *   date, never the same number — and why it is late: each working day of the difference given a
 *   cause from the record (a lost day's stated cause, the weather, a responsible who did not come),
 *   with a party where the record names one, and what the record does not explain said as such. A
 *   lost day's cause goes into the diary's hash chain, and the chain still verifies.
 */

const WORK = 'Laundry, synthetic delays';

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
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A Monday at least three weeks before today, and the next days of its week, in local time. */
function pastWeek(): string[] {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 21);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return [0, 1, 2, 3, 4].map((offset) =>
    iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset)),
  );
}

/** Open "More…" — the lost-day box and the note live there; the day is always shown. */
async function more(session: Session): Promise<void> {
  const open = await session.driver.execute<boolean>(
    `return document.querySelector('[data-testid="entry-lost-day"]') !== null`,
  );
  if (!open) await click(session, t('entry-more'));
  await session.driver.waitForElement(t('entry-lost-day'));
}

async function entryCount(session: Session): Promise<number> {
  return (await session.driver.findAll('[data-entry-seq]')).length;
}

/** Write one entry for a day; `fill` sets what the day says. */
async function writeDay(session: Session, day: string, fill: () => Promise<void>): Promise<void> {
  await go(session, 'diary');
  await session.driver.waitForElement(t('entry-today'));
  const before = await entryCount(session);
  await more(session);
  await setValue(session, t('entry-day'), day);
  await fill();
  await click(session, t('entry-save'));
  await session.driver.waitFor(`the entry of ${day}`, async () =>
    (await entryCount(session)) > before ? true : null,
  );
}

describe('E3 — why is it late: a forecast from the diary, and the causes of the days lost', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};
  const week = pastWeek();

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-e3-'));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'laundry'));
    await setValue(session, t('work-start'), week[0]!);
    await click(session, t('work-create'));
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    await setValue(session, t('person-add-name'), 'J. Plumber');
    await click(session, t('person-add'));
    await driver.waitForElement('[data-person-id]');
    id['plumber'] = await lastId(session, '[data-person-id]', 'data-person-id');
    await setValue(session, t('stage-add-name'), 'Plumbing');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    const stage = `[data-stage-id="${await lastId(session, '[data-stage-id]', 'data-stage-id')}"]`;
    await setValue(session, `${stage} ${t('activity-add-name')}`, 'Move the waste pipe');
    await click(session, `${stage} ${t('activity-add')}`);
    await driver.waitForElement('[data-activity-id]');
    id['pipe'] = await lastId(session, '[data-activity-id]', 'data-activity-id');
    const row = `[data-activity-id="${id['pipe']}"]`;
    await setValue(session, `${row} ${t('activity-duration')}`, '3');
    await setValue(session, `${row} ${t('activity-responsible')}`, id['plumber']!);
    await go(session, 'schedule');
    await click(session, t('plan-approve'));
    await driver.waitForElement(t('baseline-number'));

    // Monday: worked, the plumber there. Tuesday: lost, waiting for a decision. Wednesday: lost to
    // rain, no cause said. Thursday: an entry, the plumber not there, nothing done.
    await writeDay(session, week[0]!, async () => {
      await click(session, t(`entry-done-${id['pipe']}`));
      await click(session, t(`entry-present-${id['plumber']}`));
    });
    await writeDay(session, week[1]!, async () => {
      await click(session, t('entry-lost-day'));
      await click(session, `${t('entry-lost-cause')} [data-value="decision"]`);
    });
    await writeDay(session, week[2]!, async () => {
      await click(session, `${t('entry-weather')} [data-value="rain"]`);
      await click(session, t('entry-lost-day'));
    });
    await writeDay(session, week[3]!, async () => {
      await setValue(session, t('entry-note'), 'Nobody came.');
    });
  }, 240_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('the diary says why a day was lost, in the entry’s own words', async () => {
    await go(session, 'diary');
    const page = await session.driver.execute<string>(
      `return document.querySelector('main')?.innerText ?? ''`,
    );
    expect(page).toMatch(/waiting for a decision/i);
  });

  it('as things stand, the work finishes after its baseline, and the plan’s date is not that date', async () => {
    await go(session, 'schedule');
    await session.driver.waitForElement(t('forecast-card'));
    expect(await text(session, t('forecast-against-baseline'))).toMatch(/[1-9]/);
    await session.driver.execute(
      `document.querySelector('[data-testid="forecast-card"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('e3-forecast-en');
  });

  it('why it is late: the stated cause, the weather, the absent responsible — and what is not explained', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    await driver.waitForElement(t('delay-card'));
    expect(await text(session, t('delay-total-value'))).toMatch(/[1-9]/);
    const causes = await driver.execute<string[]>(
      `return Array.from(document.querySelectorAll('[data-delay-cause]')).map((e) => e.getAttribute('data-delay-cause'))`,
    );
    expect(causes).toEqual(expect.arrayContaining(['decision', 'weather', 'absence']));
    expect(await text(session, t('delay-by-party'))).toContain('J. Plumber');
    await driver.execute(
      `document.querySelector('[data-testid="delay-card"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('e3-delay-en');
  });

  it('a cause in the chain: the diary still verifies, every entry', async () => {
    await go(session, 'diagnostics');
    await click(session, t('diary-verify'));
    await session.driver.waitFor('the chain verified', async () =>
      /chain intact/i.test(
        await session.driver.execute<string>(
          `return document.querySelector('main')?.innerText ?? ''`,
        ),
      )
        ? true
        : null,
    );
  });

  it('the owner’s snapshot says when it finishes as things stand', async () => {
    await go(session, 'reports');
    const file = path.join(parent, 'laundry.html');
    await setValue(session, t('snapshot-path'), file);
    await click(session, t('snapshot-write'));
    await session.driver.waitFor('the snapshot written', async () => {
      const done = await session.driver.findAll(t('snapshot-done'));
      return done.length > 0 && (await done[0]!.text()).includes('laundry.html') ? true : null;
    });
    expect(readFileSync(file, 'utf8')).toMatch(/as things stand/i);
  });

  it('says it in Portuguese: Por que está atrasada?', async () => {
    await chooseLanguage(session, 'Português (Brasil)');
    // The light theme too: these screens are captured and looked at in both themes.
    await chooseTheme(session, 'Português (Brasil)', 'light');
    await go(session, 'dashboard');
    expect(await text(session, t('delay-card'))).toMatch(/Por que está atrasada\?/);
    await session.driver.execute(
      `document.querySelector('[data-testid="delay-card"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('e3-delay-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
