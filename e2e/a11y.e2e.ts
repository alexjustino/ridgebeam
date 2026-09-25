import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type LanguageName, type Session } from './session';
import { Keys } from './webdriver';

/**
 * Accessibility is gated, not reviewed (ADR-011):
 *
 *   every screen, both themes, both languages, serious/critical = fail; keyboard reachable.
 *
 * axe-core is injected into the running window and run against each screen in the light theme
 * and the dark one, in English and in Portuguese, because a contrast failure hides in exactly
 * one theme and a missing name hides in exactly one language. What axe cannot judge — that the
 * keyboard reaches everything and that focus is visible — is checked by tabbing through the
 * shell and reading focus back.
 */

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf-8');

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[]; failureSummary: string }[];
}

const SCREENS = ['dashboard', 'plan', 'settings', 'diagnostics', 'about'] as const;
const THEMES = ['Light', 'Dark'] as const;
const LANGUAGES: LanguageName[] = ['English', 'Português (Brasil)'];
const THEME_LABELS: Record<LanguageName, Record<(typeof THEMES)[number], string>> = {
  English: { Light: 'Light', Dark: 'Dark' },
  'Português (Brasil)': { Light: 'Claro', Dark: 'Escuro' },
};

async function setValue(session: Session, testId: string, value: string): Promise<void> {
  await session.driver.waitForElement(`[data-testid="${testId}"]`);
  await session.driver.execute(
    `const el = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
     Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
     el.dispatchEvent(new Event('input', { bubbles: true }));`,
  );
}

/** Set the theme the way a person does — the Settings control — so the accent tokens follow. */
async function setTheme(
  session: Session,
  language: LanguageName,
  theme: (typeof THEMES)[number],
): Promise<void> {
  const { driver } = session;
  const label = THEME_LABELS[language][theme];
  await go(session, 'settings');
  await (
    await driver.findByXPath(`//button[@role="radio" and normalize-space(.)="${label}"]`)
  ).click();
  await driver.waitFor(`the ${theme} theme`, async () =>
    (await driver.execute<string>(
      "return document.documentElement.getAttribute('data-theme') ?? 'system'",
    )) === theme.toLowerCase()
      ? true
      : null,
  );
}

async function violations(session: Session): Promise<AxeViolation[]> {
  await session.driver.execute(AXE_SOURCE);
  const result = await session.driver.executeAsync<{ violations: AxeViolation[] }>(
    `const done = arguments[arguments.length - 1];
     window.axe
       .run(document, { resultTypes: ['violations'] })
       .then((r) => done({ violations: r.violations }))
       .catch((e) => done({ violations: [{ id: 'axe-failed', impact: 'serious', help: String(e), nodes: [] }] }));`,
  );
  return result.violations;
}

function report(screen: string, theme: string, language: string, found: AxeViolation[]): string {
  return found
    .map(
      (v) =>
        `\n  [${screen}/${theme}/${language}] ${v.id} (${v.impact ?? 'n/a'}): ${v.help}\n` +
        v.nodes.map((n) => `    at ${n.target.join(' ')}\n    ${n.failureSummary}`).join('\n'),
    )
    .join('\n');
}

