// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_SETTINGS } from '@/data/commands';
import { keys } from '@/data/queries';
import {
  maintenanceDone,
  maintenanceTask,
  person,
  snapshot,
  stage,
  warranty,
} from '@/domain/__fixtures__/plan';
import type { WorkSnapshot } from '@/domain/plan';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { HandoverTab } from './HandoverTab';

/**
 * After the handover on the Plan's Handover tab (slice G4, decision 3), rendered and pressed in both
 * languages: the warranties with the day each ends and how far it is, in words; the maintenance
 * tasks with how often, how many times done and when next due — overdue said in words with its icon;
 * a warranty added with the host's keys (its length in years kept as months) and refused before the
 * host is asked when it has no title; a task refused when its interval is not whole months; **Mark as
 * done…** appending a record that is listed under the row with no way to edit it, and a task with a
 * record offering no Remove; the calendar of the next twelve months, an overdue task in the current
 * month and an empty month that says so; and the `.ics` file written through the host with the
 * domain's text — CRLF, `BEGIN:VCALENDAR` — carrying no phone or e-mail.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Monday 5 October 2026.
const TODAY = '2026-10-05';
vi.mock('@/app/today', () => ({ today: () => TODAY, useToday: () => TODAY }));

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }));

const PLAN: WorkSnapshot = snapshot({
  work: { ...snapshot().work, workId: 'w1', name: 'Sample bathroom' },
  people: [
    person('p1', 'Sample plumber', { phone: '+55 11 0000-0000', email: 'plumber@example.com' }),
  ],
  rooms: [{ id: 'r1', position: 1, name: 'Shower room' }],
  stages: [{ ...stage('s1', 1, 'Finishes'), startedAt: '2026-09-01T09:00:00.000Z' }],
});

const LISTED: WorkSnapshot = {
  ...PLAN,
  warranties: [
    // 24 months from 5 November 2024: ends on 5 November 2026, 31 days from today.
    warranty('w-valve', 1, '2024-11-05', 24, {
      title: 'Shower valve',
      targetId: 'w1',
      givenBy: 'Sample installer',
    }),
  ],
  maintenance: [
    // Never done, first due on 2 October: three days overdue.
    maintenanceTask('t-seal', 1, 12, '2026-10-02', { title: 'Reseal the shower', targetId: 'w1' }),
    // Done on 10 June, every 6 months: next due on 10 December.
    maintenanceTask('t-gutter', 1, 6, '2026-04-01', {
      title: 'Clean the gutters',
      targetKind: 'room',
      targetId: 'r1',
      done: [maintenanceDone(1, '2026-06-10')],
    }),
  ],
};

/** The plan after the reseal was recorded done today. */
const RESEALED: WorkSnapshot = {
  ...LISTED,
  maintenance: LISTED.maintenance.map((task) =>
    task.id === 't-seal'
      ? { ...task, done: [{ ...maintenanceDone(1, TODAY, 'Done well'), taskId: 't-seal' }] }
      : task,
  ),
};

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let answer: (command: string) => unknown;

function render(of: WorkSnapshot, language: Language) {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens: 'owner' });
  client.setQueryData(keys.diary, []);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <HandoverTab snapshot={of} onGates={() => undefined} />
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

function find(selector: string, within: ParentNode = document.body): HTMLElement {
  const found = within.querySelector<HTMLElement>(
    selector.startsWith('[') ? selector : `[data-testid="${selector}"]`,
  );
  if (found === null) throw new Error(`no ${selector}`);
  return found;
}

function set(element: HTMLElement, value: string) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

