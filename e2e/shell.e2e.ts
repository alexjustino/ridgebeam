import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type Session } from './session';

/**
 * The shell: the window comes up, the rail names every destination, and each one renders a
 * real screen — with nothing open, and in both languages. This is the first thing that must be
 * true of a build before any other claim about it means anything.
 */
describe('shell', () => {
  let session: Session;

  beforeAll(async () => {
    session = await startSession();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('opens on Start with the title bar and the mark', async () => {
    const { driver } = session;
    expect(await driver.title()).toBe('Ridgebeam');
    await driver.waitForElement('[data-testid="start"]');
    const mark = await driver.find('header img, header svg');
    expect(mark).toBeTruthy();
  });

  it('lists every destination, in order, and disables the three that need a work', async () => {
    const { driver } = session;
    const buttons = await driver.findAll('nav[data-rail] button[data-destination]');
    const ids = await Promise.all(buttons.map((b) => b.attribute('data-destination')));
    expect(ids).toEqual(['dashboard', 'plan', 'schedule', 'settings', 'diagnostics', 'about']);
    const disabled = await Promise.all(buttons.map((b) => b.attribute('aria-disabled')));
    expect(disabled).toEqual(['true', 'true', 'true', null, null, null]);
  });

  it.each(['settings', 'diagnostics', 'about'])('navigates to %s and renders an h1', async (id) => {
    const { driver } = session;
    await go(session, id);
    await driver.waitForElement('main h1');
  });

  it('Diagnostics reports the application database the suite relocated', async () => {
    const { driver } = session;
    await go(session, 'diagnostics');
    const row = await driver.waitForText('ridgebeam.sqlite3');
    expect(await row.text()).toContain(session.dataDir.split('\\').pop() ?? session.dataDir);
    await driver.waitForText('RIDGEBEAM_DATA_DIR');
    await session.screenshot('diagnostics-light-en');
  });

  it('About carries the trademark statement and the no-network statement', async () => {
    const { driver } = session;
    await go(session, 'about');
    await driver.waitForText('trademark of Alex Justino');
    await driver.waitForText('network');
    await session.screenshot('about-light-en');
  });

  it('renders in Portuguese, and the rail is translated', async () => {
    const { driver } = session;
    await chooseLanguage(session, 'Português (Brasil)');
    const about = await driver.find('nav[data-rail] button[data-destination="about"]');
    expect((await about.text()).trim()).toBe('Sobre');
    await go(session, 'about');
    await session.screenshot('about-light-pt-BR');
    await chooseLanguage(session, 'English');
  });

  it('renders in the dark theme too', async () => {
    const { driver } = session;
    await go(session, 'settings');
    await (
      await driver.findByXPath('//button[@role="radio" and normalize-space(.)="Dark"]')
    ).click();
    await driver.waitFor(
      'the dark theme',
      async () =>
        (await driver.execute<string | null>(
          'return document.documentElement.getAttribute("data-theme")',
        )) === 'dark',
    );
    await session.screenshot('shell-dark-en');
    await (
      await driver.findByXPath('//button[@role="radio" and normalize-space(.)="Match Windows"]')
    ).click();
  });
});
