import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type Session } from './session';

/**
 * Slice D4's proof of done, against the real binary:
 *
 *   one self-contained HTML file, with no script and nothing loaded from anywhere, that shows the
 *   owner the work as it stands — readiness, the finish, the next two weeks, the last entries with
 *   their photos, the money — every figure still opening onto its rows.
 */

const WORK = 'Kitchen, synthetic snapshot';
const NOTE = 'The old cabinets are out.';

/** A one-pixel PNG: the host re-encodes it as a JPEG for the snapshot. */
function png(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
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

async function more(session: Session): Promise<void> {
  const open = await session.driver.execute<boolean>(
    `return document.querySelector('[data-testid="entry-note"]') !== null`,
  );
  if (!open) await click(session, t('entry-more'));
  await session.driver.waitForElement(t('entry-note'));
}

/**
 * The visible words of an HTML file: tags dropped, character references undone — the host writes
 * more than the five usual ones as references (`/ : = @ (` and the backtick among them).
 */
function words(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

describe('D4 — the owner’s snapshot: one file, nothing that runs, the work as it stands', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};
  let readiness = '';

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-d4-'));
    writeFileSync(path.join(parent, 'cabinets.png'), png());
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
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    await setValue(session, t('person-add-name'), 'D. Joiner');
    await click(session, t('person-add'));
    await driver.waitForElement('[data-person-id]');
    id['joiner'] = await lastId(session, '[data-person-id]', 'data-person-id');
    await setValue(session, t('stage-add-name'), 'Cabinets');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    id['stage'] = await lastId(session, '[data-stage-id]', 'data-stage-id');
    const stage = `[data-stage-id="${id['stage']}"]`;
    await setValue(session, `${stage} ${t('activity-add-name')}`, 'Take out the old cabinets');
    await click(session, `${stage} ${t('activity-add')}`);
    await driver.waitForElement('[data-activity-id]');
    id['out'] = await lastId(session, '[data-activity-id]', 'data-activity-id');
    const row = `[data-activity-id="${id['out']}"]`;
    await setValue(session, `${row} ${t('activity-duration')}`, '2');
    await setValue(session, `${row} ${t('activity-responsible')}`, id['joiner']!);
    await setValue(session, `${stage} ${t('decision-add-name')}`, 'Which worktop');
    await setValue(session, `${stage} ${t('decision-add-lead')}`, '5');
    await click(session, `${stage} ${t('decision-add')}`);

    await go(session, 'diary');
    await driver.waitForElement(t('entry-today'));
    await click(session, t(`entry-done-${id['out']}`));
    await click(session, t(`entry-present-${id['joiner']}`));
    await more(session);
    await setValue(session, t('entry-note'), NOTE);
    await setValue(session, t('entry-photo-path'), path.join(parent, 'cabinets.png'));
    await click(session, t('entry-photo-add'));
    await driver.waitForElement('[data-pending-photo]');
    await click(session, t('entry-save'));
    await driver.waitForElement('[data-entry-seq="1"]');

    await go(session, 'dashboard');
    readiness = await text(session, t('readiness-sentence'));
  }, 180_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('the dashboard leads to the snapshot, and the snapshot is written', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    await click(session, t('dashboard-snapshot'));
    await driver.waitFor('the snapshot card', async () =>
      (await driver.execute<string>(
        `return document.activeElement?.getAttribute('data-testid') ?? ''`,
      )) === 'snapshot-path'
        ? true
        : null,
    );
    const file = path.join(parent, 'kitchen.html');
    await setValue(session, t('snapshot-path'), file);
    await click(session, t('snapshot-write'));
    await driver.waitFor('the snapshot written', async () => {
      const done = await driver.findAll(t('snapshot-done'));
      return done.length > 0 && (await done[0]!.text()).includes('kitchen.html') ? true : null;
    });
    await driver.execute(
      `document.querySelector('[data-testid="snapshot-done"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('d4-reports-en');
  });

  it('the file runs nothing and loads nothing', () => {
    const html = readFileSync(path.join(parent, 'kitchen.html'), 'utf8');
    expect(html.startsWith('<!DOCTYPE html>') || html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toMatch(/<html[^>]*\blang="en"/);
    expect(html).toContain("default-src 'none'; img-src data:; style-src 'unsafe-inline'");
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html.toLowerCase()).not.toMatch(/\son[a-z]+\s*=/);
    expect(html.toLowerCase()).not.toContain('javascript:');
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']?(?:https?:|\/\/)/i);
  });

  it('the file shows the work as it stands, and every figure opens onto its rows', () => {
    const html = readFileSync(path.join(parent, 'kitchen.html'), 'utf8');
    const shown = words(html);
    expect(shown).toContain(WORK);
    expect(shown).toContain(readiness);
    expect(shown).toMatch(/next two weeks/i);
    expect(shown).toContain('Take out the old cabinets');
    expect(shown).toContain('Which worktop');
    expect(shown).toContain(NOTE);
    expect(shown).toMatch(/does not change/i);
    expect(html).toMatch(/<img[^>]+src="data:image\/jpeg;base64,/);
    expect((html.match(/<details/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('says it in Portuguese, in the light theme', async () => {
    const { driver } = session;
    await chooseLanguage(session, 'Português (Brasil)');
    await go(session, 'settings');
    await (
      await driver.findByXPath('//button[@role="radio" and normalize-space(.)="Claro"]')
    ).click();
    await driver.waitFor('the light theme', async () =>
      (await driver.execute<string>(
        "return document.documentElement.getAttribute('data-theme') ?? 'system'",
      )) === 'light'
        ? true
        : null,
    );
    await go(session, 'dashboard');
    expect(await text(session, t('dashboard-snapshot'))).toMatch(/Retrato da obra/);
    await driver.execute(
      `document.querySelector('[data-testid="dashboard-snapshot"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('d4-dashboard-pt-BR');
    await click(session, t('dashboard-snapshot'));
    const file = path.join(parent, 'cozinha.html');
    await setValue(session, t('snapshot-path'), file);
    await click(session, t('snapshot-write'));
    await driver.waitFor('o retrato gravado', async () => {
      const done = await driver.findAll(t('snapshot-done'));
      return done.length > 0 && (await done[0]!.text()).includes('cozinha.html') ? true : null;
    });
    await driver.execute(
      `document.querySelector('[data-testid="snapshot-done"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('d4-reports-pt-BR');
    const html = readFileSync(file, 'utf8');
    expect(html).toMatch(/<html[^>]*\blang="pt-BR"/);
    expect(words(html)).toMatch(/próximas duas semanas/i);
    await chooseLanguage(session, 'English');
  });
});
