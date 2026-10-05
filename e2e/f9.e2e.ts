import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, createWork, go, startSession, type Session } from './session';

/**
 * Slice F9's proof of done, against the real binary:
 *
 *   the library ships as data and is schema-tested; a work starts from a template as a plan with
 *   ranges; a work exports as a template with numbers stripped or kept.
 *
 * The expectations are read from the library files themselves, so a template can change without
 * this suite being edited: what the screen shows must be what the file says.
 */

type Text = { en?: string; 'pt-BR'?: string };
interface Range {
  min: number;
  max: number;
}
interface TemplateFile {
  id: string;
  title: Text;
  includes?: string[];
  stages: {
    key: string;
    name: Text;
    costLines?: unknown[];
    activities: { key: string; name: Text; durationDays?: Range }[];
  }[];
}

const LIBRARY_DIR = path.resolve(process.cwd(), 'templates');
const library = new Map<string, TemplateFile>(
  readdirSync(LIBRARY_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const template = JSON.parse(
        readFileSync(path.join(LIBRARY_DIR, file), 'utf8'),
      ) as TemplateFile;
      return [template.id, template];
    }),
);

/** A template's stages with its includes expanded first, in order, each once. */
function stagesOf(id: string, seen = new Set<string>()): TemplateFile['stages'] {
  if (seen.has(id)) return [];
  seen.add(id);
  const template = library.get(id)!;
  return [...(template.includes ?? []).flatMap((each) => stagesOf(each, seen)), ...template.stages];
}

const BATHROOM = 'bathroom-renovation';

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

async function values(session: Session, selector: string): Promise<string[]> {
  return session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((e) => e.value)`,
  );
}

async function texts(session: Session, selector: string): Promise<string[]> {
  return session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((e) => (e.textContent || '').trim())`,
  );
}

async function placeholders(session: Session, selector: string): Promise<string[]> {
  return session.driver.execute<string[]>(
    `return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map((e) => e.getAttribute('placeholder') || '')`,
  );
}

const t = (id: string) => `[data-testid="${id}"]`;

async function breakdown(session: Session): Promise<void> {
  await go(session, 'plan');
  await click(session, '[data-testid="plan-tabs"] [data-tab="breakdown"]');
}

async function engineer(session: Session): Promise<void> {
  await (
    await session.driver.findByXPath(
      '//*[@data-testid="lens-switch"]//button[@role="radio" and normalize-space(.)="Engineer" or normalize-space(.)="Engenheiro"]',
    )
  ).click();
}

/** Fill the New work form; `template` is "empty", a library id, or a file path. */
async function newWork(
  session: Session,
  name: string,
  folder: string,
  template: string,
): Promise<void> {
  // From Settings with no work open, an unavailable destination leads back to Start.
  if ((await session.driver.findAll(t('start'))).length === 0) {
    await click(session, 'nav[data-rail] button[data-destination="dashboard"]');
  }
  await session.driver.waitForElement(t('start'));
  await click(session, t('new-work'));
  await setValue(session, t('work-name'), name);
  await setValue(session, t('work-folder'), folder);
  if (template.endsWith('.json')) {
    await setValue(session, t('work-template'), 'file');
    await setValue(session, t('template-path'), template);
  } else {
    await setValue(session, t('work-template'), template);
  }
}

async function show(session: Session, selector: string): Promise<void> {
  await session.driver.execute(
    `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`,
  );
}

async function closeWork(session: Session): Promise<void> {
  await go(session, 'dashboard');
  await click(session, t('work-close'));
  await session.driver.waitForElement(t('start'));
}