const press = (element: HTMLElement) => act(() => element.click());

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
  invoke.mockReset();
  answer = (command) => {
    if (command === 'settings_get') return null;
    if (command === 'diary_list') return [];
    if (command === 'aftercare_ics_write') return { path: 'C:\\out\\bathroom.ics', bytes: 1200 };
    if (command === 'maintenance_done_add') return RESEALED;
    return LISTED;
  };
  invoke.mockImplementation((command: string) => Promise.resolve(answer(command)));
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
    ends: 'Ends on November 5, 2026 — in 31 days',
    endingSoon: 'Ending soon',
    sealNext: 'First due on October 2, 2026 — 3 days overdue',
    gutterNext: 'Next due on December 10, 2026 — in 66 days',
    gutterCycle: 'Every 6 months · Done once · last done on June 10, 2026',
    overdue: 'Overdue',
    titleEmpty: 'Say what it is: the title cannot be empty.',
    everyProblem: 'Say how often in whole months, from 1 to 120.',
    record: 'Done on October 5, 2026 · Sample author',
    october: 'October 2026',
    empty: 'Nothing comes due this month',
    itemOverdue: '3 days overdue',
    warrantyEnds: 'Warranty ends',
    extension: 'The file’s name must end in .ics.',
    taskSummary: 'SUMMARY:Maintenance: Reseal the shower',
  },
  'pt-BR': {
    ends: 'Termina em 5 de novembro de 2026 — daqui a 31 dias',
    endingSoon: 'Termina em breve',
    sealNext: 'Vence pela primeira vez em 2 de outubro de 2026 — atrasada há 3 dias',
    gutterNext: 'Vence de novo em 10 de dezembro de 2026 — daqui a 66 dias',
    gutterCycle: 'A cada 6 meses · Feita uma vez · feita pela última vez em 10 de junho de 2026',
    overdue: 'Atrasada',
    titleEmpty: 'Diga o que é: o título não pode ficar vazio.',
    everyProblem: 'Diga a cada quantos meses, em meses inteiros, de 1 a 120.',
    record: 'Feita em 5 de outubro de 2026 · Sample author',
    october: 'Outubro de 2026',
    empty: 'Nada vence neste mês',
    itemOverdue: 'atrasada há 3 dias',
    warrantyEnds: 'Garantia termina',
    extension: 'O nome do arquivo precisa terminar em .ics.',
    taskSummary: 'SUMMARY:Manutenção: Reseal the shower',
  },
} as const;

