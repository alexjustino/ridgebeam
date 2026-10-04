// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { entry, person, snapshot } from '@/domain/__fixtures__/plan';
import type { DiaryEntry } from '@/domain/diary';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { EntryView } from './DiaryPage';

/**
 * An entry's line for a lost day (slice E3): the cause, and who when it names somebody — "Lost —
 * waiting for a decision (A. Joiner)" — a person since removed said to be so, and a lost day with no
 * cause read as it always did. Both languages.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WORK = snapshot({ people: [person('p1', 'A. Joiner')] });

let host: HTMLDivElement;
let root: Root;

function lines(of: DiaryEntry, language: Language = 'en'): string[] {
  act(() =>
    root.render(
      <I18nContext.Provider value={build(language, language)}>
        <ol>
          <EntryView entry={of} snapshot={WORK} correctedBySeq={null} />
        </ol>
      </I18nContext.Provider>,
    ),
  );
  return [...host.querySelectorAll('li li')].map((line) => line.textContent ?? '');
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('a lost day, with why and who', () => {
  it('says the cause and who', () => {
    const lost = entry(1, '2026-09-02', {
      lostDay: true,
      lostCause: 'decision',
      lostPartyPersonId: 'p1',
    });
    expect(lines(lost)).toContain('Lost — waiting for a decision (A. Joiner)');
    expect(lines(lost, 'pt-BR')).toContain('Dia perdido — esperando uma decisão (A. Joiner)');
  });

  it('says the cause alone when nobody is named', () => {
    const lost = entry(1, '2026-09-02', { lostDay: true, lostCause: 'material' });
    expect(lines(lost)).toContain('Lost — the material did not arrive');
    expect(lines(lost, 'pt-BR')).toContain('Dia perdido — o material não chegou');
  });

  it('keeps a person no longer in the plan, said so', () => {
    const lost = entry(1, '2026-09-02', {
      lostDay: true,
      lostCause: 'absence',
      lostPartyPersonId: 'gone',
    });
    expect(lines(lost)).toContain('Lost — the crew did not come (someone no longer in the plan)');
  });

  it('reads a lost day with no cause as it always did', () => {
    expect(lines(entry(1, '2026-09-02', { lostDay: true }))).toContain(
      'A lost day — no work was possible.',
    );
  });
});
