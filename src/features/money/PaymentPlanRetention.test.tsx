// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_SETTINGS } from '@/data/commands';
import { keys } from '@/data/queries';
import { activity, person, snag, snagClosure, snapshot, stage } from '@/domain/__fixtures__/plan';
import type { Commitment, Milestone, MilestoneTrigger, Snag } from '@/domain/plan';
import type { Language } from '@/i18n/index';
import { build, I18nContext } from '@/i18n/useI18n';

import { ByStage } from './ByStage';

/**
 * Retention in a commitment's payment plan (slice E4, decisions 3 and 5), rendered and pressed in
 * both languages: **Hold back as retention** (`milestone-retention`) adds the last part at the
 * domain's suggested 5 %, with the sentence that says it is a usual practice, not advice, and sends
 * the host's keys; a plan already at 100 % keeps the button, disabled, with the reason beside it; a
 * retention reads "held until its snags are fixed (N open)" while a snag on the commitment's person
 * is open, and "earned on …" once they are closed and the stage is.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const AGREED = '2026-01-05';
const CLOSED_AT = '2026-03-02T12:00:00.000Z';

function milestone(
  id: string,
  position: number,
  label: string,
  shareBp: number,
  trigger: MilestoneTrigger,
  activityId: string | null = null,
): Milestone {
  return { id, position, label, shareBp, trigger, activityId };
}

const QUOTE: Commitment = {
  id: 'quote',
  stageId: 's',
  personId: 'tiler',
  label: 'Tiler’s quote',
  amountCents: 1000_00,
  agreedOn: AGREED,
  documentHash: null,
  milestones: [],
};

function work(
  milestones: readonly Milestone[],
  options: { closed?: boolean; snags?: readonly Snag[]; personId?: string | null } = {},
) {
  const base = stage('s', 1, 'Tiling');
  return snapshot({
    people: [person('tiler', 'C. Tiler')],
    stages: [
      options.closed === true
        ? { ...base, startedAt: '2026-02-02T12:00:00.000Z', closedAt: CLOSED_AT }
        : base,
    ],
    activities: [{ ...activity('lay', 's', 1, 2), name: 'Lay the tiles' }],
    commitments: [
      {
        ...QUOTE,
        personId: options.personId === undefined ? 'tiler' : options.personId,
        milestones,
      },
    ],
    snags: [...(options.snags ?? [])],
  });
}

const NINETY_FIVE = [
  milestone('m1', 1, 'Start', 3000, 'stage_started'),
  milestone('m2', 2, 'Laid', 4000, 'activity_finished', 'lay'),
  milestone('m3', 3, 'Close', 2500, 'stage_closed'),
];
const RETAINED = [...NINETY_FIVE, milestone('r', 4, 'Retention', 500, 'retention')];

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

function render(of: ReturnType<typeof work>, language: Language) {
  client.setQueryData(keys.settings, { ...BUILT_IN_SETTINGS, language });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nContext.Provider value={build(language, language)}>
          <ByStage snapshot={of} outcome={{ kept: () => undefined, refused: () => undefined }} />
        </I18nContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

function find(selector: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(
    selector.startsWith('[') ? selector : `[data-testid="${selector}"]`,
  );
  if (found === null) throw new Error(`no ${selector}`);
  return found;
}

async function settle() {
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command: string) =>
    Promise.resolve(command === 'diary_list' ? [] : null),
  );
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
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
    offer: 'Hold back as retention',
    label: 'Retention',
    advice: /5 % is a usual practice, not advice/,
    noPerson: /no snag can hold it/,
    full: /already 100 %/,
    held: 'held until its snags are fixed (1 open)',
    heldStage: 'held until Tiling closes',
    earned: /^earned on March 4, 2026/,
  },
  'pt-BR': {
    offer: 'Segurar como retenção',
    label: 'Retenção',
    advice: /5 % é uma prática comum, não um conselho/,
    noPerson: /nenhuma pendência pode segurá-lo/,
    full: /já está em 100 %/,
    held: 'retida até as pendências serem resolvidas (1 aberta)',
    heldStage: 'retida até Tiling fechar',
    earned: /^devido desde 4 de março/,
  },
} as const;

describe.each(['en', 'pt-BR'] as const)('retention in a payment plan, in %s', (language) => {
  const words = WORDS[language];

  it('holds back 5 % as the last part, says it is a usual practice and not advice, and sends the host’s keys', async () => {
    render(work(NINETY_FIVE), language);
    await settle();
    const offer = find('milestone-retention') as HTMLButtonElement;
    expect(offer.textContent).toBe(words.offer);
    expect(offer.disabled).toBe(false);
    const note = find('milestone-retention-note');
    expect(offer.getAttribute('aria-describedby')).toBe(note.id);
    expect(note.textContent).toMatch(words.advice);
    act(() => offer.click());
    await settle();
    expect(invoke).toHaveBeenCalledWith('milestone_add', {
      commitment_id: 'quote',
      label: words.label,
      share_bp: 500,
      trigger: 'retention',
      activity_id: null,
    });
  });

  it('tells a commitment on nobody that no snag can hold it', async () => {
    render(work(NINETY_FIVE, { personId: null }), language);
    await settle();
    expect(find('milestone-retention-note').textContent).toMatch(words.noPerson);
  });

  it('keeps the button on a plan at 100 %, disabled, with the reason beside it', async () => {
    render(work([...NINETY_FIVE, milestone('m4', 4, 'More', 500, 'stage_closed')]), language);
    await settle();
    const offer = find('milestone-retention') as HTMLButtonElement;
    expect(offer.disabled).toBe(true);
    expect(find('milestone-retention-note').textContent).toMatch(words.full);
  });

  it('offers no second retention', async () => {
    render(work(RETAINED), language);
    await settle();
    expect(host.querySelector('[data-testid="milestone-retention"]')).toBeNull();
  });

  it('reads held while its stage is open, held by an open snag on the person, and earned once fixed', async () => {
    render(work(RETAINED), language);
    await settle();
    const state = () =>
      find('[data-milestone-id="r"]').querySelector('[data-testid="milestone-state"]')!;
    expect(state().textContent).toBe(words.heldStage);

    const open = snag('n1', 1, 's', { personId: 'tiler', raisedOn: '2026-03-03' });
    render(work(RETAINED, { closed: true, snags: [open] }), language);
    await settle();
    expect(state().getAttribute('data-held')).toBe('true');
    expect(state().getAttribute('data-earned')).toBe('false');
    expect(state().textContent).toBe(words.held);

    // A snag on somebody else holds nothing.
    const elsewhere = snag('n2', 2, 's', { personId: null, raisedOn: '2026-03-03' });
    render(
      work(RETAINED, {
        closed: true,
        snags: [{ ...open, closure: snagClosure('fixed', '2026-03-04') }, elsewhere],
      }),
      language,
    );
    await settle();
    expect(state().getAttribute('data-held')).toBeNull();
    expect(state().getAttribute('data-earned')).toBe('true');
    expect(state().textContent).toMatch(words.earned);
  });
});
