import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, chooseTheme, createWork, go, startSession, type Session } from './session';

/**
 * Slice G3's proof of done, against the real binary:
 *
 *   the work teaches the next — the Schedule says, for every activity the diary says started, what
 *   was planned and what it took; the work exports as a template "learned from this work", whose
 *   durations become ranges holding both, saved to the person's own templates; a new work starts
 *   from it, under "Your templates", with those ranges; and it can be removed from there.
 */

const WORK = 'Kitchen joinery, synthetic';
const LEARNED = 'kitchen-joinery-learned';

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

async function attr(session: Session, selector: string, name: string): Promise<string> {
  return session.driver.execute<string>(
    `return document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? ''`,
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A Monday at least three weeks before today, and the days after it, in local time. */
function pastDays(): string[] {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 21);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: 14 }, (_, offset) =>
    iso(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset)),
  );
}

function yesterday(): string {
  const now = new Date();
  return iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
}

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

async function engineer(session: Session): Promise<void> {
  await (
    await session.driver.findByXPath(
      '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
    )
  ).click();
}

async function mineOptions(session: Session): Promise<string[]> {
  return session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll('[data-testid="work-template"] option')).map((o) => o.value).filter((v) => v.startsWith('mine:'))`,
  );
}

describe('G3 — the work teaches the next: planned against actual, and a template learned from it', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};
  const days = pastDays();

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-g3-'));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'joinery'));
    await setValue(session, t('work-start'), days[0]!);
    await createWork(session);
    await engineer(session);
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    await setValue(session, t('person-add-name'), 'L. Joiner');
    await click(session, t('person-add'));
    await driver.waitForElement('[data-person-id]');
    id['joiner'] = await lastId(session, '[data-person-id]', 'data-person-id');
    await setValue(session, t('stage-add-name'), 'Joinery');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    const stage = `[data-stage-id="${await lastId(session, '[data-stage-id]', 'data-stage-id')}"]`;
    for (const [key, name, planned] of [
      ['cabinets', 'Fit the cabinets', '3'],
      ['doors', 'Hang the doors', '2'],
      ['handles', 'Fit the handles', '1'],
    ] as const) {
      const before = (await driver.findAll('[data-activity-id]')).length;
      await setValue(session, `${stage} ${t('activity-add-name')}`, name);
      await click(session, `${stage} ${t('activity-add')}`);
      await driver.waitFor(name, async () =>
        (await driver.findAll('[data-activity-id]')).length === before + 1 ? true : null,
      );
      id[key] = await lastId(session, '[data-activity-id]', 'data-activity-id');
      const row = `[data-activity-id="${id[key]}"]`;
      await setValue(session, `${row} ${t('activity-duration')}`, planned);
      await setValue(session, `${row} ${t('activity-responsible')}`, id['joiner']!);
    }
    await go(session, 'schedule');
    await click(session, t('plan-approve'));
    await driver.waitForElement(t('baseline-number'));

    // The cabinets, planned at 3, took a whole week: Monday to Friday. The doors, planned at 2,
    // took a day. The handles started yesterday and are not finished.
    await writeDay(session, days[0]!, async () => {
      await click(session, t(`entry-done-${id['cabinets']}`));
    });
    await writeDay(session, days[4]!, async () => {
      await click(session, t(`entry-done-${id['cabinets']}`));
      await click(session, t(`entry-finished-${id['cabinets']}`));
    });
    await writeDay(session, days[7]!, async () => {
      await click(session, t(`entry-done-${id['doors']}`));
      await click(session, t(`entry-finished-${id['doors']}`));
    });
    await writeDay(session, yesterday(), async () => {
      await click(session, t(`entry-done-${id['handles']}`));
    });
  }, 300_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('the Schedule says what was planned and what it took', async () => {
    await go(session, 'schedule');
    await session.driver.waitForElement(t('schedule-actuals'));
    expect(await text(session, t('actuals-finished-value'))).toMatch(/^2\b/);
    expect(await text(session, t('actuals-longer-value'))).toMatch(/^1\b/);
    const cabinets = `[data-actual-id="${id['cabinets']}"]`;
    expect(await attr(session, cabinets, 'data-state')).toBe('finished');
    expect(await attr(session, cabinets, 'data-planned')).toBe('3');
    expect(await attr(session, cabinets, 'data-took')).toBe('5');
    expect(await attr(session, cabinets, 'data-difference')).toBe('2');
    expect(await text(session, cabinets)).toMatch(/took 5/i);
    const handles = `[data-actual-id="${id['handles']}"]`;
    expect(await attr(session, handles, 'data-state')).toBe('started');
    expect(await text(session, handles)).toMatch(/so far/i);
    await session.driver.execute(
      `document.querySelector('[data-testid="schedule-actuals"]').scrollIntoView({ block: 'start' })`,
    );
    await session.screenshot('g3-actuals-en');
  });

  it('the work exports as a template learned from it, to the person’s own templates', async () => {
    await go(session, 'plan');
    await click(session, t('template-export'));
    await click(session, `${t('export-numbers')} [data-value="learned"]`);
    expect(await text(session, t('export-learned-counts'))).toMatch(/2 of 3/);
    // Learned goes to My templates unless the person chooses a file.
    expect(await attr(session, `${t('export-where')} [data-value="mine"]`, 'aria-checked')).toBe(
      'true',
    );
    await setValue(session, t('export-id'), LEARNED);
    await session.screenshot('g3-export-en');
    await click(session, t('export-save'));
    expect(await text(session, t('export-done'))).toContain(LEARNED);
    await session.driver.execute(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    );
  });

  it('a new work starts from it, under Your templates, with the ranges it learned', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    await click(session, t('work-close'));
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), 'Next kitchen, synthetic');
    await setValue(session, t('work-folder'), path.join(parent, 'next'));
    expect(await mineOptions(session)).toEqual([`mine:${LEARNED}`]);
    await setValue(session, t('work-template'), `mine:${LEARNED}`);
    await driver.waitForElement(t('template-preview'));
    expect(await text(session, t('templates-mine-folder'))).toMatch(/templates/);
    // It carries a number of its own (the handles' duration): the preview does not promise ranges.
    const preview = await text(session, t('template-preview'));
    expect(preview).toMatch(/Durations learned from Kitchen joinery, synthetic: 2 of 3/);
    expect(preview).toMatch(/come with it as numbers/);
    await driver.execute(
      `document.querySelector('[data-testid="templates-mine-folder"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('g3-picker-en');
    await createWork(session);
    await engineer(session);
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    await driver.waitFor('the learned activities', async () =>
      (await driver.findAll('[data-activity-id]')).length === 3 ? true : null,
    );
    const durations = await driver.execute<Array<{ value: string; hint: string }>>(
      `return Array.from(document.querySelectorAll('[data-testid="activity-duration"]')).map((e) => ({ value: e.value, hint: e.getAttribute('placeholder') || '' }))`,
    );
    // The cabinets: planned 3, took 5 — a range to pick from. The doors: planned 2, took 1. The
    // handles never finished: the number planned, kept as it was.
    expect(durations[0]).toMatchObject({ value: '' });
    expect(durations[0]!.hint).toMatch(/3\s*[–-]\s*5/);
    expect(durations[1]).toMatchObject({ value: '' });
    expect(durations[1]!.hint).toMatch(/1\s*[–-]\s*2/);
    expect(durations[2]).toMatchObject({ value: '1' });
  });

  it('removed from Your templates, it leaves the picker', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    await click(session, t('work-close'));
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-template'), `mine:${LEARNED}`);
    await click(session, t('template-mine-remove'));
    await click(session, t('template-mine-remove-confirm'));
    await driver.waitFor('the template removed', async () =>
      (await mineOptions(session)).length === 0 ? true : null,
    );
  });

  it('says it in Portuguese: Planejado e real', async () => {
    const { driver } = session;
    await driver.execute(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    );
    await chooseLanguage(session, 'Português (Brasil)');
    // The light theme too: these screens are captured and looked at in both themes.
    await chooseTheme(session, 'Português (Brasil)', 'light');
    // From Settings with no work open, an unavailable destination leads back to Start.
    await click(session, 'nav[data-rail] button[data-destination="dashboard"]');
    await driver.waitForElement(t('start'));
    // The first work — the one with a diary — is the older of the two recent ones.
    await (
      await driver.findByXPath(
        `//*[@data-testid="recent-work"][contains(normalize-space(.), ${JSON.stringify(WORK)})]`,
      )
    ).click();
    await go(session, 'schedule');
    expect(await text(session, t('schedule-actuals'))).toMatch(/Planejado e real/);
    await session.driver.execute(
      `document.querySelector('[data-testid="schedule-actuals"]').scrollIntoView({ block: 'start' })`,
    );
    await session.screenshot('g3-actuals-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
