import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pdfText } from './pdf';
import { chooseLanguage, chooseTheme, createWork, go, startSession, type Session } from './session';

/**
 * Slice G6's proof of done, against the real binary:
 *
 *   the work told in photos — room by room, first to last: the Diary's "In photos" view shows each
 *   room's photos in day order, and what touches no room in a section of its own; the handover book
 *   and the owner's snapshot carry the same story.
 */

const WORK = 'House, synthetic photo story';

/** A small PNG of one colour: different colours, different bytes, so different photos. */
function png(red: number, green: number, blue: number, width = 48, height = 36): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body) >>> 0, 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set([red, green, blue], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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
function day(offset: number): string {
  const now = new Date();
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
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

/** One entry on `on`, naming `activity` (or nothing), with one photo. */
async function writeDay(
  session: Session,
  on: string,
  activity: string | null,
  photo: string,
  note: string,
): Promise<void> {
  await go(session, 'diary');
  await session.driver.waitForElement(t('entry-today'));
  const before = await entryCount(session);
  await more(session);
  await setValue(session, t('entry-day'), on);
  if (activity !== null) {
    // The form offers what is running that day; an activity that is not is behind "Show every
    // activity".
    const listed = await session.driver.findAll(t(`entry-done-${activity}`));
    if (listed.length === 0) {
      await (
        await session.driver.findByXPath('//button[normalize-space(.)="Show every activity"]')
      ).click();
    }
    await click(session, t(`entry-done-${activity}`));
  }
  await setValue(session, t('entry-note'), note);
  await setValue(session, t('entry-photo-path'), photo);
  await click(session, t('entry-photo-add'));
  await session.driver.waitForElement('[data-pending-photo]');
  await click(session, t('entry-save'));
  await session.driver.waitFor(`the entry of ${on}`, async () =>
    (await entryCount(session)) > before ? true : null,
  );
}

async function sectionDays(session: Session, key: string): Promise<string[]> {
  return session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll('[data-story-section][data-key="${key}"] [data-story-photo]')).map((e) => e.getAttribute('data-day'))`,
  );
}

describe('G6 — the work told in photos: room by room, first to last', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-g6-'));
    writeFileSync(path.join(parent, 'bath-early.png'), png(30, 90, 200));
    writeFileSync(path.join(parent, 'kitchen.png'), png(220, 160, 30));
    writeFileSync(path.join(parent, 'bath-late.png'), png(40, 170, 90));
    writeFileSync(path.join(parent, 'site.png'), png(150, 150, 150));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'house'));
    await setValue(session, t('work-start'), day(-20));
    await createWork(session);
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    for (const room of ['Bathroom', 'Kitchen']) {
      const before = (await driver.findAll('[data-room-id]')).length;
      await setValue(session, t('room-add-name'), room);
      await click(session, t('room-add'));
      await driver.waitFor(room, async () =>
        (await driver.findAll('[data-room-id]')).length === before + 1 ? true : null,
      );
      id[room] = await lastId(session, '[data-room-id]', 'data-room-id');
    }
    await setValue(session, t('stage-add-name'), 'Finishes');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    const stage = `[data-stage-id="${await lastId(session, '[data-stage-id]', 'data-stage-id')}"]`;
    for (const [key, name, room] of [
      ['tiles', 'Lay the bathroom tiles', 0],
      ['cabinets', 'Fit the kitchen cabinets', 1],
    ] as const) {
      const before = (await driver.findAll('[data-activity-id]')).length;
      await setValue(session, `${stage} ${t('activity-add-name')}`, name);
      await click(session, `${stage} ${t('activity-add')}`);
      await driver.waitFor(name, async () =>
        (await driver.findAll('[data-activity-id]')).length === before + 1 ? true : null,
      );
      id[key] = await lastId(session, '[data-activity-id]', 'data-activity-id');
      // The room checkboxes are in room order: Bathroom, then Kitchen.
      await driver.execute(
        `document.querySelectorAll('[data-activity-id="${id[key]}"] [data-testid="activity-rooms"] input[type="checkbox"]')[${room}].click()`,
      );
    }

    // Day A: the bathroom, early. Day B: the kitchen. Day C: the bathroom, late. Day D: the site,
    // naming nothing.
    await writeDay(
      session,
      day(-10),
      id['tiles']!,
      path.join(parent, 'bath-early.png'),
      'Tiles start.',
    );
    await writeDay(
      session,
      day(-8),
      id['cabinets']!,
      path.join(parent, 'kitchen.png'),
      'Cabinets.',
    );
    await writeDay(
      session,
      day(-5),
      id['tiles']!,
      path.join(parent, 'bath-late.png'),
      'Tiles done.',
    );
    await writeDay(session, day(-3), null, path.join(parent, 'site.png'), 'The skip arrived.');
  }, 300_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('the Diary tells each room’s photos first to last, and what touches no room apart', async () => {
    const { driver } = session;
    await go(session, 'diary');
    await click(session, `${t('diary-view')} [data-value="story"]`);
    await driver.waitForElement(t('diary-story'));
    const keys = await driver.execute<string[]>(
      `return Array.from(document.querySelectorAll('[data-story-section]')).map((e) => e.getAttribute('data-key'))`,
    );
    expect(keys).toHaveLength(3);
    const [bath, kitchen, other] = keys as [string, string, string];
    expect(bath).toContain(id['Bathroom']!);
    expect(kitchen).toContain(id['Kitchen']!);
    expect(await sectionDays(session, bath)).toEqual([day(-10), day(-5)]);
    expect(await sectionDays(session, kitchen)).toEqual([day(-8)]);
    expect(await sectionDays(session, other)).toEqual([day(-3)]);
    expect(await text(session, `[data-story-section][data-key="${bath}"]`)).toMatch(/2 photos/);
    await driver.execute(
      `document.querySelector('[data-testid="diary-story"]').scrollIntoView({ block: 'start' })`,
    );
    await session.screenshot('g6-diary-story-en');
  });

  it('the handover book tells the same story', async () => {
    await go(session, 'reports');
    const file = path.join(parent, 'handover.pdf');
    await setValue(session, t('handover-path'), file);
    await click(session, t('handover-write'));
    await session.driver.waitFor('the book written', async () => {
      const done = await session.driver.findAll(t('handover-done'));
      return done.length > 0 && (await done[0]!.text()).includes('handover.pdf') ? true : null;
    });
    const words = pdfText(readFileSync(file));
    expect(words).toMatch(/From .+ to .+: 2 photos/);
    expect(words).toContain('Lay the bathroom tiles');
  });

  it('the owner’s snapshot carries the work in photos', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    await click(session, t('dashboard-snapshot'));
    const file = path.join(parent, 'house.html');
    await setValue(session, t('snapshot-path'), file);
    await click(session, t('snapshot-write'));
    await driver.waitFor('the snapshot written', async () => {
      const done = await driver.findAll(t('snapshot-done'));
      return done.length > 0 && (await done[0]!.text()).includes('house.html') ? true : null;
    });
    const html = readFileSync(file, 'utf8');
    expect(html).toContain('The work in photos');
    // Lately on site embeds the four entries' photos; the story embeds them again, room by room.
    expect((html.match(/<img\b/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(html.toLowerCase()).not.toContain('<script');
  });

  it('says it in Portuguese: Em fotos', async () => {
    const { driver } = session;
    await chooseLanguage(session, 'Português (Brasil)');
    // The light theme too: these screens are captured and looked at in both themes.
    await chooseTheme(session, 'Português (Brasil)', 'light');
    await go(session, 'diary');
    await click(session, `${t('diary-view')} [data-value="story"]`);
    await driver.waitForElement(t('diary-story'));
    expect(await text(session, t('diary-view'))).toMatch(/Em fotos/);
    await driver.execute(
      `document.querySelector('[data-testid="diary-story"]').scrollIntoView({ block: 'start' })`,
    );
    await session.screenshot('g6-diary-story-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
