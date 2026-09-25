import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The architectural boundary, enforced as a test.
 *
 * `src/domain/` is pure: the plan and its placement on the working calendar, working-day
 * arithmetic, readiness and its rule table, the figures that carry their rows, and the
 * person's choices. Later slices add the critical path, decisions and their deadlines, the
 * diary's chain, the check gates, money and the lenses, under the same rule. It performs no I/O
 * and knows nothing about the interface or the host.
 *
 * That purity is not decoration. It is what lets the parts of this product where plans usually
 * go wrong (a duration counted over a holiday, a readiness figure that does not match its list)
 * be tested without mounting a component or opening a window.
 *
 * ESLint enforces the same rule while editing. This test enforces it in CI, where it cannot be
 * silenced with a disable comment. A rule with only one gate is a rule that eventually gets
 * bypassed.
 */

const DOMAIN = join(process.cwd(), 'src', 'domain');

const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /from\s+['"]react['"]/, why: 'React' },
  { pattern: /from\s+['"]react-dom/, why: 'React DOM' },
  { pattern: /from\s+['"]@tauri-apps\//, why: 'the Tauri host' },
  { pattern: /from\s+['"]zustand['"]/, why: 'UI state' },
  { pattern: /from\s+['"]@tanstack\/react-query['"]/, why: 'data fetching' },
  // `../data/x`, `../ui` and `@/app/y` alike. `i18n` too: the domain returns message keys and
  // counts, and never holds a sentence in any language.
  {
    pattern: /from\s+['"][^'"]*\/(data|ui|features|app|i18n)(\/|['"])/,
    why: 'an outer layer',
  },
  { pattern: /from\s+['"]@\/(data|ui|features|app|i18n)(\/|['"])/, why: 'an outer layer' },
];

/** Source files under `src/domain/`, excluding the tests themselves. */
function domainSources(directory: string = DOMAIN): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...domainSources(path));
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
    if (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) continue;
    found.push(path);
  }
  return found;
}

describe('the domain layer stays pure', () => {
  const sources = domainSources();

  it('has something to check', () => {
    // A boundary test that silently checks nothing is worse than no test.
    expect(sources.length).toBeGreaterThan(0);
    // Including the modules in subdirectories.
    expect(sources.some((path) => path.includes(join('domain', 'readiness')))).toBe(true);
  });

  it.each([
    "import { useState } from 'react';",
    "import { invoke } from '@tauri-apps/api/core';",
    "import { t } from '../i18n';",
    "import { t } from '@/i18n/index';",
    "import { workGet } from '../data/commands';",
    "import { Button } from '../../ui';",
    "import { App } from '@/app/App';",
  ])('would catch %s, so a green run means something', (line) => {
    expect(FORBIDDEN.some(({ pattern }) => pattern.test(line))).toBe(true);
  });

  it.each(["import { hasDuration } from '../plan';", "import { percent } from '../figure';"])(
    'lets %s through, which stays inside the domain',
    (line) => {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(line))).toBe(false);
    },
  );

  it.each(sources)('%s imports nothing from an outer layer', (path) => {
    const contents = readFileSync(path, 'utf8');

    for (const { pattern, why } of FORBIDDEN) {
      expect(
        pattern.test(contents),
        `${path} imports ${why}. src/domain/ must stay free of React, the Tauri host and ` +
          'the outer layers — see CONTRIBUTING.md.',
      ).toBe(false);
    }
  });

  it.each(sources)('%s performs no direct I/O', (path) => {
    const contents = readFileSync(path, 'utf8');

    for (const forbidden of ['node:fs', 'node:path', 'fetch(', 'localStorage', 'XMLHttpRequest']) {
      expect(
        contents.includes(forbidden),
        `${path} reaches for ${forbidden}. The domain receives data; it never fetches it.`,
      ).toBe(false);
    }
  });
});
