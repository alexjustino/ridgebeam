// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_SETTINGS, type MyTemplates } from '@/data/commands';
import { keys } from '@/data/queries';
import { activity, snapshot, stage } from '@/domain/__fixtures__/plan';
import { exportTemplate, templateText } from '@/domain/templates/export';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { TemplatePicker } from './TemplatePicker';
import { useTemplateChoice } from './useTemplateChoice';

/**
 * The template picker's **Your templates** (slice G3): the person's own after the library, each by
 * its title; one that cannot be used listed disabled, with its problem said under the picker; one
 * chosen previews as a file does, says where the folder is, and can be removed — after a
 * confirmation in the danger tone that says it deletes the file — in both languages.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

const LEARNED = templateText(
  exportTemplate(
    snapshot({
      stages: [stage('s1', 1, 'Joinery')],
      activities: [
        { ...activity('a', 's1', 1, 3), name: 'Fit the cabinets' },
        { ...activity('b', 's1', 2, 2), name: 'Hang the doors' },
      ],
    }),
    { numbers: 'keep', language: 'en', id: 'kitchen-joinery-learned', title: 'Kitchen joinery' },
  ),
);

const FOLDER = 'C:\\Users\\someone\\AppData\\Roaming\\ridgebeam\\templates';
const NOT_READ = '“too-big.json” was not read: it is larger than 1 MiB.';

let listed: MyTemplates;
let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function Picker() {
  const state = useTemplateChoice({ allowEmpty: true });
  return <TemplatePicker state={state} />;
}

function render(language: Language) {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens: 'owner' });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <Picker />
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

/** Anywhere on the page: the confirmation is drawn on the document's body. */
const find = (testId: string) => {
  const found = document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`no ${testId}`);
  return found;
};
const absent = (testId: string) => document.body.querySelector(`[data-testid="${testId}"]`);

const press = (element: HTMLElement) => act(() => element.click());

function pick(value: string) {
  const select = find('work-template') as HTMLSelectElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
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

beforeEach(() => {
  listed = {
    templates: [
      { id: 'broken', text: '{"nothing": "here"}', problem: null },
      { id: 'kitchen-joinery-learned', text: LEARNED, problem: null },
      { id: 'too-big', text: null, problem: NOT_READ },
    ],
    notListed: 0,
    note: null,
  };
  invoke.mockReset();
  invoke.mockImplementation((command: string, args?: { id?: string }) => {
    if (command === 'my_templates_list') return Promise.resolve(listed);
    if (command === 'my_templates_folder') return Promise.resolve(FOLDER);
    if (command === 'my_template_remove') {
      listed = {
        ...listed,
        templates: listed.templates.filter((each) => each.id !== args?.id),
      };
      return Promise.resolve(null);
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
    group: 'Your templates',
    folder: 'Your templates are kept in this folder:',
    remove: 'Remove from my templates…',
    body: 'This deletes the file kitchen-joinery-learned.json from your templates folder.',
    confirm: 'Remove',
  },
  'pt-BR': {
    group: 'Seus modelos',
    folder: 'Seus modelos ficam nesta pasta:',
    remove: 'Remover dos meus modelos…',
    body: 'Isto apaga o arquivo kitchen-joinery-learned.json da pasta dos seus modelos.',
    confirm: 'Remover',
  },
} as const;

describe.each(['en', 'pt-BR'] as const)('Your templates, in %s', (language) => {
  const words = WORDS[language];

  it('lists yours after the library by title, an unusable one after them, disabled, with its problem said', async () => {
    render(language);
    await settle();
    const groups = [...host.querySelectorAll('optgroup')];
    expect(groups.map((group) => group.label)).toEqual([
      language === 'en' ? 'The library' : 'A biblioteca',
      words.group,
    ]);
    const options = [...groups[1]!.querySelectorAll('option')];
    expect(options.map((option) => [option.value, option.textContent, option.disabled])).toEqual([
      ['mine:kitchen-joinery-learned', 'Kitchen joinery', false],
      ['mine:broken', 'broken', true],
      ['mine:too-big', 'too-big', true],
    ]);
    // Yours come before "From a file…", which stays last.
    const all = [...host.querySelectorAll('option')];
    expect(all[all.length - 1]!.value).toBe('file');

    const problems = find('templates-mine-problems');
    expect(problems.querySelector('[data-mine-id="broken"]')?.textContent).toMatch(
      /^broken\.json: /,
    );
    expect(problems.querySelector('[data-mine-id="too-big"]')?.textContent).toBe(
      `too-big.json: ${NOT_READ}`,
    );
    expect(absent('template-mine-remove')).toBeNull();
  });

  it('previews one of yours as a file, says where the folder is, and removes it after asking', async () => {
    render(language);
    await settle();
    pick('mine:kitchen-joinery-learned');
    await settle();

    expect(find('template-preview').textContent).toMatch(
      language === 'en' ? /2 activities/ : /2 atividades/,
    );
    expect(absent('template-problem')).toBeNull();
    expect(find('templates-mine-folder').textContent).toBe(FOLDER);
    expect(find('templates-mine-folder').parentElement?.textContent).toContain(words.folder);

    const remove = find('template-mine-remove');
    expect(remove.textContent).toBe(words.remove);
    press(remove);
    const confirm = find('template-mine-remove-confirm');
    const dialog = confirm.closest('[role="dialog"]');
    expect(dialog?.textContent).toContain(words.body);
    // The danger tone, and the verb on the button — never colour alone.
    expect(confirm.className).toContain('bg-danger');
    expect(confirm.textContent).toBe(words.confirm);

    press(confirm);
    await settle();
    expect(calls('my_template_remove')).toEqual([{ id: 'kitchen-joinery-learned' }]);
    expect(absent('template-mine-remove-confirm')).toBeNull();
    expect(host.querySelector('option[value="mine:kitchen-joinery-learned"]')).toBeNull();
    expect((find('work-template') as HTMLSelectElement).value).toBe('empty');
    expect(absent('template-mine-remove')).toBeNull();
  });

  it('says what the folder held beyond what was listed', async () => {
    listed = {
      ...listed,
      notListed: 3,
      note: '3 more templates are in the folder and were not listed: only the first 200 are.',
    };
    render(language);
    await settle();
    // Said in the screen's language from the count, never the host's English sentence.
    expect(find('templates-mine-note').textContent).toBe(
      language === 'en'
        ? '3 more templates are in the folder and were not listed: only the first 200 are.'
        : 'Mais 3 modelos estão na pasta e não foram listados: só os 200 primeiros são.',
    );
  });
});