describe('F9 — templates: a work starts as a plan with ranges, and exports as a template', () => {
  let session: Session;
  let parent: string;

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-f9-'));
  }, 60_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  it('the library is there, and a template is previewed as a starting point, not a quote', () => {
    expect(library.size).toBeGreaterThanOrEqual(6);
    expect(library.has(BATHROOM)).toBe(true);
  });

  it('a work starts from a template as a plan: its stages, and ranges where durations will go', async () => {
    const { driver } = session;
    const stages = stagesOf(BATHROOM);
    const activities = stages.flatMap((stage) => stage.activities);
    await newWork(session, 'Bathroom, synthetic template', path.join(parent, 'bath'), BATHROOM);
    const preview = await text(session, t('template-preview'));
    expect(preview).toContain(String(stages.length));
    expect(preview).toContain(String(activities.length));
    expect(preview).toMatch(/not a quote/i);
    await show(session, t('template-preview'));
    await session.screenshot('f9-start-preview-en');
    await createWork(session);
    await engineer(session);
    await go(session, 'dashboard');
    expect(await text(session, t('template-provenance'))).toContain(
      library.get(BATHROOM)!.title.en!,
    );

    await breakdown(session);
    await driver.waitFor('the template stages', async () =>
      (await driver.findAll('[data-stage-id]')).length === stages.length ? true : null,
    );
    expect(await texts(session, t('stage-name'))).toEqual(stages.map((stage) => stage.name.en));
    const durations = await values(session, t('activity-duration'));
    expect(durations).toHaveLength(activities.length);
    // A range is a range until a person picks: no duration is invented.
    expect(durations.every((value) => value === '')).toBe(true);
    const hints = await placeholders(session, t('activity-duration'));
    expect(hints.every((hint) => /\d+\s*[–-]\s*\d+/.test(hint))).toBe(true);
    await show(session, '[data-activity-id]');
    await session.screenshot('f9-breakdown-ranges-en');
  });

  it('readiness names the ranges, and "use the upper end" turns every range into its duration', async () => {
    const { driver } = session;
    const activities = stagesOf(BATHROOM).flatMap((stage) => stage.activities);
    await go(session, 'dashboard');
    expect(
      await text(session, `${t('readiness-rules')} [data-rule-id="activity.duration"]`),
    ).toMatch(new RegExp(`0 of ${activities.length}`));
    await breakdown(session);
    await click(session, t('ranges-take-high'));
    await driver.waitFor('durations from the ranges', async () =>
      (await values(session, t('activity-duration'))).every((value) => value !== '') ? true : null,
    );
    const taken = (await values(session, t('activity-duration'))).map(Number).sort((a, b) => a - b);
    const maxima = activities.map((activity) => activity.durationDays!.max).sort((a, b) => a - b);
    expect(taken).toEqual(maxima);
    expect(await driver.findAll(t('ranges-take-high'))).toHaveLength(0);
    await go(session, 'dashboard');
    expect(
      await text(session, `${t('readiness-rules')} [data-rule-id="activity.duration"]`),
    ).toMatch(new RegExp(`${activities.length} of ${activities.length}`));
    expect(await text(session, t('finish-date'))).toMatch(/\d{4}/);
  });

  it('cost lines come without prices: money is not planned until a person prices a line', async () => {
    const { driver } = session;
    const stages = stagesOf(BATHROOM);
    const lines = stages.reduce((sum, stage) => sum + (stage.costLines?.length ?? 0), 0);
    expect(lines).toBeGreaterThan(0);
    await go(session, 'dashboard');
    expect(await text(session, `${t('readiness-rules')} [data-rule-id="stage.money"]`)).toMatch(
      new RegExp(`0 of ${stages.length}`),
    );
    await breakdown(session);
    expect(await driver.findAll('[data-cost-line-id][data-unpriced]')).toHaveLength(lines);
    const first = await driver.execute<string>(
      `return document.querySelector('[data-cost-line-id][data-unpriced]').getAttribute('data-cost-line-id')`,
    );
    await setValue(session, `[data-cost-line-id="${first}"] ${t('cost-line-amount')}`, '500.00');
    await driver.waitFor('one line priced', async () =>
      (await driver.findAll('[data-cost-line-id][data-unpriced]')).length === lines - 1
        ? true
        : null,
    );
    await go(session, 'dashboard');
    expect(await text(session, `${t('readiness-rules')} [data-rule-id="stage.money"]`)).toMatch(
      new RegExp(`1 of ${stages.length}`),
    );
  });

  it('a work exports as a template, with its numbers stripped or kept', async () => {
    const { driver } = session;
    const exportAs = async (numbers: 'strip' | 'keep', file: string) => {
      await go(session, 'plan');
      await click(session, t('template-export'));
      await click(session, `${t('export-numbers')} [data-value="${numbers}"]`);
      await setValue(session, t('export-path'), file);
      await click(session, t('export-confirm'));
      expect(await text(session, t('export-done'))).toContain(path.basename(file));
      if (numbers === 'strip') await session.screenshot('f9-export-en');
      await driver.execute(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
      );
    };
    const stripped = path.join(parent, 'stripped.json');
    const kept = path.join(parent, 'kept.json');
    await exportAs('strip', stripped);
    await exportAs('keep', kept);
    const strippedText = readFileSync(stripped, 'utf8');
    const keptText = readFileSync(kept, 'utf8');
    expect(strippedText).not.toContain('amountCents');
    expect(strippedText).not.toContain('leadDays');
    expect(keptText).toContain('"amountCents": 50000');
    expect(JSON.parse(keptText).stages).toHaveLength(stagesOf(BATHROOM).length);
  });

  it('a new work starts from the exported file, with its own numbers', async () => {
    const { driver } = session;
    const stages = stagesOf(BATHROOM);
    const lines = stages.reduce((sum, stage) => sum + (stage.costLines?.length ?? 0), 0);
    await closeWork(session);
    await newWork(
      session,
      'Bathroom again, synthetic',
      path.join(parent, 'again'),
      path.join(parent, 'kept.json'),
    );
    await createWork(session);
    await engineer(session);
    await breakdown(session);
    await driver.waitFor('the exported stages', async () =>
      (await driver.findAll('[data-stage-id]')).length === stages.length ? true : null,
    );
    expect(await driver.findAll('[data-cost-line-id][data-unpriced]')).toHaveLength(lines - 1);
    // The durations were kept as numbers, not as ranges to pick from.
    expect((await values(session, t('activity-duration'))).every((value) => value !== '')).toBe(
      true,
    );
    await closeWork(session);
  });

  it('a template with a link cycle, or one that includes itself, is refused, and no work is left behind', async () => {
    const { driver } = session;
    const base = {
      ridgebeamTemplate: 1,
      version: 1,
      title: { en: 'Synthetic' },
      summary: { en: 'A starting point, not a quote.' },
    };
    const cycle = path.join(parent, 'cycle.json');
    writeFileSync(
      cycle,
      JSON.stringify({
        ...base,
        id: 'cycle',
        stages: [
          {
            key: 'a',
            name: { en: 'A' },
            activities: [{ key: 'x', name: { en: 'X' }, durationDays: { min: 1, max: 2 } }],
          },
          {
            key: 'b',
            name: { en: 'B' },
            activities: [{ key: 'y', name: { en: 'Y' }, durationDays: { min: 1, max: 2 } }],
          },
        ],
        links: [
          { blocker: 'a', blocked: 'b', lagDays: 0 },
          { blocker: 'b', blocked: 'a', lagDays: 0 },
        ],
      }),
    );
    const self = path.join(parent, 'self.json');
    writeFileSync(
      self,
      JSON.stringify({ ...base, id: 'self', includes: ['self'], stages: [], links: [] }),
    );
    for (const [file, folder] of [
      [cycle, path.join(parent, 'cycle-work')],
      [self, path.join(parent, 'self-work')],
    ] as const) {
      await newWork(session, 'Refused, synthetic', folder, file);
      await click(session, t('work-create'));
      expect(await text(session, t('template-problem'))).not.toBe('');
      expect(existsSync(folder) && readdirSync(folder).length > 0).toBe(false);
      // No work was opened: the destinations that need one are still disabled.
      expect(
        await driver.execute<boolean>(
          `return document.querySelector('nav[data-rail] button[data-destination="dashboard"]').getAttribute('aria-disabled') === 'true'`,
        ),
      ).toBe(true);
      if (file === cycle) {
        await show(session, t('template-problem'));
        await session.screenshot('f9-refused-en');
      }
      // A refusal leaves the New work dialog open, with the sentence in it; close it.
      await driver.execute(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
      );
      await driver.waitFor('the dialog closed', async () =>
        (await driver.findAll(t('work-create'))).length === 0 ? true : null,
      );
    }
  });

  it('every template in the library applies to an empty work without a refusal', async () => {
    const { driver } = session;
    for (const id of library.keys()) {
      await newWork(session, `Library ${id}, synthetic`, path.join(parent, `lib-${id}`), id);
      await createWork(session);
      await breakdown(session);
      await driver.waitFor(`the ${id} stages`, async () =>
        (await driver.findAll('[data-stage-id]')).length === stagesOf(id).length ? true : null,
      );
      await closeWork(session);
    }
  });

  it('says it in Portuguese: the library in Portuguese, and the plan it starts', async () => {
    const { driver } = session;
    await chooseLanguage(session, 'Português (Brasil)');
    const bathroom = library.get(BATHROOM)!;
    await newWork(session, 'Banheiro, sintético', path.join(parent, 'banheiro'), BATHROOM);
    const option = await driver.execute<string>(
      `return document.querySelector('[data-testid="work-template"] option[value="${BATHROOM}"]').textContent.trim()`,
    );
    expect(option).toBe(bathroom.title['pt-BR']);
    await session.screenshot('f9-start-preview-pt-BR');
    await createWork(session);
    await engineer(session);
    await breakdown(session);
    await driver.waitForElement('[data-stage-id]');
    expect((await texts(session, t('stage-name')))[0]).toBe(stagesOf(BATHROOM)[0]!.name['pt-BR']);
    await show(session, '[data-activity-id]');
    await session.screenshot('f9-breakdown-pt-BR');
    await closeWork(session);
    await chooseLanguage(session, 'English');
  });
});
