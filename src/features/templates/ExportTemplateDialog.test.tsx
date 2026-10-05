// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_SETTINGS, type MyTemplates } from '@/data/commands';
import { keys } from '@/data/queries';
import { activity, entry, finished, snapshot, stage, worked } from '@/domain/__fixtures__/plan';
import type { DiaryEntry } from '@/domain/diary';
import type { WorkSnapshot } from '@/domain/plan';
import type { Template } from '@/domain/templates/format';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { ExportTemplateDialog } from './ExportTemplateDialog';

/**
 * Export as a template, slice G3: **Learned from this work** says what it does and how many
 * activities finished; **Where** is My templates when learned, with the id proposed from the work's
 * name; an id already there asks before replacing it; done says where it went. The file path of F9
 * stays as it was — in both languages.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));

const BASE = snapshot({
  stages: [stage('s1', 1, 'Joinery')],
  activities: [
    { ...activity('a', 's1', 1, 3), name: 'Fit the cabinets' },
    { ...activity('b', 's1', 2, 2), name: 'Hang the doors' },
    { ...activity('c', 's1', 3, 1), name: 'Fit the handles' },
  ],
});
const WORK: WorkSnapshot = { ...BASE, work: { ...BASE.work, name: 'Kitchen joinery' } };

// The work starts on Tuesday 1 September 2026, Monday to Friday. The cabinets took 1–7 September (5
// working days), the doors 8–9 (2); the handles started and are still running.
const DIARY: DiaryEntry[] = [
  entry(1, '2026-09-01', { done: [worked('a')] }),
  entry(2, '2026-09-07', { done: [finished('a')] }),
  entry(3, '2026-09-08', { done: [worked('b')] }),
  entry(4, '2026-09-09', { done: [finished('b')] }),
  entry(5, '2026-09-10', { done: [worked('c')] }),
];

const FOLDER = 'C:\\Users\\someone\\AppData\\Roaming\\ridgebeam\\templates';

let listed: MyTemplates;
let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(language: Language) {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens: 'owner' });
  client.setQueryData(keys.diary, DIARY);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <ExportTemplateDialog snapshot={WORK} open onClose={() => undefined} />
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

/** Anywhere on the page: a confirmation over the dialog is drawn on the document's body. */
const find = (selector: string) => {
  const found = document.body.querySelector<HTMLElement>(
    selector.startsWith('[') ? selector : `[data-testid="${selector}"]`,
  );
  if (found === null) throw new Error(`no ${selector}`);
  return found;
};

const press = (element: HTMLElement) => act(() => element.click());

