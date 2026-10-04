import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pdfText as readPdfText } from './pdf';
import { chooseLanguage, go, startSession, type Session } from './session';

/**
 * Slice F10's proof of done, against the real binary:
 *
 *   the front door composed from every figure the slices made, each carrying its rows; the weekly
 *   report (PDF) in the owner's words; the diary export (PDF and CSV) with the chain verified; the
 *   schedule printed; CSV neutralised, a second reader parses the PDF.
 *
 * The cargo suite parses every PDF with a reader of another lineage. Here the written file is read
 * back from disk by a third, deliberately small one: its content streams inflated with Node's zlib
 * and the strings the page shows collected from them.
 */

const WORK = 'Terrace, synthetic reports';
const FORMULA = '=HYPERLINK("http://example.invalid","x")';

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

/** The words a PDF shows, read back from disk by the shared third reader (e2e/pdf.ts). */
function pdfText(file: string): { text: string; raw: string } {
  const bytes = readFileSync(file);
  return { text: readPdfText(bytes), raw: bytes.toString('latin1') };
}

async function write(
  session: Session,
  pathId: string,
  writeId: string,
  doneId: string,
  file: string,
): Promise<void> {
  await setValue(session, t(pathId), file);
  await click(session, t(writeId));
  await session.driver.waitFor(`${doneId} written`, async () => {
    const done = await session.driver.findAll(t(doneId));
    if (done.length === 0) return null;
    return (await done[0]!.text()).includes(path.basename(file)) ? true : null;
  });
}