describe('accessibility', () => {
  let session: Session;
  let parent: string;

  beforeAll(async () => {
    session = await startSession();
    parent = mkdtempSync(path.join(tmpdir(), 'ridgebeam-a11y-'));
    const { driver } = session;
    // The Start screen first, under axe, with nothing open.
    await driver.waitForElement('[data-testid="start"]');
    const found = await violations(session);
    expect(found, report('start', 'Light', 'English', found)).toEqual([]);
    // Then a work with one stage and one activity, so every screen has its furniture.
    await (await driver.waitForElement('[data-testid="new-work"]')).click();
    await setValue(session, 'work-name', 'Synthetic kitchen');
    await setValue(session, 'work-folder', path.join(parent, 'kitchen'));
    await (await driver.waitForElement('[data-testid="work-create"]')).click();
    await go(session, 'plan');
    await (
      await session.driver.waitForElement('[data-testid="plan-tabs"] [data-tab="breakdown"]')
    ).click();
    await setValue(session, 'stage-add-name', 'Demolition');
    await (await driver.waitForElement('[data-testid="stage-add"]')).click();
    await driver.waitForElement('[data-stage-id]');
    await setValue(session, 'activity-add-name', 'Take the old tiles off');
    await (await driver.waitForElement('[data-testid="activity-add"]')).click();
    await driver.waitForElement('[data-activity-id]');
  }, 120_000);

  afterAll(async () => {
    await session?.stop();
    if (!process.env.RIDGEBEAM_E2E_KEEP && parent) rmSync(parent, { recursive: true, force: true });
  });

  for (const language of LANGUAGES) {
    for (const theme of THEMES) {
      for (const screen of SCREENS) {
        it(`${screen} has no axe violations — ${theme}, ${language}`, async () => {
          await chooseLanguage(session, language);
          await setTheme(session, language, theme);
          await go(session, screen);
          if (screen === 'dashboard') {
            // The figure open, so its rows are under axe too.
            await (await session.driver.waitForElement('[data-testid="figure-value"]')).click();
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
          const found = await violations(session);
          expect(found, report(screen, theme, language, found)).toEqual([]);
          const tag = language === 'English' ? 'en' : 'pt-BR';
          await session.screenshot(`a11y-${screen}-${theme.toLowerCase()}-${tag}`);
        }, 60_000);
      }
    }
  }

  async function focused(): Promise<string> {
    return session.driver.execute<string>(
      `const el = document.activeElement;
       if (!el || el === document.body) return 'BODY';
       const label = el.getAttribute('aria-label') || el.getAttribute('data-testid') || el.textContent?.trim().slice(0, 30) || '';
       return el.tagName + ':' + label + (el.matches(':focus-visible') ? ':ring' : '');`,
    );
  }

  async function tabUntil(matches: (label: string) => boolean, budget = 60): Promise<string[]> {
    const path: string[] = [];
    for (let i = 0; i < budget; i += 1) {
      await session.driver.chord(Keys.TAB);
      const now = await focused();
      path.push(now);
      if (matches(now)) return path;
    }
    return path;
  }

  it('reaches the rail and the readiness figure with real Tab presses, and focus shows', async () => {
    const { driver } = session;
    await chooseLanguage(session, 'English');
    await setTheme(session, 'English', 'Light');
    await go(session, 'dashboard');
    await driver.execute('document.activeElement && document.activeElement.blur();');
    const path = await tabUntil((label) => label.startsWith('BUTTON:figure-value'));
    const text = path.join(' | ');
    expect(path.at(-1), text).toMatch(/^BUTTON:figure-value.*:ring$/);
    expect(
      path.every((s) => s.endsWith(':ring')),
      text,
    ).toBe(true);
    await driver.chord(Keys.ENTER);
    await driver.waitForElement('[data-testid="figure-row"]');
    await session.screenshot('a11y-keyboard');
  }, 60_000);

  it('the confirm dialog takes focus, keeps it, and gives it back on Escape', async () => {
    const { driver } = session;
    await go(session, 'plan');
    await (
      await session.driver.waitForElement('[data-testid="plan-tabs"] [data-tab="breakdown"]')
    ).click();
    const remove = await driver.waitForElement(
      '[data-activity-id] [data-testid="activity-remove"]',
    );
    await remove.click();
    await driver.waitForElement('[role="dialog"]');
    const inside = () =>
      driver.execute<boolean>(
        'const d = document.querySelector("[role=dialog]"); return !!d && d.contains(document.activeElement);',
      );
    expect(await inside()).toBe(true);
    for (let i = 0; i < 6; i += 1) {
      await driver.chord(Keys.TAB);
      expect(await inside(), `after ${i + 1} tabs the focus left the dialog`).toBe(true);
    }
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor(
      'the dialog gone',
      async () =>
        (await driver.execute<boolean>(
          'return document.querySelector("[role=dialog]") === null',
        )) === true,
    );
    expect(await focused()).toMatch(/activity-remove/);
  }, 60_000);
});
