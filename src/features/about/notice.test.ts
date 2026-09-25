import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { thirdParty } from './notice';

/**
 * The About screen reads its credits from NOTICE, so there is exactly one list of what this
 * product is built on rather than two that drift.
 *
 * These tests guard the seam. A silent parse failure would show an empty credits list to every
 * person while the file it was meant to read sits there, correct, on disk — the kind of bug
 * nobody reports because it looks intentional. So "the section lists nothing yet" and "there is
 * no section" are two different answers, and both are tested.
 */

const NOTICE = readFileSync(join(process.cwd(), 'NOTICE'), 'utf8');

const SAMPLE = [
  'Ridgebeam',
  'Copyright 2026 Alex Justino',
  '',
  'THIRD-PARTY COMPONENTS',
  '',
  'Listed with their licences.',
  '',
  '  Tauri ........................ Apache-2.0 OR MIT',
  '  React, React DOM ............. MIT',
  '  rusqlite / SQLite ............ MIT / Public Domain',
  '',
].join('\n');

describe('reading the credits from NOTICE', () => {
  it('reads every listed component with its licence', () => {
    expect(thirdParty(SAMPLE)).toEqual({
      found: true,
      credits: [
        { name: 'Tauri', licence: 'Apache-2.0 OR MIT' },
        { name: 'React, React DOM', licence: 'MIT' },
        { name: 'rusqlite / SQLite', licence: 'MIT / Public Domain' },
      ],
    });
  });

  it('reads a file written with Windows line endings the same way', () => {
    expect(thirdParty(SAMPLE.replace(/\n/g, '\r\n'))).toEqual(thirdParty(SAMPLE));
  });

  it('ignores the prose around the list', () => {
    const names = thirdParty(SAMPLE).credits.map((credit) => credit.name);
    expect(names.some((name) => name.includes('Copyright'))).toBe(false);
    expect(names.some((name) => name.includes('Listed'))).toBe(false);
  });

  it('says there is no section rather than guessing, when there is none', () => {
    expect(thirdParty('a file with no such section')).toEqual({ found: false, credits: [] });
    expect(thirdParty('')).toEqual({ found: false, credits: [] });
  });

  it('finds the section in the NOTICE that ships, and reads every entry it lists', () => {
    const notice = thirdParty(NOTICE);
    // The About screen's honest empty state depends on this: the section is there, whether or
    // not it lists anything yet.
    expect(notice.found).toBe(true);
    for (const credit of notice.credits) {
      expect(credit.name).not.toBe('');
      expect(credit.licence).not.toBe('');
      // The dot leaders are for a person reading the file, not for the screen.
      expect(credit.name).not.toContain('.....');
      expect(credit.licence).not.toContain('.....');
    }
  });
});

describe('NOTICE says what the licence requires it to say', () => {
  it('names the copyright holder', () => {
    expect(NOTICE).toContain('Copyright 2026 Alex Justino');
  });

  it('carries the trademark statement About repeats', () => {
    // Apache-2.0 §6 grants no right to the project's name. The file says so explicitly, which
    // is the whole reason this licence was chosen over MIT.
    expect(NOTICE).toContain('trademark of Alex Justino');
  });
});
