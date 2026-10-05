// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavigationContext, type Navigation } from '@/app/navigation';
import { BUILT_IN_SETTINGS } from '@/data/commands';
import { keys } from '@/data/queries';
import {
  activity,
  changeOrder,
  decision,
  link,
  meeting,
  meetingAction,
  person,
  purchase,
  snag,
  snapshot,
  stage,
} from '@/domain/__fixtures__/plan';
import type { WorkSnapshot } from '@/domain/plan';
import { MeetingCard } from '@/features/dashboard/MeetingCard';
import { LANGUAGES, type Language } from '@/i18n/index';
import { termFor } from '@/i18n/terms';
import { build, I18nContext } from '@/i18n/useI18n';

import { MeetingPage } from './MeetingPage';

/**
 * This week's meeting on screen (slice G1, decisions 3 and 5), in both languages: the dashboard's
 * card says the last meeting and the actions it left, and opens the meeting; the meeting's agenda is
 * written from the record — the action still open, the decision overdue, the change order waiting,
 * the snag open — each item a `[data-agenda-item]` with its kind; a decision is made and a change
 * approved through the product's own dialogs, and each becomes the item's outcome; who was there is
 * ticked and typed; an action is written with who and by when; the carried action is closed as done;
 * and **Close the meeting…** says what will be written and sends the minutes whole, with the host's
 * keys. What the minutes lack is said in the page before the host is asked.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = '2026-09-09';
vi.mock('@/app/today', () => ({ today: () => TODAY, useToday: () => TODAY }));

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

// The work starts on Tuesday 1 September 2026; stage s2 is scheduled to start on the 11th, so its
// decision with five days of lead time is overdue on the 9th. Meeting #1 was on Friday the 4th.
const PLAN = snapshot({
  people: [person('p1', 'Sample tiler'), person('p2', 'Sample painter')],
  stages: [
    { ...stage('s1', 1, 'Walls'), startedAt: '2026-09-01T08:00:00.000Z' },
    stage('s2', 2, 'Painting'),
  ],
  activities: [
    activity('a1', 's1', 1, 5, 'p1'),
    activity('a2', 's1', 2, 3, 'p1'),
    activity('b1', 's2', 1, 4, 'p2'),
  ],
  dependencies: [link('l1', 'a1', 'a2'), link('l2', 'a2', 'b1')],
});

const WORK: WorkSnapshot = {
  ...PLAN,
  work: { ...PLAN.work, approvedAt: '2026-09-01T07:00:00.000Z' },
  decisions: [{ ...decision('d1', 's2', 1, 5), name: 'Choose the floor' }],
  changeOrders: [{ ...changeOrder('c1', 1, 's2', '2026-09-08'), title: 'Add a window' }],
  snags: [
    { ...snag('n1', 1, 's1', { raisedOn: '2026-09-02', dueOn: '2026-09-05' }), title: 'Crack' },
  ],
  meetings: [
    meeting('mt1', 1, '2026-09-04', {
      attendees: [{ position: 1, personId: 'p1', name: null }],
      actions: [
        meetingAction('x1', 'mt1', 1, {
          text: 'Send the tile samples',
          personId: 'p1',
          dueOn: '2026-09-08',
        }),
      ],
    }),
  ],
};

const NAVIGATION: Navigation = {
  openDocuments: () => undefined,
  openDiary: () => undefined,
  openPlan: () => undefined,
  openPaymentPlan: () => undefined,
  openSnapshot: () => undefined,
  openBackup: () => undefined,
  openSchedule: () => undefined,
  openChanges: () => undefined,
  openSnags: () => undefined,
  openPurchases: () => undefined,
  openMeeting: vi.fn(),
  openMinutes: vi.fn(),
};

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
const onDirty = vi.fn();
const onClosed = vi.fn();

function render(of: WorkSnapshot, language: Language, page: 'meeting' | 'card' = 'meeting') {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language, lens: 'owner' });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <NavigationContext.Provider value={NAVIGATION}>
            {page === 'meeting' ? (
              <MeetingPage
                snapshot={of}
                onLeave={() => undefined}
                onDirty={onDirty}
                onClosed={onClosed}
              />
            ) : (
              <MeetingCard snapshot={of} today={TODAY} />
            )}
          </NavigationContext.Provider>
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
  onDirty.mockReset();
  onClosed.mockReset();
  vi.mocked(NAVIGATION.openMeeting).mockReset();
  vi.mocked(NAVIGATION.openMinutes).mockReset();
  invoke.mockImplementation((command: string) => {
    if (command === 'settings_get') return Promise.resolve(null);
    if (command === 'diary_list') return Promise.resolve([]);
    return Promise.resolve(WORK);
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
  en: { title: 'This week’s meeting', close: 'Close the meeting…', who: 'Who was there' },
  'pt-BR': { title: 'Reunião da semana', close: 'Encerrar a reunião…', who: 'Quem esteve' },
} as const;

describe.each(LANGUAGES)('this week’s meeting, in %s', (language) => {
  const { t, day } = build(language, language);
  const words = WORDS[language];

  it('says the last meeting on the dashboard’s card and opens the meeting', () => {
    render(WORK, language, 'card');
    const card = find('dashboard-meeting');
    expect(card.textContent).toContain(words.title);
    expect(find('meeting-last').textContent).toBe(
      t('meeting.card.last', { number: 1, day: day('2026-09-04') }),
    );
    expect(find('meeting-actions-open-value').textContent).toBe('1');
    expect(find('meeting-actions-overdue-value').textContent).toBe('1');
    act(() => find('meeting-open').click());
    expect(NAVIGATION.openMeeting).toHaveBeenCalledTimes(1);
    act(() => find('dashboard-minutes').click());
    expect(NAVIGATION.openMinutes).toHaveBeenCalledTimes(1);
  });

  it('offers the first meeting when none was held, with no minutes to write', () => {
    render(PLAN, language, 'card');
    expect(find('meeting-last').textContent).toBe(t('meeting.card.none'));
    expect(document.body.querySelector('[data-testid="dashboard-minutes"]')).toBeNull();
    expect(find('meeting-open').textContent).toBe(t('meeting.open'));
  });

  it('writes the agenda from the record, by section, each item with its kind', async () => {
    render(WORK, language);
    await settle();
    expect(document.body.querySelector('h1')?.textContent).toBe(words.title);
    expect(find('meeting-agenda').textContent).toContain(t('meetings.agenda.section.actions'));
    const items = [...document.body.querySelectorAll<HTMLElement>('[data-agenda-item]')];
    const kinds = items.map((each) => each.getAttribute('data-kind'));
    expect(kinds.slice(0, 4)).toEqual(['action-carried', 'decision', 'change', 'snag']);
    const carried = find('[data-action-id="x1"]');
    expect(carried.textContent).toContain('Send the tile samples');
    expect(carried.getAttribute('data-overdue')).toBe('true');
    expect(find('meeting-item-overdue', carried).textContent).toContain(
      t('meetings.agenda.overdue'),
    );
    expect(find('[data-ref-id="d1"]').textContent).toContain('Choose the floor');
    expect(find('[data-ref-id="c1"]').textContent).toContain('Add a window');
    expect(find('[data-ref-id="n1"]').textContent).toContain('Crack');
    expect(find('meeting-close').textContent).toBe(words.close);
  });

  it('does what is decided through the product, and closes the meeting with its minutes', async () => {
    render(WORK, language);
    await settle();

    // Who was there: a person of the plan ticked, and somebody named.
    act(() => find('[data-person-id="p1"] [data-testid="meeting-attendee"]').click());
    set(find('meeting-attendee-name'), 'Sample architect');
    act(() => find('meeting-attendee-add').click());
    expect(onDirty).toHaveBeenLastCalledWith(true);

    // The decision, made in the meeting through the Decisions page's own dialog.
    const decisionItem = find('[data-ref-id="d1"]');
    act(() => find('[data-act="make"]', decisionItem).click());
    set(find('decision-answer'), 'White oak');
    act(() => find('decision-make-confirm').click());
    await settle();
    expect(calls('decision_make')).toEqual([{ id: 'd1', answer: 'White oak' }]);
    const made = t('meeting.outcome.decision', { answer: 'White oak' });
    expect(find('meeting-item-outcome', find('[data-ref-id="d1"]')).textContent).toContain(made);
    set(find('meeting-item-note', find('[data-ref-id="d1"]')), 'The owner chose on the spot.');

    // The change order, approved through E1's dialog with its impact.
    act(() => find('[data-act="approve"]', find('[data-ref-id="c1"]')).click());
    expect(find('change-impact')).toBeTruthy();
    act(() => find('change-confirm').click());
    await settle();
    expect(calls('change_order_decide')).toHaveLength(1);
    const changeOrder = termFor(language, 'owner', 'changeOrder');
    const approved = t('meeting.outcome.approved', {
      changeOrder: changeOrder.charAt(0).toLocaleUpperCase(language) + changeOrder.slice(1),
    });
    expect(find('meeting-item-outcome', find('[data-ref-id="c1"]')).textContent).toContain(
      approved,
    );

    // The action carried from meeting #1, done.
    act(() => find('action-done', find('[data-action-id="x1"]')).click());

    // A new action, on the painter, due on Friday.
    act(() => find('meeting-action-add').click());
    set(find('meeting-action-text'), 'Order the paint');
    set(find('meeting-action-person'), 'p2');
    set(find('meeting-action-due'), '2026-09-11');
    set(find('meeting-notes'), 'Next meeting on site.');

    act(() => find('meeting-close').click());
    await settle();
    const summary = find('meeting-summary');
    expect(summary.textContent).toContain(build(language, language).tp('meeting.close.actions', 1));
    act(() => find('meeting-confirm').click());
    await settle();

    const sent = calls('meeting_close') as Array<{ minutes: Record<string, unknown> }>;
    expect(sent).toHaveLength(1);
    const minutes = sent[0]!.minutes as {
      heldOn: string;
      notes: string | null;
      attendees: unknown[];
      items: Array<{
        kind: string;
        refId: string | null;
        note: string | null;
        outcome: string | null;
      }>;
      actions: unknown[];
      closures: unknown[];
    };
    expect(minutes.heldOn).toBe(TODAY);
    expect(minutes.notes).toBe('Next meeting on site.');
    expect(minutes.attendees).toEqual([
      { personId: 'p1', name: null },
      { personId: null, name: 'Sample architect' },
    ]);
    expect(minutes.actions).toEqual([
      { text: 'Order the paint', personId: 'p2', name: null, dueOn: '2026-09-11' },
    ]);
    expect(minutes.closures).toEqual([{ actionId: 'x1', outcome: 'done', note: null }]);
    const byRef = new Map(minutes.items.map((each) => [each.refId, each]));
    expect(byRef.get('d1')).toMatchObject({
      kind: 'decision',
      note: 'The owner chose on the spot.',
      outcome: made,
    });
    expect(byRef.get('c1')).toMatchObject({ kind: 'change', outcome: approved });
    expect(byRef.get('x1')).toMatchObject({
      kind: 'action-carried',
      outcome: t('meetings.action.state.done'),
    });
    expect(byRef.get('n1')).toMatchObject({ kind: 'snag', note: null, outcome: null });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('lists the purchase late to order, and marks it ordered through the Purchases dialog', async () => {
    // With nothing on the diary, as things stand Walls run from today, the 9th, and Painting starts
    // on the 21st: 21 days of lead time put its day to order by on 31 August, nine days ago.
    const withPurchase: WorkSnapshot = {
      ...WORK,
      purchases: [purchase('pu1', 1, 's2', 21, { name: 'Worktop' })],
    };
    render(withPurchase, language);
    await settle();
    const section = find('[data-agenda-section="purchases"]');
    expect(section.textContent).toContain(t('meetings.agenda.section.purchases'));
    const item = find('[data-ref-id="pu1"]', section);
    expect(item.getAttribute('data-kind')).toBe('other');
    expect(item.getAttribute('data-overdue')).toBe('true');
    expect(item.textContent).toContain('Worktop');
    expect(item.textContent).toContain(day('2026-08-31'));

    act(() => find('[data-act="ordered"]', item).click());
    expect(find('purchase-event').getAttribute('data-kind')).toBe('ordered');
    act(() => find('purchase-event-confirm').click());
    await settle();
    expect(calls('purchase_event_add')).toEqual([
      { event: { purchaseId: 'pu1', kind: 'ordered', day: TODAY, note: null } },
    ]);
    const ordered = t('meeting.outcome.ordered', { day: day(TODAY) });
    expect(find('meeting-item-outcome', find('[data-ref-id="pu1"]')).textContent).toContain(
      ordered,
    );
    expect(document.body.querySelector('[data-act="ordered"]')).toBeNull();

    act(() => find('meeting-close').click());
    await settle();
    act(() => find('meeting-confirm').click());
    await settle();
    const sent = calls('meeting_close') as Array<{
      minutes: { items: Array<{ kind: string; refId: string | null; outcome: string | null }> };
    }>;
    expect(sent[0]?.minutes.items.find((each) => each.refId === 'pu1')).toMatchObject({
      kind: 'other',
      outcome: ordered,
    });
  });

  it('says what the minutes lack in the page, and asks the host nothing', async () => {
    render(WORK, language);
    await settle();
    act(() => find('meeting-action-add').click());
    act(() => find('meeting-close').click());
    await settle();
    expect(find('meeting-problem').textContent).toContain(
      t('meetings.problem.actionTextEmpty', { position: '1' }),
    );
    expect(document.body.querySelector('[data-testid="meeting-confirm"]')).toBeNull();
    expect(calls('meeting_close')).toEqual([]);
  });

  it('names the screen and who was there in the language on screen', async () => {
    render(WORK, language);
    await settle();
    expect(document.body.textContent).toContain(words.who);
  });
});
