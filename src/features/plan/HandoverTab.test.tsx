// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activity, snapshot, stage } from '@/domain/__fixtures__/plan';
import type { CareNote, Check, CheckAnswer, WorkSnapshot } from '@/domain/plan';
import { ReportsPage } from '@/features/reports/ReportsPage';

import { GatesTab } from './GatesTab';
import { HandoverTab } from './HandoverTab';

/**
 * Slice D3's screens, rendered and pressed: the hidden-work check on the Gates tab, the Handover
 * tab's care notes and hidden-work list, and the handover book's card on Reports. The testids the
 * end-to-end suite reads are where it reads them, a "yes" without its photo is refused in the item's
 * own problem line before the host is asked, and what is sent is the host's own argument keys.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));

const HIDDEN: Check = {
  id: 'k-hidden',
  stageId: 's1',
  gate: 'close',
  position: 1,
  name: 'The pipes were photographed before the wall was closed',
  needsPhoto: true,
};
const ORDINARY: Check = {
  ...HIDDEN,
  id: 'k-plain',
  position: 2,
  name: 'Waste removed',
  needsPhoto: false,
};

const note = (
  id: string,
  kind: CareNote['targetKind'],
  target: string,
  position: number,
  text: string,
): CareNote => ({
  id,
  targetKind: kind,
  targetId: target,
  position,
  text,
  createdAt: '2026-09-20T10:00:00.000Z',
});

function work(parts: Partial<WorkSnapshot> = {}): WorkSnapshot {
  return snapshot({
    work: { ...snapshot().work, workId: 'w1', name: 'Bathroom' },
    rooms: [{ id: 'r1', position: 1, name: 'Shower room' }],
    stages: [{ ...stage('s1', 1, 'Rough-in'), startedAt: '2026-09-01T09:00:00.000Z' }],
    activities: [{ ...activity('a1', 's1', 1, 2), roomIds: ['r1'] }],
    checks: [HIDDEN, ORDINARY],
    ...parts,
  });
}

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(node: ReactNode) {
  act(() => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
}

function find(selector: string, within: ParentNode = host): HTMLElement {
  const found = within.querySelector<HTMLElement>(
    selector.startsWith('[') ? selector : `[data-testid="${selector}"]`,
  );
  if (found === null) throw new Error(`no ${selector}`);
  return found;
}

function set(element: HTMLElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function settle() {
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const calls = (command: string) =>
  invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args as unknown);

/** What the host answers: the plan as it is, an empty diary, or a refusal for one command. */
let answer: (command: string, args: unknown) => Promise<unknown>;

