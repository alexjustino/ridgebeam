import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseLanguage, go, startSession, type Session } from './session';

/**
 * Settings, against the real binary: the theme, the language and the lens a person sets
 * survive a restart and live in the application's own database rather than the browser's
 * storage; a key the host does not keep, or a value that does not fit, is refused with a
 * sentence (ADR-013).
 */

type InvokeResult<T> = T | { __error: string };

describe('settings', () => {
  let session: Session;

  beforeAll(async () => {
    session = await startSession();
  });

  afterAll(async () => {
    await session?.stop();
  });

  const invoke = <T>(command: string, args: Record<string, unknown>) =>
    session.driver.executeAsync<InvokeResult<T>>(
      'const [command, args, done] = arguments;' +
        'window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: e && e.message ? e.message : JSON.stringify(e) }));',
      [command, args],
    );

  const themeOnScreen = () =>
    session.driver.execute<string | null>(
      'return document.documentElement.getAttribute("data-theme")',
    );

  it('keeps the theme, the language and the lens a person sets, across a restart', async () => {
    const { driver } = session;
    await go(session, 'settings');
    await (
      await driver.findByXPath('//button[@role="radio" and normalize-space(.)="Dark"]')
    ).click();
    await driver.waitFor('the dark theme', async () => (await themeOnScreen()) === 'dark');
    await chooseLanguage(session, 'Português (Brasil)');
    await (
      await driver.findByXPath('//button[@role="radio" and normalize-space(.)="Engenheiro"]')
    ).click();
    await driver.waitFor('the lens written', async () =>
      JSON.stringify(await invoke('settings_get', {})).includes('"engineer"') ? true : null,
    );

    await session.restart();
    // The harness replaces the driver on restart; the one destructured above is gone.
    const fresh = session.driver;
    await fresh.waitFor('the dark theme back', async () => (await themeOnScreen()) === 'dark');
    expect(await fresh.execute<string>('return document.documentElement.lang')).toBe('pt-BR');
    const settings = await invoke<{ theme: string; language: string; lens: string }>(
      'settings_get',
      {},
    );
    expect(settings).toEqual({ theme: 'dark', language: 'pt-BR', lens: 'engineer' });
    await session.screenshot('settings-dark-pt-BR');

    // Back to the defaults for the tests that follow.
    await chooseLanguage(session, 'English');
    await (
      await fresh.findByXPath('//button[@role="radio" and normalize-space(.)="Match Windows"]')
    ).click();
    await fresh.waitFor('the system theme', async () => (await themeOnScreen()) === null);
  });

  it('refuses a key the host does not keep, and a value that does not fit', async () => {
    const unknown = await invoke('settings_set', { key: 'progress', value: '60' });
    expect(JSON.stringify(unknown)).toContain('__error');
    const bad = await invoke('settings_set', { key: 'theme', value: 'sepia' });
    expect(JSON.stringify(bad)).toContain('__error');
    const settings = await invoke<{ theme: string }>('settings_get', {});
    expect(settings).toMatchObject({ theme: 'system' });
  });
});
