import { useMemo } from 'react';

import { useToday } from '@/app/today';
import { useDiary } from '@/data/queries';
import type { WorkSnapshot } from '@/domain/plan';
import {
  runway,
  runwayChance,
  RUNWAY_NOTE_KEYS,
  type Runway,
  type RunwayChance,
  type RunwayRow,
  type RunwaySentence,
} from '@/domain/runway';
import { schedule } from '@/domain/schedule';
import { frequencyText } from '@/features/reports/compose/words';
import type { MessageKey } from '@/i18n/en';
import type { PluralBase } from '@/i18n/index';
import { capitalised } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

/**
 * The words of **Will the money last?** (slice E2), in one place, so the Money page, the dashboard,
 * the weekly report and the owner's snapshot say the projection the same way: its sentence, what the
 * sentence leaves out, each row in words, and the chance. Nothing here computes money: every amount
 * and every day is the domain's (`runway.ts`), and only formatted here.
 */

type Words = Pick<I18n, 't' | 'tp' | 'number' | 'money' | 'day' | 'language'>;

/** Params that are money in cents; the rest are days (`week`) or counts. */
const MONEY_PARAMS = new Set(['spare', 'short', 'needed', 'amount']);
const DAY_PARAMS = new Set(['week', 'day']);

/**
 * The notes that count something, said by the language's plural rule: their key is a plural base,
 * `.one` and `.other` in the dictionaries.
 */
const PLURAL_NOTES: ReadonlySet<string> = new Set([
  RUNWAY_NOTE_KEYS.late,
  RUNWAY_NOTE_KEYS.notPriced,
  RUNWAY_NOTE_KEYS.beyond,
  RUNWAY_NOTE_KEYS.held,
]);

/** A sentence the domain hands over as a key and raw params, in words: money and days formatted. */
export function runwaySentenceText(
  i18n: Words,
  sentence: RunwaySentence,
  currency: string,
): string {
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(sentence.params)) {
    params[name] =
      typeof value === 'number' && MONEY_PARAMS.has(name)
        ? i18n.money(value, currency)
        : typeof value === 'string' && DAY_PARAMS.has(name)
          ? i18n.day(value)
          : typeof value === 'number'
            ? i18n.number(value)
            : value;
  }
  if (PLURAL_NOTES.has(sentence.key)) {
    return i18n.tp(sentence.key as PluralBase, Number(sentence.params.count ?? 0), params);
  }
  return i18n.t(sentence.key as MessageKey, params);
}

/** What the sentence leaves out, each in one sentence, in the domain's order. */
export function runwayNotes(i18n: Words, of: Runway, currency: string): string[] {
  return of.notes.map((note) => runwaySentenceText(i18n, note, currency));
}

/**
 * The short value of the runway, for a figure whose label says what it is: the week the money runs
 * short (its Monday), or what is left at the end.
 */
export function runwayValue(i18n: Words, of: Runway, currency: string): string {
  return of.shortWeek === null ? i18n.money(of.spare, currency) : i18n.day(of.shortWeek.from);
}

/** One row of the runway in words: what it is, of what, and why it falls where it does. */
export function runwayRowText(
  i18n: Words,
  row: RunwayRow,
  snapshot: WorkSnapshot,
): { title: string; kind: string; when: string } {
  const commitment =
    snapshot.commitments.find((each) => each.id === row.commitmentId)?.label ?? row.title;
  const stage = snapshot.stages.find((each) => each.id === row.stageId)?.name ?? '';
  const kind = i18n.t(row.messageKey as MessageKey, { commitment, stage });
  const when =
    row.source === 'funding' && row.when === 'past'
      ? i18n.t('money.runway.when.late', { day: i18n.day(row.expectedOn ?? row.day ?? '') })
      : i18n.t(row.whenKey as MessageKey, {
          day: i18n.day(row.expectedOn ?? row.day ?? ''),
          stage,
        });
  return { title: row.title, kind, when };
}

/** A row joined the way the screen and the page both join it: "Savings — money expected — on 5 Oct". */
export function runwayRowLine(
  i18n: Words,
  row: RunwayRow,
  snapshot: WorkSnapshot,
  currency: string,
): string {
  const parts = runwayRowText(i18n, row, snapshot);
  return [parts.title, parts.kind, parts.when, i18n.money(row.amountCents, currency)]
    .filter((part) => part !== '')
    .join(' — ');
}

/**
 * The chance the money runs short, in one sentence opening with a capital — "3 in 10 chances that
 * the money runs short before the work ends." — or that every duration is taken as certain, or why
 * nothing could be simulated. `null` while it is not known.
 */
export function runwayChanceText(i18n: Words, chance: RunwayChance): string {
  if (!chance.ok) return i18n.t(chance.messageKey as MessageKey);
  if (chance.kind === 'all-certain') return i18n.t(chance.sentence.key as MessageKey);
  return capitalised(
    i18n.language,
    i18n.t(chance.sentence.key as MessageKey, { chance: frequencyText(i18n, chance.frequency) }),
  );
}

/** How the chance was computed: "2,000 runs of the schedule with the ranges given; seeded …". */
export function runwayMethodText(i18n: Words, chance: RunwayChance): string | null {
  if (!chance.ok || chance.kind !== 'chance') return null;
  return i18n.t(chance.method.key as MessageKey, { runs: i18n.number(chance.runs) });
}

/**
 * The runway and its chance as of today, from the snapshot, the schedule and the diary — the same
 * three inputs every screen and page uses, so they say the same seeded numbers. `null` while the
 * diary is still being read: an "activity finished" milestone cannot be placed before then. A diary
 * that cannot be read is taken as empty, as the finish's chance takes it.
 */
export function useRunway(snapshot: WorkSnapshot): {
  runway: Runway;
  chance: RunwayChance;
} | null {
  const diary = useDiary(true);
  const today = useToday();
  const entries = diary.isError ? EMPTY : diary.data;
  return useMemo(() => {
    if (entries === undefined) return null;
    const scheduled = schedule(snapshot);
    return {
      runway: runway(snapshot, scheduled, entries, today),
      chance: runwayChance(snapshot, scheduled, entries, today),
    };
  }, [snapshot, entries, today]);
}

/**
 * The runway alone, for a screen that shows its figure and not its chance (the dashboard): the
 * chance runs the whole simulation, so it is asked only where it is said.
 */
export function useRunwayOnly(snapshot: WorkSnapshot): Runway | null {
  const diary = useDiary(true);
  const today = useToday();
  const entries = diary.isError ? EMPTY : diary.data;
  return useMemo(
    () => (entries === undefined ? null : runway(snapshot, schedule(snapshot), entries, today)),
    [snapshot, entries, today],
  );
}

const EMPTY: readonly never[] = [];