describe('F10 — the front door and the reports: every figure with its rows, on screen and on paper', () => {
  let session: Session;
  let parent: string;
  const id: Record<string, string> = {};

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-f10-'));
    const { driver } = session;
    await driver.waitForElement(t('start'));
    await click(session, t('new-work'));
    await setValue(session, t('work-name'), WORK);
    await setValue(session, t('work-folder'), path.join(parent, 'terrace'));
    await click(session, t('work-create'));
    await (
      await driver.findByXPath(
        '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer"]',
      )
    ).click();
    await go(session, 'plan');
    await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
    await setValue(session, t('person-add-name'), 'B. Paver');
    await click(session, t('person-add'));
    await driver.waitForElement('[data-person-id]');
    id['paver'] = await lastId(session, '[data-person-id]', 'data-person-id');
    await setValue(session, t('stage-add-name'), 'Paving');
    await click(session, t('stage-add'));
    await driver.waitForElement('[data-stage-id]');
    id['paving'] = await lastId(session, '[data-stage-id]', 'data-stage-id');
    const stage = `[data-stage-id="${id['paving']}"]`;
    await setValue(session, `${stage} ${t('activity-add-name')}`, 'Lay the pavers');
    await click(session, `${stage} ${t('activity-add')}`);
    await driver.waitForElement('[data-activity-id]');
    id['lay'] = await lastId(session, '[data-activity-id]', 'data-activity-id');
    const row = `[data-activity-id="${id['lay']}"]`;
    await setValue(session, `${row} ${t('activity-duration')}`, '3');
    await setValue(session, `${row} ${t('activity-responsible')}`, id['paver']!);
    await setValue(session, `${stage} ${t('decision-add-name')}`, 'Which paver colour');
    await setValue(session, `${stage} ${t('decision-add-lead')}`, '30');
    await click(session, `${stage} ${t('decision-add')}`);
    await setValue(session, `${row} ${t('cost-line-add-label')}`, 'Pavers');
    await setValue(session, `${row} ${t('cost-line-add-amount')}`, '900.00');
    await click(session, `${row} ${t('cost-line-add')}`);
    await driver.waitForElement(`${row} [data-cost-line-id]`);

    await go(session, 'diary');
    await driver.waitForElement(t('entry-today'));
    await click(session, t(`entry-done-${id['lay']}`));
    await click(session, t(`entry-present-${id['paver']}`));
    await more(session);
    await setValue(session, t('entry-note'), 'The first row of pavers is down.');
    await click(session, t('entry-save'));
    await driver.waitForElement('[data-entry-seq="1"]');
    await more(session);
    await setValue(session, t('entry-note'), FORMULA);
    await click(session, t('entry-save'));
    await driver.waitForElement('[data-entry-seq="2"]');
  }, 240_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('the front door shows this week on site, the people expected and the last entries', async () => {
    const { driver } = session;
    await go(session, 'dashboard');
    expect(await text(session, t('week-entries-value'))).toMatch(/^2\b/);
    expect(await text(session, t('people-expected-value'))).toMatch(/^\d/);
    await driver.waitForElement(t('weather-lost-value'));
    const last = await text(session, t('last-entries'));
    expect(last).toContain('The first row of pavers is down.');
    await driver.execute(
      `document.querySelector('[data-testid="last-entries"]').scrollIntoView({ block: 'center' })`,
    );
    await session.screenshot('f10-dashboard-en');
  });

  it('the weekly report is a PDF in the owner’s words, and a second reader finds them', async () => {
    await go(session, 'reports');
    const file = path.join(parent, 'weekly.pdf');
    await write(session, 'weekly-path', 'weekly-write', 'weekly-done', file);
    await session.screenshot('f10-reports-en');
    const { text: words, raw } = pdfText(file);
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(words).toContain(WORK);
    expect(words).toContain('Lay the pavers');
    expect(words).toContain('B. Paver');
    expect(words).toContain('Which paver colour');
    // The owner's lens, whatever lens is on screen: the engineer's is.
    expect(words.toLowerCase()).toMatch(/week/);
  });

  it('the schedule is printed on a landscape page with every activity', async () => {
    const file = path.join(parent, 'schedule.pdf');
    await write(session, 'schedule-pdf-path', 'schedule-pdf-write', 'schedule-done', file);
    const { text: words, raw } = pdfText(file);
    expect(words).toContain('Lay the pavers');
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(raw);
    expect(box).not.toBeNull();
    expect(Number(box![1])).toBeGreaterThan(Number(box![2]));
  });

  it('the diary is exported with its chain verified, and says what that is and is not', async () => {
    const file = path.join(parent, 'diary.pdf');
    await write(session, 'diary-pdf-path', 'diary-pdf-write', 'diary-done', file);
    const { text: words } = pdfText(file);
    expect(words).toMatch(/Chain verified/);
    expect(words).toMatch(/not legal proof/);
    expect(words).toContain('The first row of pavers is down.');
  });

  it('the diary as CSV never carries a formula', async () => {
    const file = path.join(parent, 'diary.csv');
    await write(session, 'diary-csv-path', 'diary-csv-write', 'diary-done', file);
    const bytes = readFileSync(file);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = bytes.subarray(3).toString('utf8');
    const header = csv.split(/\r?\n/)[0]!;
    expect(header.split(',')).toHaveLength(15);
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).not.toMatch(/(^|[,\n])"?=HYPERLINK/);
  });

  it('the work exports as JSON for anybody else’s tool', async () => {
    const file = path.join(parent, 'work.json');
    await write(session, 'json-path', 'json-write', 'json-done', file);
    const json = JSON.parse(readFileSync(file, 'utf8')) as {
      ridgebeamWork: number;
      work: { work: { name: string } };
      diary: unknown[];
    };
    expect(json.ridgebeamWork).toBe(1);
    expect(json.work.work.name).toBe(WORK);
    expect(json.diary).toHaveLength(2);
  });

  it('says it in Portuguese, and the CSV takes the separator a Portuguese spreadsheet expects', async () => {
    await chooseLanguage(session, 'Português (Brasil)');
    await go(session, 'reports');
    const weekly = path.join(parent, 'semanal.pdf');
    await write(session, 'weekly-path', 'weekly-write', 'weekly-done', weekly);
    expect(pdfText(weekly).text).toMatch(/semana/i);
    const csvFile = path.join(parent, 'diario.csv');
    await write(session, 'diary-csv-path', 'diary-csv-write', 'diary-done', csvFile);
    const header = readFileSync(csvFile).subarray(3).toString('utf8').split(/\r?\n/)[0]!;
    expect(header.split(';')).toHaveLength(15);
    await session.screenshot('f10-reports-pt-BR');
    await chooseLanguage(session, 'English');
  });
});