beforeEach(() => {
  invoke.mockReset();
  answer = (command) =>
    Promise.resolve(
      command === 'diary_list'
        ? []
        : command === 'work_get'
          ? work()
          : command.endsWith('_verify')
            ? null
            : work(),
    );
  invoke.mockImplementation((command: string, args: unknown) => answer(command, args));
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('a check of hidden work, on the Gates tab', () => {
  it('says it needs its photo, and shows its photo field open', () => {
    render(<GatesTab snapshot={work()} />);
    const item = find(`[data-check-id="${HIDDEN.id}"]`);
    expect(item.getAttribute('data-needs-photo')).toBe('true');
    expect(find(`[data-check-id="${ORDINARY.id}"]`).getAttribute('data-needs-photo')).toBe('false');
    const field = find('check-answer-photo-path', item);
    expect(field.closest('[hidden]')).toBeNull();
    const box = find('check-needs-photo', item) as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(true);
  });

  it('refuses a "yes" without a photo on the item itself, and asks nothing of the host', async () => {
    render(<GatesTab snapshot={work()} />);
    const item = find(`[data-check-id="${HIDDEN.id}"]`);
    act(() => find('check-answer-yes', item).click());
    await settle();
    expect(find('check-problem', item).textContent).toMatch(/needs a photo/);
    expect(calls('check_answer')).toEqual([]);
    // "No" needs no photo.
    act(() => find('check-answer-no', item).click());
    await settle();
    expect(calls('check_answer')).toEqual([
      { check_id: HIDDEN.id, answer: 'no', reason: null, photo_path: null, photo_hash: null },
    ]);
    expect(item.querySelector('[data-testid="check-problem"]')).toBeNull();
  });

  it('sends the "yes" with its photo, and says the host’s refusal on the item', async () => {
    answer = (command) =>
      command === 'check_answer'
        ? Promise.reject({ kind: 'photo_refused', message: 'pipes.png is not an image.' })
        : Promise.resolve(work());
    render(<GatesTab snapshot={work()} />);
    const item = find(`[data-check-id="${HIDDEN.id}"]`);
    set(find('check-answer-photo-path', item), 'C:\\photos\\pipes.png');
    act(() => find('check-answer-photo-add', item).click());
    act(() => find('check-answer-yes', item).click());
    await settle();
    expect(calls('check_answer')).toEqual([
      {
        check_id: HIDDEN.id,
        answer: 'yes',
        reason: null,
        photo_path: 'C:\\photos\\pipes.png',
        photo_hash: null,
      },
    ]);
    expect(find('check-problem', item).textContent).toBeTruthy();
    // The other item says nothing: the refusal is where the answer was tried.
    expect(
      find(`[data-check-id="${ORDINARY.id}"]`).querySelector('[data-testid="check-problem"]'),
    ).toBeNull();
  });

  it('is ticked with the host’s keys; refused, it reads back what the plan holds', async () => {
    answer = (command) =>
      command === 'check_needs_photo'
        ? Promise.reject({ kind: 'stage_closed', message: 'Rough-in is closed.' })
        : Promise.resolve(work());
    render(<GatesTab snapshot={work()} />);
    const plain = find(`[data-check-id="${ORDINARY.id}"]`);
    const box = find('check-needs-photo', plain) as HTMLInputElement;
    expect(box.checked).toBe(false);
    act(() => box.click());
    await settle();
    expect(calls('check_needs_photo')).toEqual([{ id: ORDINARY.id, needs_photo: true }]);
    // The host said no: the box shows what the plan holds, not what was pressed, and the sentence
    // is on the item.
    expect(box.checked).toBe(false);
    expect(find('check-problem', plain).textContent).toBeTruthy();
  });

  it('is not offered on a closed stage, which says the check needs its photo in words', () => {
    const closed = work({
      stages: [
        {
          ...stage('s1', 1, 'Rough-in'),
          startedAt: '2026-09-01T09:00:00.000Z',
          closedAt: '2026-09-09T09:00:00.000Z',
        },
      ],
    });
    render(<GatesTab snapshot={closed} />);
    const item = find(`[data-check-id="${HIDDEN.id}"]`);
    expect(item.querySelector('[data-testid="check-needs-photo"]')).toBeNull();
    expect(item.textContent).toContain('Needs a photo of the work before it is closed');
  });
});

describe('the Handover tab', () => {
  const notes = [
    note('n1', 'room', 'r1', 1, 'Reseal the shower grout once a year.'),
    note('n2', 'room', 'r1', 2, 'The trap unscrews by hand.'),
  ];

  it('has a block for the work, each room and each stage, and adds a note with the host’s keys', async () => {
    render(<HandoverTab snapshot={work()} onGates={() => undefined} />);
    expect(find('[data-care-target="work:w1"]')).toBeTruthy();
    expect(find('[data-care-target="stage:s1"]')).toBeTruthy();
    const room = find('[data-care-target="room:r1"]');
    act(() => find('care-note-add', room).click());
    expect(room.textContent).toContain('Write the note first.');
    expect(calls('care_note_add')).toEqual([]);
    set(find('care-note-add-text', room), '  Reseal the shower grout once a year.  ');
    act(() => find('care-note-add', room).click());
    await settle();
    expect(calls('care_note_add')).toEqual([
      { target_kind: 'room', target_id: 'r1', text: 'Reseal the shower grout once a year.' },
    ]);
  });

  it('edits a note in place, moves it and removes it — and the focus goes to the note left', async () => {
    render(<HandoverTab snapshot={work({ careNotes: notes })} onGates={() => undefined} />);
    const first = find('[data-care-note-id="n1"]');
    const field = find('care-note-text', first);
    act(() => field.focus());
    set(field, 'Reseal the grout every spring.');
    act(() => field.blur());
    await settle();
    expect(calls('care_note_update')).toEqual([
      { id: 'n1', text: 'Reseal the grout every spring.' },
    ]);

    act(() => find('care-note-down', first).click());
    await settle();
    expect(calls('care_note_move')).toEqual([{ id: 'n1', direction: 'down' }]);

    act(() => find('care-note-remove', first).click());
    await settle();
    expect(calls('care_note_remove')).toEqual([{ id: 'n1' }]);
    render(
      <HandoverTab
        snapshot={work({ careNotes: notes.filter((each) => each.id !== 'n1') })}
        onGates={() => undefined}
      />,
    );
    await settle();
    expect(document.activeElement).toBe(find('care-note-text', find('[data-care-note-id="n2"]')));
  });

  it('lists the hidden work with its state, leading to its item on Gates', () => {
    const answered: CheckAnswer = {
      id: 'ans',
      checkId: HIDDEN.id,
      seq: 1,
      answer: 'yes',
      reason: null,
      photoHash: null,
      authorName: 'Sample author',
      answeredAt: '2026-09-02T10:00:00.000Z',
    };
    const onGates = vi.fn();
    render(<HandoverTab snapshot={work({ checkAnswers: [answered] })} onGates={onGates} />);
    const row = find(`[data-hidden-check-id="${HIDDEN.id}"]`);
    expect(row.getAttribute('data-state')).toBe('yes-without-photo');
    expect(row.textContent).toContain('without a photo');
    expect(host.querySelector(`[data-hidden-check-id="${ORDINARY.id}"]`)).toBeNull();
    act(() => find('hidden-work-open', row).click());
    expect(onGates).toHaveBeenCalledWith(HIDDEN.id);
  });
});

describe('the handover book’s card', () => {
  it('says how many gaps the book has, in digits, and writes the book as the owner’s', async () => {
    answer = (command, args) => {
      if (command === 'diary_list') return Promise.resolve([]);
      if (command === 'report_pdf_write') {
        const { path } = args as { path: string };
        return Promise.resolve({ path, bytes: 1000, pages: 3 });
      }
      return Promise.resolve(null);
    };
    render(<ReportsPage snapshot={work()} />);
    await settle();
    expect(find('handover-gaps').textContent).toMatch(/\d/);
    expect(find('handover-in-progress').textContent).toContain('in progress');
    set(find('handover-path'), 'C:\\out\\handover.pdf');
    act(() => find('handover-write').click());
    await settle();
    const [sent] = calls('report_pdf_write') as Array<{
      path: string;
      overwrite: boolean;
      document: { kind: string; title: string };
    }>;
    expect(sent?.path).toBe('C:\\out\\handover.pdf');
    expect(sent?.overwrite).toBe(false);
    expect(sent?.document.kind).toBe('handover');
    expect(sent?.document.title).toBe('Handover book');
    expect(find('handover-done').textContent).toContain('handover.pdf');
    expect(find('report-open', find('handover-done'))).toBeTruthy();
  });
});