function set(element: HTMLElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function settle() {
  for (let tick = 0; tick < 5; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const calls = (command: string) =>
  invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args as unknown);

const choose = (group: string, value: string) =>
  press(find(`[data-testid="${group}"] [data-value="${value}"]`));

beforeEach(() => {
  listed = { templates: [], notListed: 0, note: null };
  invoke.mockReset();
  invoke.mockImplementation((command: string, args?: { id?: string; path?: string }) => {
    if (command === 'diary_list') return Promise.resolve(DIARY);
    if (command === 'my_templates_list') return Promise.resolve(listed);
    if (command === 'my_templates_folder') return Promise.resolve(FOLDER);
    if (command === 'my_template_save') {
      return Promise.resolve({ path: `${FOLDER}\\${args?.id}.json`, bytes: 100 });
    }
    return Promise.resolve(null);
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const WORDS = {
  en: {
    learned: 'Learned from this work',
    hint: 'the duration of each finished activity becomes a range that holds what was planned and what it took',
    counts: '2 of 3 activities finished.',
    summary: 'Durations learned from Kitchen joinery: 2 of 3 activities finished.',
    saved: 'Saved to your templates as kitchen-joinery.',
    replaced: 'Saved to your templates as kitchen-joinery-learned.',
    replaceBody: 'Your templates already have one named kitchen-joinery-learned.',
  },
  'pt-BR': {
    learned: 'Aprendido com esta obra',
    hint: 'a duração de cada atividade concluída vira uma faixa que contém o que foi planejado e o que ela levou',
    counts: '2 de 3 atividades concluídas.',
    summary: 'Durações aprendidas com Kitchen joinery: 2 de 3 atividades concluídas.',
    saved: 'Salvo nos seus modelos como kitchen-joinery.',
    replaced: 'Salvo nos seus modelos como kitchen-joinery-learned.',
    replaceBody: 'Seus modelos já têm um chamado kitchen-joinery-learned.',
  },
} as const;

/** The activities of the template a call wrote, by name, with their durations. */
function durations(text: string): Record<string, unknown> {
  const template = JSON.parse(text) as Template;
  return Object.fromEntries(
    template.stages.flatMap((each) =>
      (each.activities ?? []).map((one) => [Object.values(one.name)[0], one.durationDays]),
    ),
  );
}

describe.each(['en', 'pt-BR'] as const)('Export as a template, in %s', (language) => {
  const words = WORDS[language];

  it('learns from this work into My templates, with the id proposed from the name', async () => {
    render(language);
    await settle();
    // Before learned is chosen, the file flow of F9 is what is offered.
    expect(
      find('[data-testid="export-where"] [data-value="file"]').getAttribute('aria-checked'),
    ).toBe('true');
    find('export-path');

    choose('export-numbers', 'learned');
    await settle();
    expect(find('[data-testid="export-numbers"] [data-value="learned"]').textContent).toBe(
      words.learned,
    );
    expect(host.textContent).toContain(words.hint);
    expect(find('export-learned-counts').textContent).toBe(words.counts);
    expect(
      find('[data-testid="export-where"] [data-value="mine"]').getAttribute('aria-checked'),
    ).toBe('true');
    expect((find('export-id') as HTMLInputElement).value).toBe('kitchen-joinery');
    expect(find('export-folder').textContent).toBe(FOLDER);
    expect(host.querySelector('[data-testid="export-path"]')).toBeNull();

    press(find('export-save'));
    await settle();
    const [saved] = calls('my_template_save') as Array<{
      id: string;
      text: string;
      overwrite: boolean;
    }>;
    expect(saved).toMatchObject({ id: 'kitchen-joinery', overwrite: false });
    const template = JSON.parse(saved!.text) as Template;
    expect(template.id).toBe('kitchen-joinery');
    expect(Object.values(template.summary ?? {})[0]).toBe(words.summary);
    // Finished: what was planned and what it took. Running: kept as planned.
    expect(durations(saved!.text)).toEqual({
      'Fit the cabinets': { min: 3, max: 5 },
      'Hang the doors': { min: 2, max: 2 },
      'Fit the handles': { min: 1, max: 1 },
    });
    expect(find('export-done').textContent).toContain(words.saved);
    expect(calls('template_write')).toEqual([]);
  });

  it('asks before replacing a template of yours with the same id, then replaces it', async () => {
    listed = {
      templates: [{ id: 'kitchen-joinery-learned', text: '{}', problem: null }],
      notListed: 0,
      note: null,
    };
    render(language);
    choose('export-numbers', 'learned');
    await settle();
    set(find('export-id'), 'Kitchen joinery learned');
    press(find('export-save'));
    await settle();

    expect(calls('my_template_save')).toEqual([]);
    const confirm = find('export-replace-confirm');
    expect(confirm.closest('[role="dialog"]')?.textContent).toContain(words.replaceBody);

    press(confirm);
    await settle();
    expect(calls('my_template_save')).toEqual([
      expect.objectContaining({ id: 'kitchen-joinery-learned', overwrite: true }),
    ]);
    expect(document.body.querySelector('[data-testid="export-replace-confirm"]')).toBeNull();
    expect(find('export-done').textContent).toContain(words.replaced);
  });

  it('says the host’s sentence when it refuses, and nothing is said done', async () => {
    invoke.mockImplementation((command: string) => {
      if (command === 'diary_list') return Promise.resolve(DIARY);
      if (command === 'my_templates_list') return Promise.resolve(listed);
      if (command === 'my_templates_folder') return Promise.resolve(FOLDER);
      if (command === 'my_template_save') {
        return Promise.reject({
          kind: 'invalid_input',
          message:
            '“kitchen-joinery.json” is already in your templates; replace it to save over it.',
        });
      }
      return Promise.resolve(null);
    });
    render(language);
    choose('export-numbers', 'learned');
    await settle();
    press(find('export-save'));
    await settle();
    expect(find('export-problem').textContent).toContain('kitchen-joinery.json');
    expect(document.body.querySelector('[data-testid="export-done"]')).toBeNull();
  });

  it('keeps the file flow: strip by default, and learned to a file carries its summary', async () => {
    render(language);
    await settle();
    set(find('export-path'), 'C:\\exports\\stripped.json');
    press(find('export-confirm'));
    await settle();
    expect(calls('template_write')).toEqual([
      expect.objectContaining({ path: 'C:\\exports\\stripped.json', overwrite: false }),
    ]);
    expect(find('export-done').textContent).toContain('stripped.json');

    choose('export-numbers', 'learned');
    choose('export-where', 'file');
    set(find('export-path'), 'C:\\exports\\learned.json');
    press(find('export-confirm'));
    await settle();
    const written = calls('template_write')[1] as { text: string };
    expect(Object.values((JSON.parse(written.text) as Template).summary ?? {})[0]).toBe(
      words.summary,
    );
    expect(calls('my_template_save')).toEqual([]);
  });
});