describe.each(['en', 'pt-BR'] as const)(
  'after the handover on the Handover tab, in %s',
  (language) => {
    const words = WORDS[language];

    it('says when each warranty ends and how far that is, in words, with its state', () => {
      render(LISTED, language);
      const valve = find('[data-warranty-id="w-valve"]');
      expect(valve.dataset.state).toBe('ending-soon');
      expect(valve.dataset.ends).toBe('2026-11-05');
      expect(find('warranty-ends', valve).textContent).toBe(words.ends);
      const state = find('warranty-state', valve);
      expect(state.textContent).toBe(words.endingSoon);
      // Never colour alone: the state carries its icon.
      expect(state.querySelector('svg')).not.toBeNull();
    });

    it('says how often each task comes back, when it is next due, and what is overdue', () => {
      render(LISTED, language);
      const seal = find('[data-task-id="t-seal"]');
      expect(seal.dataset.overdue).toBe('true');
      expect(seal.dataset.next).toBe('2026-10-02');
      expect(find('maintenance-next', seal).textContent).toBe(words.sealNext);
      expect(find('maintenance-state', seal).textContent).toBe(words.overdue);
      expect(find('maintenance-state', seal).querySelector('svg')).not.toBeNull();

      const gutter = find('[data-task-id="t-gutter"]');
      expect(gutter.dataset.overdue).toBe('false');
      expect(find('maintenance-next', gutter).textContent).toBe(words.gutterNext);
      expect(find('maintenance-cycle', gutter).textContent).toBe(words.gutterCycle);
    });

    it('offers Remove only for a task never done, and says why otherwise', () => {
      render(LISTED, language);
      const seal = find('[data-task-id="t-seal"]');
      expect(seal.querySelector('[data-testid="maintenance-remove"]')).not.toBeNull();
      expect(seal.querySelector('[data-testid="maintenance-remove-locked"]')).toBeNull();
      const gutter = find('[data-task-id="t-gutter"]');
      expect(gutter.querySelector('[data-testid="maintenance-remove"]')).toBeNull();
      expect(find('maintenance-remove-locked', gutter).textContent).not.toBe('');
      // A record once written offers no Edit and no Delete.
      expect(find('maintenance-records', gutter).querySelectorAll('button')).toHaveLength(0);
    });

    it('adds a warranty with the host’s keys, its years kept as months, and refuses it with no title', async () => {
      render(PLAN, language);
      expect(find('warranties-none')).toBeTruthy();
      press(find('warranty-add'));
      set(find('warranty-length'), '2');
      press(find('[data-testid="warranty-unit"] [data-value="years"]'));
      press(find('warranty-save'));
      await settle();
      expect(find('warranty-problem').textContent).toContain(words.titleEmpty);
      expect(calls('warranty_add')).toEqual([]);

      set(find('warranty-title'), 'Shower valve');
      set(find('warranty-given-by'), 'Sample installer');
      press(find('warranty-save'));
      await settle();
      expect(calls('warranty_add')).toEqual([
        {
          draft: {
            targetKind: 'work',
            targetId: 'w1',
            title: 'Shower valve',
            givenBy: 'Sample installer',
            // The work is not finished: it starts today unless changed.
            startsOn: TODAY,
            months: 24,
            documentId: null,
            note: null,
          },
        },
      ]);
    });

    it('starts a warranty on the day the work finished, once every stage is closed', async () => {
      const finished: WorkSnapshot = {
        ...PLAN,
        stages: PLAN.stages.map((each) => ({ ...each, closedAt: '2026-09-25T17:00:00.000Z' })),
      };
      render(finished, language);
      press(find('warranty-add'));
      set(find('warranty-title'), 'Boiler');
      set(find('warranty-length'), '18');
      press(find('warranty-save'));
      await settle();
      expect(calls('warranty_add')).toEqual([
        {
          draft: {
            targetKind: 'work',
            targetId: 'w1',
            title: 'Boiler',
            givenBy: null,
            startsOn: '2026-09-25',
            months: 18,
            documentId: null,
            note: null,
          },
        },
      ]);
    });

    it('adds a task, and refuses an interval that is not whole months', async () => {
      render(PLAN, language);
      press(find('maintenance-add'));
      set(find('maintenance-title'), 'Service the boiler');
      set(find('maintenance-target'), 'room:r1');
      set(find('maintenance-every'), '2.5');
      press(find('maintenance-save'));
      await settle();
      expect(find('maintenance-problem').textContent).toContain(words.everyProblem);
      expect(calls('maintenance_add')).toEqual([]);

      set(find('maintenance-every'), '12');
      press(find('maintenance-save'));
      await settle();
      expect(calls('maintenance_add')).toEqual([
        {
          draft: {
            targetKind: 'room',
            targetId: 'r1',
            title: 'Service the boiler',
            everyMonths: 12,
            firstDueOn: TODAY,
            note: null,
          },
        },
      ]);
    });

    it('marks a task as done today, and lists the record under it with no way to edit it', async () => {
      client.setQueryData(keys.work, LISTED);
      render(LISTED, language);
      press(find('maintenance-done', find('[data-task-id="t-seal"]')));
      set(find('maintenance-done-note'), 'Done well');
      press(find('maintenance-done-confirm'));
      await settle();
      expect(calls('maintenance_done_add')).toEqual([
        { record: { taskId: 't-seal', doneOn: TODAY, note: 'Done well' } },
      ]);
      expect(document.querySelector('[data-testid="maintenance-done-dialog"]')).toBeNull();

      // The host answered with the record appended: the row is drawn from it.
      render(RESEALED, language);
      const seal = find('[data-task-id="t-seal"]');
      expect(seal.dataset.overdue).toBe('false');
      expect(seal.dataset.next).toBe('2027-10-05');
      const records = [...find('maintenance-records', seal).querySelectorAll('li')];
      expect(records).toHaveLength(1);
      expect(records[0]?.textContent).toContain(words.record);
      expect(records[0]?.textContent).toContain('Done well');
      expect(seal.querySelector('[data-testid="maintenance-remove"]')).toBeNull();
    });

    it('refuses a day after today inside the done dialog, and sends nothing', async () => {
      render(LISTED, language);
      press(find('maintenance-done', find('[data-task-id="t-seal"]')));
      const day = find('maintenance-done-day') as HTMLInputElement;
      set(day, '2026-10-09');
      act(() => day.dispatchEvent(new FocusEvent('blur')));
      press(find('maintenance-done-confirm'));
      await settle();
      expect(find('maintenance-done-problem')).toBeTruthy();
      expect(calls('maintenance_done_add')).toEqual([]);
    });

    it('lists twelve months, the overdue task in this month, and an empty month that says so', () => {
      render(LISTED, language);
      const calendar = find('aftercare-calendar');
      const months = [...calendar.querySelectorAll<HTMLElement>('[data-month]')];
      expect(months.map((month) => month.dataset.month)).toEqual([
        '2026-10',
        '2026-11',
        '2026-12',
        '2027-01',
        '2027-02',
        '2027-03',
        '2027-04',
        '2027-05',
        '2027-06',
        '2027-07',
        '2027-08',
        '2027-09',
      ]);
      const october = months[0]!;
      expect(october.querySelector('h3')?.textContent).toBe(words.october);
      const seal = find('[data-calendar-item="task:t-seal:2026-10-02"]', october);
      expect(seal.dataset.overdue).toBe('true');
      expect(find('aftercare-item-overdue', seal).textContent).toBe(words.itemOverdue);
      expect(seal.querySelectorAll('svg').length).toBeGreaterThan(0);

      const november = months[1]!;
      const valve = find('[data-calendar-item="warranty:w-valve"]', november);
      expect(valve.dataset.kind).toBe('warranty-ends');
      expect(valve.textContent).toContain(words.warrantyEnds);
      expect(valve.textContent).toContain('Shower valve');

      const january = months[3]!;
      expect(january.dataset.empty).toBe('true');
      expect(find('aftercare-month-empty', january).textContent).toBe(words.empty);
    });

    it('writes the calendar file through the host, with CRLF and no phone or e-mail', async () => {
      render(LISTED, language);
      press(find('aftercare-ics'));
      set(find('aftercare-ics-path'), 'C:\\out\\bathroom.txt');
      press(find('aftercare-ics-write'));
      await settle();
      expect(find('aftercare-ics-problem').textContent).toContain(words.extension);
      expect(calls('aftercare_ics_write')).toEqual([]);

      set(find('aftercare-ics-path'), 'C:\\out\\bathroom.ics');
      press(find('aftercare-ics-write'));
      await settle();
      const [sent] = calls('aftercare_ics_write') as Array<{
        path: string;
        text: string;
        overwrite: boolean;
      }>;
      expect(sent?.path).toBe('C:\\out\\bathroom.ics');
      expect(sent?.overwrite).toBe(false);
      const text = sent?.text ?? '';
      expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
      expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      expect(text).toContain('RRULE:FREQ=MONTHLY;INTERVAL=12');
      expect(text).toContain(words.taskSummary);
      expect(text).toContain('Shower valve');
      expect(text).toContain('Sample installer');
      expect(text).not.toContain('+55 11 0000-0000');
      expect(text).not.toContain('plumber@example.com');
      expect(find('aftercare-ics-done').textContent).toContain('C:\\out\\bathroom.ics');
    });
  },
);

describe('a work with no warranty and no task', () => {
  it('says the calendar has nothing, and offers no file to write', () => {
    render(PLAN, 'en');
    expect(find('aftercare-calendar-nothing')).toBeTruthy();
    expect(document.querySelector('[data-testid="aftercare-ics"]')).toBeNull();
    expect(find('maintenance-none')).toBeTruthy();
  });
});
